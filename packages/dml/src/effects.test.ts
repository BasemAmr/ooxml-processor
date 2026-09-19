import { describe, expect, it } from 'vitest';
import { createEffectBudget, createScratchPool, planEffect } from './effects.js';

describe('DrawingML effects', () => {
  it('clamps blur and records a visible degradation diagnostic', () => {
    const budget = createEffectBudget({ maxBlurRadius: 4 });
    const plan = planEffect(
      'outerShdw',
      { blurRad: 95250, dist: 0, dir: 0 },
      { x: 0, y: 0, width: 10, height: 10 },
      budget,
    );
    expect(plan?.blurRadius).toBe(4);
    expect(budget.diagnostics).toContain('blur-clamped:outerShdw');
  });
  it('reuses scratch canvases', () => {
    const pool = createScratchPool((width, height) => ({ width, height }));
    const first = pool.acquire(10, 10);
    pool.release(first);
    pool.acquire(10, 10);
    expect(pool.allocations).toBe(1);
  });
});
