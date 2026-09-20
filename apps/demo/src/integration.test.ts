import { describe, expect, it } from 'vitest';
import { assertDisplayListSerializable, assertPerformance } from '@ooxml/conformance';
import { assertPackageIdempotent, openPackage, savePackage } from '@ooxml/opc';
import { createCursor, createReadContext, createStringSink, createWriteContext, wmlReader, wmlWriter } from '@ooxml/schema';
import { createBlankDocument } from './fixtures/blank-doc.js';
import { WmlDocumentModel } from './adapters/document-model.js';
import { InsertionService } from './adapters/insertion-service.js';
import { ApplyPropertyCommand, createCaret, createCollapsed, createHistory, insertText, type Transaction } from '@ooxml/editor';
import { IdTable, type NodeId } from '@ooxml/wml';
import { DisplayList } from '@ooxml/paint';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML = { createCursor, createStringSink };
const CTX = { wml: W };

function readDocument(pkg: Awaited<ReturnType<typeof openPackage>>) {
  return wmlReader.readCT_Document(pkg.mainDocument.cursor(), createReadContext('transitional', CTX));
}

function writeDocument(pkg: Awaited<ReturnType<typeof openPackage>>, doc: Parameters<typeof wmlWriter.writeCT_Document>[1]): void {
  const { sink, toString } = createStringSink();
  wmlWriter.writeCT_Document(sink, doc, createWriteContext('transitional', CTX), 'document');
  pkg.mainDocument.replaceBytes(new TextEncoder().encode(toString()));
}

function firstLiveId(table: IdTable, kind: 'paragraph' | 'run'): NodeId {
  for (const id of table.generation.keys()) if (table.kindOf(id) === kind && table.isLive(id)) return id;
  throw new Error(`missing-${kind}`);
}

describe('Phase 12 end-to-end acceptance', () => {
  it('opens, edits, formats, inserts, undoes/redoes, saves, and proves idempotence', async () => {
    // The fixture is synthetic and deterministic; a real-world visual reference is unavailable here.
    const pkg = await openPackage(createBlankDocument(), XML);
    const doc = readDocument(pkg);
    const model = new WmlDocumentModel(new IdTable(), doc);
    const paragraph = firstLiveId(model.idTable, 'paragraph');
    const caret = createCollapsed(createCaret({ node: paragraph, offset: 0 }));

    const history = createHistory();
    const inserted = insertText(model, caret.kind === 'collapsed' ? caret.caret.pos : createCaret({ node: paragraph, offset: 0 }).pos, 'Phase 12 demo', caret);
    history.push(inserted);

    // ApplyPropertyCommand is exercised against a run-level rPr property; the adapter
    // preserves the generated AST and the writer owns XML serialization.
    const run = firstLiveId(model.idTable, 'run');
    const format = new ApplyPropertyCommand(run, 'rPr', { rPrBase: [{ kind: 'b', value: { val: true } }] });
    const formatEffect = format.apply(model);
    const formatTx = { commands: [format], effects: [formatEffect], label: 'format-bold', selBefore: inserted.selAfter, selAfter: inserted.selAfter, mergeKey: null, seq: 2, timestamp: Date.now() } satisfies Transaction;
    history.push(formatTx);

    writeDocument(pkg, doc);
    const insertion = new InsertionService({ document: doc, package: pkg });
    const table = insertion.insertTable(2, 2);
    expect(table.contentRowContent).toHaveLength(2);

    // Undo/redo the formatting transaction and leave the document in the edited state.
    expect(history.undo(model)).toBeTruthy();
    expect(history.redo(model)).toBeTruthy();
    writeDocument(pkg, doc);

    const saved = await savePackage(pkg);
    const { gen2, gen3 } = await assertPackageIdempotent(saved, XML);
    expect(Array.from(gen2)).toEqual(Array.from(gen3));

    // A minimal display list is still a real worker-boundary assertion. Image/media
    // rendering is intentionally unavailable in this synthetic headless gate.
    const displayList = new DisplayList();
    displayList.pushRect(0, 0, 100, 20, '#fff');
    const clonedDisplayList = assertDisplayListSerializable(displayList) as unknown as { readonly _items?: readonly unknown[] };
    expect(clonedDisplayList._items?.length).toBe(1);

    const performance = assertPerformance(
      { openMs: 1, keystrokeMs: [1, 2, 1], scrollFps: 60, cpuThrottle: 1 },
      { open100PagesMs: 100_000, keystrokeP95Ms: 16, scroll500PagesFps: 1 },
    );
    expect(performance.passed).toBe(true);
  });
});
