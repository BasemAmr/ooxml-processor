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

import type { RawNode, XmlSink } from './xml.js';

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

/**
 * Orders and drains {@link PositionedRaw} entries during serialization.
 *
 * Interleaves unrecognized content back at its original anchor points:
 * - `afterSlot: -1` flushes before the first slot
 * - `afterSlot: i, afterIndex: idx` flushes immediately following repetition `idx` of slot `i`
 * - `afterSlot: i` (afterIndex absent) flushes after slot `i` as a whole
 * - any remaining entries flush before closing the parent element
 */
export class PositionedRawQueue {
  private readonly entries: readonly PositionedRaw[];
  private cursor = 0;

  constructor(entries: readonly PositionedRaw[] | undefined) {
    this.entries = entries && entries.length > 0 ? sortPositioned(entries) : [];
  }

  /**
   * Drain entries anchored at or before `afterSlot`.
   * When `afterIndex` is specified, drains entries anchored at `(afterSlot, idx)` with `idx <= afterIndex`.
   * When `afterIndex` is absent (undefined), drains all entries anchored at `afterSlot` as a whole.
   */
  flush(sink: XmlSink, afterSlot: number, afterIndex?: number): void {
    while (this.cursor < this.entries.length) {
      const entry = this.entries[this.cursor]!;
      if (entry.afterSlot < afterSlot) {
        sink.raw(entry.node);
        this.cursor++;
        continue;
      }
      if (entry.afterSlot === afterSlot) {
        if (afterIndex === undefined) {
          sink.raw(entry.node);
          this.cursor++;
          continue;
        }
        if (entry.afterIndex !== undefined && entry.afterIndex <= afterIndex) {
          sink.raw(entry.node);
          this.cursor++;
          continue;
        }
      }
      break;
    }
  }

  /**
   * Flush any remaining entries anchored past the emitted slots.
   */
  flushRemaining(sink: XmlSink): void {
    while (this.cursor < this.entries.length) {
      sink.raw(this.entries[this.cursor]!.node);
      this.cursor++;
    }
  }
}
