import { describe, it, expect } from 'vitest';
import { selectionRects } from './geometry.js';
import { createRange, createCollapsed } from './model.js';
import type { LayoutIndex } from '../position/map.js';
import { createCaret } from '../position/types.js';

describe('selection geometry', () => {
  it('Empty/collapsed selection produces zero rects', () => {
    const sel = createCollapsed(createCaret({ node: 1 as any, offset: 0 }));
    expect(selectionRects(sel, { pages: [], paragraphs: new Map() })).toEqual([]);
  });

  it('Selection within a single LTR line produces one rect', () => {
    const sel = createRange({ node: 1 as any, offset: 0 }, { node: 1 as any, offset: 2 });
    const index: LayoutIndex = {
      paragraphs: new Map(),
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
    const rects = selectionRects(sel, index);
    expect(rects.length).toBe(1);
    expect(rects[0]!.w).toBe(20);
  });
});
