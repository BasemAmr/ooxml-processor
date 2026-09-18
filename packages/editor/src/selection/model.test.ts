import { describe, it, expect } from 'vitest';
import { createCollapsed, createRange, createTableRect, normalizeSelection, selectionEquals, isCollapsed } from './model.js';
import { createCaret } from '../position/types.js';

describe('selection model', () => {
  it('createCollapsed returns kind collapsed', () => {
    const sel = createCollapsed(createCaret({ node: 1 as any, offset: 0 }));
    expect(sel.kind).toBe('collapsed');
    expect(isCollapsed(sel)).toBe(true);
  });

  it('createRange with anchor === focus normalizes to collapsed', () => {
    const sel = createRange({ node: 1 as any, offset: 5 }, { node: 1 as any, offset: 5 });
    const norm = normalizeSelection(sel);
    expect(norm.kind).toBe('collapsed');
  });

  it('normalizeSelection is idempotent', () => {
    const sel = {
      kind: 'multi' as const,
      ranges: [
        { anchor: { node: 1 as any, offset: 10 }, focus: { node: 1 as any, offset: 5 } },
        { anchor: { node: 1 as any, offset: 7 }, focus: { node: 1 as any, offset: 15 } }
      ]
    };
    const norm1 = normalizeSelection(sel);
    const norm2 = normalizeSelection(norm1);
    expect(selectionEquals(norm1, norm2)).toBe(true);
  });

  it('selectionEquals returns true for identical selections', () => {
    const s1 = createRange({ node: 1 as any, offset: 0 }, { node: 1 as any, offset: 5 });
    const s2 = createRange({ node: 1 as any, offset: 0 }, { node: 1 as any, offset: 5 });
    expect(selectionEquals(s1, s2)).toBe(true);
  });
});
