/** A bounded deterministic convergence result. */
export interface FixpointResult<S> {
  readonly state: S;
  readonly iterations: number;
  readonly converged: boolean;
  readonly oscillated: boolean;
  /** Quantised keys observed in order; useful for diagnostics and goldens. */
  readonly keys: readonly string[];
}

export interface FixpointOptions {
  readonly maxIters?: number;
  /** Called once when the iteration cap is reached or a cycle is found. */
  readonly onNonConvergence?: (event: {
    readonly kind: 'cycle' | 'limit';
    readonly iterations: number;
    readonly keys: readonly string[];
  }) => void;
}

/**
 * Runs a bounded fixpoint loop over quantised state.
 *
 * The caller owns quantisation through `key`; comparing object identity here
 * would make sub-twip layout noise look like progress and could loop forever.
 */
export function fixpoint<S>(
  initial: S,
  step: (state: S) => S,
  key: (state: S) => string,
  options: FixpointOptions = {},
): FixpointResult<S> {
  const maxIters = options.maxIters ?? 8;
  if (!Number.isInteger(maxIters) || maxIters < 1) {
    throw new RangeError('fixpoint maxIters must be a positive integer');
  }

  const seen = new Map<string, { readonly iteration: number; readonly state: S }>();
  const keys: string[] = [];
  let state = initial;

  for (let iteration = 0; iteration < maxIters; iteration += 1) {
    const currentKey = key(state);
    const previous = seen.get(currentKey);
    if (previous !== undefined) {
      const cycleStart = previous.iteration;
      const cycleEntries = keys
        .slice(cycleStart)
        .map((cycleKey) => ({ key: cycleKey, state: seen.get(cycleKey)?.state }))
        .filter((entry): entry is { key: string; state: S } => entry.state !== undefined);
      // Lexicographic minimisation makes an oscillating result independent of
      // which member of the cycle happened to be supplied as the initial state.
      cycleEntries.sort((a, b) => a.key.localeCompare(b.key));
      const winner = cycleEntries[0] ?? { key: currentKey, state };
      const cycleKeys = keys.slice(cycleStart).concat(currentKey);
      options.onNonConvergence?.({ kind: 'cycle', iterations: iteration, keys: cycleKeys });
      return {
        state: winner.state,
        iterations: iteration,
        converged: false,
        oscillated: true,
        keys: cycleKeys,
      };
    }

    seen.set(currentKey, { iteration, state });
    keys.push(currentKey);
    const next = step(state);
    const nextKey = key(next);
    if (nextKey === currentKey) {
      return { state: next, iterations: iteration, converged: true, oscillated: false, keys };
    }
    state = next;
  }

  options.onNonConvergence?.({ kind: 'limit', iterations: maxIters, keys });
  return { state, iterations: maxIters, converged: false, oscillated: false, keys };
}
