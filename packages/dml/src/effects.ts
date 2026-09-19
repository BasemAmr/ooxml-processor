export interface EffectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface ScratchCanvas {
  readonly width: number;
  readonly height: number;
  readonly context?: { [key: string]: unknown };
}
export interface ScratchPool<T extends ScratchCanvas> {
  acquire(width: number, height: number): T;
  release(canvas: T): void;
  allocations: number;
}
export interface EffectBudget {
  readonly maxPixels?: number;
  readonly maxEffects?: number;
  readonly maxBlurRadius?: number;
  usedPixels: number;
  diagnostics: string[];
}

export function createScratchPool<T extends ScratchCanvas>(
  factory: (width: number, height: number) => T,
): ScratchPool<T> {
  const free: T[] = [];
  let allocations = 0;
  return {
    get allocations() {
      return allocations;
    },
    acquire(width, height) {
      const found = free.pop();
      if (found && found.width >= width && found.height >= height) return found;
      allocations++;
      return factory(width, height);
    },
    release(canvas) {
      free.push(canvas);
    },
  };
}

export function createEffectBudget(
  options: Pick<EffectBudget, 'maxPixels' | 'maxEffects' | 'maxBlurRadius'> = {},
): EffectBudget {
  return {
    maxPixels: options.maxPixels ?? 4_000_000,
    maxEffects: options.maxEffects ?? 8,
    maxBlurRadius: options.maxBlurRadius ?? 64,
    usedPixels: 0,
    diagnostics: [],
  };
}

export function beginEffectFrame(budget: EffectBudget): void {
  budget.usedPixels = 0;
  budget.diagnostics.length = 0;
}

export interface EffectPlan {
  readonly kind: string;
  readonly blurRadius: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly alpha: number;
  readonly degraded: boolean;
}
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Normalizes a schema effect node and enforces the per-shape/document cost budget. */
export function planEffect(
  kind: string,
  value: Record<string, unknown>,
  bounds: EffectBounds,
  budget: EffectBudget,
  effectIndex = 0,
): EffectPlan | undefined {
  if (effectIndex >= (budget.maxEffects ?? 8)) {
    budget.diagnostics.push(`effect-limit:${kind}`);
    return undefined;
  }
  const pixels = Math.max(1, bounds.width * bounds.height);
  const overPixels = budget.usedPixels + pixels > (budget.maxPixels ?? Number.POSITIVE_INFINITY);
  if (overPixels) {
    budget.diagnostics.push(`frame-budget:${kind}`);
    return undefined;
  }
  budget.usedPixels += pixels;
  const maxBlur = budget.maxBlurRadius ?? 64;
  const rawBlur = num(value.blurRad ?? value.rad, 0) / 9525;
  const blurRadius = Math.min(Math.max(0, rawBlur), maxBlur);
  const degraded = rawBlur > maxBlur;
  if (degraded) budget.diagnostics.push(`blur-clamped:${kind}`);
  const dir = ((num(value.dir, 0) / 60000) * Math.PI) / 180;
  const distance = num(value.dist, 0) / 9525;
  return {
    kind,
    blurRadius,
    offsetX: Math.cos(dir) * distance,
    offsetY: Math.sin(dir) * distance,
    alpha: 1,
    degraded,
  };
}

export function effectPlans(
  effects: readonly { kind: string; value: Record<string, unknown> }[],
  bounds: EffectBounds,
  budget = createEffectBudget(),
): readonly EffectPlan[] {
  const plans: EffectPlan[] = [];
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    if (!e) continue;
    const plan = planEffect(e.kind, e.value, bounds, budget, i);
    if (plan) plans.push(plan);
  }
  return plans;
}

export function collectEffectList(
  value: unknown,
): readonly { kind: string; value: Record<string, unknown> }[] {
  if (!value || typeof value !== 'object') return [];
  const list = value as Record<string, unknown>;
  const out: { kind: string; value: Record<string, unknown> }[] = [];
  for (const kind of [
    'blur',
    'glow',
    'innerShdw',
    'outerShdw',
    'prstShdw',
    'reflection',
    'softEdge',
  ]) {
    const item = list[kind];
    if (item && typeof item === 'object')
      out.push({ kind, value: item as Record<string, unknown> });
  }
  return out;
}
