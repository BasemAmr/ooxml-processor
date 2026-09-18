/**
 * The measureText Fast Path and Eligibility Predicate (P4-10).
 *
 * Implements Ticket P4-10 and ADR 0004.
 *
 * ## Architectural Role & The Strict Allowlist Principle
 * Canvas 2D's `measureText` is significantly cheaper than full OpenType shaping,
 * but it is only correct for simple, unjoined, unkerned scripts with no ligatures.
 *
 * THE TRAP (P4-10):
 * If the eligibility predicate is a blocklist, any unrecognised script (or newly added
 * Unicode range) will slip through to the fast path and be SILENTLY MIS-SHAPED.
 * A silent layout error in Arabic, Indic, or Thai is catastrophic because it
 * produces wrong advances, misplaces carets, and causes wrong line wrapping.
 *
 * Therefore, `isFastPathEligible` is a STRICT ALLOWLIST:
 * A run is eligible ONLY IF ALL of the following hold:
 *   1. Uniform LTR embedding level (bidiLevel is even / 0).
 *   2. Script is Latin, Greek, or Cyrillic (verified codepoint by codepoint).
 *   3. No combining marks (Unicode category M: Mn, Mc, Me).
 *   4. No ligature-forming sequences (e.g. 'fi', 'fl', 'ff'), OR ligatures are explicitly disabled.
 *   5. Character kerning is inactive (w:kern threshold is absent or fontSize < kernThreshold).
 *   6. No character spacing adjustment (w:spacing is 0 or absent).
 *   7. No character horizontal scaling (w:w is 100 or absent).
 *
 * Unrecognised scripts ALWAYS default to FALSE (shaper path).
 */

import type { SubRun } from './itemizer.js';
import {
  createPackedShapedRun,
  type ClusterInput,
  type RunDirection,
  type ShapedRun,
} from './shaped-run.js';
import type { ResolvedFontFace } from './shaper.js';

/**
 * Run formatting options that affect measurement and fast-path eligibility.
 */
export interface FastPathOptions {
  /** Kerning threshold in half-points (w:kern). If fontSize >= kernThreshold, kerning applies. */
  readonly kernThreshold?: number | undefined;
  /** Character spacing adjustment in twips (w:spacing). Default: 0 */
  readonly spacing?: number | undefined;
  /** Character width scaling percentage (w:w). Default: 100 */
  readonly w?: number | undefined;
  /** Ligature configuration (w:ligatures). 'none' or false disables ligatures. */
  readonly ligatures?: 'none' | 'standard' | 'contextual' | 'all' | boolean | undefined;
}

/**
 * Strict allowlist ranges for fast-path eligible scripts:
 * Latin, Greek, Cyrillic, standard ASCII punctuation, and common typography.
 */
function isAllowlistedCodepoint(cp: number): boolean {
  // Printable ASCII (space to tilde: digits, Latin letters, punctuation)
  if (cp >= 0x0020 && cp <= 0x007e) return true;

  // Latin-1 Supplement printable characters
  if (cp >= 0x00a0 && cp <= 0x00ff) return true;

  // Latin Extended-A
  if (cp >= 0x0100 && cp <= 0x017f) return true;

  // Latin Extended-B
  if (cp >= 0x0180 && cp <= 0x024f) return true;

  // Latin Extended Additional
  if (cp >= 0x1e00 && cp <= 0x1eff) return true;

  // Greek and Coptic (excluding combining marks)
  if (cp >= 0x0370 && cp <= 0x03ff) return true;

  // Greek Extended
  if (cp >= 0x1f00 && cp <= 0x1fff) return true;

  // Cyrillic
  if (cp >= 0x0400 && cp <= 0x04ff) return true;

  // Cyrillic Supplement
  if (cp >= 0x0500 && cp <= 0x052f) return true;

  // Common typographic punctuation (hyphens, en/em-dashes, quotation marks, ellipsis)
  if (cp >= 0x2010 && cp <= 0x2027) return true;

  // Per mille, single angle quotes, currency
  if (cp >= 0x2030 && cp <= 0x203a) return true;
  if (cp === 0x20ac) return true; // Euro sign

  // All other scripts (Arabic, Hebrew, Indic, CJK, Thai, Emoji, symbols) are NOT allowlisted
  return false;
}

/**
 * Regex matching any Unicode combining mark (Category M: Mn, Mc, Me).
 * Runs with combining marks require GPOS anchor positioning and cannot use fast path.
 */
const COMBINING_MARKS_REGEX = /\p{M}/u;

/**
 * Regex identifying potential Latin ligature sequences ('fi', 'fl', 'ff', 'ffi', 'ffl').
 */
const LATIN_LIGATURE_REGEX = /f[ilf]/;

/**
 * Evaluates whether a sub-run is eligible for the fast measurement path.
 *
 * Strict ALLOWLIST: returns false for any unrecognised, complex, or styled script.
 */
export function isFastPathEligible(run: SubRun, options?: FastPathOptions | undefined): boolean {
  // 1. Text must be non-empty
  if (run.text.length === 0) return false;

  // 2. Uniform LTR embedding level: RTL runs (bidiLevel odd) require cursive joining and visual reordering
  if (run.bidiLevel % 2 !== 0) return false;

  // 3. Script slot must be ascii or hAnsi; cs and eastAsia are always shaper path
  if (run.script !== 'ascii' && run.script !== 'hAnsi') return false;

  // 4. Character spacing adjustment (w:spacing): non-zero adjustments require custom advances
  if (options?.spacing !== undefined && options.spacing !== 0) return false;

  // 5. Width scaling adjustment (w:w): non-100% scaling requires glyph transformation
  if (options?.w !== undefined && options.w !== 100) return false;

  // 6. Kerning: if w:kern is set and run's fontSize >= kernThreshold, kerning applies (shaper path)
  if (options?.kernThreshold !== undefined && run.fontSize >= options.kernThreshold) {
    return false;
  }

  // 7. Ligatures: if ligatures are NOT explicitly disabled, check for ligature-forming character pairs
  const ligaturesDisabled = options?.ligatures === 'none' || options?.ligatures === false;
  if (!ligaturesDisabled && LATIN_LIGATURE_REGEX.test(run.text)) {
    return false;
  }

  // 8. Combining Marks: any character with Unicode category M requires mark-to-base GPOS
  if (COMBINING_MARKS_REGEX.test(run.text)) {
    return false;
  }

  // 9. Every single character must strictly reside within the allowlist
  for (let i = 0; i < run.text.length;) {
    const cp = run.text.codePointAt(i)!;
    if (!isAllowlistedCodepoint(cp)) {
      return false;
    }
    i += cp > 0xffff ? 2 : 1;
  }

  return true;
}

/**
 * Calculates fast-path character advance in twips.
 * 1 em = fontSize * 10 twips.
 */
export function calculateFastCharAdvance(cp: number, fontSizeHalfPoints: number): number {
  const emInTwips = fontSizeHalfPoints * 10;

  // Space
  if (cp === 0x20 || cp === 0x00a0) {
    return Math.round(emInTwips * 0.25);
  }

  // Tabular digits
  if (cp >= 0x30 && cp <= 0x39) {
    return Math.round(emInTwips * 0.55);
  }

  // Wide Latin
  if (cp === 0x57 || cp === 0x4d || cp === 0x77 || cp === 0x6d) {
    return Math.round(emInTwips * 0.78);
  }

  // Narrow Latin & punctuation
  if (
    cp === 0x69 ||
    cp === 0x6c ||
    cp === 0x6a ||
    cp === 0x49 ||
    cp === 0x74 ||
    cp === 0x2e ||
    cp === 0x2c ||
    cp === 0x3a ||
    cp === 0x3b ||
    cp === 0x21 ||
    cp === 0x7c ||
    cp === 0x27
  ) {
    return Math.round(emInTwips * 0.28);
  }

  // Standard proportional Latin, Greek, Cyrillic letter width
  return Math.round(emInTwips * 0.52);
}

/**
 * Measures an eligible fast-path sub-run and constructs a `ShapedRun` directly
 * without invoking WASM or complex GSUB/GPOS shaping.
 */
export function measureFastPath(
  run: SubRun,
  fontFace?: ResolvedFontFace | undefined,
  options?: FastPathOptions | undefined,
): ShapedRun {
  const text = run.text;
  const fontSize = run.fontSize;
  const baseSrcOffset = run.srcOffset;
  const faceId = fontFace?.faceId ?? 0;

  const clusters: ClusterInput[] = [];
  let i = 0;

  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const advance = calculateFastCharAdvance(cp, fontSize);

    clusters.push({
      glyphId: cp,
      xAdvance: advance,
      xOffset: 0,
      yOffset: 0,
      srcOffset: baseSrcOffset + i,
      srcLength: len,
    });

    i += len;
  }

  return createPackedShapedRun({
    faceId,
    fontSize,
    direction: 'ltr',
    script: run.script,
    clusters,
  });
}
