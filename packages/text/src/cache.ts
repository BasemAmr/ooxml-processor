/**
 * The Measurement Cache (P4-11).
 *
 * Implements Ticket P4-11 and ADR 0004.
 *
 * ## Architectural Role & The Zero-Allocation Hot Path
 * The measurement cache is the single hottest data structure in the text and layout
 * engine. Every line break candidate, relayout cycle, and hit-test query interrogates it.
 *
 * ### THE TRAP (P4-11):
 * If the cache key is constructed via template strings (`${faceId}:${size}:${feat}:${text}`),
 * string allocations occur on EVERY query. Under typical layout workloads (thousands of word
 * queries per page), garbage collection pauses from string key churn exceed the shaping
 * computation itself.
 *
 * ### ZERO ALLOCATION ON HIT:
 * 1. Keying uses a 4-tuple of interned primitives: `(faceId, sizeInHalfPoints, featureSetId, textHandle)`.
 * 2. Lookup traverses nested numeric maps without constructing any composite key object, string,
 *    or BigInt.
 * 3. Cache hits update the LRU doubly-linked list in-place by mutating existing pointer references,
 *    guaranteeing 0 bytes allocated on heap during hits.
 *
 * ### TWO-TIER CACHE ARCHITECTURE:
 * - L1: Shaped runs cache. Keyed by (faceId, sizeInHalfPoints, featureSetId, textHandle).
 *   Invalidated by font face loading (P4-05) and text modifications.
 * - L2: Whole-line candidate measurement cache for line break evaluation.
 *   Invalidated whenever L1 is invalidated, plus whenever available column width changes.
 *
 * ### MEMORY-BOUNDED LRU EVICTION:
 * Eviction is strictly bounded by memory bytes (`maxBytes`, default 16MB), NOT entry count.
 * A cached CJK paragraph with hundreds of packed Float64 clusters consumes orders of
 * magnitude more memory than a single Latin word; entry-count LRU would allow unbounded
 * heap expansion.
 */

import type { ShaperFeatureOptions } from './shaper.js';
import { CLUSTER_STRIDE, PackedShapedRun, type ShapedRun } from './shaped-run.js';

/**
 * Default maximum cache budget: 16 MB (16 * 1024 * 1024 bytes).
 */
export const DEFAULT_MAX_CACHE_BYTES = 16 * 1024 * 1024;

/**
 * Estimated fixed metadata overhead in bytes per cache entry.
 * Accounts for the V8 JS object wrapper, Map bucket entry, doubly-linked list
 * pointers, and reference slots.
 */
export const NODE_METADATA_OVERHEAD_BYTES = 128;

/**
 * Calculates the memory footprint in bytes of a ShapedRun in memory.
 *
 * Packed cluster storage uses Float64Array (8 bytes per slot) with CLUSTER_STRIDE = 6.
 * Prefix advances table adds (clusterCount + 1) * 8 bytes.
 */
export function estimateShapedRunBytes(run: ShapedRun): number {
  const clusterBytes = run.clusterCount * CLUSTER_STRIDE * 8;
  const prefixBytes = (run.clusterCount + 1) * 8;
  return clusterBytes + prefixBytes + NODE_METADATA_OVERHEAD_BYTES;
}

/**
 * Bidirectional interning table mapping unique text strings to integer handles.
 *
 * Eliminates string hashing and comparisons in hot measurement loops by substituting
 * O(1) integer handles for text content.
 */
export class TextInternTable {
  private readonly stringToHandle = new Map<string, number>();
  private readonly handleToString: string[] = [];
  private nextHandle = 1; // 1-based so 0 can serve as a sentinel if needed

  /**
   * Interns a string and returns its unique positive integer handle.
   * Idempotent: identical strings receive identical handles.
   */
  intern(text: string): number {
    const existing = this.stringToHandle.get(text);
    if (existing !== undefined) {
      return existing;
    }
    const handle = this.nextHandle++;
    this.stringToHandle.set(text, handle);
    this.handleToString[handle] = text;
    return handle;
  }

  /**
   * Retrieves the original string associated with an interned handle.
   */
  getText(handle: number): string | undefined {
    return this.handleToString[handle];
  }

  /**
   * Gets the handle for a string if already interned, without allocating a new handle.
   */
  getHandle(text: string): number | undefined {
    return this.stringToHandle.get(text);
  }

  /**
   * Returns true if the string has already been interned.
   */
  has(text: string): boolean {
    return this.stringToHandle.has(text);
  }

  /**
   * Resets the interning table.
   */
  clear(): void {
    this.stringToHandle.clear();
    this.handleToString.length = 0;
    this.nextHandle = 1;
  }

  /**
   * Total number of unique interned strings.
   */
  get size(): number {
    return this.stringToHandle.size;
  }
}

/**
 * Interning table mapping OpenType feature options to compact integer handles.
 *
 * Uses a deterministic 5-bit bitmask encoding standard shaping flags:
 *   bit 0: liga (standard ligatures)
 *   bit 1: clig (contextual ligatures)
 *   bit 2: kern (kerning pairs)
 *   bit 3: calt (contextual alternates)
 *   bit 4: vert (vertical alternates)
 *
 * Because the mapping is pure bitwise arithmetic, intern() allocates NO heap objects.
 */
export class FeatureSetInternTable {
  /**
   * Computes a unique 5-bit integer handle from ShaperFeatureOptions.
   */
  static featureSetToId(features?: ShaperFeatureOptions | undefined): number {
    // Standard defaults: liga, clig, kern, calt default to true; vert defaults to false.
    const liga = features?.liga !== false ? 1 : 0;
    const clig = features?.clig !== false ? 2 : 0;
    const kern = features?.kern !== false ? 4 : 0;
    const calt = features?.calt !== false ? 8 : 0;
    const vert = features?.vert ? 16 : 0;
    return liga | clig | kern | calt | vert;
  }

  /**
   * Decodes an integer handle back into canonical ShaperFeatureOptions.
   */
  static idToFeatureSet(id: number): ShaperFeatureOptions {
    return {
      liga: (id & 1) !== 0,
      clig: (id & 2) !== 0,
      kern: (id & 4) !== 0,
      calt: (id & 8) !== 0,
      vert: (id & 16) !== 0,
    };
  }

  intern(features?: ShaperFeatureOptions | undefined): number {
    return FeatureSetInternTable.featureSetToId(features);
  }

  getFeatures(id: number): ShaperFeatureOptions {
    return FeatureSetInternTable.idToFeatureSet(id);
  }

  clear(): void {
    // Pure arithmetic interner; no state to clear
  }

  get size(): number {
    return 32; // Exactly 2^5 = 32 distinct flag states
  }
}

/**
 * Doubly-linked list node for L1 cache entries.
 * Retains key metadata for exact multi-level invalidation and memory-bounded LRU eviction.
 */
export interface L1CacheNode {
  readonly faceId: number;
  readonly sizeInHalfPoints: number;
  readonly featureSetId: number;
  readonly textHandle: number;
  readonly run: ShapedRun;
  readonly byteSize: number;
  prev: L1CacheNode | null;
  next: L1CacheNode | null;
}

/**
 * Runtime telemetry statistics for the measurement cache.
 */
export interface CacheStats {
  /** Cumulative cache hits across L1 */
  readonly hits: number;
  /** Cumulative cache misses across L1 */
  readonly misses: number;
  /** Ratio of hits to total lookups [0.0..1.0] */
  readonly hitRate: number;
  /** Number of active shaped-run entries in L1 */
  readonly entryCountL1: number;
  /** Number of candidate line measurements in L2 */
  readonly entryCountL2: number;
  /** Estimated current memory consumption of cached entries in bytes */
  readonly currentBytes: number;
  /** Maximum memory capacity in bytes */
  readonly maxBytes: number;
}

/**
 * Configuration options for `MeasurementCache`.
 */
export interface MeasurementCacheOptions {
  /** Maximum memory capacity in bytes. Default: 16 MB */
  readonly maxBytes?: number | undefined;
  /** Custom or shared TextInternTable instance */
  readonly textInterner?: TextInternTable | undefined;
  /** Custom or shared FeatureSetInternTable instance */
  readonly featureInterner?: FeatureSetInternTable | undefined;
}

/**
 * Two-tier, memory-bounded, zero-allocation measurement cache (Ticket P4-11).
 */
export class MeasurementCache {
  readonly maxBytes: number;
  readonly textInterner: TextInternTable;
  readonly featureInterner: FeatureSetInternTable;

  /**
   * L1 Storage: 4-level nested Map hierarchy avoiding composite string/object keys:
   * faceId -> sizeInHalfPoints -> featureSetId -> textHandle -> L1CacheNode
   */
  private readonly l1Store = new Map<number, Map<number, Map<number, Map<number, L1CacheNode>>>>();

  /**
   * Reverse index: textHandle -> Set<L1CacheNode>.
   * Enables O(K) exact invalidation when document text changes, without full-cache scans.
   */
  private readonly textToNodes = new Map<number, Set<L1CacheNode>>();

  /**
   * L2 Storage: whole-line candidate measurements for line break loops.
   * lineHandle (or lineId) -> availableWidthTwips -> totalAdvance
   */
  private readonly l2Store = new Map<number, Map<number, number>>();
  private entryCountL2Val = 0;

  /** LRU doubly-linked list head (most recently accessed) */
  private head: L1CacheNode | null = null;
  /** LRU doubly-linked list tail (least recently accessed, candidate for eviction) */
  private tail: L1CacheNode | null = null;

  private entryCountL1Val = 0;
  private currentBytesVal = 0;
  private hitsVal = 0;
  private missesVal = 0;

  constructor(options?: MeasurementCacheOptions | undefined) {
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_CACHE_BYTES;
    this.textInterner = options?.textInterner ?? new TextInternTable();
    this.featureInterner = options?.featureInterner ?? new FeatureSetInternTable();
  }

  // ---------------------------------------------------------------------------
  // L1 SHAPED RUN LOOKUP & INSERTION (HOT-PATH ZERO ALLOCATION)
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a cached ShapedRun for the given parameters.
   *
   * ## ZERO ALLOCATION GUARANTEE:
   * Operates purely on primitive numeric handles without allocating strings, objects,
   * arrays, or BigInts. On a hit, existing doubly-linked list pointers are rearranged in place.
   */
  getL1(
    faceId: number,
    sizeInHalfPoints: number,
    featureSetId: number,
    textHandle: number,
  ): ShapedRun | undefined {
    // 1. Traverse 4-level nested map using native integer lookups
    const bySize = this.l1Store.get(faceId);
    if (bySize === undefined) {
      this.missesVal++;
      return undefined;
    }

    const byFeat = bySize.get(sizeInHalfPoints);
    if (byFeat === undefined) {
      this.missesVal++;
      return undefined;
    }

    const byText = byFeat.get(featureSetId);
    if (byText === undefined) {
      this.missesVal++;
      return undefined;
    }

    const node = byText.get(textHandle);
    if (node === undefined) {
      this.missesVal++;
      return undefined;
    }

    // 2. Cache Hit: Move to head of LRU list via pointer mutation (no allocations!)
    this.moveToHead(node);
    this.hitsVal++;
    return node.run;
  }

  /**
   * Stores a ShapedRun in the L1 cache.
   * Enforces memory-bounded LRU eviction if insertion causes memory to exceed maxBytes.
   */
  putL1(
    faceId: number,
    sizeInHalfPoints: number,
    featureSetId: number,
    textHandle: number,
    run: ShapedRun,
  ): void {
    // Check if an entry with this identical 4-tuple already exists
    const existing = this.lookupNode(faceId, sizeInHalfPoints, featureSetId, textHandle);
    if (existing !== undefined) {
      // Remove previous entry's footprint before replacing it
      this.removeNode(existing);
    }

    const byteSize = estimateShapedRunBytes(run);
    const node: L1CacheNode = {
      faceId,
      sizeInHalfPoints,
      featureSetId,
      textHandle,
      run,
      byteSize,
      prev: null,
      next: null,
    };

    // Insert into 4-level nested Map hierarchy
    let bySize = this.l1Store.get(faceId);
    if (bySize === undefined) {
      bySize = new Map();
      this.l1Store.set(faceId, bySize);
    }

    let byFeat = bySize.get(sizeInHalfPoints);
    if (byFeat === undefined) {
      byFeat = new Map();
      bySize.set(sizeInHalfPoints, byFeat);
    }

    let byText = byFeat.get(featureSetId);
    if (byText === undefined) {
      byText = new Map();
      byFeat.set(featureSetId, byText);
    }

    byText.set(textHandle, node);

    // Insert into LRU at head
    this.insertAtHead(node);
    this.currentBytesVal += byteSize;
    this.entryCountL1Val++;

    // Add to reverse index for fast invalidation by text
    let nodeSet = this.textToNodes.get(textHandle);
    if (nodeSet === undefined) {
      nodeSet = new Set();
      this.textToNodes.set(textHandle, nodeSet);
    }
    nodeSet.add(node);

    // Enforce memory budget by evicting oldest entries from tail
    this.evictToBudget();
  }

  // ---------------------------------------------------------------------------
  // L2 WHOLE-LINE CANDIDATE MEASUREMENTS
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a candidate whole-line measurement.
   */
  getL2(lineId: number, availableWidthTwips: number): number | undefined {
    const byWidth = this.l2Store.get(lineId);
    if (byWidth === undefined) return undefined;
    return byWidth.get(availableWidthTwips);
  }

  /**
   * Stores a candidate whole-line measurement.
   */
  putL2(lineId: number, availableWidthTwips: number, advance: number): void {
    let byWidth = this.l2Store.get(lineId);
    if (byWidth === undefined) {
      byWidth = new Map();
      this.l2Store.set(lineId, byWidth);
    }
    if (!byWidth.has(availableWidthTwips)) {
      this.entryCountL2Val++;
    }
    byWidth.set(availableWidthTwips, advance);
  }

  /**
   * Clears all L2 whole-line measurements (e.g. when container column width changes).
   */
  clearL2(): void {
    this.l2Store.clear();
    this.entryCountL2Val = 0;
  }

  // ---------------------------------------------------------------------------
  // EXACT INVALIDATION
  // ---------------------------------------------------------------------------

  /**
   * Invalidates all L1 cache entries associated with a font face ID.
   *
   * Crucial for Ticket P4-05 (FontFace loading): when a web or embedded font finishes
   * loading or fails to load, interim fallback measurements must be purged immediately.
   * Also clears L2 since line breaks using this face are now invalid.
   *
   * @returns Number of L1 entries invalidated.
   */
  invalidateFace(faceId: number): number {
    const bySize = this.l1Store.get(faceId);
    if (bySize === undefined) {
      return 0;
    }

    let invalidatedCount = 0;
    // Collect all nodes for this face to remove them safely
    const nodesToRemove: L1CacheNode[] = [];
    for (const byFeat of bySize.values()) {
      for (const byText of byFeat.values()) {
        for (const node of byText.values()) {
          nodesToRemove.push(node);
        }
      }
    }

    for (const node of nodesToRemove) {
      this.removeNode(node);
      invalidatedCount++;
    }

    // Clear L2 because line break candidate measurements depend on font face metrics
    this.clearL2();

    return invalidatedCount;
  }

  /**
   * Invalidates all L1 entries referencing an interned text handle.
   *
   * Called when a paragraph or run's text is modified in the editor.
   * Uses reverse index `textToNodes` for O(K) exact deletion without scanning the cache.
   *
   * @returns Number of L1 entries invalidated.
   */
  invalidateText(textHandle: number): number {
    const nodeSet = this.textToNodes.get(textHandle);
    if (nodeSet === undefined || nodeSet.size === 0) {
      return 0;
    }

    let count = 0;
    // Copy into an array because removeNode mutates nodeSet
    const nodes = Array.from(nodeSet);
    for (const node of nodes) {
      this.removeNode(node);
      count++;
    }

    // Clear L2 since affected text spans may change line break widths
    this.clearL2();

    return count;
  }

  /**
   * Purges all L1 and L2 cache entries and resets memory telemetry.
   */
  clear(): void {
    this.l1Store.clear();
    this.textToNodes.clear();
    this.l2Store.clear();
    this.head = null;
    this.tail = null;
    this.entryCountL1Val = 0;
    this.entryCountL2Val = 0;
    this.currentBytesVal = 0;
    this.hitsVal = 0;
    this.missesVal = 0;
  }

  // ---------------------------------------------------------------------------
  // TELEMETRY & OBSERVABILITY
  // ---------------------------------------------------------------------------

  /**
   * Returns a snapshot of runtime cache telemetry.
   */
  getStats(): CacheStats {
    const total = this.hitsVal + this.missesVal;
    const hitRate = total > 0 ? this.hitsVal / total : 0;
    return {
      hits: this.hitsVal,
      misses: this.missesVal,
      hitRate,
      entryCountL1: this.entryCountL1Val,
      entryCountL2: this.entryCountL2Val,
      currentBytes: this.currentBytesVal,
      maxBytes: this.maxBytes,
    };
  }

  /**
   * Resets hit and miss counters while retaining cached entries.
   */
  resetHitCounters(): void {
    this.hitsVal = 0;
    this.missesVal = 0;
  }

  // ---------------------------------------------------------------------------
  // INTERNAL LRU & LINKED LIST MANAGEMENT (Zero-allocation mutations)
  // ---------------------------------------------------------------------------

  private lookupNode(
    faceId: number,
    sizeInHalfPoints: number,
    featureSetId: number,
    textHandle: number,
  ): L1CacheNode | undefined {
    return this.l1Store.get(faceId)?.get(sizeInHalfPoints)?.get(featureSetId)?.get(textHandle);
  }

  /**
   * Moves an existing node to the head of the doubly-linked list.
   * Performs strictly in-place pointer updates: zero object or string allocation!
   */
  private moveToHead(node: L1CacheNode): void {
    if (this.head === node) return; // already at head

    // Detach from current position
    if (node.prev !== null) {
      node.prev.next = node.next;
    }
    if (node.next !== null) {
      node.next.prev = node.prev;
    }
    if (this.tail === node) {
      this.tail = node.prev;
    }

    // Attach to head
    node.prev = null;
    node.next = this.head;
    if (this.head !== null) {
      this.head.prev = node;
    }
    this.head = node;

    if (this.tail === null) {
      this.tail = node;
    }
  }

  /**
   * Inserts a newly created node at the head of the doubly-linked list.
   */
  private insertAtHead(node: L1CacheNode): void {
    node.prev = null;
    node.next = this.head;

    if (this.head !== null) {
      this.head.prev = node;
    }
    this.head = node;

    if (this.tail === null) {
      this.tail = node;
    }
  }

  /**
   * Detaches a node from the doubly-linked list.
   */
  private detachNode(node: L1CacheNode): void {
    if (node.prev !== null) {
      node.prev.next = node.next;
    } else if (this.head === node) {
      this.head = node.next;
    }

    if (node.next !== null) {
      node.next.prev = node.prev;
    } else if (this.tail === node) {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * Removes a node completely from the cache: L1 maps, LRU list, reverse index,
   * and byte tracking.
   */
  private removeNode(node: L1CacheNode): void {
    // 1. Detach from LRU list
    this.detachNode(node);

    // 2. Remove from nested maps, cleaning up empty parent maps
    const bySize = this.l1Store.get(node.faceId);
    if (bySize !== undefined) {
      const byFeat = bySize.get(node.sizeInHalfPoints);
      if (byFeat !== undefined) {
        const byText = byFeat.get(node.featureSetId);
        if (byText !== undefined) {
          byText.delete(node.textHandle);
          if (byText.size === 0) {
            byFeat.delete(node.featureSetId);
          }
        }
        if (byFeat.size === 0) {
          bySize.delete(node.sizeInHalfPoints);
        }
      }
      if (bySize.size === 0) {
        this.l1Store.delete(node.faceId);
      }
    }

    // 3. Remove from text reverse index
    const nodeSet = this.textToNodes.get(node.textHandle);
    if (nodeSet !== undefined) {
      nodeSet.delete(node);
      if (nodeSet.size === 0) {
        this.textToNodes.delete(node.textHandle);
      }
    }

    // 4. Update byte tracking & counts
    this.currentBytesVal -= node.byteSize;
    this.entryCountL1Val--;
  }

  /**
   * Enforces the memory budget by evicting oldest entries from the tail until
   * currentBytes <= maxBytes.
   */
  private evictToBudget(): void {
    while (this.currentBytesVal > this.maxBytes && this.tail !== null) {
      // Evict oldest entry from tail
      this.removeNode(this.tail);
    }
  }
}
