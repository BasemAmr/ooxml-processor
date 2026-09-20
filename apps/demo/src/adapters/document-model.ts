import type { DocumentModel } from '@ooxml/editor';
import type { CT_Document, CT_P, CT_R, CT_Tbl, CT_Row, CT_Tc } from '@ooxml/schema';
import { IdTable, type NodeId, type NodeKind } from '@ooxml/wml';

type Entry = { kind: NodeKind; node: unknown; parent?: unknown; slot?: string; index?: number };
type ContentItem = { kind: string; value: any };

/** Mutable facade over the generated AST; the AST remains authoritative for writing. */
export class WmlDocumentModel implements DocumentModel {
  private readonly nodes = new Map<NodeId, Entry>();
  private readonly identities = new Map<unknown, NodeId>();

  constructor(public readonly idTable: IdTable, public readonly doc: CT_Document) {
    this.reindex();
  }

  private add(kind: NodeKind, node: unknown, parent?: unknown, slot?: string, index?: number): NodeId {
    const existing = this.identities.get(node);
    const id = existing ?? this.idTable.mint(kind);
    this.identities.set(node, id);
    const entry: Entry = { kind, node };
    if (parent !== undefined) entry.parent = parent;
    if (slot !== undefined) entry.slot = slot;
    if (index !== undefined) entry.index = index;
    this.nodes.set(id, entry);
    return id;
  }

  /** Rebuilds only the adapter index; it never clones or normalizes AST data. */
  private reindex(): void {
    this.nodes.clear();
    const body = this.doc.body;
    if (!body) return;
    const visitParagraph = (p: CT_P, parent: unknown, slot: string, index: number) => {
      const pid = this.add('paragraph', p, parent, slot, index);
      for (let i = 0; i < p.pContent.length; i++) {
        const item = p.pContent[i] as ContentItem;
        if (item.kind !== 'r') continue;
        const rid = this.add('run', item.value as CT_R, p, 'pContent', i);
        for (const child of (item.value as CT_R).runInnerContent as readonly ContentItem[]) {
          if (child.kind === 't') this.add('run', child.value, item.value, 'runInnerContent');
        }
      }
      void pid;
    };
    const visitCell = (tc: CT_Tc, parent: unknown, index: number) => {
      this.add('cell', tc, parent, 'contentCellContent', index);
      for (let i = 0; i < tc.blockLevelElts.length; i++) {
        const b = tc.blockLevelElts[i] as ContentItem;
        if (b.kind === 'p') visitParagraph(b.value, tc, 'blockLevelElts', i);
        else if (b.kind === 'tbl') visitTable(b.value, tc, 'blockLevelElts', i);
      }
    };
    const visitRow = (row: CT_Row, parent: unknown, index: number) => {
      this.add('row', row, parent, 'contentRowContent', index);
      for (let i = 0; i < row.contentCellContent.length; i++) {
        const c = row.contentCellContent[i] as ContentItem;
        if (c.kind === 'tc') visitCell(c.value, row, i);
      }
    };
    const visitTable = (tbl: CT_Tbl, parent: unknown, slot: string, index: number) => {
      this.add('table', tbl, parent, slot, index);
      for (let i = 0; i < tbl.contentRowContent.length; i++) {
        const r = tbl.contentRowContent[i] as ContentItem;
        if (r.kind === 'tr') visitRow(r.value, tbl, i);
      }
    };
    for (let i = 0; i < body.blockLevelElts.length; i++) {
      const b = body.blockLevelElts[i] as ContentItem;
      if (b.kind === 'p') visitParagraph(b.value, body, 'blockLevelElts', i);
      else if (b.kind === 'tbl') visitTable(b.value, body, 'blockLevelElts', i);
    }
  }

  private entry(id: NodeId): Entry {
    const e = this.nodes.get(id);
    if (!e) throw new Error(`Unknown document node: ${String(id)}`);
    return e;
  }

  private textOf(node: any): string {
    if (node && Array.isArray(node.pContent)) return node.pContent.filter((x: ContentItem) => x.kind === 'r').map((x: ContentItem) => this.textOf(x.value)).join('');
    if (node && Array.isArray(node.runInnerContent)) return node.runInnerContent.filter((x: ContentItem) => x.kind === 't').map((x: ContentItem) => String(x.value.$value ?? '')).join('');
    return typeof node?.$value === 'string' ? node.$value : '';
  }

  getText(node: NodeId): string {
    const e = this.entry(node);
    if (e.kind !== 'paragraph' && e.kind !== 'run') throw new Error(`Text is not supported for node kind: ${e.kind}`);
    return this.textOf(e.node);
  }

  setText(node: NodeId, text: string): void {
    const e = this.entry(node);
    if (e.kind === 'run') {
      const r = e.node as CT_R;
      const texts = (r.runInnerContent as ContentItem[]).filter((x) => x.kind === 't');
      if (texts.length) {
        (texts[0]!.value as { $value: string }).$value = text;
        for (let i = 1; i < texts.length; i++) (texts[i]!.value as { $value: string }).$value = '';
      } else (r.runInnerContent as ContentItem[]).push({ kind: 't', value: { $value: text } });
      return;
    }
    if (e.kind !== 'paragraph') throw new Error(`Text is not supported for node kind: ${e.kind}`);
    const p = e.node as CT_P;
    const runs = (p.pContent as ContentItem[]).filter((x) => x.kind === 'r');
    if (!runs.length) (p.pContent as ContentItem[]).push({ kind: 'r', value: { runInnerContent: [{ kind: 't', value: { $value: text } }] } });
    else this.setText(this.idFor(runs[0]!.value, 'run'), text);
    for (let i = 1; i < runs.length; i++) this.setText(this.idFor(runs[i]!.value, 'run'), '');
  }

  private idFor(node: unknown, kind: NodeKind): NodeId {
    for (const [id, e] of this.nodes) if (e.node === node && e.kind === kind) return id;
    return this.add(kind, node);
  }

  getProperty(node: NodeId, property: string): unknown {
    const e = this.entry(node);
    const n: any = e.node;
    if (property in n) return n[property];
    if (e.kind === 'paragraph' && n.pPr && property in n.pPr) return n.pPr[property];
    if (e.kind === 'run' && n.rPr && property in n.rPr) return n.rPr[property];
    return undefined;
  }

  setProperty(node: NodeId, property: string, value: unknown): void {
    const e = this.entry(node);
    const n: any = e.node;
    const target = e.kind === 'paragraph' && n.pPr ? n.pPr : e.kind === 'run' && n.rPr ? n.rPr : n;
    target[property] = value;
  }

  insertNode(node: NodeId, kind: string, parent: NodeId, offset: number): void {
    const p = this.entry(parent);
    if (kind !== 'paragraph' || p.kind !== 'paragraph') throw new Error(`Unsupported insertion: ${kind} into ${p.kind}`);
    const source = p.node as CT_P;
    const text = this.getText(parent);
    const at = Math.max(0, Math.min(offset, text.length));
    const left = text.slice(0, at);
    const right = text.slice(at);
    this.setText(parent, left);
    const fresh: CT_P = { pContent: [{ kind: 'r', value: { runInnerContent: [{ kind: 't', value: { $value: right } }] } }] };
    // The editor allocates the identity before calling this method; bind that exact
    // identity to the inserted AST object instead of minting a second, unreachable id.
    this.identities.set(fresh, node);
    const container = this.findContainer(source);
    if (!container) throw new Error('Parent paragraph is not attached to document');
    container.array.splice(container.index + 1, 0, { kind: 'p', value: fresh });
    this.reindex();
    if (!this.idTable.isLive(node)) throw new Error(`Inserted node is not live: ${String(node)}`);
  }

  removeNode(node: NodeId): void {
    const e = this.entry(node);
    const c = this.findContainer(e.node);
    if (!c) throw new Error(`Cannot remove unattached node: ${String(node)}`);
    c.array.splice(c.index, 1);
    this.idTable.retire(node);
    this.reindex();
  }

  private findContainer(node: unknown): { array: ContentItem[]; index: number } | undefined {
    const body = this.doc.body;
    if (!body) return undefined;
    const scan = (arr: readonly ContentItem[]): { array: ContentItem[]; index: number } | undefined => {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i]!.value === node) return { array: arr as ContentItem[], index: i };
        const v: any = arr[i]!.value;
        for (const key of ['blockLevelElts', 'contentRowContent', 'contentCellContent', 'pContent']) {
          if (Array.isArray(v?.[key])) { const found = scan(v[key]); if (found) return found; }
        }
      }
      return undefined;
    };
    return scan(body.blockLevelElts as readonly ContentItem[]);
  }
}
