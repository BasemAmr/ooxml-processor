import { CanvasPainter, PageBitmapCache, ViewportManager, type DisplayList } from '@ooxml/paint';
import type { PageLayoutRecord } from '@ooxml/editor';
import { buildDisplayList } from './display-list-builder';

export interface CanvasViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly dPR?: number;
  readonly overscanPixels?: number;
  readonly themeState?: string;
}

/** Main-thread canvas host. Layout snapshots enter here; DOM APIs never enter a DisplayList. */
export class CanvasView {
  readonly canvas: HTMLCanvasElement;
  readonly viewport = new ViewportManager();
  readonly cache = new PageBitmapCache();
  private readonly lists = new Map<number, DisplayList>();
  private readonly overscanPixels: number;
  private readonly themeState: string;
  private pages: readonly PageLayoutRecord[] = [];
  private _zoom = 1;
  private dPR: number;
  private contentVersion = 0;

  constructor(options: CanvasViewOptions) {
    this.canvas = options.canvas;
    this.dPR = options.dPR ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    this.overscanPixels = options.overscanPixels ?? 500;
    this.themeState = options.themeState ?? 'light';
  }

  get zoom(): number { return this._zoom; }
  set zoom(value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('zoom must be positive');
    if (value !== this._zoom) { this._zoom = value; this.viewport.zoom = value; this.cache.clear(); }
  }

  setDevicePixelRatio(value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('dPR must be positive');
    if (value !== this.dPR) { this.dPR = value; this.cache.clear(); }
  }

  render(pages: PageLayoutRecord[], scrollTop = 0): void {
    this.pages = pages;
    this.viewport.zoom = this._zoom;
    this.viewport.setPageHeights(pages.map((page) => page.bounds.h));
    const viewportHeight = this.canvas.clientHeight || this.canvas.height || 0;
    const visible = this.viewport.getVisiblePages(scrollTop, viewportHeight, this.overscanPixels);
    const context = this.canvas.getContext('2d');
    if (context === null) return;

    const width = Math.max(1, ...pages.map((page) => page.bounds.w)) * this._zoom;
    const height = pages.reduce((sum, page) => sum + page.bounds.h, 0) * this._zoom;
    this.canvas.width = Math.max(1, Math.ceil(width * this.dPR));
    this.canvas.height = Math.max(1, Math.ceil(height * this.dPR));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    context.setTransform(this.dPR, 0, 0, this.dPR, 0, 0);
    context.clearRect(0, 0, width, height);

    let pageTop = 0;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]!;
      if (index >= visible.firstVisiblePage && index <= visible.lastVisiblePage) {
        const bitmap = this.getPageBitmap(index, page);
        context.drawImage(bitmap, 0, pageTop * this._zoom, page.bounds.w * this._zoom, page.bounds.h * this._zoom);
      }
      pageTop += page.bounds.h;
    }
  }

  invalidatePage(pageIndex: number): void { this.cache.invalidatePage(pageIndex); this.contentVersion += 1; }

  private getPageBitmap(index: number, page: PageLayoutRecord): HTMLCanvasElement {
    const key = { pageIndex: index, contentVersion: this.contentVersion, zoom: this._zoom, dPR: this.dPR, themeState: this.themeState };
    const cached = this.cache.get(key);
    if (cached instanceof HTMLCanvasElement) return cached;
    const built = buildDisplayList(page.lines, { width: page.bounds.w, height: page.bounds.h });
    this.lists.set(index, built.displayList.clone());
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.max(1, Math.ceil(page.bounds.w * this.dPR));
    offscreen.height = Math.max(1, Math.ceil(page.bounds.h * this.dPR));
    const offscreenContext = offscreen.getContext('2d');
    if (offscreenContext === null) return offscreen;
    offscreenContext.setTransform(this.dPR, 0, 0, this.dPR, 0, 0);
    new CanvasPainter(offscreenContext).paint(built.displayList);
    this.cache.set(key, offscreen);
    return offscreen;
  }
}
