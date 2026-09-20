import type { PaintSchedulerDelegate, Rect } from '@ooxml/editor';
import type { PageBitmapCache } from '@ooxml/paint';
import type { CanvasView } from '../canvas/canvas-view';

/** Keeps scheduler invalidation separate from caret/selection overlays and cached page pixels. */
export class DemoPaintDelegate implements PaintSchedulerDelegate {
  constructor(
    private readonly cache: PageBitmapCache,
    private readonly view: CanvasView,
    private readonly overlayCallback: () => void = () => {},
  ) {}

  invalidatePageBitmap(pageIndex: number): void {
    this.cache.invalidatePage(pageIndex);
    this.view.invalidatePage(pageIndex);
  }

  redrawPageRegion(_pageIndex: number, _rects: Rect[]): void {
    // The next CanvasView.render rebuilds only the invalidated page; scheduler owns timing.
  }

  drawOverlays(): void { this.overlayCallback(); }

  pagesTouchedBy(rects: Rect[]): number[] {
    const pages = new Set<number>();
    for (const rect of rects) {
      for (const page of this.viewPages()) {
        if (rect.y < page.y + page.h && rect.y + rect.h > page.y) pages.add(page.index);
      }
    }
    return [...pages].sort((a, b) => a - b);
  }

  private viewPages(): Array<{ index: number; y: number; h: number }> {
    const pages = (this.view as unknown as { pages?: readonly { bounds: Rect }[] }).pages;
    if (pages === undefined) return [];
    let y = 0;
    return pages.map((page, index) => {
      const item = { index, y, h: page.bounds.h };
      y += page.bounds.h;
      return item;
    });
  }
}
