import { describe, expect, it } from 'vitest';
import { evaluateFormula, evaluateGuides } from './guides.js';

describe('DrawingML guide evaluator', () => {
  const v = { x: 6, y: 4, z: 2, a: 2, b: 8, ang: 5400000 };
  it.each([
    ['*/ x y z', 12],
    ['+- x y z', 8],
    ['+/ x y z', 5],
    ['?: x y z', 4],
    ['val x', 6],
    ['abs z', 2],
    ['sqrt y', 2],
    ['max x y', 6],
    ['min x y', 4],
    ['mod x y z', Math.sqrt(56)],
    ['pin a x b', 6],
    ['sin x ang', 6],
    ['cos x ang', 0],
    ['tan x 2700000', 6],
    ['at2 x y', (Math.atan2(4, 6) * 10800000) / Math.PI],
    ['cat2 x y z', 6 * Math.cos(Math.atan2(2, 4))],
    ['sat2 x y z', 6 * Math.sin(Math.atan2(2, 4))],
  ])('%s', (formula, expected) =>
    expect(evaluateFormula(formula, v)).toBeCloseTo(expected as number, 9),
  );

  it('supports digit-prefixed constants and document-order guides', () => {
    const result = evaluateGuides(
      [
        { name: 'half', formula: '*/ w 1 2' },
        { name: 'angle', formula: 'val 3cd4' },
      ],
      { w: 100, h: 80 },
    );
    expect(result.half).toBe(50);
    expect(result.angle).toBe(16200000);
  });

  it('includes adjustments in the cache key', () => {
    const guides = [{ name: 'x', formula: 'val adj1' }];
    expect(evaluateGuides(guides, { w: 10, h: 10, adjustments: { adj1: 1 } }).x).toBe(1);
    expect(evaluateGuides(guides, { w: 10, h: 10, adjustments: { adj1: 2 } }).x).toBe(2);
  });
});
