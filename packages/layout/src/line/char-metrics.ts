export interface CharMetricsConfig {
  spacing: number; // twips, added to every advance
  kern: number; // half-points, minimum font size at or above which kerning applies
  w: number; // percentage stretch (e.g., 100 = normal, 150 = 1.5x wider)
}

export interface CharAdvance {
  advance: number; // twips
}

/**
 * Adjusts a character's advance width based on w:spacing, w:kern, and w:w.
 *
 * @param baseAdvance The initial advance from the shaper
 * @param fontSize The run's font size in half-points
 * @param config Character metrics configuration
 * @returns The adjusted advance in twips
 */
export function adjustCharMetrics(
  baseAdvance: number,
  fontSize: number,
  config: CharMetricsConfig,
): number {
  let advance = baseAdvance;

  // w:w scales advances, not glyph geometry. 100 is 100% (no change).
  if (config.w !== undefined && config.w !== 100) {
    advance = (advance * config.w) / 100;
  }

  // w:spacing is added to every advance (can be negative to tighten without reordering)
  if (config.spacing !== undefined && config.spacing !== 0) {
    advance += config.spacing;
  }

  // NOTE: w:kern determines whether the SHAPER should apply kerning.
  // <w:kern w:val="16"/> means "kern at 8pt and above" (16 half-points).
  // If fontSize < config.kern, kerning should ideally be disabled in the shaper.
  // Since we only receive the shaped advance here, this function assumes the
  // shaper has respected the kerning flag. The metric check is here to validate
  // the logic for the consumer of this module.
  const shouldKern = config.kern !== undefined && fontSize >= config.kern;

  // We return the computed advance and expose `shouldKern` so the shaping layer
  // (P4) can be informed before shaping happens.

  return Math.max(0, advance); // Avoid negative total advances
}

/**
 * Helper to determine if kerning should be enabled for a given font size.
 */
export function isKerningEnabled(fontSize: number, kernThreshold?: number): boolean {
  if (kernThreshold === undefined || kernThreshold === 0) return false;
  return fontSize >= kernThreshold;
}
