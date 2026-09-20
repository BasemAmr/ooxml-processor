import type { NodeId } from '@ooxml/wml';
import type { CT_Ind } from '@ooxml/schema';
import { ParagraphFormatController } from './dialogs/paragraph-format.js';

export interface RulerParagraphState {
  readonly paragraph: NodeId;
  readonly contentWidthTwips: number;
  readonly ind: CT_Ind;
}

export interface RulerOptions {
  readonly getParagraph: () => RulerParagraphState | undefined;
  readonly onIndentChange: (left: number, firstLine: number) => void;
  readonly twipsPerPixel?: number;
  readonly width?: number;
}

type Marker = 'left' | 'firstLine' | 'right';

/** Canvas ruler with safe, clamped drag callbacks for Word-style paragraph indents. */
export class Ruler {
  readonly element: HTMLCanvasElement;
  private readonly options: RulerOptions;
  private readonly twipsPerPixel: number;
  private readonly width: number;
  private drag: { marker: Marker; startX: number; left: number; firstLine: number } | undefined;

  constructor(options: RulerOptions) {
    this.options = options;
    this.twipsPerPixel = options.twipsPerPixel ?? 15;
    this.width = options.width ?? 720;
    this.element = document.createElement('canvas');
    this.element.className = 'demo-horizontal-ruler';
    this.element.width = this.width;
    this.element.height = 36;
    this.element.setAttribute('role', 'slider');
    this.element.setAttribute('aria-label', 'Paragraph ruler');
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerUp);
    this.render();
  }

  render(): void {
    const ctx = this.element.getContext('2d');
    if (!ctx) return;
    const state = this.options.getParagraph();
    ctx.clearRect(0, 0, this.width, this.element.height);
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, this.width, this.element.height);
    ctx.strokeStyle = '#a0a0a0';
    ctx.fillStyle = '#555';
    const max = state?.contentWidthTwips ?? this.width * this.twipsPerPixel;
    for (let twips = 0; twips <= max; twips += 720) {
      const x = twips / this.twipsPerPixel;
      ctx.beginPath(); ctx.moveTo(x, 25); ctx.lineTo(x, 5); ctx.stroke();
      ctx.fillText(String(Math.round(twips / 1440)), x + 2, 12);
    }
    if (!state) return;
    const ind = state.ind;
    const left = Number(ind.left ?? ind.start ?? 0);
    const firstLine = left + Number(ind.firstLine ?? 0) - Number(ind.hanging ?? 0);
    this.drawMarker(ctx, left / this.twipsPerPixel, 24, 'left');
    this.drawMarker(ctx, firstLine / this.twipsPerPixel, 5, 'firstLine');
    const right = (max - Number(ind.right ?? ind.end ?? 0)) / this.twipsPerPixel;
    this.drawMarker(ctx, right, 24, 'right');
  }

  destroy(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
  }

  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, marker: Marker): void {
    ctx.fillStyle = marker === 'right' ? '#8b4a4a' : '#3e6b9c';
    ctx.beginPath();
    if (marker === 'firstLine') {
      ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 8); ctx.lineTo(x + 6, y + 8);
    } else {
      ctx.moveTo(x, y); ctx.lineTo(x - 6, y - 8); ctx.lineTo(x + 6, y - 8);
    }
    ctx.closePath(); ctx.fill();
  }

  private markerAt(x: number, y: number): Marker | undefined {
    const state = this.options.getParagraph();
    if (!state) return undefined;
    const max = state.contentWidthTwips;
    const left = Number(state.ind.left ?? state.ind.start ?? 0) / this.twipsPerPixel;
    const first = (Number(state.ind.left ?? state.ind.start ?? 0) + Number(state.ind.firstLine ?? 0) - Number(state.ind.hanging ?? 0)) / this.twipsPerPixel;
    const right = (max - Number(state.ind.right ?? state.ind.end ?? 0)) / this.twipsPerPixel;
    if (Math.abs(x - first) < 10 && y < 20) return 'firstLine';
    if (Math.abs(x - left) < 10 && y >= 16) return 'left';
    if (Math.abs(x - right) < 10 && y >= 16) return 'right';
    return undefined;
  }

  private onPointerDown = (event: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const marker = this.markerAt(event.clientX - rect.left, event.clientY - rect.top);
    const state = this.options.getParagraph();
    if (!marker || !state) return;
    const left = Number(state.ind.left ?? state.ind.start ?? 0);
    const firstLine = left + Number(state.ind.firstLine ?? 0) - Number(state.ind.hanging ?? 0);
    this.drag = { marker, startX: event.clientX, left, firstLine };
    this.element.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;
    const state = this.options.getParagraph();
    if (!state) return;
    const dx = Math.round((event.clientX - this.drag.startX) * this.twipsPerPixel);
    const max = Math.max(0, state.contentWidthTwips - 1);
    const left = Math.max(0, Math.min(max, this.drag.left + (this.drag.marker === 'left' ? dx : 0)));
    const first = Math.max(0, Math.min(max, this.drag.firstLine + (this.drag.marker === 'firstLine' ? dx : 0)));
    this.options.onIndentChange(left, first - left);
    this.render();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    this.drag = undefined;
  };
}

export { ParagraphFormatController };
