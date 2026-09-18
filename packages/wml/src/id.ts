/**
 * Stable Node Identity for WordprocessingML document elements.
 *
 * Implements Ticket P3-01.
 *
 * Every addressable entity in the document (paragraphs, runs, tables, rows,
 * cells, range annotation anchors, drawings, fields) needs an identity that
 * survives edits. This identity is the substrate for:
 *   - Caret tracking across mutations (P6-01)
 *   - Range annotation intervals (bookmarks, comments, permissions) (P3-03)
 *   - Incremental layout dirty-range invalidation (P5-16)
 *   - Layout golden snapshots keyed by NodeId (P5-17)
 *   - Command-based undo/redo inversion (P6-11)
 *
 * Key architectural invariants:
 *   1. Dense, opaque u32 representation to allow direct array indexing in caches
 *      while forbidding arithmetic or document-order inference.
 *   2. Strictly monotonic ID allocation without recycling (NO freelist).
 *      Recycling IDs would silently retarget stale carets, bookmarks, or undo
 *      records to newly created nodes.
 *   3. Generational tracking on retirement to detect use-after-retire and stale
 *      pointer dereferencing in development and diagnostic modes.
 */

declare const NodeIdBrand: unique symbol;

/**
 * Dense, opaque 32-bit unsigned identifier for document nodes.
 *
 * Branded nominal type prevents callers from performing arithmetic (+, -),
 * ordering comparisons (<, >), or treating NodeId as a document position.
 * NodeId answers "which entity", never "where is it".
 */
export type NodeId = number & { readonly [NodeIdBrand]: 'NodeId' };

/**
 * The canonical set of node kinds that receive a stable NodeId.
 *
 * Giving every XML attribute an ID causes high overhead and memory churn;
 * giving only paragraphs an ID makes it impossible to address run boundaries
 * or range endpoints. This enumerated set covers every structurally addressable
 * document entity.
 */
export const NODE_KINDS = [
  'paragraph',
  'run',
  'table',
  'row',
  'cell',
  'rangeStart',
  'rangeEnd',
  'drawing',
  'field',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Allocation table and lifecycle tracker for stable node identities.
 */
export class IdTable {
  // Monotonic sequence starting at 0. Never decremented or recycled.
  private _nextId = 0;

  // Stores the immutable kind for each minted node.
  private readonly _kinds: Map<NodeId, NodeKind> = new Map();

  // Generational counter per ID: initialized to 1 on mint, incremented on retire.
  // Catches stale references and use-after-retire in dev/testing.
  private readonly _generation: Map<NodeId, number> = new Map();

  // Set of currently active, unretired IDs.
  private readonly _live: Set<NodeId> = new Set();

  /**
   * The next monotonic integer ID to be minted.
   * Monotonically increases with every mint call.
   */
  get nextId(): number {
    return this._nextId;
  }

  /**
   * Read-only view of the generation map.
   */
  get generation(): ReadonlyMap<NodeId, number> {
    return this._generation;
  }

  /**
   * Mints a fresh, dense NodeId for a node of the specified kind.
   *
   * The ID is allocated from a monotonic counter. No freelist is maintained,
   * guaranteeing that IDs are never reused even after nodes are deleted.
   */
  mint(kind: NodeKind): NodeId {
    const raw = this._nextId++;
    // Guard against 32-bit overflow (4,294,967,295 IDs).
    if (raw > 0xffffffff) {
      throw new Error('NodeId exhaustion: 32-bit unsigned identifier space exceeded.');
    }
    const id = raw as NodeId;
    this._kinds.set(id, kind);
    this._generation.set(id, 1);
    this._live.add(id);
    return id;
  }

  /**
   * Returns true if the node ID is currently live (minted and not yet retired).
   */
  isLive(id: NodeId): boolean {
    return this._live.has(id);
  }

  /**
   * Retires a live node ID, marking it dead and bumping its generation counter.
   *
   * Crucially, this does NOT return the ID to any pool or freelist.
   * Throws if the ID was never minted or was already retired.
   */
  retire(id: NodeId): void {
    if (!this._kinds.has(id)) {
      throw new Error(`Cannot retire unknown NodeId: ${id}`);
    }
    if (!this._live.has(id)) {
      const gen = this._generation.get(id) ?? 0;
      this._generation.set(id, gen + 1);
      throw new Error(
        `Use-after-retire detected: NodeId ${id} (${this._kinds.get(id)}) was already retired.`,
      );
    }
    this._live.delete(id);
    const currentGen = this._generation.get(id) ?? 1;
    this._generation.set(id, currentGen + 1);
  }

  /**
   * Returns the NodeKind associated with the given ID.
   * Throws if the ID is unknown (was never minted).
   */
  kindOf(id: NodeId): NodeKind {
    const kind = this._kinds.get(id);
    if (kind === undefined) {
      throw new Error(`Unknown NodeId: ${id}`);
    }
    return kind;
  }

  /**
   * Returns the current generation number of the given ID.
   * 1 = currently live on its initial mint; >1 = retired.
   * Throws if the ID was never minted.
   */
  generationOf(id: NodeId): number {
    const gen = this._generation.get(id);
    if (gen === undefined) {
      throw new Error(`Unknown NodeId: ${id}`);
    }
    return gen;
  }

  /**
   * Asserts that the given ID is currently live.
   * Throws a diagnostic error explaining whether it is unknown or retired.
   */
  assertLive(id: NodeId): void {
    if (!this._kinds.has(id)) {
      throw new Error(`Unknown NodeId: ${id}`);
    }
    if (!this._live.has(id)) {
      const gen = this._generation.get(id) ?? 0;
      throw new Error(
        `Use-after-retire detected: NodeId ${id} (${this._kinds.get(id)}) is retired (generation ${gen}).`,
      );
    }
  }
}
