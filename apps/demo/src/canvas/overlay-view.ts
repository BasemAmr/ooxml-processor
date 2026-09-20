import {
  caretRect,
  selectionRects,
  startBlink,
  stopBlink,
  suspendBlink,
  resumeBlink,
  type Caret,
  type CaretBlinkState,
  type LayoutIndex,
  type Rect,
  type Selection,
} from '@ooxml/editor';

export interface OverlayViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly layoutIndex: LayoutIndex;
  readonly zoom?: number;
  readonly caretColor?: string;
  readonly selectionColor?: string;
}

/**
 * Paints transient editor UI above the page bitmap. The overlay has its own
 * canvas so blinking and drag-selection never invalidate a PageBitmapCache.
 */
export class OverlayView {
  readonly canvas: HTMLCanvasElement;
  private layoutIndex: LayoutIndex;
  private zoom: number;
  private readonly caretColor: string;
  private readonly selectionColor: string;
  private caret: Caret | null = null;
  private selection: Selection | null = null;
  private blink: CaretBlinkState | null = null;

  constructor(options: OverlayViewOptions) {
    this.canvas = options.canvas;
    this.layoutIndex = options.layoutIndex;
    this.zoom = options.zoom ?? 1;
    this.caretColor = options.caretColor ?? '#1a73e8';
    this.selectionColor = options.selectionColor ?? 'rgba(66, 133, 244, 0.28)';
  }

  setLayout(index: LayoutIndex, zoom = this.zoom): void {
    this.layoutIndex = index;
    this.zoom = zoom;
    this.render();
  }

  drawCaret(caret: Caret | null): void {
    this.caret = caret;
    if (caret !== null && this.blink === null) {
      // The timer only toggles this transient layer; the cached page pixels are untouched.
      this.blink = startBlink(() => this.render());
    }
    this.render();
  }

  drawSelection(selection: Selection | null): void {
    this.selection = selection;
    this.render();
  }

  suspendBlink(): void {
    if (this.blink !== null) suspendBlink(this.blink);
    this.render();
  }

  resumeBlink(): void {
    if (this.blink !== null) resumeBlink(this.blink, () => this.render());
  }

  dispose(): void {
    if (this.blink !== null) stopBlink(this.blink);
    this.blink = null;
  }

  render(): void {
    const context = this.canvas.getContext('2d');
    if (context === null) return;
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    context.clearRect(0, 0, width, height);

    if (this.selection !== null) {
      context.fillStyle = this.selectionColor;
      for (const rect of selectionRects(this.selection, this.layoutIndex)) {
        this.fillPageRect(context, rect);
      }
    }

    if (this.caret !== null && (this.blink === null || this.blink.visible)) {
      const rect = caretRect(this.caret, this.layoutIndex);
      if (rect !== null) {
        context.fillStyle = this.caretColor;
        this.fillPageRect(context, rect, true);
      }
    }
  }

  private fillPageRect(context: CanvasRenderingContext2D, rect: Rect, caret = false): void {
    // Editor geometry is already in the overlay's document coordinate system; only zoom is applied.
    context.fillRect(rect.x * this.zoom, rect.y * this.zoom, Math.max(caret ? 1 : rect.w, 1) * this.zoom, rect.h * this.zoom);
  }
}
