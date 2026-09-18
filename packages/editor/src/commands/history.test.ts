import { describe, it, expect } from 'vitest';
import { createHistory } from './history.js';
import { InsertTextCommand } from './command.js';
import type { DocumentModel, Transaction } from './command.js';
import { IdTable } from '@ooxml/wml';
import type { NodeId } from '@ooxml/wml';
import { createCollapsed } from '../selection/model.js';
import { createCaret } from '../position/types.js';

function createMockModel(): DocumentModel {
  const table = new IdTable();
  const textStore = new Map<NodeId, string>();

  return {
    idTable: table,
    getText(node: NodeId) {
      return textStore.get(node) ?? '';
    },
    setText(node: NodeId, text: string) {
      textStore.set(node, text);
    },
    getProperty() { return undefined; },
    setProperty() {},
    insertNode() {},
    removeNode() {},
  };
}

describe('Undo / Redo History (P6-11)', () => {
  it('pushes transactions and performs undo/redo', () => {
    const history = createHistory();
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    model.setText(id, 'Hello');

    const cmd = new InsertTextCommand({ node: id, offset: 5 }, ' World');
    const effect = cmd.apply(model);

    const tx: Transaction = {
      commands: [cmd],
      effects: [effect],
      label: 'Typing',
      selBefore: createCollapsed(createCaret({ node: id, offset: 5 })),
      selAfter: createCollapsed(createCaret({ node: id, offset: 11 })),
      mergeKey: null,
      seq: 1,
      timestamp: 1000,
    };

    history.push(tx);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(model.getText(id)).toBe('Hello World');

    const undoneTx = history.undo(model);
    expect(undoneTx).toBe(tx);
    expect(model.getText(id)).toBe('Hello');
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    const redoneTx = history.redo(model);
    expect(redoneTx).toBe(tx);
    expect(model.getText(id)).toBe('Hello World');
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('clears redo stack on new edit', () => {
    const history = createHistory();
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');

    const cmd1 = new InsertTextCommand({ node: id, offset: 0 }, 'A');
    const tx1: Transaction = {
      commands: [cmd1],
      effects: [cmd1.apply(model)],
      label: 'Type A',
      selBefore: createCollapsed(createCaret({ node: id, offset: 0 })),
      selAfter: createCollapsed(createCaret({ node: id, offset: 1 })),
      mergeKey: null,
      seq: 1,
      timestamp: 1000,
    };

    history.push(tx1);
    history.undo(model);
    expect(history.canRedo()).toBe(true);

    const cmd2 = new InsertTextCommand({ node: id, offset: 0 }, 'B');
    const tx2: Transaction = {
      commands: [cmd2],
      effects: [cmd2.apply(model)],
      label: 'Type B',
      selBefore: createCollapsed(createCaret({ node: id, offset: 0 })),
      selAfter: createCollapsed(createCaret({ node: id, offset: 1 })),
      mergeKey: null,
      seq: 2,
      timestamp: 1100,
    };

    history.push(tx2);
    expect(history.canRedo()).toBe(false);
  });

  it('coalesces adjacent typing within time window', () => {
    const history = createHistory({ coalesceWindowMs: 500 });
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');

    const cmd1 = new InsertTextCommand({ node: id, offset: 0 }, 'H');
    const tx1: Transaction = {
      commands: [cmd1],
      effects: [cmd1.apply(model)],
      label: 'Typing',
      selBefore: createCollapsed(createCaret({ node: id, offset: 0 })),
      selAfter: createCollapsed(createCaret({ node: id, offset: 1 })),
      mergeKey: 'type',
      seq: 1,
      timestamp: 1000,
    };
    history.push(tx1);

    const cmd2 = new InsertTextCommand({ node: id, offset: 1 }, 'i');
    const tx2: Transaction = {
      commands: [cmd2],
      effects: [cmd2.apply(model)],
      label: 'Typing',
      selBefore: createCollapsed(createCaret({ node: id, offset: 1 })),
      selAfter: createCollapsed(createCaret({ node: id, offset: 2 })),
      mergeKey: 'type',
      seq: 2,
      timestamp: 1200, // +200ms < 500ms
    };
    history.push(tx2);

    expect(history.undoCount).toBe(1);
    expect(model.getText(id)).toBe('Hi');

    history.undo(model);
    expect(model.getText(id)).toBe('');
  });

  it('does not coalesce different merge keys (e.g. typing then backspacing)', () => {
    const history = createHistory();
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');

    const tx1: Transaction = {
      commands: [],
      effects: [],
      label: 'Type',
      selBefore: createCollapsed(createCaret({ node: id, offset: 0 })),
      selAfter: createCollapsed(createCaret({ node: id, offset: 1 })),
      mergeKey: 'type',
      seq: 1,
      timestamp: 1000,
    };
    const tx2: Transaction = {
      commands: [],
      effects: [],
      label: 'Delete',
      selBefore: createCollapsed(createCaret({ node: id, offset: 1 })),
      selAfter: createCollapsed(createCaret({ node: id, offset: 0 })),
      mergeKey: 'delete-back',
      seq: 2,
      timestamp: 1100,
    };

    history.push(tx1);
    history.push(tx2);
    expect(history.undoCount).toBe(2);
  });

  it('drops oldest transaction when maxUndo limit is exceeded', () => {
    const history = createHistory({ maxUndo: 2 });
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');

    const makeTx = (seq: number): Transaction => ({
      commands: [],
      effects: [],
      label: `Tx ${seq}`,
      selBefore: createCollapsed(createCaret({ node: id, offset: seq })),
      selAfter: createCollapsed(createCaret({ node: id, offset: seq + 1 })),
      mergeKey: null,
      seq,
      timestamp: 1000 * seq,
    });

    history.push(makeTx(1));
    history.push(makeTx(2));
    history.push(makeTx(3));

    expect(history.undoCount).toBe(2);
    const u1 = history.undo(model);
    expect(u1?.seq).toBe(3);
    const u2 = history.undo(model);
    expect(u2?.seq).toBe(2);
    expect(history.undo(model)).toBeNull();
  });
});
