/**
 * Position representation and coordinate mapping for WordprocessingML.
 *
 * Implements Ticket P3-02 (Positions).
 *
 * Two representations exist by design:
 *   1. `DocPos` ({ node: NodeId, offset: number }): Logical coordinate.
 *      Survives edits elsewhere in the document. Persisted, addressable,
 *      safe to cross async boundaries or undo records.
 *   2. `AbsPos` (branded number): Flat 0-indexed document offset.
 *      A transient CACHE only. Valid only within a single synchronous algorithm
 *      (e.g. line breaking). Never persisted, never crosses an await,
 *      never written into an undo record or bookmark.
 */

import type { NodeId } from './id.js';

/**
 * Logical position inside a specific text-bearing document node.
 *
 * Stable under mutations occurring in other nodes across the document tree.
 */
export interface DocPos {
  readonly node: NodeId;
  readonly offset: number;
}

/**
 * Creates and validates a logical document position.
 */
export function createDocPos(node: NodeId, offset: number): DocPos {
  if (offset < 0 || !Number.isInteger(offset)) {
    throw new Error(`Invalid DocPos offset: ${offset}. Offset must be a non-negative integer.`);
  }
  return { node, offset };
}

/**
 * Structural equality check for two logical document positions.
 */
export function docPosEquals(a: DocPos, b: DocPos): boolean {
  return a.node === b.node && a.offset === b.offset;
}

declare const AbsPosBrand: unique symbol;

/**
 * Transient flat document character offset.
 *
 * CAUTION: `AbsPos` is an ephemeral cache coordinate. It is invalidated by any
 * document edit. It must NEVER be persisted, stored across asynchronous turns,
 * or written into undo records.
 */
export type AbsPos = number & { readonly [AbsPosBrand]: 'AbsPos' };

/**
 * Branded constructor for `AbsPos` with non-negative integer validation.
 */
export function asAbsPos(offset: number): AbsPos {
  if (offset < 0 || !Number.isInteger(offset)) {
    throw new Error(`Invalid AbsPos: ${offset}. Offset must be a non-negative integer.`);
  }
  return offset as AbsPos;
}

/**
 * Specification of a node's linear extent in the document sequence.
 */
export interface NodeExtent {
  readonly id: NodeId;
  readonly length: number;
}

/**
 * Bidirectional mapper between logical `DocPos` and flat cached `AbsPos`.
 *
 * Uses prefix-sum binary search for O(log N) conversions in both directions.
 */
export class PositionMapper {
  private readonly _nodes: NodeExtent[] = [];
  private readonly _nodeIndices: Map<NodeId, number> = new Map();
  // Prefix sums of lengths: prefixSums[i] is start offset of node i; prefixSums[N] is total length.
  private _prefixSums: number[] = [0];

  constructor(nodes?: readonly NodeExtent[]) {
    if (nodes && nodes.length > 0) {
      for (const n of nodes) {
        this.appendNode(n.id, n.length);
      }
    }
  }

  /**
   * Total character length across all nodes registered in the mapper.
   */
  get totalLength(): number {
    return this._prefixSums[this._prefixSums.length - 1] ?? 0;
  }

  /**
   * Number of nodes in the document sequence.
   */
  get nodeCount(): number {
    return this._nodes.length;
  }

  /**
   * Appends a node to the end of the document sequence.
   */
  appendNode(id: NodeId, length: number): void {
    if (length < 0 || !Number.isInteger(length)) {
      throw new Error(`Invalid node length: ${length}. Must be a non-negative integer.`);
    }
    if (this._nodeIndices.has(id)) {
      throw new Error(`Duplicate NodeId registered in PositionMapper: ${id}`);
    }
    const index = this._nodes.length;
    this._nodes.push({ id, length });
    this._nodeIndices.set(id, index);
    const lastSum = this._prefixSums[index] ?? 0;
    this._prefixSums.push(lastSum + length);
  }

  /**
   * Updates the character length of an existing node and rebuilds prefix sums.
   */
  updateLength(id: NodeId, newLength: number): void {
    if (newLength < 0 || !Number.isInteger(newLength)) {
      throw new Error(`Invalid node length: ${newLength}. Must be a non-negative integer.`);
    }
    const index = this._nodeIndices.get(id);
    if (index === undefined) {
      throw new Error(`NodeId not found in PositionMapper: ${id}`);
    }
    this._nodes[index] = { id, length: newLength };
    this._rebuildPrefixSumsFrom(index);
  }

  /**
   * Converts a logical `DocPos` into a flat cached `AbsPos`.
   * Throws if the node is unknown or the offset exceeds the node length.
   */
  toAbs(p: DocPos): AbsPos {
    const index = this._nodeIndices.get(p.node);
    if (index === undefined) {
      throw new Error(`Cannot map DocPos to AbsPos: NodeId ${p.node} not in PositionMapper.`);
    }
    const node = this._nodes[index]!;
    if (p.offset > node.length) {
      throw new Error(`DocPos offset ${p.offset} exceeds node ${p.node} length of ${node.length}.`);
    }
    const startAbs = this._prefixSums[index]!;
    return asAbsPos(startAbs + p.offset);
  }

  /**
   * Converts a flat cached `AbsPos` back into a logical `DocPos`.
   * Binary searches prefix sums in O(log N) time.
   */
  toDoc(abs: AbsPos | number): DocPos {
    const raw = typeof abs === 'number' ? abs : (abs as number);
    if (raw < 0 || !Number.isInteger(raw)) {
      throw new Error(`Invalid AbsPos: ${raw}. Must be non-negative integer.`);
    }
    if (this._nodes.length === 0) {
      throw new Error('Cannot map AbsPos to DocPos: PositionMapper contains no nodes.');
    }
    const total = this.totalLength;
    if (raw > total) {
      throw new Error(`AbsPos ${raw} is beyond document end (totalLength: ${total}).`);
    }

    // Binary search prefix sums to find the node containing `raw`.
    // We seek the largest index where prefixSums[index] <= raw.
    let low = 0;
    let high = this._nodes.length - 1;
    let foundIndex = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const midVal = this._prefixSums[mid]!;
      if (midVal <= raw) {
        foundIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // If raw is at the exact boundary of totalLength, clamp to the last node
    if (foundIndex >= this._nodes.length) {
      foundIndex = this._nodes.length - 1;
    }

    const nodeStart = this._prefixSums[foundIndex]!;
    const node = this._nodes[foundIndex]!;
    let offset = raw - nodeStart;

    // If raw equals totalLength and is past node.length, clamp or keep on last node
    if (offset > node.length && foundIndex < this._nodes.length - 1) {
      foundIndex++;
      offset = raw - this._prefixSums[foundIndex]!;
    }

    return {
      node: this._nodes[foundIndex]!.id,
      offset,
    };
  }

  /**
   * Returns the starting flat offset for a given node.
   */
  startOf(id: NodeId): AbsPos {
    const index = this._nodeIndices.get(id);
    if (index === undefined) {
      throw new Error(`NodeId not found in PositionMapper: ${id}`);
    }
    return asAbsPos(this._prefixSums[index]!);
  }

  /**
   * Returns the registered character length for a given node.
   */
  lengthOf(id: NodeId): number {
    const index = this._nodeIndices.get(id);
    if (index === undefined) {
      throw new Error(`NodeId not found in PositionMapper: ${id}`);
    }
    return this._nodes[index]!.length;
  }

  private _rebuildPrefixSumsFrom(startIndex: number): void {
    for (let i = startIndex; i < this._nodes.length; i++) {
      this._prefixSums[i + 1] = this._prefixSums[i]! + this._nodes[i]!.length;
    }
  }
}

/**
 * Creates a PositionMapper initialized with an array of node extents.
 */
export function createPositionMapper(nodes: readonly NodeExtent[]): PositionMapper {
  return new PositionMapper(nodes);
}
