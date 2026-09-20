import {
  RelationshipTypes,
  type OpcPackage,
  type OpcPart,
} from '@ooxml/opc';
import { buildPresetGeometry, PRESET_GEOMETRIES } from '@ooxml/dml';
import { buildGrid, autofitColumns, layoutMath, type MathNode } from '@ooxml/layout';
import { parseTocSwitches, renderTocEntries } from '@ooxml/wml';
import type { CT_Body, CT_Document, CT_P, CT_R, CT_Tbl, CT_Row, CT_Tc, CT_Drawing } from '@ooxml/schema';
// OMML generated types are intentionally not public from @ooxml/schema; insertion uses a checked raw-compatible value.
import { createStringSink, createWriteContext, wmlWriter } from '@ooxml/schema';
import type { WmlDocumentModel } from './document-model.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

export type BreakKind = 'page' | 'column' | 'section-next-page' | 'section-continuous';
export type ImageInput = File | Blob | Uint8Array;

export interface InsertionServiceOptions {
  readonly document: CT_Document;
  readonly model?: WmlDocumentModel;
  readonly package?: OpcPackage;
  /** The paragraph at which block/inline insertions are made. Defaults to the last paragraph. */
  readonly getParagraph?: () => CT_P | undefined;
  readonly onChange?: () => void;
}

export interface InsertedImage { readonly partName?: string; readonly relationshipId?: string; readonly diagnostic?: string; }
export interface InsertedShape { readonly preset: string; readonly diagnostic?: string; }

/**
 * Demo-local insertion pipeline. It mutates the parsed AST, then serializes only the
 * main part through the public writer. No private OPC mutation or guessed package API is used.
 */
export class InsertionService {
  private readonly opts: InsertionServiceOptions;
  private imageNumber = 1;
  private relationshipNumber = 1;

  constructor(options: InsertionServiceOptions) { this.opts = options; }

  insertTable(rows: number, columns: number): CT_Tbl {
    const r = clampInt(rows, 1, 50); const c = clampInt(columns, 1, 50);
    const width = Math.floor(9360 / c);
    const tbl: CT_Tbl = {
      rangeMarkupElements: [],
      tblPr: { tblW: { type: 'dxa', w: 9360 }, tblLayout: { type: 'fixed' }, tblBorders: {
        top: { val: 'single', sz: '4' }, bottom: { val: 'single', sz: '4' }, left: { val: 'single', sz: '4' }, right: { val: 'single', sz: '4' }, insideH: { val: 'single', sz: '4' }, insideV: { val: 'single', sz: '4' },
      } },
      tblGrid: { gridCol: Array.from({ length: c }, () => ({ w: width })) },
      contentRowContent: Array.from({ length: r }, () => ({ kind: 'tr', value: {
        contentCellContent: Array.from({ length: c }, () => ({ kind: 'tc', value: {
          blockLevelElts: [{ kind: 'p', value: emptyParagraph() }],
        } as CT_Tc })),
      } as CT_Row })),
    };
    // Validate the exact generated shape before publishing it to the document.
    buildGrid(tbl);
    autofitColumns(c, [], { available: 9360, tblWidth: { kind: 'twips', value: 9360 } });
    this.appendBlock({ kind: 'tbl', value: tbl });
    return tbl;
  }

  async insertImage(input: ImageInput): Promise<InsertedImage> {
    const pkg = this.opts.package;
    if (!pkg) return { diagnostic: 'image-byte-registration-unavailable: no OpcPackage was supplied' };
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    const mime = input instanceof File ? input.type : input instanceof Blob ? input.type : 'image/png';
    const extension = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'png';
    const partName = `/word/media/image${this.imageNumber++}.${extension}`;
    const relId = this.nextRelationshipId();
    const part = pkg.getPart(partName);
    if (part) part.replaceBytes(bytes);
    else return { partName, relationshipId: relId, diagnostic: 'image-byte-registration-unsupported: OpcPackage has no public part-creation API' };
    const relSet = pkg.relationships.relationshipsOf(pkg.mainDocument.name);
    relSet.add({ id: relId, type: RelationshipTypes.image[0]!, target: `media/image${this.imageNumber - 1}.${extension}`, targetMode: 'Internal', targetModeExplicit: false, targetPartName: undefined, unknownAttributes: [], text: '' });
    this.appendInlineDrawing(this.imageDrawing(relId, partName));
    this.commit();
    return { partName, relationshipId: relId };
  }

  insertShape(preset: string): InsertedShape {
    const name = Object.prototype.hasOwnProperty.call(PRESET_GEOMETRIES, preset) ? preset : 'rect';
    const geometry = buildPresetGeometry(name, { width: 2400, height: 1200 });
    const diagnostic = geometry ? undefined : 'shape-preset-unavailable';
    this.appendInlineDrawing(this.rawDrawing(`<a:prstGeom prst="${escapeXml(name)}"><a:avLst/></a:prstGeom>`));
    this.commit();
    return { preset: name, ...(diagnostic ? { diagnostic } : {}) };
  }

  insertEquation(node: MathNode | unknown | string): { readonly diagnostic?: string } {
    const math = typeof node === 'string' ? ({ kind: 'r', text: node } as MathNode) : isMathNode(node) ? node : ({ kind: 'r', text: 'equation' } as MathNode);
    const diagnostics: string[] = [];
    layoutMath(math, { diagnostics, mathTableAvailable: false });
    const omath = { oMathElements: [{ kind: 'r', value: { content: [{ kind: 't_math', value: { $value: math.text ?? '' } }] } }] } as unknown;
    const paragraph = this.getParagraph() ?? this.lastParagraph();
    (paragraph.pContent as unknown as Array<unknown>).push({ kind: 'oMath', value: omath });
    this.commit();
    return diagnostics.length ? { diagnostic: diagnostics.join(',') } : {};
  }

  insertBreak(kind: BreakKind): void {
    const paragraph = this.getParagraph() ?? this.lastParagraph();
    if (kind === 'page' || kind === 'column') {
      (paragraph.pContent as unknown as Array<unknown>).push({ kind: 'r', value: { runInnerContent: [{ kind: 'br', value: { type: kind } }] } });
    } else {
      const body = this.requireBody() as CT_Body & { sectPr?: { hdrFtrReferences: readonly unknown[]; type?: unknown } };
      const sectPr = body.sectPr ?? { hdrFtrReferences: [] };
      sectPr.type = { val: kind === 'section-next-page' ? 'nextPage' : 'continuous' };
      body.sectPr = sectPr;
    }
    this.commit();
  }

  insertToc(instruction = 'TOC \\o "1-3" \\h'): { readonly text: string; readonly diagnostic?: string } {
    const options = parseTocSwitches(instruction);
    const entries = this.headingEntries();
    const text = renderTocEntries(entries, options);
    const paragraph = this.getParagraph() ?? this.lastParagraph();
    (paragraph.pContent as unknown as Array<unknown>).push({ kind: 'fldSimple', value: { instr: instruction, pContent: [{ kind: 'r', value: textRun(text) }] } });
    this.commit();
    return { text, ...(entries.length ? {} : { diagnostic: 'toc-no-headings' }) };
  }

  private headingEntries(): Array<{ title: string; page: number; bookmark?: string }> {
    const body = this.requireBody(); const entries: Array<{ title: string; page: number }> = [];
    for (const item of body.blockLevelElts) if (item.kind === 'p') {
      const title = paragraphText(item.value); const style = (item.value.pPr?.pStyle as { val?: string } | undefined)?.val;
      if (style?.startsWith('Heading')) entries.push({ title, page: entries.length + 1 });
    }
    return entries;
  }

  private appendBlock(item: unknown): void { (this.requireBody().blockLevelElts as unknown as Array<unknown>).push(item); this.commit(); }
  private appendInlineDrawing(drawing: CT_Drawing): void { (this.getParagraph() ?? this.lastParagraph()).pContent as unknown as Array<unknown>; ((this.getParagraph() ?? this.lastParagraph()).pContent as unknown as Array<unknown>).push({ kind: 'r', value: { runInnerContent: [{ kind: 'drawing', value: drawing }] } }); }
  private rawDrawing(fragment: string): CT_Drawing { return { content: [{ kind: '$raw', value: rawNode(`<w:drawing xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:r="${R}">${fragment}</w:drawing>`) }] } as unknown as CT_Drawing; }
  private imageDrawing(relId: string, partName: string): CT_Drawing { return this.rawDrawing(`<wp:inline><wp:extent cx="990600" cy="742950"/><wp:docPr id="1" name="Image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="990600" cy="742950"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline>`); }
  private nextRelationshipId(): string { const used = new Set(this.opts.package?.relationships.relationshipsOf(this.opts.package.mainDocument.name).relationships.map((r) => r.id)); let id = ''; do id = `rId${this.relationshipNumber++}`; while (used.has(id)); return id; }
  private getParagraph(): CT_P | undefined { return this.opts.getParagraph?.(); }
  private lastParagraph(): CT_P { const found = this.requireBody().blockLevelElts.filter((x) => x.kind === 'p').at(-1); if (found?.kind === 'p') return found.value; const p = emptyParagraph(); (this.requireBody().blockLevelElts as unknown as Array<unknown>).push({ kind: 'p', value: p }); return p; }
  private requireBody(): CT_Body { if (!this.opts.document.body) throw new Error('document body is required'); return this.opts.document.body; }
  private commit(): void { if (this.opts.package) { const { sink, toString } = createStringSink(); const ctx = createWriteContext('transitional', { wml: W }); wmlWriter.writeCT_Document(sink, this.opts.document, ctx, 'document'); this.opts.package.mainDocument.replaceBytes(new TextEncoder().encode(toString())); } this.opts.onChange?.(); }
}

function emptyParagraph(): CT_P { return { pContent: [{ kind: 'r', value: textRun('') }] }; }
function textRun(text: string): CT_R { return { runInnerContent: [{ kind: 't', value: { $value: text } }] }; }
function paragraphText(p: CT_P): string { return p.pContent.filter((x) => x.kind === 'r').map((x) => x.value.runInnerContent.filter((y) => y.kind === 't').map((y) => String(y.value.$value ?? '')).join('')).join(''); }
function clampInt(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Math.trunc(value))); }
function escapeXml(value: string): string { return value.replace(/[<&\"]/g, (c) => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '"' ? '&quot;' : '&apos;'); }
function isMathNode(value: unknown): value is MathNode { return !!value && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string'; }
function rawNode(xml: string): any { return { kind: 'element', name: 'w:drawing', attrs: [], children: [{ kind: 'text', value: xml }] }; }

export function isImagePart(part: OpcPart): boolean { return part.contentType.startsWith('image/'); }
export function presetNames(): readonly string[] { return Object.keys(PRESET_GEOMETRIES).sort(); }
