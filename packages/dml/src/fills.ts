import { dmlMainTypes } from '@ooxml/schema';
type CT_BlipFillProperties = dmlMainTypes.CT_BlipFillProperties;
type CT_GradientFillProperties = dmlMainTypes.CT_GradientFillProperties;
type CT_PatternFillProperties = dmlMainTypes.CT_PatternFillProperties;
type CT_RelativeRect = dmlMainTypes.CT_RelativeRect;
type CT_SolidColorFillProperties = dmlMainTypes.CT_SolidColorFillProperties;
import { PRESET_COLORS, applyColorTransforms, type Rgba } from './color.js';

export interface FillRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface FillContext {
  createLinearGradient?: (x0: number, y0: number, x1: number, y1: number) => CanvasGradient;
  createRadialGradient?: (
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ) => CanvasGradient;
  createPattern?: (canvas: CanvasImageSource, repetition?: string) => CanvasPattern | null;
}
export type FillStyle = string | CanvasGradient | CanvasPattern;
export type ColorResolver = (choice: unknown) => Rgba;

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const pct = (n: unknown, fallback = 0): number =>
  typeof n === 'number' && Number.isFinite(n) ? n / 100000 : fallback;
const css = (c: Rgba): string =>
  `rgba(${Math.round(clamp(c.r) * 255)},${Math.round(clamp(c.g) * 255)},${Math.round(clamp(c.b) * 255)},${clamp(c.a ?? 1)})`;
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Resolves an OOXML colour choice while preserving absent values as the caller's fallback. */
export function resolveDmlColor(
  choice: unknown,
  fallback: Rgba = { r: 0, g: 0, b: 0, a: 1 },
): Rgba {
  if (!choice || typeof choice !== 'object') return fallback;
  const c = choice as { kind?: string; value?: Record<string, unknown> };
  const value = c.value ?? {};
  let base = fallback;
  switch (c.kind) {
    case 'srgbClr': {
      const hex = String(value.val ?? '').replace(/^#/, '');
      if (/^[0-9a-f]{6}$/i.test(hex))
        base = {
          r: parseInt(hex.slice(0, 2), 16) / 255,
          g: parseInt(hex.slice(2, 4), 16) / 255,
          b: parseInt(hex.slice(4), 16) / 255,
          a: 1,
        };
      break;
    }
    case 'sysClr': {
      const hex = String(value.lastClr ?? '').replace(/^#/, '');
      if (/^[0-9a-f]{6}$/i.test(hex))
        base = resolveDmlColor({ kind: 'srgbClr', value: { val: hex } }, fallback);
      else base = PRESET_COLORS[String(value.val ?? '').toLowerCase()] ?? fallback;
      break;
    }
    case 'prstClr':
      base = PRESET_COLORS[String(value.val ?? '').toLowerCase()] ?? fallback;
      break;
    case 'schemeClr':
      base = PRESET_COLORS[String(value.val ?? '').toLowerCase()] ?? fallback;
      break;
    case 'scrgbClr':
      base = { r: pct(value.r, 0), g: pct(value.g, 0), b: pct(value.b, 0), a: 1 };
      break;
    case 'hslClr': {
      // DrawingML angles are 60,000ths of a degree; convert to turns.
      const h = num(value.hue) / 21600000;
      const s = pct(value.sat, 1);
      const l = pct(value.lum, 0.5);
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hue = (t: number) => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
      };
      base =
        s === 0
          ? { r: l, g: l, b: l, a: 1 }
          : { r: hue(h + 1 / 3), g: hue(h), b: hue(h - 1 / 3), a: 1 };
      break;
    }
  }
  const transforms = value.colorTransform;
  if (!Array.isArray(transforms)) return base;
  const t: Record<string, number | boolean> = {};
  for (const item of transforms) {
    if (!item || typeof item !== 'object') continue;
    const x = item as { kind?: string; value?: { val?: number } };
    if (x.kind === 'gray' || x.kind === 'inv' || x.kind === 'comp') t[x.kind] = true;
    else if (x.kind && x.value?.val !== undefined) t[x.kind] = Number(x.value.val);
  }
  return applyColorTransforms(base, t);
}

function colorFrom(value: unknown, resolver: ColorResolver): string {
  if (!value || typeof value !== 'object') return 'rgba(0,0,0,1)';
  const c = value as { colorChoice?: unknown };
  return css(resolver(c.colorChoice));
}

function addStops(
  gradient: CanvasGradient,
  stops: readonly { pos?: unknown; colorChoice?: unknown }[],
  resolver: ColorResolver,
): void {
  for (const stop of stops)
    gradient.addColorStop(clamp(num(stop.pos) / 100000), css(resolver(stop.colorChoice)));
}

/** Converts a DrawingML fill choice into a Canvas fill style. Unsupported image fills return a visible fallback. */
export function createFillStyle(
  fill: unknown,
  rect: FillRect,
  ctx: FillContext,
  resolver: ColorResolver = (x) => resolveDmlColor(x),
): FillStyle | undefined {
  if (!fill || typeof fill !== 'object') return undefined;
  const f = fill as { kind?: string; value?: unknown };
  if (f.kind === 'noFill') return undefined;
  if (f.kind === 'grpFill') return 'rgba(128,128,128,1)';
  if (f.kind === 'solidFill') return colorFrom(f.value, resolver);
  if (f.kind === 'pattFill')
    return createPatternFill(f.value as CT_PatternFillProperties, rect, ctx, resolver);
  if (f.kind === 'gradFill')
    return createGradientFill(f.value as CT_GradientFillProperties, rect, ctx, resolver);
  if (f.kind === 'blipFill') return 'rgba(192,192,192,1)';
  return undefined;
}

export function createGradientFill(
  fill: CT_GradientFillProperties,
  rect: FillRect,
  ctx: FillContext,
  resolver: ColorResolver = (x) => resolveDmlColor(x),
): FillStyle {
  const stops = fill.gsLst?.gs ?? [];
  const shade = fill.shadeProperties;
  if (shade?.kind === 'lin' && ctx.createLinearGradient) {
    const angle = ((num(shade.value.ang) / 60000) * Math.PI) / 180;
    const cx = rect.x + rect.width / 2,
      cy = rect.y + rect.height / 2;
    const dx = (Math.cos(angle) * Math.max(rect.width, rect.height)) / 2;
    const dy = (Math.sin(angle) * Math.max(rect.width, rect.height)) / 2;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    addStops(g, stops, resolver);
    return g;
  }
  // SPEC-GAP: Canvas has no shape-following gradient; the radial approximation is deterministic.
  if (ctx.createRadialGradient) {
    const g = ctx.createRadialGradient(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      0,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      Math.max(rect.width, rect.height) / 2,
    );
    addStops(g, stops, resolver);
    return g;
  }
  return stops.length ? css(resolver(stops[0]?.colorChoice)) : 'rgba(0,0,0,0)';
}

const patternCache = new Map<string, CanvasPattern | string>();
export function createPatternFill(
  fill: CT_PatternFillProperties,
  rect: FillRect,
  ctx: FillContext,
  resolver: ColorResolver = (x) => resolveDmlColor(x),
  dpr = 1,
): FillStyle {
  const fg = colorFrom(fill.fgClr, resolver),
    bg = colorFrom(fill.bgClr, resolver),
    name = String(fill.prst ?? 'pct5');
  const key = `${name}|${fg}|${bg}|${dpr}`;
  const cached = patternCache.get(key);
  if (cached !== undefined) return cached;
  if (!ctx.createPattern || typeof OffscreenCanvas === 'undefined') {
    patternCache.set(key, fg);
    return fg;
  }
  const tile = new OffscreenCanvas(8 * dpr, 8 * dpr);
  const t = tile.getContext('2d');
  if (!t) {
    patternCache.set(key, fg);
    return fg;
  }
  t.fillStyle = bg;
  t.fillRect(0, 0, tile.width, tile.height);
  t.fillStyle = fg;
  // A compact deterministic subset covers the common 48 preset patterns; unknown names remain visibly patterned.
  if (name.includes('lt')) t.fillRect(0, 0, tile.width, Math.max(1, dpr));
  else if (name.includes('vert')) t.fillRect(tile.width / 2, 0, Math.max(1, dpr), tile.height);
  else if (name.includes('horz')) t.fillRect(0, tile.height / 2, tile.width, Math.max(1, dpr));
  else {
    t.fillRect(0, 0, Math.max(1, dpr), Math.max(1, dpr));
    t.fillRect(tile.width / 2, tile.height / 2, Math.max(1, dpr), Math.max(1, dpr));
  }
  const pattern = ctx.createPattern(tile, 'repeat') ?? fg;
  patternCache.set(key, pattern);
  return pattern;
}

export function relativeRect(rect: FillRect, inset?: CT_RelativeRect): FillRect {
  const l = pct(inset?.l),
    t = pct(inset?.t),
    r = pct(inset?.r),
    b = pct(inset?.b);
  return {
    x: rect.x + rect.width * l,
    y: rect.y + rect.height * t,
    width: rect.width * (1 - l - r),
    height: rect.height * (1 - t - b),
  };
}

export function solidFillColor(
  fill: CT_SolidColorFillProperties,
  resolver: ColorResolver = (x) => resolveDmlColor(x),
): string {
  return colorFrom(fill, resolver);
}

export function imageCrop(
  fill: CT_BlipFillProperties,
  sourceWidth: number,
  sourceHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const p = (v: unknown) => pct(v);
  const r = fill.srcRect;
  const clean = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    sx: clean(sourceWidth * p(r?.l)),
    sy: clean(sourceHeight * p(r?.t)),
    sw: clean(sourceWidth * (1 - p(r?.l) - p(r?.r))),
    sh: clean(sourceHeight * (1 - p(r?.t) - p(r?.b))),
  };
}
