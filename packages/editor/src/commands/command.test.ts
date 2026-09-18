import { describe, it, expect } from 'vitest';
import {
  createEffect,
  mergeEffects,
  InsertTextCommand,
  DeleteTextCommand,
  ApplyPropertyCommand,
  SplitParagraphCommand,
} from './command.js';
import type { DocumentModel } from './command.js';
import { IdTable } from '@ooxml/wml';
import type { NodeId } from '@ooxml/wml';

function createMockModel(initialText: Record<number, string> = {}): DocumentModel {
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

describe('Command Model (P6-10)', () => {
  it('InsertTextCommand.apply inserts text at correct position', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    model.setText(id, 'Helo');

    const cmd = new InsertTextCommand({ node: id, offset: 3 }, 'l');
    const effect = cmd.apply(model);

    expect(model.getText(id)).toBe('Hello');
    expect(effect.textEdits).toHaveLength(1);
    expect(effect.textEdits[0]).toEqual({
      node: id,
      start: 3,
      removed: '',
      inserted: 'l',
    });
  });

  it('InsertTextCommand.invert produces DeleteTextCommand that restores original', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    model.setText(id, 'Helo');

    const cmd = new InsertTextCommand({ node: id, offset: 3 }, 'l');
    const effect = cmd.apply(model);
    const inverse = cmd.invert(effect);

    const invertEffect = inverse.apply(model);
    expect(model.getText(id)).toBe('Helo');
    expect(invertEffect.textEdits[0]!.removed).toBe('l');
  });

  it('DeleteTextCommand.apply removes text and inverse restores it', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    model.setText(id, 'Hello World');

    const cmd = new DeleteTextCommand({ node: id, offset: 5 }, ' World');
    const effect = cmd.apply(model);

    expect(model.getText(id)).toBe('Hello');
    expect(effect.textEdits[0]!.removed).toBe(' World');

    const inverse = cmd.invert(effect);
    inverse.apply(model);
    expect(model.getText(id)).toBe('Hello World');
  });

  it('ApplyPropertyCommand sets and inverts property', () => {
    const model = createMockModel();
    const id = model.idTable.mint('run');
    model.setProperty(id, 'bold', false);

    const cmd = new ApplyPropertyCommand(id, 'bold', true);
    const effect = cmd.apply(model);

    expect(model.getProperty(id, 'bold')).toBe(true);
    expect(effect.propEdits[0]!.before).toBe(false);
    expect(effect.propEdits[0]!.after).toBe(true);

    const inverse = cmd.invert(effect);
    inverse.apply(model);
    expect(model.getProperty(id, 'bold')).toBe(false);
  });

  it('SplitParagraphCommand mints new paragraph and records added node', () => {
    const model = createMockModel();
    const id = model.idTable.mint('paragraph');

    const cmd = new SplitParagraphCommand({ node: id, offset: 0 });
    const effect = cmd.apply(model);

    expect(effect.nodesAdded).toHaveLength(1);
    expect(model.idTable.isLive(effect.nodesAdded[0]!)).toBe(true);
  });

  it('createEffect and mergeEffects combine edits correctly', () => {
    const e1 = createEffect();
    const e2 = createEffect();

    const model = createMockModel();
    const id = model.idTable.mint('paragraph');
    e1.nodesAdded.push(id);
    e2.textEdits.push({ node: id, start: 0, removed: '', inserted: 'abc' });

    const merged = mergeEffects(e1, e2);
    expect(merged.nodesAdded).toEqual([id]);
    expect(merged.textEdits).toHaveLength(1);
  });
});
