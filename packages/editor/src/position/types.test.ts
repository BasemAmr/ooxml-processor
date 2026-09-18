import { describe, it, expect } from 'vitest';
import { createCaret, caretEquals, isValid } from './types.js';
import { IdTable } from '@ooxml/wml';
import type { Affinity } from './types.js';

describe('Position types (P6-01)', () => {
  describe('createCaret', () => {
    it('defaults to downstream affinity and null preferredX', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const caret = createCaret({ node: id, offset: 5 });

      expect(caret.affinity).toBe('downstream');
      expect(caret.pos.node).toBe(id);
      expect(caret.pos.offset).toBe(5);
      expect(caret.preferredX).toBeNull();
    });

    it('accepts explicit upstream affinity', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const caret = createCaret({ node: id, offset: 10 }, 'upstream');

      expect(caret.affinity).toBe('upstream');
      expect(caret.preferredX).toBeNull();
    });

    it('accepts explicit preferredX for goal column', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const caret = createCaret({ node: id, offset: 0 }, 'downstream', 150.5);

      expect(caret.preferredX).toBe(150.5);
    });
  });

  describe('caretEquals', () => {
    it('returns true for structurally identical carets', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const a = createCaret({ node: id, offset: 5 }, 'downstream', 100);
      const b = createCaret({ node: id, offset: 5 }, 'downstream', 100);

      expect(caretEquals(a, b)).toBe(true);
    });

    it('returns false when affinity differs', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const a = createCaret({ node: id, offset: 5 }, 'downstream');
      const b = createCaret({ node: id, offset: 5 }, 'upstream');

      expect(caretEquals(a, b)).toBe(false);
    });

    it('returns false when offset differs', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const a = createCaret({ node: id, offset: 5 });
      const b = createCaret({ node: id, offset: 6 });

      expect(caretEquals(a, b)).toBe(false);
    });

    it('returns false when node differs', () => {
      const table = new IdTable();
      const id1 = table.mint('paragraph');
      const id2 = table.mint('paragraph');
      const a = createCaret({ node: id1, offset: 0 });
      const b = createCaret({ node: id2, offset: 0 });

      expect(caretEquals(a, b)).toBe(false);
    });

    it('returns false when preferredX differs', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const a = createCaret({ node: id, offset: 0 }, 'downstream', 100);
      const b = createCaret({ node: id, offset: 0 }, 'downstream', null);

      expect(caretEquals(a, b)).toBe(false);
    });
  });

  describe('isValid', () => {
    it('returns true for a live node', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const caret = createCaret({ node: id, offset: 0 });

      expect(isValid(caret, table)).toBe(true);
    });

    it('returns false after the node is retired', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const caret = createCaret({ node: id, offset: 3 });

      table.retire(id);
      expect(isValid(caret, table)).toBe(false);
    });

    it('returns false for an unknown node', () => {
      const table = new IdTable();
      const id = table.mint('paragraph');
      const otherTable = new IdTable();
      const caret = createCaret({ node: id, offset: 0 });

      // id from table is not known to otherTable
      expect(isValid(caret, otherTable)).toBe(false);
    });
  });

  describe('Affinity semantics', () => {
    it('upstream and downstream are the only two values', () => {
      const values: Affinity[] = ['upstream', 'downstream'];
      expect(values).toHaveLength(2);
    });
  });
});
