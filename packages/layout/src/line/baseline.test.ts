import { describe, it, expect } from 'vitest';
import { computeLineBaseline, alignRunInLine } from './baseline';
import type { RunMetrics } from './baseline';

describe('baseline', () => {
  it('maxes ascent and descent across runs', () => {
    const runs: RunMetrics[] = [
      { ascent: 200, descent: 50, position: 0, vertAlign: 'baseline' },
      { ascent: 100, descent: 80, position: 0, vertAlign: 'baseline' },
    ];
    const metrics = computeLineBaseline(runs);
    expect(metrics.ascent).toBe(200);
    expect(metrics.descent).toBe(80);
    expect(metrics.height).toBe(280);
  });

  it('raised run increases the line ascent', () => {
    // A run with position=10 (100 twips raise)
    const runs: RunMetrics[] = [
      { ascent: 200, descent: 50, position: 0, vertAlign: 'baseline' },
      { ascent: 200, descent: 50, position: 10, vertAlign: 'baseline' },
    ];
    const metrics = computeLineBaseline(runs);
    // second run ascent = 200 + 100 = 300
    expect(metrics.ascent).toBe(300);
    // second run descent = 50 - 100 = -50. max descent is 50.
    expect(metrics.descent).toBe(50);
  });

  it('center textAlignment centres the run box', () => {
    const line = { ascent: 300, descent: 100, height: 400 };
    const run = { ascent: 100, descent: 50, position: 0, vertAlign: 'baseline' as const };

    // Line height 400, run height 150. Center offset = (400 - 150) / 2 = 125
    const yOffset = alignRunInLine(line, run, 'center');
    expect(yOffset).toBe(125);
  });

  it('baseline textAlignment aligns baselines', () => {
    const line = { ascent: 300, descent: 100, height: 400 };
    const run = { ascent: 100, descent: 50, position: 0, vertAlign: 'baseline' as const };

    // Line baseline is at 300. Run ascent is 100. Offset = 300 - 100 = 200.
    const yOffset = alignRunInLine(line, run, 'baseline');
    expect(yOffset).toBe(200);
  });
});
