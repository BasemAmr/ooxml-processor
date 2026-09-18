export type TextAlignment = 'top' | 'center' | 'baseline' | 'bottom' | 'auto';
export type VertAlign = 'baseline' | 'superscript' | 'subscript';

export interface RunMetrics {
  ascent: number; // twips
  descent: number; // twips, positive value representing space below baseline
  position: number; // half-points (positive = raised, negative = lowered)
  vertAlign: VertAlign;
}

export interface LineBaselineMetrics {
  ascent: number; // twips
  descent: number; // twips
  height: number; // twips
}

/**
 * Computes the overall baseline metrics for a line of mixed sizes and positions.
 *
 * SPEC-GAP: superscript/subscript size reduction factor is not normative.
 * Word typically uses ~65% of the base font size for super/subscript.
 * We record this choice here but the size reduction itself is applied during
 * property resolution (P3), not here. We only care about the resulting metrics.
 *
 * w:position is in half-points. 1 half-point = 10 twips.
 *
 * @param runs The metrics of runs in this line
 */
export function computeLineBaseline(runs: RunMetrics[]): LineBaselineMetrics {
  let maxAscent = 0;
  let maxDescent = 0;

  for (const run of runs) {
    // position is half-points, convert to twips. Positive means raised.
    const raiseTwips = run.position * 10;

    // Additional shifting for vertAlign if not already baked into position/ascent
    // Typically, if vertAlign is superscript, we assume the layout engine shifted it.
    // Wait, the instructions say:
    // "w:vertAlign (superscript/subscript) shifts the baseline AND conventionally reduces the size.
    // The reduction factor is not normative - SPEC-GAP, record it.
    // w:position raises/lowers in HALF-POINTS without changing size, and a raised run DOES increase the line's ascent"

    // SPEC-GAP: Superscript raises by ~33% of the *base* ascent, subscript lowers by ~25% of the *base* descent.
    // However, since we don't have the parent size here, we rely on the resolved ascent.
    // We will approximate the shift if vertAlign is present.
    let vertAlignShift = 0;
    if (run.vertAlign === 'superscript') {
      vertAlignShift = run.ascent * 0.4; // rough approx
    } else if (run.vertAlign === 'subscript') {
      vertAlignShift = -(run.descent * 0.4);
    }

    const totalRaise = raiseTwips + vertAlignShift;

    // A raised run increases ascent. A lowered run increases descent.
    const effectiveAscent = run.ascent + totalRaise;
    const effectiveDescent = run.descent - totalRaise;

    if (effectiveAscent > maxAscent) {
      maxAscent = effectiveAscent;
    }
    if (effectiveDescent > maxDescent) {
      maxDescent = effectiveDescent;
    }
  }

  return {
    ascent: maxAscent,
    descent: maxDescent,
    height: maxAscent + maxDescent,
  };
}

/**
 * Calculates the y-offset for a run within the line, based on w:textAlignment.
 *
 * @param line The computed line metrics
 * @param run The run metrics
 * @param alignment ST_TextAlignment
 * @returns The y-offset from the top of the line box for this run
 */
export function alignRunInLine(
  line: LineBaselineMetrics,
  run: RunMetrics,
  alignment: TextAlignment,
): number {
  const runHeight = run.ascent + run.descent;

  switch (alignment) {
    case 'top':
      return 0;
    case 'center':
      // 'center' centres rather than baseline-aligns
      return (line.height - runHeight) / 2;
    case 'bottom':
      return line.height - runHeight;
    case 'baseline':
    case 'auto':
    default:
      // Align baselines. The line's baseline is at `line.ascent` from the top.
      // The run's baseline is at `run.ascent` from its own top.
      // We also account for the raise.
      const raiseTwips =
        run.position * 10 +
        (run.vertAlign === 'superscript'
          ? run.ascent * 0.4
          : run.vertAlign === 'subscript'
            ? -(run.descent * 0.4)
            : 0);
      return line.ascent - (run.ascent + raiseTwips);
  }
}
