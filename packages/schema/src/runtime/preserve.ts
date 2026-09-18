/**
 * Positional anchoring for unrecognized content.
 *
 * See `docs/adr/0009-unknown-content-preservation.md`. The short version: a flat
 * bag of dropped nodes records *what* was unrecognized but not *where*, and
 * re-emitting at the end of the element produces a different document. Round-trip
 * losslessness is the project's foundational guarantee, so position is part of
 * what gets captured.
 *
 * Content inside a *repeating choice* does not need any of this — it lives in
 * the same ordered array as the recognized children, as a `$raw` alternative.
 * This module covers everything else.
 */

import type { RawNode } from './xml.js';

/**
 * An unrecognized child element, anchored to the slot it followed.
 *
 * The anchor is expressed in terms of the type's **slot list**, which is fixed
 * by the schema and does not vary with document content. That is what makes it
 * stable under editing: deleting the `w:tblPr` a stray element was sitting after
 * does not renumber anything, because absent slots still occupy their index.
 */
export interface PositionedRaw {
  /**
   * Index into the owning type's slot list, or `-1` for content that preceded
   * the first slot.
   */
  readonly afterSlot: number;

  /**
   * Index within a repeating slot's array, for content interleaved between
   * repetitions — `<w:gridCol/><ext/><w:gridCol/>` anchors at `afterIndex: 0`.
   *
   * Absent means "after the slot as a whole", which is the only meaning
   * available for a non-repeating slot and the common case everywhere else.
   * There is deliberately no "before the first item" value: that position is
   * already expressible as `afterSlot` of the *previous* slot, and two
   * encodings for one position is how a writer ends up with two behaviours.
   */
  readonly afterIndex?: number | undefined;

  readonly node: RawNode;
}

/**
 * Order `PositionedRaw` entries the way a writer must flush them.
 *
 * Readers append in document order, so this is normally already sorted; a
 * writer that has had edits applied to it cannot assume so. Sorting is
 * total and deterministic — `afterIndex` absent sorts after every present
 * `afterIndex` for the same slot, matching "after the slot as a whole".
 */
export function sortPositioned(entries: readonly PositionedRaw[]): readonly PositionedRaw[] {
  return [...entries].sort((a, b) => {
    if (a.afterSlot !== b.afterSlot) return a.afterSlot - b.afterSlot;
    const ai = a.afterIndex ?? Number.POSITIVE_INFINITY;
    const bi = b.afterIndex ?? Number.POSITIVE_INFINITY;
    return ai === bi ? 0 : ai < bi ? -1 : 1;
  });
}
