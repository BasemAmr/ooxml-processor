import { describe, expect, it } from 'vitest';
import { selectMceBranch } from './mce.js';
import type { RawNode } from '@ooxml/schema';

const child = (localName: string): RawNode => ({
  uri: 'urn:test',
  localName,
  prefix: 'w',
  attrs: [],
  nsDeclarations: new Map(),
  children: [],
});
describe('MCE branch preference', () => {
  it('chooses the first supported Choice and preserves the source', () => {
    const drawing = child('drawing');
    const source = child('AlternateContent');
    const choice = {
      ...child('Choice'),
      attrs: [{ uri: '', localName: 'Requires', prefix: '', value: 'wps' }],
      children: [drawing],
    };
    const fallback = { ...child('Fallback'), children: [child('pict')] };
    const node = { ...source, children: [choice, fallback] };
    const selected = selectMceBranch(node, new Set(['wps']));
    expect(selected.selected).toBe('choice');
    expect(selected.children[0]!.localName).toBe('drawing');
    expect(selected.source).toBe(node);
  });
  it('falls back when a required namespace is unknown', () => {
    const node: RawNode = {
      ...child('AlternateContent'),
      children: [
        {
          ...child('Choice'),
          attrs: [{ uri: '', localName: 'Requires', prefix: '', value: 'unknown' }],
          children: [child('drawing')],
        },
        { ...child('Fallback'), children: [child('pict')] },
      ],
    };
    expect(selectMceBranch(node, new Set()).selected).toBe('fallback');
  });
});
