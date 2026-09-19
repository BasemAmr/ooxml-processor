import { fixpoint } from '../fixpoint.js';

export interface FootnotePage<T> {
  readonly content: T;
  readonly referenced: readonly string[];
  readonly reserved: number;
  readonly carry: readonly string[];
  readonly converged: boolean;
}

export interface FootnoteLayout {
  readonly height: number;
  readonly carry: readonly string[];
}

/** Resolves the body/footnote feedback loop with a bounded deterministic pass. */
export function paginateWithFootnotes<T>(
  initialReserve: number,
  fill: (reserve: number) => { readonly content: T; readonly referenced: readonly string[] },
  layoutFootnotes: (ids: readonly string[]) => FootnoteLayout,
  maxIters = 8,
): FootnotePage<T> {
  // SPEC-GAP: Word's exact footnote split heuristic is not published; the
  // caller supplies the measured area and carry state, while this loop only
  // resolves the body/footnote height dependency.
  const result = fixpoint(
    initialReserve,
    (reserve) => layoutFootnotes(fill(reserve).referenced).height,
    String,
    { maxIters },
  );
  let reserve = result.state;
  if (result.oscillated) {
    // A larger reserve loses a little body space but cannot lose a footnote.
    reserve = Math.max(...result.keys.map((key) => Number(key)).filter(Number.isFinite), reserve);
  }
  const filled = fill(reserve);
  const notes = layoutFootnotes(filled.referenced);
  return {
    content: filled.content,
    referenced: filled.referenced,
    reserved: reserve,
    carry: notes.carry,
    converged: result.converged,
  };
}
