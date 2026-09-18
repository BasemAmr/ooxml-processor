import { describe, it, expect } from 'vitest';
import {
  insertText,
  deleteRange,
  splitParagraph,
  applyRunProperty,
  toggleRunProperty,
} from './index.js';
import type { DocumentModel } from '../commands/command.js';
import { IdTable } from '@ooxml/wml';
import type { NodeId } from '@ooxml/wml';
import { createCollapsed, createRange } from '../selection/model.js';
import { createCaret } from '../position/types.js';

function createMockModel(initialText: Record<string, string> = {}): DocumentModel {
  const table = new IdTable();
  const textStore = new Map<NodeId, string>();
  const propStore = new Map<string, unknown>();

  for (const [k, v] of Object.entries(initialText)) {
    textStore.set(Number(k) as unknown as NodeId, v);
  }

  return {
    idTable: table,
    getText(node: NodeId) {
      return textStore.get(node) ?? '';
    },
    setText(node: NodeId, text: string) {
      textStore.set(node, text);
    },
    getProperty(node: NodeId, property: string) {
      return propStore.get(`${node}:${property}`);
    },
    setProperty(node: NodeId, property: string, value: unknown) {
      propStore.set(`${node}:${property}`, value);
    },
    insertNode() {},
    removeNode(node: NodeId) {
      textStore.delete(node);
    },
  };
}

describe('Mutation API (P6-12)', () => {
  it('insertText creates transaction with mergeKey type and updates model', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    model.setText(id, 'World');

    const selBefore = createCollapsed(createCaret({ node: id, offset: 0 }));
    const tx = insertText(model, { node: id, offset: 0 }, 'Hello ', selBefore);

    expect(model.getText(id)).toBe('Hello World');
    expect(tx.mergeKey).toBe('type');
    expect(tx.commands).toHaveLength(1);
    expect(tx.selAfter.kind).toBe('collapsed');
    if (tx.selAfter.kind === 'collapsed') {
      expect(tx.selAfter.caret.pos.offset).toBe(6);
    }
  });

  it('deleteRange on single character backspace creates delete-back mergeKey', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    model.setText(id, 'Hello');

    const sel = createCollapsed(createCaret({ node: id, offset: 5 }));
    const tx = deleteRange(model, sel, 'back');

    expect(model.getText(id)).toBe('Hell');
    expect(tx.mergeKey).toBe('delete-back');
  });

  it('deleteRange on range selection has null mergeKey', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    model.setText(id, 'Hello World');

    const sel = createRange({ node: id, offset: 0 }, { node: id, offset: 6 });
    const tx = deleteRange(model, sel);

    expect(model.getText(id)).toBe('World');
    expect(tx.mergeKey).toBeNull();
  });

  it('splitParagraph creates new paragraph node with null mergeKey', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');

    const sel = createCollapsed(createCaret({ node: id, offset: 0 }));
    const tx = splitParagraph(model, { node: id, offset: 0 }, sel);

    expect(tx.mergeKey).toBeNull();
    expect(tx.effects[0]!.nodesAdded).toHaveLength(1);
    const newId = tx.effects[0]!.nodesAdded[0]!;
    expect(model.idTable.isLive(newId)).toBe(true);
  });

  it('applyRunProperty records property change in transaction', () => {
    const model = createMockModel();
    const id = model.idTable.mint('run');

    const sel = createCollapsed(createCaret({ node: id, offset: 0 }));
    const tx = applyRunProperty(model, sel, 'b', true);

    expect(model.getProperty(id, 'b')).toBe(true);
    expect(tx.effects[0]!.propEdits[0]!.after).toBe(true);
  });

  it('toggleRunProperty toggles boolean values using toggle semantics', () => {
    const model = createMockModel();
    const id = model.idTable.mint('run');

    const sel = createCollapsed(createCaret({ node: id, offset: 0 }));
    toggleRunProperty(model, sel, 'b'); // initially undefined -> true
    expect(model.getProperty(id, 'b')).toBe(true);

    toggleRunProperty(model, sel, 'b'); // true -> false
    expect(model.getProperty(id, 'b')).toBe(false);
  });
});
