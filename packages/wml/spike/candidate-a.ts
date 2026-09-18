/**
 * Candidate A: Piece table over flat text buffer + interval store.
 *
 * Implements Spike Candidate A for ADR 0003.
 *
 * Architecture:
 *   - Text lives in an immutable original buffer plus an append-only add buffer.
 *   - Structure is represented as a sequence of pieces indexing either buffer.
 *   - Runs, paragraph boundaries, and annotations are tracked as intervals over character offsets.
 *
 * Strengths:
 *   - O(1) text append, O(k) piece-split insertion. Fast keystroke typing.
 *
 * Fatal Risk / Weakness:
 *   - WordprocessingML is structural (tables, SDTs, drawing anchors, section properties).
 *   - Unknown XML elements ($unknown) and attributes ($unknownAttrs) are not flat text.
 *   - Lossless round-trip requires maintaining a parallel DOM tree anyway, causing
 *     duplication, desynchronization, and leaky abstractions.
 */

import type { BookmarkSpan, RunProperties, SpikeDocumentModel } from './types.js';
import type { CT_Document } from '@ooxml/schema';

interface Piece {
  buffer: 'orig' | 'add';
  start: number;
  length: number;
}

interface FormatInterval {
  from: number;
  to: number;
  rPr: RunProperties;
}

interface BookmarkInterval {
  id: number;
  name: string;
  from: number;
  to: number;
}

interface ParagraphInterval {
  from: number;
  to: number;
}

export class CandidateAPieceTable implements SpikeDocumentModel {
  private readonly _origBuffer: string;
  private _addBuffer: string = '';
  private _pieces: Piece[] = [];
  private _formatting: FormatInterval[] = [];
  private _bookmarks: BookmarkInterval[] = [];
  private _paragraphs: ParagraphInterval[] = [];

  constructor(doc: CT_Document) {
    // Flatten the initial document into an original text buffer and intervals
    let fullText = '';
    const formatting: FormatInterval[] = [];
    const bookmarks: BookmarkInterval[] = [];
    const paragraphs: ParagraphInterval[] = [];

    const activeBookmarks = new Map<number, { name: string; startPos: number }>();

    for (const block of doc.body.blockLevelElts) {
      if (block.kind === 'p') {
        const pStart = fullText.length;
        for (const item of block.value.pContent) {
          if (item.kind === 'bookmarkStart') {
            const b = item.value;
            activeBookmarks.set(b.id ?? 0, {
              name: b.name ?? '',
              startPos: fullText.length,
            });
          } else if (item.kind === 'bookmarkEnd') {
            const b = item.value;
            const start = activeBookmarks.get(b.id ?? 0);
            if (start) {
              bookmarks.push({
                id: b.id ?? 0,
                name: start.name,
                from: start.startPos,
                to: fullText.length,
              });
              activeBookmarks.delete(b.id ?? 0);
            }
          } else if (item.kind === 'r') {
            const r = item.value;
            const rPr: RunProperties = {};
            for (const b of r.rPr?.rPrBase ?? []) {
              if (b.kind === 'b') rPr.b = true;
              if (b.kind === 'i') rPr.i = true;
            }

            for (const content of r.runInnerContent) {
              if (content.kind === 't') {
                const text = (content.value as any).$value ?? (content.value as any).value ?? '';
                if (text) {
                  const rStart = fullText.length;
                  fullText += text;
                  const rEnd = fullText.length;
                  formatting.push({ from: rStart, to: rEnd, rPr });
                }
              }
            }
          }
        }
        // Paragraph boundary marker
        paragraphs.push({ from: pStart, to: fullText.length });
      }
    }

    this._origBuffer = fullText;
    this._pieces = [{ buffer: 'orig', start: 0, length: fullText.length }];
    this._formatting = formatting;
    this._bookmarks = bookmarks;
    this._paragraphs = paragraphs;
  }

  insertText(pos: number, text: string): void {
    if (text.length === 0) return;

    const addStart = this._addBuffer.length;
    this._addBuffer += text;
    const newPiece: Piece = { buffer: 'add', start: addStart, length: text.length };

    // Find the piece containing pos
    let currentOffset = 0;
    let pieceIdx = 0;

    while (pieceIdx < this._pieces.length) {
      const piece = this._pieces[pieceIdx]!;
      const pieceEnd = currentOffset + piece.length;

      if (pos >= currentOffset && pos <= pieceEnd) {
        const offsetInPiece = pos - currentOffset;

        if (offsetInPiece === 0) {
          this._pieces.splice(pieceIdx, 0, newPiece);
        } else if (offsetInPiece === piece.length) {
          this._pieces.splice(pieceIdx + 1, 0, newPiece);
        } else {
          // Split piece into left and right
          const leftPiece: Piece = {
            buffer: piece.buffer,
            start: piece.start,
            length: offsetInPiece,
          };
          const rightPiece: Piece = {
            buffer: piece.buffer,
            start: piece.start + offsetInPiece,
            length: piece.length - offsetInPiece,
          };
          this._pieces.splice(pieceIdx, 1, leftPiece, newPiece, rightPiece);
        }
        break;
      }
      currentOffset = pieceEnd;
      pieceIdx++;
    }

    const delta = text.length;

    // Shift formatting intervals
    for (const fmt of this._formatting) {
      if (fmt.from >= pos) {
        fmt.from += delta;
        fmt.to += delta;
      } else if (fmt.to > pos) {
        fmt.to += delta;
      }
    }

    // Shift bookmark intervals
    for (const bm of this._bookmarks) {
      if (bm.from >= pos) bm.from += delta;
      if (bm.to >= pos) bm.to += delta;
    }

    // Shift paragraphs
    for (const p of this._paragraphs) {
      if (p.from >= pos) p.from += delta;
      if (p.to >= pos) p.to += delta;
    }
  }

  deleteRange(from: number, to: number): void {
    if (from >= to) return;
    const deleteLen = to - from;

    // Rebuild pieces excluding [from, to)
    const newPieces: Piece[] = [];
    let currentOffset = 0;

    for (const piece of this._pieces) {
      const pieceStart = currentOffset;
      const pieceEnd = currentOffset + piece.length;
      currentOffset = pieceEnd;

      if (pieceEnd <= from || pieceStart >= to) {
        newPieces.push(piece);
      } else {
        if (pieceStart < from) {
          newPieces.push({
            buffer: piece.buffer,
            start: piece.start,
            length: from - pieceStart,
          });
        }
        if (pieceEnd > to) {
          newPieces.push({
            buffer: piece.buffer,
            start: piece.start + (to - pieceStart),
            length: pieceEnd - to,
          });
        }
      }
    }
    this._pieces = newPieces;

    // Adjust formatting
    const newFmt: FormatInterval[] = [];
    for (const f of this._formatting) {
      if (f.to <= from) {
        newFmt.push(f);
      } else if (f.from >= to) {
        newFmt.push({ from: f.from - deleteLen, to: f.to - deleteLen, rPr: f.rPr });
      }
    }
    this._formatting = newFmt;

    // Adjust bookmarks
    for (const bm of this._bookmarks) {
      if (bm.from >= to) bm.from -= deleteLen;
      else if (bm.from > from) bm.from = from;

      if (bm.to >= to) bm.to -= deleteLen;
      else if (bm.to > from) bm.to = from;
    }

    // Adjust paragraphs
    for (const p of this._paragraphs) {
      if (p.from >= to) p.from -= deleteLen;
      if (p.to >= to) p.to -= deleteLen;
    }
  }

  resolveRunProps(pos: number): RunProperties | undefined {
    for (const f of this._formatting) {
      if (pos >= f.from && pos < f.to) {
        return f.rPr;
      }
    }
    return undefined;
  }

  getText(): string {
    let result = '';
    for (const piece of this._pieces) {
      const buf = piece.buffer === 'orig' ? this._origBuffer : this._addBuffer;
      result += buf.slice(piece.start, piece.start + piece.length);
    }
    return result;
  }

  getLength(): number {
    let total = 0;
    for (const piece of this._pieces) total += piece.length;
    return total;
  }

  getBookmarks(): BookmarkSpan[] {
    return this._bookmarks.map((bm) => ({
      id: bm.id,
      name: bm.name,
      startPos: bm.from,
      endPos: bm.to,
    }));
  }

  insertParagraph(index: number, text: string): void {
    const targetPos =
      index < this._paragraphs.length ? this._paragraphs[index]!.from : this.getLength();
    this.insertText(targetPos, text + '\n');
    this._paragraphs.splice(index, 0, { from: targetPos, to: targetPos + text.length + 1 });
  }

  deleteParagraph(index: number): void {
    if (index >= this._paragraphs.length) return;
    const p = this._paragraphs[index]!;
    this.deleteRange(p.from, p.to);
    this._paragraphs.splice(index, 1);
  }

  serialize(): string {
    // Attempt to reconstruct WordprocessingML from piece table & intervals.
    // FUNDAMENTAL DEFECT:
    // Flattens tables and drops unknown elements ($unknown raw nodes) and custom attributes ($unknownAttrs),
    // because piece tables only track textual character sequences.
    const text = this.getText();
    let xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';

    for (let i = 0; i < this._paragraphs.length; i++) {
      const p = this._paragraphs[i]!;
      xml += '<w:p>';

      // Check for bookmarks starting in this paragraph
      for (const bm of this._bookmarks) {
        if (bm.from >= p.from && bm.from < p.to) {
          xml += `<w:bookmarkStart w:id="${bm.id}" w:name="${bm.name}"/>`;
        }
      }

      // Reconstruct runs from formatting intervals overlapping this paragraph
      let cur = p.from;
      while (cur < p.to) {
        const fmt = this._formatting.find((f) => cur >= f.from && cur < f.to);
        const nextCut = fmt ? Math.min(p.to, fmt.to) : p.to;
        const slice = text.slice(cur, nextCut);

        if (slice.length > 0) {
          xml += '<w:r>';
          if (fmt?.rPr.b || fmt?.rPr.i) {
            xml += '<w:rPr>';
            if (fmt.rPr.b) xml += '<w:b/>';
            if (fmt.rPr.i) xml += '<w:i/>';
            xml += '</w:rPr>';
          }
          xml += `<w:t>${escapeXml(slice)}</w:t></w:r>`;
        }
        cur = nextCut;
      }

      for (const bm of this._bookmarks) {
        if (bm.to >= p.from && bm.to <= p.to) {
          xml += `<w:bookmarkEnd w:id="${bm.id}"/>`;
        }
      }

      xml += '</w:p>';
    }

    xml += '</w:body></w:document>';
    return xml;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
