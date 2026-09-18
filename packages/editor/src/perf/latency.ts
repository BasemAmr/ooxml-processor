export interface LatencySample {
  t0: number; // Input event received
  t1: number; // Model mutation applied
  t2: number; // Relayout returned
  t3: number; // Paint flush completed
  duration: number; // t3 - t0
  stageMutation: number; // t1 - t0
  stageRelayout: number; // t2 - t1
  stagePaint: number; // t3 - t2
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
  stageAverages: {
    mutation: number;
    relayout: number;
    paint: number;
  };
}

export class LatencyTracker {
  private buffer: LatencySample[];
  private capacity: number;
  private pointer = 0;
  private isFull = false;

  constructor(capacity = 256) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  public record(t0: number, t1: number, t2: number, t3: number): void {
    const sample: LatencySample = {
      t0,
      t1,
      t2,
      t3,
      duration: Math.max(0, t3 - t0),
      stageMutation: Math.max(0, t1 - t0),
      stageRelayout: Math.max(0, t2 - t1),
      stagePaint: Math.max(0, t3 - t2),
    };

    this.buffer[this.pointer] = sample;
    this.pointer = (this.pointer + 1) % this.capacity;
    if (this.pointer === 0) {
      this.isFull = true;
    }
  }

  public getSamples(): LatencySample[] {
    const count = this.isFull ? this.capacity : this.pointer;
    const samples: LatencySample[] = [];
    for (let i = 0; i < count; i++) {
      samples.push(this.buffer[i]!);
    }
    return samples;
  }

  public getStats(): LatencyStats {
    const samples = this.getSamples();
    if (samples.length === 0) {
      return {
        count: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        avg: 0,
        max: 0,
        stageAverages: { mutation: 0, relayout: 0, paint: 0 },
      };
    }

    const durations = samples.map((s) => s.duration).sort((a, b) => a - b);
    const count = durations.length;

    let totalMutation = 0;
    let totalRelayout = 0;
    let totalPaint = 0;
    let totalDuration = 0;

    for (const s of samples) {
      totalMutation += s.stageMutation;
      totalRelayout += s.stageRelayout;
      totalPaint += s.stagePaint;
      totalDuration += s.duration;
    }

    const percentile = (p: number): number => {
      const idx = Math.min(count - 1, Math.floor((p / 100) * count));
      return durations[idx]!;
    };

    return {
      count,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
      avg: totalDuration / count,
      max: durations[count - 1]!,
      stageAverages: {
        mutation: totalMutation / count,
        relayout: totalRelayout / count,
        paint: totalPaint / count,
      },
    };
  }

  public meetsBudget(budgetMs = 16): boolean {
    const stats = this.getStats();
    if (stats.count === 0) return true;
    return stats.p95 <= budgetMs;
  }

  public clear(): void {
    this.pointer = 0;
    this.isFull = false;
  }
}
