import { describe, expect, it } from 'vitest';
import { ExclusionStore } from './exclusions.js';
import { justifySegments, layoutLineAcrossSegments } from './line-segments.js';

describe('line segment integration', () => {
  it('flows items across two free segments', () => {
    const store = new ExclusionStore();
    store.add({ x: 30, y: 0, width: 20, height: 30, wrap: 'square' });
    const line = layoutLineAcrossSegments(
      2,
      10,
      [
        { value: 'a', width: 20 },
        { value: 'b', width: 20 },
        { value: 'c', width: 20 },
      ],
      store,
      { x: 0, width: 100 },
    );
    expect(line.segments.map((segment) => segment.items.map((item) => item.value))).toEqual([
      ['a'],
      ['b', 'c'],
    ]);
  });

  it('marks a fully excluded band as skipped', () => {
    const store = new ExclusionStore();
    store.add({ x: 0, y: 0, width: 100, height: 20, wrap: 'topAndBottom' });
    expect(layoutLineAcrossSegments(2, 10, [], store, { x: 0, width: 100 }).skipped).toBe(true);
  });

  it('justifies independently within each segment', () => {
    const segments = [
      {
        x: 0,
        width: 30,
        items: [
          { value: 'a', x: 0, width: 10 },
          { value: 'b', x: 10, width: 10 },
        ],
        extraSpace: 10,
      },
    ];
    justifySegments(segments);
    expect(segments[0]!.items.map((item) => item.x)).toEqual([0, 20]);
  });
});
