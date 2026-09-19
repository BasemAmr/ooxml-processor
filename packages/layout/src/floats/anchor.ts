/** WordprocessingDrawing anchor position resolution (P9-01). */
import type { FloatRect, WrapMode } from './exclusions.js';

export type HorizontalReference =
  | 'margin'
  | 'page'
  | 'column'
  | 'character'
  | 'leftMargin'
  | 'rightMargin'
  | 'insideMargin'
  | 'outsideMargin';
export type VerticalReference =
  | 'margin'
  | 'page'
  | 'paragraph'
  | 'line'
  | 'topMargin'
  | 'bottomMargin'
  | 'insideMargin'
  | 'outsideMargin';
export type HorizontalAlign = 'left' | 'right' | 'center' | 'inside' | 'outside';
export type VerticalAlign = 'top' | 'bottom' | 'center' | 'inside' | 'outside';
export type AxisPosition<TAlign extends string, TRef extends string> =
  | { readonly relativeFrom: TRef; readonly kind: 'align'; readonly value: TAlign }
  | { readonly relativeFrom: TRef; readonly kind: 'offset'; readonly value: number };

export interface AnchorSpec {
  readonly simplePos?: { x: number; y: number };
  readonly h: AxisPosition<HorizontalAlign, HorizontalReference>;
  readonly v: AxisPosition<VerticalAlign, VerticalReference>;
  readonly width: number;
  readonly height: number;
  readonly wrap?: WrapMode;
  readonly behindDoc?: boolean;
  readonly allowOverlap?: boolean;
  readonly relativeHeight?: number;
  readonly anchorPos?: number;
  readonly dist?: { top?: number; bottom?: number; left?: number; right?: number };
}

export interface AnchorContext {
  readonly page: {
    x: number;
    y: number;
    width: number;
    height: number;
    marginLeft: number;
    marginRight: number;
    marginTop: number;
    marginBottom: number;
  };
  readonly column?: { x: number; y: number; width: number; height: number };
  readonly paragraph?: { x: number; y: number; width: number; height: number };
  readonly line?: { x: number; y: number; width: number; height: number };
  readonly characterX?: number;
  readonly pageNumber?: number;
  readonly mirrorMargins?: boolean;
}

function frameX(ref: HorizontalReference, ctx: AnchorContext): { start: number; size: number } {
  const p = ctx.page;
  const marginStart = p.x + p.marginLeft;
  const marginWidth = p.width - p.marginLeft - p.marginRight;
  // Some producers emit paragraph-relative horizontal anchors even though the
  // transitional schema's horizontal enumeration omits that token.
  if ((ref as string) === 'paragraph') {
    return { start: ctx.paragraph?.x ?? marginStart, size: ctx.paragraph?.width ?? marginWidth };
  }
  switch (ref) {
    case 'page':
      return { start: p.x, size: p.width };
    case 'column':
      return { start: ctx.column?.x ?? marginStart, size: ctx.column?.width ?? marginWidth };
    case 'character':
      return { start: ctx.characterX ?? marginStart, size: 0 };
    case 'rightMargin':
      return { start: p.x + p.width - p.marginRight, size: p.marginRight };
    case 'leftMargin':
      return { start: p.x, size: p.marginLeft };
    case 'insideMargin': {
      const inside =
        ctx.mirrorMargins && (ctx.pageNumber ?? 1) % 2 === 0 ? p.marginRight : p.marginLeft;
      const start =
        ctx.mirrorMargins && (ctx.pageNumber ?? 1) % 2 === 0 ? p.x + p.width - p.marginRight : p.x;
      return { start, size: inside };
    }
    case 'outsideMargin': {
      const outside =
        ctx.mirrorMargins && (ctx.pageNumber ?? 1) % 2 === 0 ? p.marginLeft : p.marginRight;
      const start =
        ctx.mirrorMargins && (ctx.pageNumber ?? 1) % 2 === 0 ? p.x : p.x + p.width - outside;
      return { start, size: outside };
    }
    case 'margin':
    default:
      return { start: marginStart, size: marginWidth };
  }
}
function frameY(ref: VerticalReference, ctx: AnchorContext): { start: number; size: number } {
  const p = ctx.page;
  const marginStart = p.y + p.marginTop;
  const marginHeight = p.height - p.marginTop - p.marginBottom;
  switch (ref) {
    case 'page':
      return { start: p.y, size: p.height };
    case 'paragraph':
      return { start: ctx.paragraph?.y ?? marginStart, size: ctx.paragraph?.height ?? 0 };
    case 'line':
      return { start: ctx.line?.y ?? marginStart, size: ctx.line?.height ?? 0 };
    case 'topMargin':
      return { start: p.y, size: p.marginTop };
    case 'bottomMargin':
      return { start: p.y + p.height - p.marginBottom, size: p.marginBottom };
    case 'insideMargin':
      return { start: p.y, size: p.marginTop };
    case 'outsideMargin':
      return { start: p.y + p.height - p.marginBottom, size: p.marginBottom };
    case 'margin':
    default:
      return { start: marginStart, size: marginHeight };
  }
}

function align(
  start: number,
  size: number,
  extent: number,
  value: string,
  inside: boolean,
): number {
  if (value === 'right' || value === 'bottom' || (value === 'outside' && inside))
    return start + size - extent;
  if (value === 'center') return start + (size - extent) / 2;
  return start;
}

export function resolveAnchor(spec: AnchorSpec, context: AnchorContext): FloatRect {
  let x: number;
  let y: number;
  if (spec.simplePos) {
    x = context.page.x + spec.simplePos.x;
    y = context.page.y + spec.simplePos.y;
  } else {
    const pageEven = (context.pageNumber ?? 1) % 2 === 0 && context.mirrorMargins === true;
    const inside = !pageEven;
    const hf = frameX(spec.h.relativeFrom, context);
    const vf = frameY(spec.v.relativeFrom, context);
    if (spec.h.kind === 'offset') x = hf.start + spec.h.value;
    else {
      const hValue =
        spec.h.relativeFrom === 'insideMargin' || spec.h.relativeFrom === 'outsideMargin'
          ? spec.h.value === 'inside'
            ? inside
              ? 'left'
              : 'right'
            : spec.h.value === 'outside'
              ? inside
                ? 'right'
                : 'left'
              : spec.h.value
          : spec.h.value === 'inside'
            ? 'left'
            : spec.h.value === 'outside'
              ? 'right'
              : spec.h.value;
      x = align(hf.start, hf.size, spec.width, hValue, inside);
    }
    if (spec.v.kind === 'offset') y = vf.start + spec.v.value;
    else {
      const vValue =
        spec.v.value === 'inside'
          ? inside
            ? 'top'
            : 'bottom'
          : spec.v.value === 'outside'
            ? inside
              ? 'bottom'
              : 'top'
            : spec.v.value;
      y = align(vf.start, vf.size, spec.height, vValue, inside);
    }
  }
  const result: {
    x: number;
    y: number;
    width: number;
    height: number;
    wrap?: WrapMode;
    behindDoc?: boolean;
    allowOverlap?: boolean;
    relativeHeight?: number;
    anchorPos?: number;
    distTop?: number;
    distBottom?: number;
    distLeft?: number;
    distRight?: number;
  } = { x, y, width: spec.width, height: spec.height };
  if (spec.wrap !== undefined) result.wrap = spec.wrap;
  if (spec.behindDoc !== undefined) result.behindDoc = spec.behindDoc;
  if (spec.allowOverlap !== undefined) result.allowOverlap = spec.allowOverlap;
  if (spec.relativeHeight !== undefined) result.relativeHeight = spec.relativeHeight;
  if (spec.anchorPos !== undefined) result.anchorPos = spec.anchorPos;
  if (spec.dist?.top !== undefined) result.distTop = spec.dist.top;
  if (spec.dist?.bottom !== undefined) result.distBottom = spec.dist.bottom;
  if (spec.dist?.left !== undefined) result.distLeft = spec.dist.left;
  if (spec.dist?.right !== undefined) result.distRight = spec.dist.right;
  return result;
}
