export type DisplayItem =
  | GlyphRunItem
  | RectItem
  | LineItem
  | PathItem
  | ImageItem
  | ClipPushItem
  | ClipPopItem
  | TransformPushItem
  | TransformPopItem;

export interface GlyphRunItem {
  type: 'glyphRun';
  fontKey: string | number;
  size: number;
  color: string;
  x: number;
  y: number;
  glyphs: Uint32Array;
  positions: Float64Array;
}

export interface RectItem {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface LineItem {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  width: number;
  dash?: readonly number[];
}

export interface PathItem {
  type: 'path';
  commands: Float32Array; // pure float commands, not Path2D
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface ImageItem {
  type: 'image';
  partKey: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface ClipPushItem {
  type: 'clipPush';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClipPopItem {
  type: 'clipPop';
}

export interface TransformPushItem {
  type: 'transformPush';
  matrix: readonly [number, number, number, number, number, number];
}

export interface TransformPopItem {
  type: 'transformPop';
}

/**
 * A perfectly serializable list of paint commands.
 * By design, contains NO references to DOM objects, closures, or mutable models.
 * This ensures it can cross a postMessage boundary to an OffscreenCanvas worker
 * without any transformation.
 */
export class DisplayList {
  private _items: DisplayItem[] = [];

  get items(): readonly DisplayItem[] {
    return this._items;
  }

  // Internal access for clone
  private set items(val: DisplayItem[]) {
    this._items = val;
  }

  pushGlyphRun(
    fontKey: string | number,
    size: number,
    color: string,
    x: number,
    y: number,
    glyphs: Uint32Array,
    positions: Float64Array,
  ): void {
    this._items.push({
      type: 'glyphRun',
      fontKey,
      size,
      color,
      x,
      y,
      glyphs,
      positions,
    });
  }

  pushRect(
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: string,
    stroke?: string,
    strokeWidth?: number,
  ): void {
    const item: RectItem = { type: 'rect', x, y, w, h };
    if (fill !== undefined) item.fill = fill;
    if (stroke !== undefined) item.stroke = stroke;
    if (strokeWidth !== undefined) item.strokeWidth = strokeWidth;
    this._items.push(item);
  }

  pushLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    width: number,
    dash?: readonly number[],
  ): void {
    const item: LineItem = { type: 'line', x1, y1, x2, y2, stroke, width };
    if (dash !== undefined) item.dash = dash;
    this._items.push(item);
  }

  pushPath(commands: Float32Array, fill?: string, stroke?: string, strokeWidth?: number): void {
    const item: PathItem = { type: 'path', commands };
    if (fill !== undefined) item.fill = fill;
    if (stroke !== undefined) item.stroke = stroke;
    if (strokeWidth !== undefined) item.strokeWidth = strokeWidth;
    this._items.push(item);
  }

  pushImage(
    partKey: string,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this._items.push({
      type: 'image',
      partKey,
      sx,
      sy,
      sw,
      sh,
      dx,
      dy,
      dw,
      dh,
    });
  }

  pushClip(x: number, y: number, w: number, h: number): void {
    this._items.push({ type: 'clipPush', x, y, w, h });
  }

  popClip(): void {
    this._items.push({ type: 'clipPop' });
  }

  pushTransform(matrix: readonly [number, number, number, number, number, number]): void {
    this._items.push({ type: 'transformPush', matrix });
  }

  popTransform(): void {
    this._items.push({ type: 'transformPop' });
  }

  /**
   * Clones the display list via structuredClone to guarantee no shared memory
   * or prototype pollution.
   */
  clone(): DisplayList {
    const list = new DisplayList();
    list.items = structuredClone(this._items);
    return list;
  }
}
