import { describe, expect, it } from 'vitest';
import { createCaret, createCollapsed } from '@ooxml/editor';
import { IdTable, type NodeId } from '@ooxml/wml';
import type { CT_Document } from '@ooxml/schema';
import { WmlDocumentModel } from '../adapters/document-model.js';
import { EditorController } from './editor-controller.js';

function fixture(): { model: WmlDocumentModel; paragraph: NodeId } {
  const doc = { body: { blockLevelElts: [{ kind: 'p', value: { pContent: [{ kind: 'r', value: { runInnerContent: [{ kind: 't', value: { $value: 'abc' } }] } }] } }] } } as unknown as CT_Document;
  const model = new WmlDocumentModel(new IdTable(), doc);
  const paragraph = [...model.idTable.generation.keys()].find((id) => model.idTable.kindOf(id) === 'paragraph');
  if (paragraph === undefined) throw new Error('fixture paragraph missing');
  return { model, paragraph };
}

describe('EditorController', () => {
  it('applies typing, backspace, undo and redo through one model/history loop', () => {
    const { model, paragraph } = fixture();
    const controller = new EditorController({ model, initialSelection: createCollapsed(createCaret({ node: paragraph, offset: 3 })) });
    controller.typeChar('x');
    expect(model.getText(paragraph)).toBe('abcx');
    controller.deleteBack();
    expect(model.getText(paragraph)).toBe('abc');
    controller.undo();
    expect(model.getText(paragraph)).toBe('abcx');
    controller.redo();
    expect(model.getText(paragraph)).toBe('abc');
    controller.dispose();
  });
});
