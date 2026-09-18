import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaintScheduler, coalesceRects } from './paint-scheduler.js';
import type { PaintSchedulerDelegate } from './paint-scheduler.js';

describe('Repaint Scheduling and Dirty Rects (P6-14)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces overlapping rects into single bounding box', () => {
    const r1 = { x: 0, y: 0, w: 100, h: 20 };
    const r2 = { x: 50, y: 0, w: 100, h: 20 };
    const coalesced = coalesceRects([r1, r2]);

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]).toEqual({ x: 0, y: 0, w: 150, h: 20 });
  });

  it('batches multiple synchronous repaint calls into a single flush', () => {
    const delegate: PaintSchedulerDelegate = {
      invalidatePageBitmap: vi.fn(),
      redrawPageRegion: vi.fn(),
      drawOverlays: vi.fn(),
      pagesTouchedBy: () => [0],
    };

    const scheduler = new PaintScheduler(delegate);

    // Trigger 10 synchronous model changes in one tick
    for (let i = 0; i < 10; i++) {
      scheduler.scheduleRepaint([{ x: i * 10, y: 0, w: 10, h: 20 }]);
    }

    // Flush hasn't run yet before timer/rAF ticks
    expect(delegate.drawOverlays).not.toHaveBeenCalled();

    vi.runAllTimers();

    // Exactly one flush occurred!
    expect(delegate.drawOverlays).toHaveBeenCalledTimes(1);
    expect(delegate.invalidatePageBitmap).toHaveBeenCalledTimes(1);
  });

  it('overlay-only scheduling draws overlays without invalidating any page bitmaps', () => {
    const delegate: PaintSchedulerDelegate = {
      invalidatePageBitmap: vi.fn(),
      redrawPageRegion: vi.fn(),
      drawOverlays: vi.fn(),
      pagesTouchedBy: () => [0],
    };

    const scheduler = new PaintScheduler(delegate);

    // Caret blink or selection drag
    scheduler.scheduleOverlayOnly();

    vi.runAllTimers();

    expect(delegate.drawOverlays).toHaveBeenCalledTimes(1);
    // Crucial: page bitmaps are NOT invalidated!
    expect(delegate.invalidatePageBitmap).not.toHaveBeenCalled();
    expect(delegate.redrawPageRegion).not.toHaveBeenCalled();
  });
});
