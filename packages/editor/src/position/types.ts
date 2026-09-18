/**
 * Position model for the editor (P6-01).
 *
 * Two coordinate systems by design:
 *   - DocPos (from @ooxml/wml): stable logical coordinate that survives edits
 *     elsewhere in the document. Persisted in selections, bookmarks, undo records.
 *   - LayoutPos: transient screen coordinate. Invalidated by any relayout.
 *     NEVER stored across a frame boundary or an async turn.
 *
 * Affinity resolves the ambiguity at soft-wrap and bidi direction boundaries
 * where a single DocPos maps to two distinct screen positions.
 */

import type { DocPos } from '@ooxml/wml';
import type { IdTable } from '@ooxml/wml';

/**
 * Disambiguates positions at soft-wrap and bidi direction boundaries.
 *
 * At a soft wrap, offset k is both "after the last cluster of line N"
 * and "before the first cluster of line N+1":
 *   - UPSTREAM   → line N,   trailing edge of last cluster
 *   - DOWNSTREAM → line N+1, leading  edge of first cluster
 *
 * At a hard break (paragraph end, explicit <w:br/>) there is no ambiguity;
 * affinity is ignored because the two offsets are genuinely different positions.
 *
 * Default: DOWNSTREAM. Typing at a fresh position should extend forward.
 * This matches the behaviour of every mainstream editor.
 */
export type Affinity = 'upstream' | 'downstream';

/**
 * Transient layout coordinate — derived, used, discarded within one frame.
 *
 * Invalidated by ANY relayout that touches its page. Never stored in
 * selections, bookmarks, undo records, or across an async boundary.
 */
export interface LayoutPos {
  /** Page index in the LayoutIndex.pages array */
  page: number;
  /** Line index within the page's line array */
  lineIndex: number;
  /** Segment index within line.segments */
  segmentIndex: number;
  /** Run index within segment.runs */
  runIndex: number;
  /** Visual cluster index within the run's PackedShapedRun */
  cluster: number;
  /**
   * Which side of the cluster this position represents.
   * true  = before the cluster's text (its logical start)
   * false = after the cluster's text (its logical end)
   */
  leadingEdge: boolean;
}

/**
 * A caret: a document position with affinity and an optional goal column.
 *
 * `preferredX` is the "goal column" for vertical movement: set on the first
 * Up/Down press, cleared by any horizontal movement or edit. Without it,
 * repeated Down through a short line permanently loses the horizontal position.
 */
export interface Caret {
  readonly pos: DocPos;
  readonly affinity: Affinity;
  readonly preferredX: number | null;
}

/**
 * Creates a Caret. Default affinity is DOWNSTREAM (typing extends forward).
 */
export function createCaret(
  pos: DocPos,
  affinity: Affinity = 'downstream',
  preferredX: number | null = null,
): Caret {
  return { pos, affinity, preferredX };
}

/**
 * Full structural equality of two Carets, including affinity and preferredX.
 */
export function caretEquals(a: Caret, b: Caret): boolean {
  return (
    a.pos.node === b.pos.node &&
    a.pos.offset === b.pos.offset &&
    a.affinity === b.affinity &&
    a.preferredX === b.preferredX
  );
}

/**
 * Checks whether the caret's underlying node is still live in the IdTable.
 * A retired or unknown node means the caret is stale (the node was deleted).
 */
export function isValid(caret: Caret, idTable: IdTable): boolean {
  return idTable.isLive(caret.pos.node);
}
