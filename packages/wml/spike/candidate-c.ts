/**
 * Candidate C: Mutable Generated AST + Layered Interval Store.
 *
 * Implements Spike Candidate C for ADR 0003 (The Plan's Recommended Architecture).
 *
 * Architecture:
 *   - The authoritative model is the generated `@ooxml/schema` `CT_Document` AST.
 *   - Mutations happen directly in-place on the AST nodes (`CT_P`, `CT_R`, `CT_Text`).
 *   - Range annotations (bookmarks, comment ranges, carets) that do not nest with the
 *     element tree are maintained in a layered interval store.
 *   - Serialization delegates directly to `@ooxml/schema` generated `writeCT_Document`.
 *
 * Strengths:
 *   - 100% lossless round-trip fidelity: unknown extensions ($unknown) and attributes ($unknownAttrs)
 *     are preserved natively in wire order by the generated writer.
 *   - In-place mutation is extremely fast: 10,000 keystrokes into a run mutate text in-place
 *     with near-zero object allocation and zero tree copying.
 *   - Direct alignment with the schema codegen from Phase 1 and the OPC package graph from Phase 2.
 */

import type { BookmarkSpan, RunProperties, SpikeDocumentModel } from './types.js';
import type { CT_Document, CT_P, CT_R } from '@ooxml/schema';
import { createStringSink, createWriteContext, wmlWriter } from '@ooxml/schema';

interface IntervalRecord {
  id: number;
  name: string;
  from: number;
  to: number;
}

export class CandidateCMutableTree implements SpikeDocumentModel {
  private readonly _doc: CT_Document;
  private readonly _intervals: IntervalRecord[] = [];
  private _lastRun?: {
    tNode: { $value: string };
    startOffset: number;
    endOffset: number;
  };

  constructor(doc: CT_Document) {
    // Deep clone doc to allow independent isolated benchmarking
    this._doc = structuredClone(doc);
    this._initIntervals();
  }

  /**
   * Universal traversal of all shaped runs across both body paragraphs and table cells.
   */
  private _forEachRun(
    cb: (tNode: { $value: string }, r: CT_R, start: number, end: number) => boolean | void,
  ): void {
    let currentOffset = 0;

    const processParagraph = (p: CT_P): boolean => {
      for (const item of p.pContent) {
        if (item.kind === 'r') {
          for (const c of item.value.runInnerContent) {
            if (c.kind === 't' && c.value.$value !== undefined) {
              const len = c.value.$value.length;
              const start = currentOffset;
              const end = currentOffset + len;
              currentOffset = end;
              const stop = cb(c.value as { $value: string }, item.value, start, end);
              if (stop) return true;
            }
          }
        }
      }
      return false;
    };

    for (const block of this._doc.body.blockLevelElts) {
      if (block.kind === 'p') {
        if (processParagraph(block.value)) return;
      } else if (block.kind === 'tbl') {
        for (const rowItem of block.value.contentRowContent) {
          if (rowItem.kind === 'tr') {
            for (const cellItem of rowItem.value.contentCellContent) {
              if (cellItem.kind === 'tc') {
                for (const b of cellItem.value.blockLevelElts) {
                  if (b.kind === 'p') {
                    if (processParagraph(b.value)) return;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private _initIntervals(): void {
    let currentOffset = 0;
    const active = new Map<number, { name: string; startPos: number }>();

    const scanParagraph = (p: CT_P) => {
      for (const item of p.pContent) {
        if (item.kind === 'bookmarkStart') {
          active.set(item.value.id ?? 0, {
            name: item.value.name ?? '',
            startPos: currentOffset,
          });
        } else if (item.kind === 'bookmarkEnd') {
          const id = item.value.id ?? 0;
          const start = active.get(id);
          if (start) {
            this._intervals.push({
              id,
              name: start.name,
              from: start.startPos,
              to: currentOffset,
            });
            active.delete(id);
          }
        } else if (item.kind === 'r') {
          for (const c of item.value.runInnerContent) {
            if (c.kind === 't' && c.value.$value) {
              currentOffset += c.value.$value.length;
            }
          }
        }
      }
    };

    for (const block of this._doc.body.blockLevelElts) {
      if (block.kind === 'p') {
        scanParagraph(block.value);
      } else if (block.kind === 'tbl') {
        for (const rowItem of block.value.contentRowContent) {
          if (rowItem.kind === 'tr') {
            for (const cellItem of rowItem.value.contentCellContent) {
              if (cellItem.kind === 'tc') {
                for (const b of cellItem.value.blockLevelElts) {
                  if (b.kind === 'p') scanParagraph(b.value);
                }
              }
            }
          }
        }
      }
    }
  }

  insertText(pos: number, text: string): void {
    if (text.length === 0) return;

    let inserted = false;

    // Fast path: consecutive typing in the same run (e.g. typing a sentence)
    if (this._lastRun && pos >= this._lastRun.startOffset && pos <= this._lastRun.endOffset) {
      const local = pos - this._lastRun.startOffset;
      const curVal = this._lastRun.tNode.$value;
      this._lastRun.tNode.$value = curVal.slice(0, local) + text + curVal.slice(local);
      this._lastRun.endOffset += text.length;
      inserted = true;
    }

    if (!inserted) {
      this._forEachRun((tNode, _r, start, end) => {
        if (pos >= start && pos <= end) {
          const local = pos - start;
          const curVal = tNode.$value;
          tNode.$value = curVal.slice(0, local) + text + curVal.slice(local);
          this._lastRun = {
            tNode,
            startOffset: start,
            endOffset: end + text.length,
          };
          inserted = true;
          return true;
        }
      });
    }

    // Shift intervals in the layered interval store
    const delta = text.length;
    for (const inv of this._intervals) {
      if (inv.from >= pos) inv.from += delta;
      if (inv.to >= pos) inv.to += delta;
    }
  }

  deleteRange(from: number, to: number): void {
    if (from >= to) return;
    const deleteLen = to - from;
    this._lastRun = undefined;

    this._forEachRun((tNode, _r, start, end) => {
      if (end <= from || start >= to) return;
      const keepBefore = Math.max(0, from - start);
      const cutEnd = Math.max(0, to - start);
      const curVal = tNode.$value;
      tNode.$value = curVal.slice(0, keepBefore) + curVal.slice(cutEnd);
    });

    // Shift/shrink intervals in the interval store
    for (const inv of this._intervals) {
      if (inv.from >= to) inv.from -= deleteLen;
      else if (inv.from > from) inv.from = from;

      if (inv.to >= to) inv.to -= deleteLen;
      else if (inv.to > from) inv.to = from;
    }
  }

  resolveRunProps(pos: number): RunProperties | undefined {
    let found: RunProperties | undefined;
    this._forEachRun((_tNode, r, start, end) => {
      if (pos >= start && pos < end) {
        const rPr: RunProperties = {};
        for (const b of r.rPr?.rPrBase ?? []) {
          if (b.kind === 'b') rPr.b = true;
          if (b.kind === 'i') rPr.i = true;
        }
        found = rPr;
        return true;
      }
    });
    return found;
  }

  getText(): string {
    let text = '';
    this._forEachRun((t) => {
      text += t.$value;
    });
    return text;
  }

  getLength(): number {
    return this.getText().length;
  }

  getBookmarks(): BookmarkSpan[] {
    return this._intervals.map((inv) => ({
      id: inv.id,
      name: inv.name,
      startPos: inv.from,
      endPos: inv.to,
    }));
  }

  insertParagraph(index: number, text: string): void {
    const newPara: CT_P = {
      pContent: [
        {
          kind: 'r',
          value: {
            runInnerContent: [
              {
                kind: 't',
                value: { $value: text },
              },
            ],
          },
        },
      ],
    };

    // Calculate insertion character offset for interval shift
    let offset = 0;
    const blocks = this._doc.body.blockLevelElts;
    const boundedIndex = Math.min(index, blocks.length);

    for (let i = 0; i < boundedIndex; i++) {
      const b = blocks[i]!;
      if (b.kind === 'p') {
        for (const item of b.value.pContent) {
          if (item.kind === 'r') {
            for (const c of item.value.runInnerContent) {
              if (c.kind === 't' && c.value.$value) offset += c.value.$value.length;
            }
          }
        }
      }
    }

    blocks.splice(boundedIndex, 0, { kind: 'p', value: newPara });

    // Shift intervals located after insertion offset
    const delta = text.length;
    for (const inv of this._intervals) {
      if (inv.from >= offset) inv.from += delta;
      if (inv.to >= offset) inv.to += delta;
    }
  }

  deleteParagraph(index: number): void {
    const blocks = this._doc.body.blockLevelElts;
    if (index >= blocks.length) return;

    let offset = 0;
    for (let i = 0; i < index; i++) {
      const b = blocks[i]!;
      if (b.kind === 'p') {
        for (const item of b.value.pContent) {
          if (item.kind === 'r') {
            for (const c of item.value.runInnerContent) {
              if (c.kind === 't' && c.value.$value) offset += c.value.$value.length;
            }
          }
        }
      }
    }

    const target = blocks[index]!;
    let targetLen = 0;
    if (target.kind === 'p') {
      for (const item of target.value.pContent) {
        if (item.kind === 'r') {
          for (const c of item.value.runInnerContent) {
            if (c.kind === 't' && c.value.$value) targetLen += c.value.$value.length;
          }
        }
      }
    }

    blocks.splice(index, 1);

    // Shift/shrink intervals
    for (const inv of this._intervals) {
      if (inv.from >= offset + targetLen) inv.from -= targetLen;
      else if (inv.from > offset) inv.from = offset;

      if (inv.to >= offset + targetLen) inv.to -= targetLen;
      else if (inv.to > offset) inv.to = offset;
    }
  }

  serialize(): string {
    const stringSink = createStringSink();
    const ctx = createWriteContext('transitional', {
      wml: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
    });

    wmlWriter.writeCT_Document(stringSink.sink, this._doc, ctx, 'document');
    return stringSink.toString();
  }
}
