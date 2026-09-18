import { describe, expect, it } from 'vitest';
import { IdTable, NODE_KINDS, type NodeId, type NodeKind } from './id.js';

describe('P3-01 Stable Node Identity', () => {
  it('mints dense, strictly monotonic IDs starting from 0', () => {
    const table = new IdTable();
    expect(table.nextId).toBe(0);

    const id0 = table.mint('paragraph');
    const id1 = table.mint('run');
    const id2 = table.mint('table');

    // Values should be dense 0, 1, 2
    expect(id0 as unknown as number).toBe(0);
    expect(id1 as unknown as number).toBe(1);
    expect(id2 as unknown as number).toBe(2);
    expect(table.nextId).toBe(3);

    // Initial state is live with generation 1
    expect(table.isLive(id0)).toBe(true);
    expect(table.isLive(id1)).toBe(true);
    expect(table.isLive(id2)).toBe(true);
    expect(table.generationOf(id0)).toBe(1);
    expect(table.generationOf(id1)).toBe(1);
    expect(table.generationOf(id2)).toBe(1);
  });

  it('correctly associates and retrieves kindOf for all NodeKind members', () => {
    const table = new IdTable();
    for (const kind of NODE_KINDS) {
      const id = table.mint(kind);
      expect(table.kindOf(id)).toBe(kind);
    }
  });

  it('retire bumps generation, marks node as not live, and allows checking generation', () => {
    const table = new IdTable();
    const id = table.mint('paragraph');

    expect(table.isLive(id)).toBe(true);
    expect(table.generationOf(id)).toBe(1);

    table.retire(id);

    expect(table.isLive(id)).toBe(false);
    expect(table.generationOf(id)).toBe(2);
    // Node kind remains queryable even after retirement
    expect(table.kindOf(id)).toBe('paragraph');
  });

  it('detects use-after-retire and throws on double retirement or assertLive', () => {
    const table = new IdTable();
    const id = table.mint('cell');

    table.retire(id);

    // Calling retire again must throw use-after-retire error and bump generation
    expect(() => table.retire(id)).toThrowError(/already retired/i);
    expect(table.generationOf(id)).toBe(3);

    // assertLive must throw
    expect(() => table.assertLive(id)).toThrowError(/Use-after-retire detected/i);
  });

  it('NEVER recycles or reuses retired IDs (no freelist)', () => {
    const table = new IdTable();
    const id0 = table.mint('paragraph');
    const id1 = table.mint('run');
    const id2 = table.mint('run');

    // Retire id1
    table.retire(id1);
    expect(table.isLive(id1)).toBe(false);

    // Next mint must NOT get 1; it must get 3
    const id3 = table.mint('run');
    expect(id3 as unknown as number).toBe(3);
    expect(table.isLive(id3)).toBe(true);

    // Retire everything minted so far
    table.retire(id0);
    table.retire(id2);
    table.retire(id3);

    // Minting more must still never return any old id (0, 1, 2, 3)
    const id4 = table.mint('table');
    expect(id4 as unknown as number).toBe(4);
    expect(table.nextId).toBe(5);

    // Old IDs remain dead
    expect(table.isLive(id0)).toBe(false);
    expect(table.isLive(id1)).toBe(false);
    expect(table.isLive(id2)).toBe(false);
    expect(table.isLive(id3)).toBe(false);
  });

  it('throws when querying unknown / unminted IDs', () => {
    const table = new IdTable();
    const bogusId = 9999 as NodeId;

    expect(table.isLive(bogusId)).toBe(false);
    expect(() => table.retire(bogusId)).toThrowError(/unknown NodeId/i);
    expect(() => table.kindOf(bogusId)).toThrowError(/unknown NodeId/i);
    expect(() => table.generationOf(bogusId)).toThrowError(/unknown NodeId/i);
    expect(() => table.assertLive(bogusId)).toThrowError(/unknown NodeId/i);
  });
});
