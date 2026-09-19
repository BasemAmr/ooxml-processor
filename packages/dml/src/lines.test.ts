import { describe, expect, it } from 'vitest';
import { lineStrokePlan, shortenLineForArrows } from './lines.js';

describe('DrawingML line planning', () => {
  it('keeps compound lines distinct and scales preset dashes', () => {
    const p = lineStrokePlan({
      cmpd: 'dbl',
      w: 19050,
      lineDashProperties: { kind: 'prstDash', value: { val: 'dash' } },
    });
    expect(p.strokes).toHaveLength(2);
    expect(p.dash).toEqual([6, 6]);
  });
  it('shortens the centerline around arrowheads', () =>
    expect(
      shortenLineForArrows(
        0,
        0,
        100,
        0,
        { type: 'triangle', length: 10, width: 5 },
        { type: 'triangle', length: 5, width: 5 },
      ),
    ).toEqual({ x1: 5, y1: 0, x2: 90, y2: 0 }));
});
