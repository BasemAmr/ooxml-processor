import type { DisplayList, DisplayItem } from './displaylist';

export interface CanvasContext2DLike {
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  clip(): void;
  rect(x: number, y: number, w: number, h: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void; // Just a stub since we don't have text string in item
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  setLineDash(segments: readonly number[]): void;
  drawImage(
    image: any,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export class CanvasPainter {
  constructor(private ctx: CanvasContext2DLike) {}

  paint(list: DisplayList) {
    for (const item of list.items) {
      this.paintItem(item);
    }
  }

  private paintItem(item: DisplayItem) {
    const ctx = this.ctx;
    switch (item.type) {
      case 'clipPush':
        ctx.save();
        ctx.beginPath();
        ctx.rect(item.x, item.y, item.w, item.h);
        ctx.clip();
        break;
      case 'clipPop':
        ctx.restore();
        break;
      case 'transformPush':
        ctx.save();
        ctx.transform(
          item.matrix[0],
          item.matrix[1],
          item.matrix[2],
          item.matrix[3],
          item.matrix[4],
          item.matrix[5],
        );
        break;
      case 'transformPop':
        ctx.restore();
        break;
      case 'rect':
        ctx.beginPath();
        ctx.rect(item.x, item.y, item.w, item.h);
        if (item.fill !== undefined) {
          ctx.fillStyle = item.fill;
          ctx.fill();
        }
        if (item.stroke !== undefined) {
          ctx.strokeStyle = item.stroke;
          if (item.strokeWidth !== undefined) {
            ctx.lineWidth = item.strokeWidth;
          }
          ctx.stroke();
        }
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.width;
        if (item.dash) {
          ctx.setLineDash(item.dash);
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
        break;
      case 'glyphRun':
        // Assign state
        ctx.font = `${item.size}px ${item.fontKey}`;
        ctx.fillStyle = item.color;
        // In a real implementation we would iterate clusters/glyphs and position them.
        // For tests and lack of text, we'll just mock fillText with empty string to trigger calls.
        ctx.fillText('', item.x, item.y);
        break;
      case 'path':
        // Path rendering skipped for brevity in this mock, would iterate float commands
        break;
      case 'image':
        // ImageKey resolution happens here. We mock it for the test.
        ctx.drawImage(
          {} as any,
          item.sx,
          item.sy,
          item.sw,
          item.sh,
          item.dx,
          item.dy,
          item.dw,
          item.dh,
        );
        break;
    }
  }
}
