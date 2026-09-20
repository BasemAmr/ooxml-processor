/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { createCaret, createCollapsed } from '@ooxml/editor';
import { IdTable } from '@ooxml/wml';
import type { CT_Document } from '@ooxml/schema';
import { WmlDocumentModel } from '../adapters/document-model.js';
import { ParagraphFormatController } from './dialogs/paragraph-format.js';
import { Ruler } from './ruler.js';

function fixture() {
  const doc = { body: { blockLevelElts: [{ kind: 'p', value: { pContent: [{ kind: 'r', value: { runInnerContent: [{ kind: 't', value: { $value: 'abc' } }] } }] } }] } } as unknown as CT_Document;
  const model = new WmlDocumentModel(new IdTable(), doc);
  const paragraph = [...model.idTable.generation.keys()].find((id) => model.idTable.kindOf(id) === 'paragraph')!;
  const selection = createCollapsed(createCaret({ node: paragraph, offset: 0 }));
  return { model, paragraph, selection };
}

describe('W8-S2 paragraph formatting and ruler', () => {
  it('applies alignment, hanging indents, spacing, and explicit local list IDs', () => {
    const { model, paragraph, selection } = fixture();
    const labels: string[] = [];
    const controller = new ParagraphFormatController({
      model,
      getSelection: () => selection,
      getParagraphIds: () => [paragraph],
      onTransaction: (tx) => labels.push(tx.label),
    });
    controller.setAlignment('center');
    controller.setIndent(720, -360);
    controller.setSpacing(120, 240, 276);
    controller.setList('numbered');
    expect(model.getProperty(paragraph, 'jc')).toEqual({ val: 'center' });
    expect(model.getProperty(paragraph, 'ind')).toEqual({ left: 720, hanging: 360 });
    expect(model.getProperty(paragraph, 'spacing')).toEqual({ before: 120, after: 240, line: 276, lineRule: 'auto' });
    expect(model.getProperty(paragraph, 'numPr')).toEqual({ ilvl: { val: 0 }, numId: { val: 2 } });
    expect(labels).toEqual(['Format paragraph jc', 'Format paragraph ind', 'Format paragraph spacing', 'Format paragraph numPr']);
  });

  it('uses a safe no-op when the ruler has no selected paragraph', () => {
    const ruler = new Ruler({ getParagraph: () => undefined, onIndentChange: () => { throw new Error('must not call'); } });
    expect(ruler.element).toBeInstanceOf(HTMLCanvasElement);
    ruler.destroy();
  });
});
