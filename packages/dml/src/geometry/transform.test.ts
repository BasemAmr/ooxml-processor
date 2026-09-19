import { describe, expect, it } from 'vitest';
import { apply, groupTransform, shapeTransform } from './transform.js';

describe('DrawingML transforms', () => {
  it('rotates around the shape centre', () => {
    const m = shapeTransform({ x: 10, y: 20, cx: 100, cy: 40 }, 5400000);
    expect(apply(m, { x: 60, y: 40 }).x).toBeCloseTo(60);
    expect(apply(m, { x: 10, y: 20 }).x).toBeCloseTo(80);
  });
  it('maps nested group child coordinates', () => {
    const m = groupTransform({
      offX: 10,
      offY: 20,
      extCx: 200,
      extCy: 100,
      chOffX: 0,
      chOffY: 0,
      chExtCx: 100,
      chExtCy: 100,
    });
    expect(apply(m, { x: 25, y: 25 })).toEqual({ x: 60, y: 45 });
  });
});
