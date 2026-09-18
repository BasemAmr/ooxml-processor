/**
 * Manages viewport mapping, zoom, and virtualization.
 *
 * Invariants:
 * - Zoom is a paint-time transform. It causes ZERO relayout.
 * - Fractional dPR rounding prevents shimmering glyphs.
 */

export interface VirtualizationState {
  firstVisiblePage: number;
  lastVisiblePage: number;
}

export class ViewportManager {
  private pageHeights: number[] = [];
  public zoom: number = 1.0;

  /**
   * Helper to round coordinates for fractional devicePixelRatio
   * to avoid subpixel antialiasing shimmer.
   */
  static roundForDPR(value: number, dPR: number): number {
    return Math.round(value * dPR) / dPR;
  }

  /**
   * Updates the structural layout information (e.g. from pagination).
   * Note: We know page count without painting them.
   */
  setPageHeights(heights: number[]) {
    this.pageHeights = heights;
  }

  get totalPages(): number {
    return this.pageHeights.length;
  }

  /**
   * Computes the visible page range based on scroll position and overscan.
   * Zoom is applied here to map screen pixels to layout twips.
   */
  getVisiblePages(
    scrollTop: number,
    viewportHeight: number,
    overscanPixels: number = 500,
  ): VirtualizationState {
    if (this.pageHeights.length === 0) {
      return { firstVisiblePage: 0, lastVisiblePage: 0 };
    }

    // Convert screen coordinates to layout coordinates (accounting for zoom)
    const layoutScrollTop = (scrollTop - overscanPixels) / this.zoom;
    const layoutScrollBottom = (scrollTop + viewportHeight + overscanPixels) / this.zoom;

    let currentY = 0;
    let first = -1;
    let last = -1;

    for (let i = 0; i < this.pageHeights.length; i++) {
      const h = this.pageHeights[i]!;
      const pageTop = currentY;
      const pageBottom = currentY + h;

      if (pageBottom >= layoutScrollTop && first === -1) {
        first = i;
      }
      if (pageTop <= layoutScrollBottom) {
        last = i;
      }

      currentY += h;
    }

    if (first === -1) first = 0;
    if (last === -1) last = this.pageHeights.length - 1;

    return { firstVisiblePage: first, lastVisiblePage: last };
  }
}
