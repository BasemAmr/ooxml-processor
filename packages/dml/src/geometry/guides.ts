/** DrawingML geometry guide compiler (P9-09).
 *
 * Guide formulas are deliberately kept as source strings until compilation. This
 * preserves document order and lets the same compiled expression be reused for
 * different shape extents and adjustment values without reparsing XML.
 */

export interface GeometryGuide {
  readonly name: string;
  readonly formula: string;
}

export interface GuideContext {
  readonly w: number;
  readonly h: number;
  readonly adjustments?: Readonly<Record<string, number>>;
  readonly variables?: Readonly<Record<string, number>>;
}

export type CompiledGuide = (values: Readonly<Record<string, number>>) => number;

const DEG60K = 60000;

function builtins(w: number, h: number): Record<string, number> {
  const out: Record<string, number> = { w, h, l: 0, t: 0, r: w, b: h };
  out.hc = w / 2;
  out.vc = h / 2;
  out.ss = Math.min(w, h);
  out.ls = Math.max(w, h);
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12]) out[`hd${n}`] = h / n;
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 32]) out[`wd${n}`] = w / n;
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 32]) out[`ssd${n}`] = out.ss / n;
  out.cd2 = 10800000;
  out.cd4 = 5400000;
  out.cd8 = 2700000;
  out['3cd4'] = 16200000;
  out['5cd8'] = 13500000;
  out['7cd8'] = 18900000;
  return out;
}

function numberOrVariable(token: string, values: Readonly<Record<string, number>>): number {
  const numeric = Number(token);
  if (Number.isFinite(numeric) && token !== '') return numeric;
  return values[token] ?? 0;
}

/** Evaluates one DrawingML formula against already resolved variables. */
export function evaluateFormula(formula: string, values: Readonly<Record<string, number>>): number {
  const tokens = formula.trim().split(/\s+/u);
  const op = tokens[0] ?? 'val';
  const arg = (i: number): number => numberOrVariable(tokens[i] ?? '0', values);
  switch (op) {
    case '*/':
      return (arg(1) * arg(2)) / arg(3);
    case '+-':
      return arg(1) + arg(2) - arg(3);
    case '+/':
      return (arg(1) + arg(2)) / arg(3);
    case '?:':
      return arg(1) > 0 ? arg(2) : arg(3);
    case 'val':
      return arg(1);
    case 'abs':
      return Math.abs(arg(1));
    case 'sqrt':
      return Math.sqrt(Math.max(0, arg(1)));
    case 'max':
      return Math.max(arg(1), arg(2));
    case 'min':
      return Math.min(arg(1), arg(2));
    // In DrawingML `mod` is the Euclidean length of a 3D vector.
    case 'mod':
      return Math.hypot(arg(1), arg(2), arg(3));
    case 'pin':
      return Math.min(Math.max(arg(2), arg(1)), arg(3));
    case 'sin':
      return arg(1) * Math.sin(((arg(2) / DEG60K) * Math.PI) / 180);
    case 'cos':
      return arg(1) * Math.cos(((arg(2) / DEG60K) * Math.PI) / 180);
    case 'tan':
      return arg(1) * Math.tan(((arg(2) / DEG60K) * Math.PI) / 180);
    case 'at2':
      return (Math.atan2(arg(2), arg(1)) * 180 * DEG60K) / Math.PI;
    case 'cat2':
      return arg(1) * Math.cos(Math.atan2(arg(3), arg(2)));
    case 'sat2':
      return arg(1) * Math.sin(Math.atan2(arg(3), arg(2)));
    default:
      return numberOrVariable(op, values);
  }
}

const compileCache = new WeakMap<readonly GeometryGuide[], readonly CompiledGuide[]>();

/** Compiles formulas once while preserving their source/document order. */
export function compileGuides(guides: readonly GeometryGuide[]): readonly CompiledGuide[] {
  const cached = compileCache.get(guides);
  if (cached) return cached;
  const compiled = guides.map(
    (guide) => (values: Readonly<Record<string, number>>) => evaluateFormula(guide.formula, values),
  );
  compileCache.set(guides, compiled);
  return compiled;
}

const resultCache = new Map<string, Readonly<Record<string, number>>>();

/** Resolves built-ins, adjustments and guides in document order. */
export function evaluateGuides(
  guides: readonly GeometryGuide[],
  context: GuideContext,
): Readonly<Record<string, number>> {
  const adjustments = context.adjustments ?? {};
  const key = `${guides.map((g) => `${g.name}:${g.formula}`).join('|')}|${context.w}|${context.h}|${Object.keys(
    adjustments,
  )
    .sort()
    .map((k) => `${k}=${adjustments[k]}`)
    .join(',')}`;
  const cached = resultCache.get(key);
  if (cached) return cached;
  const values: Record<string, number> = {
    ...builtins(context.w, context.h),
    ...(context.variables ?? {}),
    ...adjustments,
  };
  for (const [index, guide] of guides.entries())
    values[guide.name] = compileGuides(guides)[index]!(values);
  const result = Object.freeze({ ...values });
  resultCache.set(key, result);
  return result;
}

export function clearGuideCache(): void {
  resultCache.clear();
}
