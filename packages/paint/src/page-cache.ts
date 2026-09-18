/**
 * Caches rendered pages as bitmaps.
 *
 * Invariants:
 * - Caret and selection are painted OVER the cached bitmap.
 * - Typing in one paragraph invalidates only that page.
 * - Key explicitly includes all visual variables affecting layout/paint.
 */

export interface PageCacheKey {
  pageIndex: number;
  contentVersion: number;
  zoom: number;
  dPR: number;
  themeState: string;
}

export class PageBitmapCache {
  private cache = new Map<string, ImageBitmap | HTMLCanvasElement>();

  private buildKeyString(key: PageCacheKey): string {
    return `${key.pageIndex}-${key.contentVersion}-${key.zoom}-${key.dPR}-${key.themeState}`;
  }

  get(key: PageCacheKey): ImageBitmap | HTMLCanvasElement | undefined {
    return this.cache.get(this.buildKeyString(key));
  }

  set(key: PageCacheKey, bitmap: ImageBitmap | HTMLCanvasElement): void {
    this.cache.set(this.buildKeyString(key), bitmap);
  }

  invalidatePage(pageIndex: number): void {
    // A real implementation would clear old entries for this page.
    // For simplicity, we just clear anything matching pageIndex.
    const prefix = `${pageIndex}-`;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) {
        this.cache.delete(k);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
