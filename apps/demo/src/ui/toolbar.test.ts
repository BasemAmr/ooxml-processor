/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { createCaret, createCollapsed } from '@ooxml/editor';
import { IdTable, type NodeId } from '@ooxml/wml';
import type { CT_Document } from '@ooxml/schema';
import { WmlDocumentModel } from '../adapters/document-model.js';
import { FormattingToolbar } from './toolbar.js';

function fixture(): { model: WmlDocumentModel; run: NodeId } {
  const doc = { body: { blockLevelElts: [{ kind: 'p', value: { pContent: [{ kind: 'r', value: { runInnerContent: [{ kind: 't', value: { $value: 'abc' } }] } }] } }] } } as unknown as CT_Document;
  const model = new WmlDocumentModel(new IdTable(), doc);
  const run = [...model.idTable.generation.keys()].find((id) => model.idTable.kindOf(id) === 'run');
  if (run === undefined) throw new Error('fixture run missing');
  return { model, run };
}

describe('FormattingToolbar', () => {
  it('routes toggle and direct formatting through public mutation APIs', () => {
    const { model, run } = fixture();
    const selection = createCollapsed(createCaret({ node: run, offset: 0 }));
    const transactions: string[] = [];
    const toolbar = new FormattingToolbar({
      model,
      getSelection: () => selection,
      onTransaction: (transaction) => transactions.push(transaction.label),
    });

    toolbar.toggleBold();
    toolbar.setFont('Georgia');
    toolbar.setSize(18);
    toolbar.setColor('#ff0000');

    expect(transactions).toEqual(['Format b', 'Format rFonts', 'Format sz', 'Format color']);
    expect(model.getProperty(run, 'b')).toBe(true);
    expect(model.getProperty(run, 'rFonts')).toBe('Georgia');
    expect(model.getProperty(run, 'sz')).toBe(18);
    expect(model.getProperty(run, 'color')).toBe('FF0000');
    toolbar.destroy();
  });

  it('handles the documented keyboard shortcuts and renders a local palette', () => {
    const { model, run } = fixture();
    const selection = createCollapsed(createCaret({ node: run, offset: 0 }));
    const labels: string[] = [];
    const toolbar = new FormattingToolbar({ model, getSelection: () => selection, onTransaction: (tx) => labels.push(tx.label) });
    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true });

    expect(toolbar.handleKeyDown(event)).toBe(true);
    expect(toolbar.element.querySelectorAll('[data-color]').length).toBeGreaterThan(0);
    expect(labels).toEqual(['Format b']);
    expect(toolbar.handleKeyDown(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true }))).toBe(false);
    toolbar.destroy();
  });
});
