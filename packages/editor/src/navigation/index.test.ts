import { describe, it, expect } from 'vitest';
import { moveHorizontal, moveVertical, moveByWord, moveToLineEdge, extendSelection } from './index.js';
import { createCaret } from '../position/types.js';
import { createCollapsed } from '../selection/model.js';
import type { LayoutIndex } from '../position/map.js';

describe('navigation', () => {
  it('moveHorizontal steps over a single character and clears preferredX', () => {
    const caret = createCaret({ node: 1 as any, offset: 0 }, 'downstream', 50);
    const newCaret = moveHorizontal(caret, 'right', 'Hello');
    expect(newCaret.pos.offset).toBe(1);
    expect(newCaret.preferredX).toBeNull();
  });

  it('moveVertical preserves preferredX', () => {
    const caret = createCaret({ node: 1 as any, offset: 0 }, 'downstream', 50);
    const index: LayoutIndex = { paragraphs: new Map(), pages: [] };
    const newCaret = moveVertical(caret, 'down', index);
    expect(newCaret.preferredX).toBe(50);
  });

  it('moveToLineEdge home produces downstream affinity', () => {
    const index: LayoutIndex = {
      paragraphs: new Map([[1 as any, { page: 0, lineIndices: [0] }]]),
      pages: [{
        pageIndex: 0,
        lines: [{
          paraId: 1 as any, top: 0, height: 20, baseline: 15, breakKind: 'wrap', isFirst: true, isLast: true,
          segments: [{
            x: 0, width: 20, direction: 'ltr',
            runs: [{
              fontKey: 1, size: 12, srcNode: 1 as any, style: {},
              clusters: {
                clusterCount: 2,
                srcOffset: (i: number) => i,
                srcLength: () => 1,
                xAdvance: () => 10,
                clusterAtSourceOffset: (o: number) => o
              } as any
            }]
          }]
        }]
      }]
    };
    const caret = createCaret({ node: 1 as any, offset: 1 });
    const newCaret = moveToLineEdge(caret, 'home', index);
    expect(newCaret.affinity).toBe('downstream');
    expect(newCaret.pos.offset).toBe(0);
  });

  it('extendSelection from collapsed creates range', () => {
    const sel = createCollapsed(createCaret({ node: 1 as any, offset: 0 }));
    const target = createCaret({ node: 1 as any, offset: 5 });
    const ext = extendSelection(sel, target);
    expect(ext.kind).toBe('range');
    if (ext.kind === 'range') {
      expect(ext.anchor.offset).toBe(0);
      expect(ext.focus.offset).toBe(5);
    }
  });
});
