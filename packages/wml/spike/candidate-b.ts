/**
 * Candidate B: Immutable Persistent Tree with Structural Sharing.
 *
 * Implements Spike Candidate B for ADR 0003.
 *
 * Architecture:
 *   - Pure, immutable functional tree.
 *   - Every keystroke or deletion produces a new root document.
 *   - Untouched subtrees (e.g. 499 of 500 paragraphs) are structurally shared via reference equality.
 *
 * Strengths:
 *   - Trivial undo/redo (keep root references in an array).
 *   - Invalidation is pointer equality check: if (oldPara === newPara) skipRelayout().
 *   - High structural fidelity (keeps the hierarchical AST).
 *
 * Fatal Risk / Weakness:
 *   - Memory churn on single-character typing: each keystroke allocates a new Run,
 *     a new Run array, a new Paragraph, a new Block array, a new Body, and a new Document root.
 *   - On 10,000 keystrokes, allocates tens of thousands of intermediate objects,
 *     triggering major V8 GC sweeps and degrading typing latency.
 */

import type { BookmarkSpan, RunProperties, SpikeDocumentModel } from './types.js';
import type { CT_Document, RawNode, XmlAttr } from '@ooxml/schema';

export interface ImmutableRun {
  readonly kind: 'r';
  readonly text: string;
  readonly rPr?: RunProperties;
}

export interface ImmutableBookmarkStart {
  readonly kind: 'bookmarkStart';
  readonly id: number;
  readonly name: string;
}

export interface ImmutableBookmarkEnd {
  readonly kind: 'bookmarkEnd';
  readonly id: number;
}

export type ImmutablePContent = ImmutableRun | ImmutableBookmarkStart | ImmutableBookmarkEnd;

export interface ImmutableParagraph {
  readonly kind: 'p';
  readonly pStyle?: string;
  readonly pContent: readonly ImmutablePContent[];
  readonly $unknown?: readonly unknown[];
  readonly $unknownAttrs?: readonly XmlAttr[];
}

export interface ImmutableTableCell {
  readonly paragraphs: readonly ImmutableParagraph[];
}

export interface ImmutableTableRow {
  readonly cells: readonly ImmutableTableCell[];
}

export interface ImmutableTable {
  readonly kind: 'tbl';
  readonly rows: readonly ImmutableTableRow[];
}

export type ImmutableBlock = ImmutableParagraph | ImmutableTable;

export interface ImmutableBody {
  readonly blockLevelElts: readonly ImmutableBlock[];
}

export interface ImmutableDoc {
  readonly body: ImmutableBody;
}

export class CandidateBImmutableTree implements SpikeDocumentModel {
  private _root: ImmutableDoc;

  constructor(doc: CT_Document) {
    this._root = this._convertDoc(doc);
  }

  private _convertDoc(doc: CT_Document): ImmutableDoc {
    const blocks: ImmutableBlock[] = [];

    for (const block of doc.body.blockLevelElts) {
      if (block.kind === 'p') {
        const p = block.value;
        const pContent: ImmutablePContent[] = [];

        for (const item of p.pContent) {
          if (item.kind === 'r') {
            const r = item.value;
            const rPr: RunProperties = {};
            for (const b of r.rPr?.rPrBase ?? []) {
              if (b.kind === 'b') rPr.b = true;
              if (b.kind === 'i') rPr.i = true;
            }

            let text = '';
            for (const c of r.runInnerContent) {
              if (c.kind === 't') text += (c.value as any).$value ?? (c.value as any).value ?? '';
            }
            pContent.push({ kind: 'r', text, rPr: Object.keys(rPr).length > 0 ? rPr : undefined });
          } else if (item.kind === 'bookmarkStart') {
            pContent.push({
              kind: 'bookmarkStart',
              id: item.value.id ?? 0,
              name: item.value.name ?? '',
            });
          } else if (item.kind === 'bookmarkEnd') {
            pContent.push({
              kind: 'bookmarkEnd',
              id: item.value.id ?? 0,
            });
          }
        }

        blocks.push({
          kind: 'p',
          pStyle: p.pPr?.pStyle?.val,
          pContent,
          $unknown: p.$unknown,
          $unknownAttrs: p.$unknownAttrs,
        });
      } else if (block.kind === 'tbl') {
        const tbl = block.value;
        const rows: ImmutableTableRow[] = [];
        for (const rowItem of tbl.contentRowContent) {
          if (rowItem.kind === 'tr') {
            const cells: ImmutableTableCell[] = [];
            for (const cellItem of rowItem.value.contentCellContent) {
              if (cellItem.kind === 'tc') {
                const paras: ImmutableParagraph[] = [];
                for (const b of cellItem.value.blockLevelElts) {
                  if (b.kind === 'p') {
                    for (const item of b.value.pContent) {
                      if (item.kind === 'r') {
                        let text = '';
                        for (const c of item.value.runInnerContent) {
                          if (c.kind === 't')
                            text += (c.value as any).$value ?? (c.value as any).value ?? '';
                        }
                        paras.push({ kind: 'p', pContent: [{ kind: 'r', text }] });
                      }
                    }
                  }
                }
                cells.push({ paragraphs: paras });
              }
            }
            rows.push({ cells });
          }
        }
        blocks.push({ kind: 'tbl', rows });
      }
    }

    return { body: { blockLevelElts: blocks } };
  }

  insertText(pos: number, text: string): void {
    if (text.length === 0) return;

    let currentOffset = 0;
    const oldBlocks = this._root.body.blockLevelElts;
    const newBlocks = [...oldBlocks];

    for (let bIdx = 0; bIdx < oldBlocks.length; bIdx++) {
      const block = oldBlocks[bIdx]!;
      if (block.kind === 'p') {
        const pLen = this._getParagraphTextLength(block);
        const pEnd = currentOffset + pLen;

        if (pos >= currentOffset && pos <= pEnd) {
          // Target paragraph found. Clone the paragraph with structural sharing
          const newPContent = [...block.pContent];
          let pOffset = currentOffset;

          for (let cIdx = 0; cIdx < block.pContent.length; cIdx++) {
            const item = block.pContent[cIdx]!;
            if (item.kind === 'r') {
              const rLen = item.text.length;
              const rEnd = pOffset + rLen;

              if (pos >= pOffset && pos <= rEnd) {
                const localOffset = pos - pOffset;
                const newText =
                  item.text.slice(0, localOffset) + text + item.text.slice(localOffset);
                newPContent[cIdx] = {
                  ...item,
                  text: newText,
                };
                break;
              }
              pOffset = rEnd;
            }
          }

          newBlocks[bIdx] = {
            ...block,
            pContent: newPContent,
          };
          break;
        }
        currentOffset = pEnd;
      }
    }

    // Allocate new root and body (structural sharing)
    this._root = {
      body: {
        blockLevelElts: newBlocks,
      },
    };
  }

  deleteRange(from: number, to: number): void {
    if (from >= to) return;

    let currentOffset = 0;
    const oldBlocks = this._root.body.blockLevelElts;
    const newBlocks: ImmutableBlock[] = [];

    for (let bIdx = 0; bIdx < oldBlocks.length; bIdx++) {
      const block = oldBlocks[bIdx]!;
      if (block.kind === 'p') {
        const pLen = this._getParagraphTextLength(block);
        const pStart = currentOffset;
        const pEnd = currentOffset + pLen;
        currentOffset = pEnd;

        if (pEnd <= from || pStart >= to) {
          // Untouched paragraph, reuse reference
          newBlocks.push(block);
        } else {
          // Partially or fully affected paragraph
          const newPContent: ImmutablePContent[] = [];
          let itemOffset = pStart;

          for (const item of block.pContent) {
            if (item.kind === 'r') {
              const rStart = itemOffset;
              const rEnd = itemOffset + item.text.length;
              itemOffset = rEnd;

              if (rEnd <= from || rStart >= to) {
                newPContent.push(item);
              } else {
                const keepBefore = Math.max(0, from - rStart);
                const cutEnd = Math.max(0, to - rStart);
                const newText = item.text.slice(0, keepBefore) + item.text.slice(cutEnd);
                if (newText.length > 0) {
                  newPContent.push({ ...item, text: newText });
                }
              }
            } else {
              newPContent.push(item);
            }
          }

          newBlocks.push({
            ...block,
            pContent: newPContent,
          });
        }
      } else {
        newBlocks.push(block);
      }
    }

    this._root = {
      body: {
        blockLevelElts: newBlocks,
      },
    };
  }

  resolveRunProps(pos: number): RunProperties | undefined {
    let currentOffset = 0;
    for (const block of this._root.body.blockLevelElts) {
      if (block.kind === 'p') {
        for (const item of block.pContent) {
          if (item.kind === 'r') {
            const len = item.text.length;
            if (pos >= currentOffset && pos < currentOffset + len) {
              return item.rPr;
            }
            currentOffset += len;
          }
        }
      }
    }
    return undefined;
  }

  getText(): string {
    let result = '';
    for (const block of this._root.body.blockLevelElts) {
      if (block.kind === 'p') {
        for (const item of block.pContent) {
          if (item.kind === 'r') result += item.text;
        }
      }
    }
    return result;
  }

  getLength(): number {
    return this.getText().length;
  }

  getBookmarks(): BookmarkSpan[] {
    const spans: BookmarkSpan[] = [];
    const active = new Map<number, { name: string; startPos: number }>();
    let currentOffset = 0;

    for (const block of this._root.body.blockLevelElts) {
      if (block.kind === 'p') {
        for (const item of block.pContent) {
          if (item.kind === 'bookmarkStart') {
            active.set(item.id, { name: item.name, startPos: currentOffset });
          } else if (item.kind === 'bookmarkEnd') {
            const st = active.get(item.id);
            if (st) {
              spans.push({
                id: item.id,
                name: st.name,
                startPos: st.startPos,
                endPos: currentOffset,
              });
              active.delete(item.id);
            }
          } else if (item.kind === 'r') {
            currentOffset += item.text.length;
          }
        }
      }
    }
    return spans;
  }

  insertParagraph(index: number, text: string): void {
    const newBlocks = [...this._root.body.blockLevelElts];
    const newPara: ImmutableParagraph = {
      kind: 'p',
      pContent: [{ kind: 'r', text }],
    };
    newBlocks.splice(index, 0, newPara);
    this._root = { body: { blockLevelElts: newBlocks } };
  }

  deleteParagraph(index: number): void {
    const newBlocks = [...this._root.body.blockLevelElts];
    newBlocks.splice(index, 1);
    this._root = { body: { blockLevelElts: newBlocks } };
  }

  serialize(): string {
    let xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';

    for (const block of this._root.body.blockLevelElts) {
      if (block.kind === 'p') {
        xml += '<w:p>';
        if (block.pStyle) {
          xml += `<w:pPr><w:pStyle w:val="${block.pStyle}"/></w:pPr>`;
        }
        for (const item of block.pContent) {
          if (item.kind === 'bookmarkStart') {
            xml += `<w:bookmarkStart w:id="${item.id}" w:name="${item.name}"/>`;
          } else if (item.kind === 'bookmarkEnd') {
            xml += `<w:bookmarkEnd w:id="${item.id}"/>`;
          } else if (item.kind === 'r') {
            xml += '<w:r>';
            if (item.rPr?.b || item.rPr?.i) {
              xml += '<w:rPr>';
              if (item.rPr.b) xml += '<w:b/>';
              if (item.rPr.i) xml += '<w:i/>';
              xml += '</w:rPr>';
            }
            xml += `<w:t>${escapeXml(item.text)}</w:t></w:r>`;
          }
        }
        xml += '</w:p>';
      } else if (block.kind === 'tbl') {
        xml += '<w:tbl>';
        for (const row of block.rows) {
          xml += '<w:tr>';
          for (const cell of row.cells) {
            xml += '<w:tc>';
            for (const p of cell.paragraphs) {
              xml += '<w:p>';
              for (const item of p.pContent) {
                if (item.kind === 'r') {
                  xml += `<w:r><w:t>${escapeXml(item.text)}</w:t></w:r>`;
                }
              }
              xml += '</w:p>';
            }
            xml += '</w:tc>';
          }
          xml += '</w:tr>';
        }
        xml += '</w:tbl>';
      }
    }

    xml += '</w:body></w:document>';
    return xml;
  }

  private _getParagraphTextLength(p: ImmutableParagraph): number {
    let len = 0;
    for (const c of p.pContent) {
      if (c.kind === 'r') len += c.text.length;
    }
    return len;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
