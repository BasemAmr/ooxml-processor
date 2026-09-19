import { fixpoint } from '../fixpoint.js';
import { resolveAnchor, type AnchorContext, type AnchorSpec } from './anchor.js';
import type { FloatRect } from './exclusions.js';

export interface AnchorInput {
  readonly id: string;
  readonly spec: AnchorSpec;
  readonly context: AnchorContext;
}

export interface AnchorFixpointResult {
  readonly positions: readonly FloatRect[];
  readonly iterations: number;
  readonly converged: boolean;
  readonly oscillated: boolean;
  readonly keys: readonly string[];
}

export interface AnchorFixpointOptions {
  readonly maxIters?: number;
  /** Re-layouts text affected by the current float positions. */
  readonly relayout?: (positions: readonly FloatRect[]) => readonly AnchorInput[];
  readonly onNonConvergence?: (event: {
    readonly kind: 'cycle' | 'limit';
    readonly keys: readonly string[];
  }) => void;
}

const TEXT_REFERENCES = new Set(['character', 'line', 'paragraph', 'column']);

function key(inputs: readonly AnchorInput[], positions: readonly FloatRect[]): string {
  return inputs
    .map(
      (input, index) =>
        `${input.id}:${Math.round((positions[index]?.x ?? 0) * 20)},${Math.round((positions[index]?.y ?? 0) * 20)}`,
    )
    .join('|');
}

/** Resolves page/margin anchors once and iterates only text-relative anchors. */
export function resolveAnchorsWithWrapFixpoint(
  inputs: readonly AnchorInput[],
  options: AnchorFixpointOptions = {},
): AnchorFixpointResult {
  const ordered = [...inputs].sort((a, b) => a.id.localeCompare(b.id));
  const resolve = (current: readonly AnchorInput[]): FloatRect[] =>
    current.map((input) => resolveAnchor(input.spec, input.context));
  const independent = ordered.map(
    (input) =>
      !TEXT_REFERENCES.has(input.spec.h.relativeFrom) &&
      !TEXT_REFERENCES.has(input.spec.v.relativeFrom),
  );
  const initial = resolve(ordered);
  const looping = ordered.filter((_input, index) => !independent[index]);
  if (looping.length === 0)
    return { positions: initial, iterations: 0, converged: true, oscillated: false, keys: [] };

  const step = (positions: readonly FloatRect[]): FloatRect[] => {
    const nextInputs = options.relayout?.(positions) ?? ordered;
    const next = resolve(nextInputs);
    // Keep page/margin positions fixed outside the cycle, preserving their
    // one-pass semantics even when text layout changes around them.
    for (let index = 0; index < next.length; index += 1)
      if (independent[index]) next[index] = positions[index]!;
    return next;
  };
  // Prime the text-relative loop with one relayout pass. This prevents a
  // producer's first no-op seed from hiding a subsequent two-state cycle.
  const seeded = options.relayout === undefined ? initial : step(initial);
  const result = fixpoint(seeded, step, (positions) => key(ordered, positions), {
    maxIters: options.maxIters ?? 8,
    onNonConvergence: (event) => options.onNonConvergence?.({ kind: event.kind, keys: event.keys }),
  });
  return {
    positions: result.state,
    iterations: result.iterations,
    converged: result.converged,
    oscillated: result.oscillated,
    keys: result.keys,
  };
}

export const anchorWrapFixpoint = resolveAnchorsWithWrapFixpoint;
