import type { ModelSet } from '../model.js';
import type { EmittedModule } from './types.js';

/** Deterministic coverage manifest emitted alongside generated modules. */
export function emitCoverage(set: ModelSet): EmittedModule {
  // normalize() already computes reachability, diagnostics, and stable ordering;
  // the emitter must serialize that authoritative manifest rather than
  // re-deriving partial metadata from the type maps.
  return {
    path: 'coverage.json',
    contents: `${JSON.stringify({ version: 1, entries: set.coverage }, null, 2)}\n`,
  };
}
