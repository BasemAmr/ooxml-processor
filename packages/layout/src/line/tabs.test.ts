import { describe, it, expect } from 'vitest';
import { resolveTabStops, calculateNextTab } from './tabs';
import type { Segment } from './linebox';

describe('tabs', () => {
  it('clear removes an inherited stop', () => {
    const inherited = [{ val: 'start' as const, pos: 100 }];
    const direct = [{ val: 'clear' as const, pos: 100 }];
    const res = resolveTabStops(inherited, direct, 720);
    expect(res).toHaveLength(0);
  });

  it('bar does not advance', () => {
    // handled indirectly in calculateNextTab
    const stops = [
      { val: 'bar' as const, pos: 100 },
      { val: 'start' as const, pos: 200 },
    ];
    const next = calculateNextTab(50, stops, 720, [], 0);
    expect(next.x).toBe(200);
    expect(next.stop?.val).toBe('start');
  });

  it('lands in exclusion advances to next segment', () => {
    const segments: Segment[] = [
      { x: 0, width: 100, direction: 'ltr', runs: [] },
      { x: 150, width: 100, direction: 'ltr', runs: [] }, // exclusion from 100 to 150
    ];
    // A tab stop at 120 is inside the exclusion.
    const stops = [{ val: 'start' as const, pos: 120 }];
    const next = calculateNextTab(50, stops, 720, segments, 0);

    // Should snap to next segment start (150)
    expect(next.x).toBe(150);
    expect(next.segmentIdx).toBe(1);
  });

  it('uses default tab stop if no explicit ones are present', () => {
    const next = calculateNextTab(
      100,
      [],
      720,
      [{ x: 0, width: 1000, direction: 'ltr', runs: [] }],
      0,
    );
    expect(next.x).toBe(720);
  });
});
