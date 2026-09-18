import { describe, it, expect, vi } from 'vitest';
import { caretRect, startBlink, stopBlink, suspendBlink, resumeBlink } from './caret.js';
import { createCaret } from './position/types.js';
import type { LayoutIndex } from './position/map.js';

describe('caret', () => {
  it('caretRect height equals line height', () => {
    // Mock layout index
    const index: LayoutIndex = {
      paragraphs: new Map([[1 as any, { page: 0, lineIndices: [0] }]]),
      pages: [{
        pageIndex: 0,
        lines: [{
          paraId: 1 as any, top: 10, height: 20, baseline: 15, breakKind: 'wrap', isFirst: true, isLast: true,
          segments: [{
            x: 5, width: 10, direction: 'ltr',
            runs: [{
              fontKey: 1, size: 12, srcNode: 1 as any, style: {},
              clusters: {
                clusterCount: 1,
                srcOffset: () => 0,
                srcLength: () => 1,
                xAdvance: () => 10,
                clusterAtSourceOffset: () => 0
              } as any
            }]
          }]
        }]
      }]
    };
    
    const caret = createCaret({ node: 1 as any, offset: 0 });
    const rect = caretRect(caret, index);
    expect(rect).not.toBeNull();
    expect(rect!.h).toBe(20);
    expect(rect!.x).toBe(5); // Leading edge LTR
  });

  it('caretRect returns null for NOT_LAID_OUT', () => {
    const index: LayoutIndex = { paragraphs: new Map(), pages: [] };
    const caret = createCaret({ node: 1 as any, offset: 0 });
    expect(caretRect(caret, index)).toBeNull();
  });

  it('blink starts visible and toggles', () => {
    vi.useFakeTimers();
    let visible = false;
    const state = startBlink((v) => visible = v);
    expect(visible).toBe(true);
    
    vi.advanceTimersByTime(500);
    expect(visible).toBe(false);
    
    vi.advanceTimersByTime(500);
    expect(visible).toBe(true);

    stopBlink(state);
    vi.useRealTimers();
  });
});
