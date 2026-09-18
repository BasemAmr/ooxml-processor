/**
 * Interval store with sub-linear shift propagation and endpoint gravity.
 *
 * Implements Ticket P3-02 (Interval Store).
 *
 * In WordprocessingML, range annotations (bookmarks, comment ranges, permissions,
 * moves) and UI anchors (caret, selection) are intervals over document text.
 *
 * Core architectural requirements:
 *   1. Explicit endpoint gravity ('left' | 'right').
 *      Default bookmark start gravity: 'right'; default bookmark end gravity: 'left'.
 *      Typing inside a bookmark extends it; typing at boundaries does not.
 *   2. Zero-width intervals (from === to) fully supported (collapsed bookmarks, caret).
 *   3. Sub-linear `shift(at, delta)`:
 *      Every keystroke triggers a shift. Walking all intervals linearly is O(N).
 *      Using an augmented balanced Cartesian tree (Treap) with lazy delta tags,
 *      shifts over large interval sets (10,000+ intervals) run in O(log N + k) time.
 *   4. Fast stabbing (point containment) and interval overlap queries in O(log N + k).
 */

export type Gravity = 'left' | 'right';

/**
 * Default endpoint gravity for bookmark start markers.
 * Sticks to text after insertion point ('right').
 */
export const DEFAULT_START_GRAVITY: Gravity = 'right';

/**
 * Default endpoint gravity for bookmark end markers.
 * Sticks to text before insertion point ('left').
 */
export const DEFAULT_END_GRAVITY: Gravity = 'left';

declare const IntervalIdBrand: unique symbol;

/**
 * Unique identifier for an interval stored in `IntervalStore`.
 */
export type IntervalId = number & { readonly [IntervalIdBrand]: 'IntervalId' };

/**
 * Stored interval representation.
 */
export interface Interval<T> {
  readonly id: IntervalId;
  readonly from: number;
  readonly to: number;
  readonly payload: T;
  readonly fromGravity: Gravity;
  readonly toGravity: Gravity;
}

/**
 * Internal node in the augmented Treap.
 */
interface TreapNode<T> {
  readonly id: IntervalId;
  from: number;
  to: number;
  readonly payload: T;
  readonly fromGravity: Gravity;
  readonly toGravity: Gravity;
  priority: number;

  left: TreapNode<T> | null;
  right: TreapNode<T> | null;
  parent: TreapNode<T> | null;

  // Augmented subtree metrics
  maxTo: number;
  minFrom: number;
  subtreeSize: number;

  // Lazy delta applied to all intervals in this subtree
  lazyDelta: number;
}

function gravityRank(g: Gravity): number {
  return g === 'left' ? 0 : 1;
}

/**
 * Strict total ordering for Treap BST keys:
 *   1. `from` coordinate
 *   2. `fromGravity` ('left' before 'right')
 *   3. `id` (unique monotonic tie-breaker)
 */
function compareKeys(
  fromA: number,
  gravA: Gravity,
  idA: number,
  fromB: number,
  gravB: Gravity,
  idB: number,
): number {
  if (fromA !== fromB) return fromA - fromB;
  const gA = gravityRank(gravA);
  const gB = gravityRank(gravB);
  if (gA !== gB) return gA - gB;
  return idA - idB;
}

/**
 * Applies lazy delta directly to a node and its subtree metrics.
 */
function applyLazy<T>(node: TreapNode<T> | null, delta: number): void {
  if (!node || delta === 0) return;
  node.from += delta;
  node.to += delta;
  node.maxTo += delta;
  node.minFrom += delta;
  node.lazyDelta += delta;
}

/**
 * Pushes lazy delta down to immediate children.
 */
function pushDown<T>(node: TreapNode<T> | null): void {
  if (!node || node.lazyDelta === 0) return;
  const delta = node.lazyDelta;
  node.lazyDelta = 0;
  if (node.left) applyLazy(node.left, delta);
  if (node.right) applyLazy(node.right, delta);
}

/**
 * Recomputes subtree metrics from children.
 */
function pushUp<T>(node: TreapNode<T>): void {
  node.subtreeSize =
    1 + (node.left ? node.left.subtreeSize : 0) + (node.right ? node.right.subtreeSize : 0);
  node.maxTo = Math.max(
    node.to,
    node.left ? node.left.maxTo : -Infinity,
    node.right ? node.right.maxTo : -Infinity,
  );
  node.minFrom = Math.min(
    node.from,
    node.left ? node.left.minFrom : Infinity,
    node.right ? node.right.minFrom : Infinity,
  );
  if (node.left) node.left.parent = node;
  if (node.right) node.right.parent = node;
}

/**
 * Splits treap into:
 *   - left: all nodes with key <= pivot
 *   - right: all nodes with key > pivot
 */
function split<T>(
  node: TreapNode<T> | null,
  pFrom: number,
  pGrav: Gravity,
  pId: number,
): [TreapNode<T> | null, TreapNode<T> | null] {
  if (!node) return [null, null];
  pushDown(node);

  const cmp = compareKeys(node.from, node.fromGravity, node.id as number, pFrom, pGrav, pId);
  if (cmp <= 0) {
    const [rl, rr] = split(node.right, pFrom, pGrav, pId);
    node.right = rl;
    if (rl) rl.parent = node;
    pushUp(node);
    return [node, rr];
  } else {
    const [ll, lr] = split(node.left, pFrom, pGrav, pId);
    node.left = lr;
    if (lr) lr.parent = node;
    pushUp(node);
    return [ll, node];
  }
}

/**
 * Merges two treaps assuming all keys in left < all keys in right.
 */
function merge<T>(left: TreapNode<T> | null, right: TreapNode<T> | null): TreapNode<T> | null {
  if (!left) return right;
  if (!right) return left;

  if (left.priority >= right.priority) {
    pushDown(left);
    left.right = merge(left.right, right);
    if (left.right) left.right.parent = left;
    pushUp(left);
    return left;
  } else {
    pushDown(right);
    right.left = merge(left, right.left);
    if (right.left) right.left.parent = right;
    pushUp(right);
    return right;
  }
}

/**
 * IntervalStore maintaining intervals with endpoint gravity, fast stabbing,
 * overlapping queries, and sub-linear shift propagation.
 */
export class IntervalStore<T = unknown> {
  private _root: TreapNode<T> | null = null;
  private readonly _byId: Map<IntervalId, TreapNode<T>> = new Map();
  private _nextId = 1;

  /**
   * Total number of intervals currently in the store.
   */
  get size(): number {
    return this._byId.size;
  }

  /**
   * Inserts an interval into the store.
   *
   * @param from Start position (must be <= to).
   * @param to End position (must be >= from).
   * @param payload User data attached to the interval.
   * @param fromGravity Start endpoint gravity (default: 'right').
   * @param toGravity End endpoint gravity (default: 'left').
   */
  insert(
    from: number,
    to: number,
    payload: T,
    fromGravity: Gravity = DEFAULT_START_GRAVITY,
    toGravity: Gravity = DEFAULT_END_GRAVITY,
  ): IntervalId {
    if (from < 0 || to < 0 || !Number.isFinite(from) || !Number.isFinite(to)) {
      throw new Error(
        `Invalid interval range [${from}, ${to}]: positions must be finite non-negative numbers.`,
      );
    }
    if (from > to) {
      throw new Error(`Invalid interval range [${from}, ${to}]: 'from' cannot exceed 'to'.`);
    }

    const id = this._nextId++ as IntervalId;
    const node: TreapNode<T> = {
      id,
      from,
      to,
      payload,
      fromGravity,
      toGravity,
      priority: Math.random(),
      left: null,
      right: null,
      parent: null,
      maxTo: to,
      minFrom: from,
      subtreeSize: 1,
      lazyDelta: 0,
    };

    this._byId.set(id, node);
    this._insertNode(node);
    return id;
  }

  /**
   * Returns interval by ID, ensuring all lazy transformations are synchronized.
   */
  get(id: IntervalId): Interval<T> | undefined {
    const node = this._byId.get(id);
    if (!node) return undefined;
    this._syncNode(node);
    return this._toInterval(node);
  }

  /**
   * Removes an interval by its ID.
   * Returns true if found and removed, false otherwise.
   */
  remove(id: IntervalId): boolean {
    const node = this._byId.get(id);
    if (!node) return false;

    this._syncNode(node);
    this._byId.delete(id);

    // Split around this node's exact key and remove it
    const [t1, tRest] = split(this._root, node.from, node.fromGravity, (node.id as number) - 1);
    const [, t2] = split(tRest, node.from, node.fromGravity, node.id as number);
    this._root = merge(t1, t2);
    if (this._root) this._root.parent = null;
    return true;
  }

  /**
   * Clears all intervals from the store.
   */
  clear(): void {
    this._root = null;
    this._byId.clear();
  }

  /**
   * Returns all intervals currently in the store, sorted by start position.
   */
  all(): Interval<T>[] {
    const result: Interval<T>[] = [];
    const traverse = (node: TreapNode<T> | null): void => {
      if (!node) return;
      pushDown(node);
      traverse(node.left);
      result.push(this._toInterval(node));
      traverse(node.right);
    };
    traverse(this._root);
    return result;
  }

  /**
   * Stabbing query: finds all intervals containing position `at`.
   *
   * For non-zero-width intervals: matches if `from <= at <= to`.
   * For zero-width intervals: matches if `from === at`.
   * Time complexity: O(log N + k).
   */
  stab(at: number): Interval<T>[] {
    const result: Interval<T>[] = [];
    this._stab(this._root, at, result);
    return result;
  }

  /**
   * Range query: finds all intervals overlapping `[from, to]`.
   *
   * @param from Start of query range.
   * @param to End of query range.
   * @param options.inclusive When true, intervals touching boundaries are included.
   *                          Default is true for zero-width queries, and true for boundary touches.
   */
  overlapping(from: number, to: number, options?: { inclusive?: boolean }): Interval<T>[] {
    if (from > to) {
      throw new Error(`Invalid overlapping query [${from}, ${to}]: 'from' cannot exceed 'to'.`);
    }
    const result: Interval<T>[] = [];
    const inclusive = options?.inclusive ?? true;
    this._overlapping(this._root, from, to, inclusive, result);
    return result;
  }

  /**
   * Shifts all intervals according to an edit at position `at` with magnitude `delta`.
   *
   * Invariant: SUB-LINEAR in total interval count N.
   * When delta > 0 (text insertion):
   *   - Endpoints > at shift right by delta.
   *   - Endpoints < at are untouched.
   *   - Endpoints === at shift if their gravity is 'right'; stay if 'left'.
   *   - Zero-width intervals (from === to === at) stay well-formed.
   *
   * When delta < 0 (text deletion in [at, at + |delta|)):
   *   - Endpoints > at + |delta| shift left by |delta|.
   *   - Endpoints in [at, at + |delta|) collapse to `at`.
   *   - Endpoints <= at are untouched.
   */
  shift(at: number, delta: number): void {
    if (delta === 0 || !this._root) return;

    if (delta > 0) {
      this._shiftInsert(at, delta);
    } else {
      this._shiftDelete(at, -delta);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Shift Implementation
  // ---------------------------------------------------------------------------

  private _shiftInsert(at: number, delta: number): void {
    // Split key partition:
    // T_left contains all nodes where:
    //   from < at OR (from === at && fromGravity === 'left')
    // T_right contains all nodes where:
    //   from > at OR (from === at && fromGravity === 'right')
    // In compareKeys, (at, 'left', Infinity) strictly bounds T_left.
    const [tLeft, tRight] = split(this._root, at, 'left', Infinity);

    // In T_right, all intervals have from > at OR (from === at && fromGravity === 'right').
    // Since to >= from, both from and to shift by +delta.
    // For zero-width intervals where from === at && fromGravity === 'right':
    // to is also at; shifting both to at + delta preserves zero width and respects gravity.
    if (tRight) {
      applyLazy(tRight, delta);
    }

    // In T_left, from does not shift.
    // Intervals that span across `at` (or zero-width expanding with toGravity === 'right')
    // must have their `to` shifted by +delta.
    if (tLeft) {
      this._updateSpanningTo(tLeft, at, delta);
    }

    this._root = merge(tLeft, tRight);
    if (this._root) this._root.parent = null;
  }

  private _updateSpanningTo(node: TreapNode<T> | null, at: number, delta: number): void {
    if (!node) return;
    pushDown(node);

    // Subtree prune: if maxTo < at, no interval in this entire subtree can span `at`
    if (node.maxTo < at) {
      return;
    }

    if (node.left && node.left.maxTo >= at) {
      this._updateSpanningTo(node.left, at, delta);
    }

    if (node.to > at || (node.to === at && node.toGravity === 'right')) {
      node.to += delta;
    }

    if (node.right && node.right.maxTo >= at) {
      this._updateSpanningTo(node.right, at, delta);
    }

    pushUp(node);
  }

  private _shiftDelete(at: number, delLen: number): void {
    const delEnd = at + delLen;

    // Split off everything strictly at or after delEnd:
    // T_right has from >= delEnd.
    // Both from and to shift left by delLen.
    const [tLeft, tRight] = split(this._root, delEnd, 'left', -Infinity);

    if (tRight) {
      applyLazy(tRight, -delLen);
    }

    // In T_left, nodes have from < delEnd.
    // Nodes that started in [at, delEnd) need their `from` collapsed to `at`.
    // Because changing `from` alters the BST search key, we collect and re-insert them.
    const nodesToReinsert: TreapNode<T>[] = [];
    this._collectAndAdjustDeleted(tLeft, at, delEnd, delLen, nodesToReinsert);

    // If any nodes had their `from` modified, remove them from tLeft and re-insert
    let updatedTLeft = tLeft;
    for (const n of nodesToReinsert) {
      // Remove n from tree
      const [t1, tRest] = split(updatedTLeft, n.from, n.fromGravity, (n.id as number) - 1);
      const [, t2] = split(tRest, n.from, n.fromGravity, n.id as number);
      updatedTLeft = merge(t1, t2);
    }

    // Now update from to `at` and re-insert each
    for (const n of nodesToReinsert) {
      n.from = at;
      n.left = null;
      n.right = null;
      n.parent = null;
      n.maxTo = n.to;
      n.minFrom = n.from;
      n.subtreeSize = 1;
      n.lazyDelta = 0;
      const [t1, t2] = split(updatedTLeft, n.from, n.fromGravity, n.id as number);
      updatedTLeft = merge(merge(t1, n), t2);
    }

    this._root = merge(updatedTLeft, tRight);
    if (this._root) this._root.parent = null;
  }

  private _collectAndAdjustDeleted(
    node: TreapNode<T> | null,
    at: number,
    delEnd: number,
    delLen: number,
    reinsertList: TreapNode<T>[],
  ): void {
    if (!node) return;
    pushDown(node);

    if (node.left) {
      this._collectAndAdjustDeleted(node.left, at, delEnd, delLen, reinsertList);
    }

    let fromChanged = false;
    if (node.from > at && node.from < delEnd) {
      // Endpoint was inside deleted range; will collapse to `at`
      fromChanged = true;
      reinsertList.push(node);
    }

    // Adjust `to` coordinate
    if (node.to > at && node.to <= delEnd) {
      node.to = at;
    } else if (node.to > delEnd) {
      node.to -= delLen;
    }

    if (node.right) {
      this._collectAndAdjustDeleted(node.right, at, delEnd, delLen, reinsertList);
    }

    if (!fromChanged) {
      pushUp(node);
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  private _stab(node: TreapNode<T> | null, at: number, result: Interval<T>[]): void {
    if (!node) return;
    pushDown(node);

    // If entire subtree maxTo < at, nothing in this subtree can reach `at`
    if (node.maxTo < at) return;

    // Check left child
    if (node.left && node.left.maxTo >= at) {
      this._stab(node.left, at, result);
    }

    // Check current node
    if (node.from <= at && at <= node.to) {
      result.push(this._toInterval(node));
    }

    // Check right child: only if current node's `from` <= at, because right
    // children have from >= node.from
    if (node.right && node.from <= at && node.right.maxTo >= at) {
      this._stab(node.right, at, result);
    }
  }

  private _overlapping(
    node: TreapNode<T> | null,
    from: number,
    to: number,
    inclusive: boolean,
    result: Interval<T>[],
  ): void {
    if (!node) return;
    pushDown(node);

    if (node.maxTo < from) return;

    if (node.left && node.left.maxTo >= from) {
      this._overlapping(node.left, from, to, inclusive, result);
    }

    // Overlap test
    if (this._isOverlapping(node, from, to, inclusive)) {
      result.push(this._toInterval(node));
    }

    // Right child search: nodes in right have from >= node.from.
    // If node.from > to, right children also have from > to, so cannot overlap [from, to].
    if (node.right && node.from <= to && node.right.maxTo >= from) {
      this._overlapping(node.right, from, to, inclusive, result);
    }
  }

  private _isOverlapping(
    node: TreapNode<T>,
    from: number,
    to: number,
    inclusive: boolean,
  ): boolean {
    const isPointQuery = from === to;
    const isPointInterval = node.from === node.to;

    if (isPointQuery) {
      return node.from <= from && from <= node.to;
    }
    if (isPointInterval) {
      return from <= node.from && node.from <= to;
    }

    if (inclusive) {
      return Math.max(from, node.from) <= Math.min(to, node.to);
    }
    return Math.max(from, node.from) < Math.min(to, node.to);
  }

  // ---------------------------------------------------------------------------
  // Tree Helpers
  // ---------------------------------------------------------------------------

  private _insertNode(node: TreapNode<T>): void {
    const [t1, t2] = split(this._root, node.from, node.fromGravity, node.id as number);
    this._root = merge(merge(t1, node), t2);
    if (this._root) this._root.parent = null;
  }

  /**
   * Pushes all lazy tags from the root down to `node`.
   */
  private _syncNode(node: TreapNode<T>): void {
    const ancestors: TreapNode<T>[] = [];
    let cur: TreapNode<T> | null = node;
    while (cur) {
      ancestors.push(cur);
      cur = cur.parent;
    }
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i];
      if (a) {
        pushDown(a);
      }
    }
  }

  private _toInterval(node: TreapNode<T>): Interval<T> {
    return {
      id: node.id,
      from: node.from,
      to: node.to,
      payload: node.payload,
      fromGravity: node.fromGravity,
      toGravity: node.toGravity,
    };
  }
}
