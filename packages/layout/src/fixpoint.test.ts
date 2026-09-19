import { describe, expect, it } from 'vitest';
import { fixpoint } from './fixpoint';

describe('fixpoint', () => {
  it('reports exact convergence iterations', () => {
    const result = fixpoint<number>(0, (value) => (value < 3 ? value + 1 : value), String);
    expect(result).toMatchObject({ state: 3, iterations: 3, converged: true, oscillated: false });
  });

  it('breaks cycles using the lowest key in the cycle', () => {
    const step = (value: number) => (value === 1 ? 2 : 1);
    const first = fixpoint(1, step, String);
    const second = fixpoint(2, step, String);
    expect(first.oscillated).toBe(true);
    expect(first.state).toBe(1);
    expect(second.state).toBe(1);
  });

  it('logs and returns at the iteration cap', () => {
    const events: string[] = [];
    const result = fixpoint<number>(0, (value) => value + 1, String, {
      maxIters: 2,
      onNonConvergence: (event) => events.push(event.kind),
    });
    expect(result.converged).toBe(false);
    expect(result.oscillated).toBe(false);
    expect(result.state).toBe(2);
    expect(events).toEqual(['limit']);
  });
});
