import {
  createFillStyle,
  lineStrokePlan,
  shortenLineForArrows,
  type FillContext,
  type FillRect,
} from '@ooxml/dml';
import { dmlMainTypes } from '@ooxml/schema';
type CT_LineProperties = dmlMainTypes.CT_LineProperties;

export interface ShapeCanvas extends FillContext {
  beginPath(): void;
  rect(x: number, y: number, width: number, height: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText?(text: string, x: number, y: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  setLineDash(segments: readonly number[]): void;
}

export function paintFilledRect(ctx: ShapeCanvas, rect: FillRect, fill: unknown): void {
  const style = createFillStyle(fill, rect, ctx);
  if (style === undefined) return;
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = style;
  ctx.fill();
}

export function paintLine(
  ctx: ShapeCanvas,
  line: CT_LineProperties,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = 'rgba(0,0,0,1)',
): void {
  const plan = lineStrokePlan(line, color);
  const shortened = shortenLineForArrows(x1, y1, x2, y2);
  ctx.strokeStyle = color;
  ctx.setLineDash(plan.dash);
  ctx.lineCap = plan.cap;
  ctx.lineJoin = plan.join;
  const dx = shortened.x2 - shortened.x1;
  const dy = shortened.y2 - shortened.y1;
  const length = Math.hypot(dx, dy);
  const nx = length > 0 ? -dy / length : 0;
  const ny = length > 0 ? dx / length : 0;
  for (const stroke of plan.strokes) {
    const ox = nx * stroke.offset;
    const oy = ny * stroke.offset;
    ctx.beginPath();
    ctx.moveTo(shortened.x1 + ox, shortened.y1 + oy);
    ctx.lineTo(shortened.x2 + ox, shortened.y2 + oy);
    ctx.lineWidth = stroke.width;
    ctx.stroke();
  }
}

export function paintImagePlaceholder(ctx: ShapeCanvas, rect: FillRect, label: string): void {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = 'rgba(235,235,235,1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,110,110,1)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (ctx.fillText) {
    ctx.fillStyle = 'rgba(70,70,70,1)';
    ctx.fillText(`[${label}]`, rect.x + 4, rect.y + Math.min(16, rect.height / 2));
  }
}
