import { describe, it, expect } from 'vitest';
import { LatencyTracker } from './latency.js';

describe('Latency Instrumentation (P6-17)', () => {
  it('records samples and tracks four-stage breakdowns', () => {
    const tracker = new LatencyTracker(10);

    // t0=0, t1=1 (mutation: 1ms), t2=3 (relayout: 2ms), t3=5 (paint: 2ms) -> total 5ms
    tracker.record(0, 1, 3, 5);

    const samples = tracker.getSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]!.duration).toBe(5);
    expect(samples[0]!.stageMutation).toBe(1);
    expect(samples[0]!.stageRelayout).toBe(2);
    expect(samples[0]!.stagePaint).toBe(2);
  });

  it('calculates p50, p95, p99 and verifies 16ms budget', () => {
    const tracker = new LatencyTracker(100);

    // Record 100 keystrokes ranging from 2ms to 12ms (all well within 16ms)
    for (let i = 1; i <= 100; i++) {
      const dur = 2 + (i / 100) * 8; // 2..10ms
      tracker.record(0, 1, dur * 0.6, dur);
    }

    const stats = tracker.getStats();
    expect(stats.count).toBe(100);
    expect(stats.p50).toBeLessThan(8);
    expect(stats.p95).toBeLessThan(12);
    expect(tracker.meetsBudget(16)).toBe(true);
  });

  it('detects when p95 exceeds budget', () => {
    const tracker = new LatencyTracker(100);

    for (let i = 1; i <= 100; i++) {
      const dur = i <= 90 ? 5 : 25; // 10% of keystrokes are 25ms
      tracker.record(0, 1, dur * 0.5, dur);
    }

    const stats = tracker.getStats();
    expect(stats.p95).toBe(25);
    expect(tracker.meetsBudget(16)).toBe(false);
  });

  it('ring buffer overwrites oldest when capacity is reached', () => {
    const tracker = new LatencyTracker(3);
    tracker.record(0, 0, 0, 10);
    tracker.record(0, 0, 0, 20);
    tracker.record(0, 0, 0, 30);
    tracker.record(0, 0, 0, 40); // overwrites 10

    const samples = tracker.getSamples();
    expect(samples).toHaveLength(3);
    const durations = samples.map((s) => s.duration).sort((a, b) => a - b);
    expect(durations).toEqual([20, 30, 40]);
  });
});
