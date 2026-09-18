import type { Rect } from './caret.js';

export interface PaintSchedulerDelegate {
  invalidatePageBitmap(pageIndex: number): void;
  redrawPageRegion(pageIndex: number, rects: Rect[]): void;
  drawOverlays(): void;
  pagesTouchedBy(rects: Rect[]): number[];
}

export function coalesceRects(rects: readonly Rect[], maxRects = 32): Rect[] {
  if (rects.length <= 1) return [...rects];

  // If there are too many small dirty rects, fall back to their union bounding box
  if (rects.length > maxRects) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    return [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }];
  }

  // Merge overlapping or touching rects
  const result: Rect[] = [];
  for (const r of rects) {
    let merged = false;
    for (const existing of result) {
      // Check for overlap or touch
      const overlapX = r.x <= existing.x + existing.w && r.x + r.w >= existing.x;
      const overlapY = r.y <= existing.y + existing.h && r.y + r.h >= existing.y;
      if (overlapX && overlapY) {
        const x1 = Math.min(existing.x, r.x);
        const y1 = Math.min(existing.y, r.y);
        const x2 = Math.max(existing.x + existing.w, r.x + r.w);
        const y2 = Math.max(existing.y + existing.h, r.y + r.h);
        existing.x = x1;
        existing.y = y1;
        existing.w = x2 - x1;
        existing.h = y2 - y1;
        merged = true;
        break;
      }
    }
    if (!merged) {
      result.push({ ...r });
    }
  }

  return result;
}

export class PaintScheduler {
  private pending: Rect[] = [];
  private scheduled = false;
  private overlayOnlyDirty = false;
  private rafId: number | null = null;
  private delegate: PaintSchedulerDelegate;

  constructor(delegate: PaintSchedulerDelegate) {
    this.delegate = delegate;
  }

  public scheduleRepaint(rects: Rect[]): void {
    this.pending.push(...rects);
    this.requestFrame();
  }

  public scheduleOverlayOnly(): void {
    // Caret blink or selection drag: triggers overlays draw WITHOUT invalidating any page bitmaps!
    this.overlayOnlyDirty = true;
    this.requestFrame();
  }

  private requestFrame(): void {
    if (this.scheduled) return;
    this.scheduled = true;

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => this.flush());
    } else {
      // Node.js environment fallback
      setTimeout(() => this.flush(), 0);
    }
  }

  public flush(): void {
    this.scheduled = false;
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.pending.length > 0) {
      const coalesced = coalesceRects(this.pending);
      const pages = this.delegate.pagesTouchedBy(coalesced);

      for (const p of pages) {
        this.delegate.invalidatePageBitmap(p);
        this.delegate.redrawPageRegion(p, coalesced);
      }
    }

    // Overlays are drawn outside and after the page bitmap cache
    this.delegate.drawOverlays();

    this.pending = [];
    this.overlayOnlyDirty = false;
  }

  public dispose(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pending = [];
    this.scheduled = false;
  }
}
