/**
 * ShapedRun Representation and Packed Cluster Storage (P4-12).
 *
 * Implements Ticket P4-12.
 *
 * ## Architectural Contract with Phase 5 (Line Box) and Phase 6 (Caret / Affinity)
 *
 * 1. Flat Packed Numeric Storage:
 *    To eliminate garbage collection churn in the hot layout break loop, clusters
 *    are stored in a single contiguous Float64Array rather than an array of individual
 *    JavaScript objects. Each cluster occupies exactly `CLUSTER_STRIDE = 6` 64-bit slots:
 *      [glyphId, xAdvance, xOffset, yOffset, srcOffset, srcLength]
 *
 * 2. Visual Order vs Logical Order:
 *    - Clusters are stored in strictly VISUAL order (left-to-right screen order).
 *      This allows painters and line breakers to iterate sequentially (`x += xAdvance`)
 *      without branching on text direction.
 *    - `srcOffset` represents the LOGICAL character offset in the source document string.
 *    - In LTR runs, visual order and logical order both progress forward.
 *    - In RTL runs, visual cluster 0 is the leftmost glyph on screen (the logical END of the word),
 *      while visual cluster N-1 is the rightmost glyph on screen (the logical START).
 *      Thus, across an RTL run, `srcOffset` is monotonically decreasing in visual array order.
 *
 * 3. O(1) Allocation-Free Slicing:
 *    The line breaking loop measures candidate prefixes constantly (P5-01). Slicing a
 *    ShapedRun must NEVER copy the cluster buffer. Slicing returns a view sharing the
 *    underlying Float64Array and computes slice totalAdvance in O(1) using precomputed
 *    prefix advance sums.
 *
 * 4. O(log N) Source Offset Mapping:
 *    Because `srcOffset` and `srcLength` tile the logical source with no gaps or overlaps,
 *    mapping any source offset to its visual cluster index is a binary search.
 */

/**
 * Number of Float64 slots per cluster in the packed storage buffer.
 */
export const CLUSTER_STRIDE = 6;

/** Field offset within a cluster stride: 32-bit glyph identifier or codepoint */
export const GLYPH_ID_OFFSET = 0;
/** Field offset within a cluster stride: horizontal advance in twips (or design units) */
export const X_ADVANCE_OFFSET = 1;
/** Field offset within a cluster stride: horizontal glyph positioning adjustment */
export const X_OFFSET_OFFSET = 2;
/** Field offset within a cluster stride: vertical glyph positioning adjustment */
export const Y_OFFSET_OFFSET = 3;
/** Field offset within a cluster stride: logical UTF-16 code unit start offset in source text */
export const SRC_OFFSET_OFFSET = 4;
/** Field offset within a cluster stride: logical length in UTF-16 code units */
export const SRC_LENGTH_OFFSET = 5;

/**
 * Text direction of a shaped run.
 */
export type RunDirection = 'ltr' | 'rtl';

/**
 * Immutable interface for a shaped text run handed across the text -> layout boundary.
 */
export interface ShapedRun {
  /** Interned font face identifier for cache keying and rendering */
  readonly faceId: number;
  /** Font size in half-points (1 pt = 2 half-points) */
  readonly fontSize: number;
  /** Primary text direction */
  readonly direction: RunDirection;
  /** Script tag or slot (e.g., 'latn', 'arab', 'ascii', 'cs') */
  readonly script: string;
  /** Total number of visual clusters contained in this run */
  readonly clusterCount: number;
  /** Precomputed total horizontal advance of all clusters in twips (O(1) query) */
  readonly totalAdvance: number;

  /** Gets the glyph ID for the visual cluster at index */
  glyphId(index: number): number;
  /** Gets the horizontal advance for the visual cluster at index */
  xAdvance(index: number): number;
  /** Gets the horizontal placement offset for the visual cluster at index */
  xOffset(index: number): number;
  /** Gets the vertical placement offset for the visual cluster at index */
  yOffset(index: number): number;
  /** Gets the logical starting offset in source text for the visual cluster at index */
  srcOffset(index: number): number;
  /** Gets the logical length in code units for the visual cluster at index */
  srcLength(index: number): number;

  /**
   * Maps a logical source character offset to its corresponding visual cluster index
   * using binary search in O(log N) time.
   *
   * @param srcOffset Logical UTF-16 code unit offset in source text.
   * @returns Visual cluster index [0..clusterCount - 1], or -1 if outside this run's source range.
   */
  clusterAtSourceOffset(srcOffset: number): number;

  /**
   * Creates an O(1) allocation-free view over a sub-range of clusters in this run.
   * Does NOT copy the underlying packed numeric array.
   *
   * @param startCluster Starting visual cluster index (inclusive).
   * @param endCluster Ending visual cluster index (exclusive). Defaults to clusterCount.
   */
  slice(startCluster: number, endCluster?: number): ShapedRun;
}

/**
 * Construction options for `PackedShapedRun`.
 */
export interface PackedShapedRunOptions {
  readonly faceId: number;
  readonly fontSize: number;
  readonly direction: RunDirection;
  readonly script: string;
  readonly clusterStorage: Float64Array;
  readonly clusterStart?: number | undefined;
  readonly clusterCount: number;
  readonly totalAdvance?: number | undefined;
  readonly prefixAdvances?: Float64Array | undefined;
}

/**
 * High-performance packed numeric implementation of `ShapedRun`.
 */
export class PackedShapedRun implements ShapedRun {
  readonly faceId: number;
  readonly fontSize: number;
  readonly direction: RunDirection;
  readonly script: string;
  readonly clusterCount: number;
  readonly totalAdvance: number;

  /** The shared underlying packed Float64 storage */
  readonly clusterStorage: Float64Array;
  /** Cluster offset within the storage where this run begins */
  readonly clusterStart: number;
  /**
   * Precomputed cumulative advance sums for clusters starting at clusterStart.
   * prefixAdvances[k] = sum of xAdvances for visual clusters [0..k-1].
   * Enables O(1) totalAdvance calculation for any arbitrary slice.
   */
  private readonly prefixAdvances: Float64Array;

  constructor(options: PackedShapedRunOptions) {
    this.faceId = options.faceId;
    this.fontSize = options.fontSize;
    this.direction = options.direction;
    this.script = options.script;
    this.clusterStorage = options.clusterStorage;
    this.clusterStart = options.clusterStart ?? 0;
    this.clusterCount = Math.max(0, options.clusterCount);

    if (options.prefixAdvances) {
      // Sliced view: reuse existing prefixAdvances array
      this.prefixAdvances = options.prefixAdvances;
      if (options.totalAdvance !== undefined) {
        this.totalAdvance = options.totalAdvance;
      } else {
        const startIdx = this.clusterStart;
        const endIdx = this.clusterStart + this.clusterCount;
        this.totalAdvance = this.prefixAdvances[endIdx]! - this.prefixAdvances[startIdx]!;
      }
    } else {
      // Root instance: build prefix advance sum table once
      const count = this.clusterCount;
      const prefixes = new Float64Array(count + 1);
      let runningSum = 0;
      prefixes[0] = 0;

      const baseOffset = this.clusterStart * CLUSTER_STRIDE;
      for (let i = 0; i < count; i++) {
        const advance = this.clusterStorage[baseOffset + i * CLUSTER_STRIDE + X_ADVANCE_OFFSET]!;
        runningSum += advance;
        prefixes[i + 1] = runningSum;
      }

      this.prefixAdvances = prefixes;
      this.totalAdvance = options.totalAdvance ?? runningSum;
    }
  }

  /**
   * Asserts index validity to prevent out-of-bounds reads corrupting layout state.
   */
  private checkBounds(index: number): number {
    if (index < 0 || index >= this.clusterCount) {
      throw new RangeError(
        `Cluster index ${index} out of range [0, ${this.clusterCount}) in ShapedRun.`,
      );
    }
    return (this.clusterStart + index) * CLUSTER_STRIDE;
  }

  glyphId(index: number): number {
    const offset = this.checkBounds(index);
    return this.clusterStorage[offset + GLYPH_ID_OFFSET]!;
  }

  xAdvance(index: number): number {
    const offset = this.checkBounds(index);
    return this.clusterStorage[offset + X_ADVANCE_OFFSET]!;
  }

  xOffset(index: number): number {
    const offset = this.checkBounds(index);
    return this.clusterStorage[offset + X_OFFSET_OFFSET]!;
  }

  yOffset(index: number): number {
    const offset = this.checkBounds(index);
    return this.clusterStorage[offset + Y_OFFSET_OFFSET]!;
  }

  srcOffset(index: number): number {
    const offset = this.checkBounds(index);
    return this.clusterStorage[offset + SRC_OFFSET_OFFSET]!;
  }

  srcLength(index: number): number {
    const offset = this.checkBounds(index);
    return this.clusterStorage[offset + SRC_LENGTH_OFFSET]!;
  }

  /**
   * Binary search mapping logical source offset to visual cluster index.
   *
   * In LTR:
   *   Visual cluster index progresses in same direction as logical srcOffset (monotonic non-decreasing).
   * In RTL:
   *   Visual clusters progress left-to-right, so visual cluster 0 is at the highest logical offset,
   *   and visual cluster N-1 is at the lowest (monotonic non-increasing).
   */
  clusterAtSourceOffset(srcOffset: number): number {
    if (this.clusterCount === 0) return -1;

    let low = 0;
    let high = this.clusterCount - 1;

    if (this.direction === 'ltr') {
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const midSrc = this.srcOffset(mid);
        const midLen = this.srcLength(mid);

        if (srcOffset >= midSrc && srcOffset < midSrc + midLen) {
          return mid;
        }

        if (srcOffset < midSrc) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
    } else {
      // RTL: srcOffset decreases as visual cluster index increases
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const midSrc = this.srcOffset(mid);
        const midLen = this.srcLength(mid);

        if (srcOffset >= midSrc && srcOffset < midSrc + midLen) {
          return mid;
        }

        if (srcOffset < midSrc) {
          // In RTL, lower logical offsets are positioned at higher visual cluster indices
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
    }

    // Fallback linear scan: handles rare complex-script cases with intra-cluster reordering
    // where strict monotonicity across visual cluster boundaries is temporarily inverted.
    for (let i = 0; i < this.clusterCount; i++) {
      const off = this.srcOffset(i);
      const len = this.srcLength(i);
      if (srcOffset >= off && srcOffset < off + len) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Creates an O(1) slice view sharing this run's numeric cluster storage.
   */
  slice(startCluster: number, endCluster?: number): ShapedRun {
    const start = Math.max(0, Math.min(startCluster, this.clusterCount));
    const end =
      endCluster === undefined
        ? this.clusterCount
        : Math.max(start, Math.min(endCluster, this.clusterCount));

    if (start === 0 && end === this.clusterCount) {
      return this;
    }

    const newCount = end - start;
    const globalStart = this.clusterStart + start;
    const globalEnd = this.clusterStart + end;

    // O(1) totalAdvance calculation using the shared prefix advances table
    const sliceAdvance = this.prefixAdvances[globalEnd]! - this.prefixAdvances[globalStart]!;

    return new PackedShapedRun({
      faceId: this.faceId,
      fontSize: this.fontSize,
      direction: this.direction,
      script: this.script,
      clusterStorage: this.clusterStorage,
      clusterStart: globalStart,
      clusterCount: newCount,
      totalAdvance: sliceAdvance,
      prefixAdvances: this.prefixAdvances,
    });
  }
}

/**
 * Cluster input representation for initializing `PackedShapedRun`.
 */
export interface ClusterInput {
  readonly glyphId: number;
  readonly xAdvance: number;
  readonly xOffset?: number | undefined;
  readonly yOffset?: number | undefined;
  readonly srcOffset: number;
  readonly srcLength: number;
}

/**
 * Factory creating a `ShapedRun` from an array of cluster descriptors.
 */
export function createPackedShapedRun(params: {
  readonly faceId: number;
  readonly fontSize: number;
  readonly direction: RunDirection;
  readonly script: string;
  readonly clusters: readonly ClusterInput[];
}): ShapedRun {
  const count = params.clusters.length;
  const storage = new Float64Array(count * CLUSTER_STRIDE);

  let totalAdvance = 0;
  for (let i = 0; i < count; i++) {
    const c = params.clusters[i]!;
    const base = i * CLUSTER_STRIDE;
    storage[base + GLYPH_ID_OFFSET] = c.glyphId;
    storage[base + X_ADVANCE_OFFSET] = c.xAdvance;
    storage[base + X_OFFSET_OFFSET] = c.xOffset ?? 0;
    storage[base + Y_OFFSET_OFFSET] = c.yOffset ?? 0;
    storage[base + SRC_OFFSET_OFFSET] = c.srcOffset;
    storage[base + SRC_LENGTH_OFFSET] = c.srcLength;
    totalAdvance += c.xAdvance;
  }

  return new PackedShapedRun({
    faceId: params.faceId,
    fontSize: params.fontSize,
    direction: params.direction,
    script: params.script,
    clusterStorage: storage,
    clusterStart: 0,
    clusterCount: count,
    totalAdvance,
  });
}
