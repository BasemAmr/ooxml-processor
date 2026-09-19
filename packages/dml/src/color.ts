/** DrawingML colour resolution and transform order (P9-14). */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}
export interface ColorTransforms {
  lumMod?: number;
  lumOff?: number;
  shade?: number;
  tint?: number;
  alpha?: number;
  alphaMod?: number;
  alphaOff?: number;
  satMod?: number;
  hueMod?: number;
  gray?: boolean;
  inv?: boolean;
  comp?: boolean;
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const toLinear = (n: number): number =>
  n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
const toSrgb = (n: number): number =>
  n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(Math.max(0, n), 1 / 2.4) - 0.055;
const pct = (n: number | undefined): number => (n ?? 100000) / 100000;

/** Applies transforms in the normative DrawingML order. Values are normalized 0..1. */
export function applyColorTransforms(base: Rgba, transforms: ColorTransforms = {}): Rgba {
  let r = toLinear(clamp(base.r));
  let g = toLinear(clamp(base.g));
  let b = toLinear(clamp(base.b));
  const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const lumMod = pct(transforms.lumMod);
  const lumOff = (transforms.lumOff ?? 0) / 100000;
  r = r * lumMod + lumOff;
  g = g * lumMod + lumOff;
  b = b * lumMod + lumOff;
  if (transforms.shade !== undefined) {
    const s = pct(transforms.shade);
    r *= s;
    g *= s;
    b *= s;
  }
  if (transforms.tint !== undefined) {
    const t = pct(transforms.tint);
    r += (1 - r) * t;
    g += (1 - g) * t;
    b += (1 - b) * t;
  }
  let alpha = clamp(base.a ?? 1);
  if (transforms.alpha !== undefined) alpha = pct(transforms.alpha);
  if (transforms.alphaMod !== undefined) alpha *= pct(transforms.alphaMod);
  if (transforms.alphaOff !== undefined) alpha += transforms.alphaOff / 100000;
  if (transforms.gray) {
    r = g = b = lum;
  }
  if (transforms.inv) {
    r = 1 - r;
    g = 1 - g;
    b = 1 - b;
  }
  if (transforms.comp) {
    [r, b] = [b, r];
  }
  return { r: clamp(toSrgb(r)), g: clamp(toSrgb(g)), b: clamp(toSrgb(b)), a: clamp(alpha) };
}

export const PRESET_COLORS: Readonly<Record<string, Rgba>> = Object.freeze({
  black: { r: 0, g: 0, b: 0 },
  white: { r: 1, g: 1, b: 1 },
  red: { r: 1, g: 0, b: 0 },
  green: { r: 0, g: 0.5, b: 0 },
  blue: { r: 0, g: 0, b: 1 },
  yellow: { r: 1, g: 1, b: 0 },
  cyan: { r: 0, g: 1, b: 1 },
  magenta: { r: 1, g: 0, b: 1 },
  gray: { r: 0.5, g: 0.5, b: 0.5 },
  orange: { r: 1, g: 0.6470588235, b: 0 },
  purple: { r: 0.5, g: 0, b: 0.5 },
});

export function resolveSchemeColor(
  name: string,
  scheme: Readonly<Record<string, Rgba>>,
  transforms?: ColorTransforms,
): Rgba {
  const color = scheme[name] ?? PRESET_COLORS[name] ?? { r: 0.5, g: 0.5, b: 0.5 };
  return applyColorTransforms(color, transforms);
}
