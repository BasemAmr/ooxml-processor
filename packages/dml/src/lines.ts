import { dmlMainTypes } from '@ooxml/schema';
type CT_LineProperties = dmlMainTypes.CT_LineProperties;

export interface StrokePlan {
  readonly width: number;
  readonly color: string | undefined;
  readonly dash: readonly number[];
  readonly cap: 'round' | 'square' | 'butt';
  readonly join: 'round' | 'bevel' | 'miter';
  readonly strokes: readonly { offset: number; width: number }[];
}
export interface ArrowHead {
  readonly type: string;
  readonly length: number;
  readonly width: number;
}

const PRESET_DASH: Readonly<Record<string, readonly number[]>> = Object.freeze({
  solid: [],
  dash: [3, 3],
  dashDot: [3, 1, 1, 1],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 3],
  sysDot: [1, 2],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
  dot: [1, 2],
  lgDot: [1, 3],
  dashDotDot: [3, 1, 1, 1, 1, 1],
  circ: [1, 2],
  smDash: [2, 2],
  smDashDot: [2, 1, 1, 1],
});

const n = (x: unknown, fallback = 0): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;

export function dashArray(value: unknown, width: number): readonly number[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as { kind?: string; value?: Record<string, unknown> };
  if (v.kind === 'prstDash') {
    const name = String(v.value?.val ?? 'solid');
    return (PRESET_DASH[name] ?? PRESET_DASH.solid ?? []).map((x) => x * Math.max(width, 1));
  }
  if (v.kind === 'custDash') {
    const stops = v.value?.ds as readonly { d?: number; sp?: number }[] | undefined;
    return (stops ?? []).flatMap((x) => [
      (n(x.d) / 100000) * width * 8,
      (n(x.sp) / 100000) * width * 8,
    ]);
  }
  return [];
}

function compoundStrokes(
  cmpd: string,
  width: number,
): readonly { offset: number; width: number }[] {
  const w = Math.max(width, 0.01);
  switch (cmpd) {
    case 'dbl':
      return [
        { offset: -w * 0.35, width: w * 0.3 },
        { offset: w * 0.35, width: w * 0.3 },
      ];
    case 'thickThin':
      return [
        { offset: -w * 0.25, width: w * 0.55 },
        { offset: w * 0.35, width: w * 0.2 },
      ];
    case 'thinThick':
      return [
        { offset: -w * 0.35, width: w * 0.2 },
        { offset: w * 0.25, width: w * 0.55 },
      ];
    case 'tri':
      return [
        { offset: -w * 0.3, width: w * 0.2 },
        { offset: 0, width: w * 0.2 },
        { offset: w * 0.3, width: w * 0.2 },
      ];
    default:
      return [{ offset: 0, width: w }];
  }
}

export function lineStrokePlan(line: CT_LineProperties, color?: string): StrokePlan {
  const width = n(line.w, 9525) / 9525;
  const cap = line.cap === 'rnd' ? 'round' : line.cap === 'sq' ? 'square' : 'butt';
  const join =
    line.lineJoinProperties?.kind === 'round'
      ? 'round'
      : line.lineJoinProperties?.kind === 'bevel'
        ? 'bevel'
        : 'miter';
  return {
    width,
    color,
    dash: dashArray(line.lineDashProperties, width),
    cap,
    join,
    strokes: compoundStrokes(String(line.cmpd ?? 'sng'), width),
  };
}

export function arrowHead(
  value: { type?: string; w?: string | number; len?: string | number } | undefined,
  width: number,
): ArrowHead | undefined {
  if (!value || !value.type || value.type === 'none') return undefined;
  const scale = (x: unknown, fallback: number) =>
    typeof x === 'number'
      ? x / 3
      : x === 'sm'
        ? fallback * 0.7
        : x === 'lg'
          ? fallback * 1.35
          : fallback;
  return {
    type: String(value.type),
    length: scale(value.len, width * 3),
    width: scale(value.w, width * 2),
  };
}

export function shortenLineForArrows(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  head?: ArrowHead,
  tail?: ArrowHead,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.hypot(dx, dy);
  if (!len) return { x1, y1, x2, y2 };
  const ux = dx / len,
    uy = dy / len;
  const h = head?.length ?? 0,
    t = tail?.length ?? 0;
  return { x1: x1 + ux * t, y1: y1 + uy * t, x2: x2 - ux * h, y2: y2 - uy * h };
}

export { PRESET_DASH };
