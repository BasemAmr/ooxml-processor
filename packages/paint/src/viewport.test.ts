import { describe, it, expect } from 'vitest';
import { ViewportManager } from './viewport';

describe('ViewportManager', () => {
  it('computes visible page range based on scroll position + overscan', () => {
    const vp = new ViewportManager();
    // 10 pages, 1000 height each
    vp.setPageHeights(Array(10).fill(1000));

    // Viewport at 1500, height 500. Visible: 1500 to 2000.
    // Overscan 500: layout range 1000 to 2500.
    // This covers pages: 1 (1000-2000), 2 (2000-3000).
    // Wait, first page is 0 (0-1000). So it covers index 1 and 2.
    const state = vp.getVisiblePages(1500, 500, 500);
    expect(state.firstVisiblePage).toBe(0);
    expect(state.lastVisiblePage).toBe(2);
  });

  it('changing zoom changes visible range without altering layout heights (0 relayout)', () => {
    const vp = new ViewportManager();
    vp.setPageHeights([1000, 1000, 1000]); // Layout heights never change on zoom

    // At zoom 1.0, 1500-2000 px maps to 1500-2000 twips. Covers page 1.
    vp.zoom = 1.0;
    const state1 = vp.getVisiblePages(1500, 500, 0);
    expect(state1.firstVisiblePage).toBe(1);
    expect(state1.lastVisiblePage).toBe(2);

    // At zoom 2.0, 1500-2000 px maps to 750-1000 twips. Covers page 0.
    vp.zoom = 2.0;
    const state2 = vp.getVisiblePages(1500, 500, 0);
    expect(state2.firstVisiblePage).toBe(0);
    expect(state2.lastVisiblePage).toBe(1);
  });

  it('fractional dPR rounding', () => {
    expect(ViewportManager.roundForDPR(10.333333333, 1.5)).toBeCloseTo(10.0, 3);
    // 10.333 * 1.5 = 15.5 -> round to 15 or 16?
    // 10.3333 * 1.5 = 15.5. Math.round(15.5) = 16. 16 / 1.5 = 10.666

    const r = ViewportManager.roundForDPR(10.1, 1.25);
    // 10.1 * 1.25 = 12.625 -> 13 / 1.25 = 10.4
    expect(r).toBeCloseTo(10.4, 3);
  });

  it('page count available without painting non-visible pages', () => {
    const vp = new ViewportManager();
    vp.setPageHeights(Array(500).fill(1000));
    expect(vp.totalPages).toBe(500);
  });
});
