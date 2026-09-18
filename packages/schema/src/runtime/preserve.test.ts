import { describe, expect, it } from 'vitest';
import { sortPositioned } from './preserve.js';
import type { PositionedRaw } from './preserve.js';
import type { RawNode } from './xml.js';

const node = (localName: string): RawNode => ({
  uri: 'urn:test',
  localName,
  prefix: 't',
  attrs: [],
  nsDeclarations: new Map(),
  children: [],
});

describe('PositionedRaw ordering', () => {
  it('interleaves raw content between repetitions of a slot', () => {
    const entries: PositionedRaw[] = [
      { afterSlot: 0, afterIndex: 1, node: node('after-second') },
      { afterSlot: 0, afterIndex: 0, node: node('between-first-second') },
      { afterSlot: -1, node: node('leading') },
      { afterSlot: 0, node: node('after-slot') },
    ];
    expect(sortPositioned(entries).map((entry) => entry.node.localName)).toEqual([
      'leading',
      'between-first-second',
      'after-second',
      'after-slot',
    ]);
  });
});
