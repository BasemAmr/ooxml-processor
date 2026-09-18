/**
 * Hyphenation policies (P5-11)
 *
 * SPEC-GAP: Dictionary-based Liang hyphenation is not bundled.
 * Word supports complex, language-specific dictionary hyphenation.
 * Because we do not ship these dictionaries (and cannot derive them),
 * we DO NOT perform automatic hyphenation. It will be recorded in
 * the coverage manifest as unimplemented rather than silently approximated.
 * An approximate hyphenator that breaks words in the wrong places is worse
 * than not hyphenating.
 */

export interface HyphenationSettings {
  autoHyphenation?: boolean;
  suppressAutoHyphens?: boolean;
  hyphenationZone?: number;
  consecutiveHyphenLimit?: number; // tracked, though mostly applicable when auto-hyphen is implemented
  doNotHyphenateCaps?: boolean;
}

export class Hyphenator {
  private consecutiveHyphens = 0;
  private limit = 0;

  constructor(settings: HyphenationSettings = {}) {
    this.limit = settings.consecutiveHyphenLimit || 0; // 0 usually means no limit in Word, but we track it.
  }

  /**
   * Records that a hyphen was used to break a line.
   */
  public recordHyphenBreak() {
    this.consecutiveHyphens++;
  }

  /**
   * Records a normal line break (resets hyphen limit).
   */
  public recordNormalBreak() {
    this.consecutiveHyphens = 0;
  }

  /**
   * Returns true if we are allowed to hyphenate again on this line.
   */
  public canHyphenate(): boolean {
    if (this.limit === 0) return true; // No limit
    return this.consecutiveHyphens < this.limit;
  }
}

// Note: Soft hyphens (U+00AD) and Non-breaking hyphens (U+2011)
// are handled at the break opportunity generation (P5-04) and painting (P5-13) stages.
// - U+2011 explicitly does not provide a break opportunity.
// - U+00AD provides a break opportunity and, if broken at, renders a hyphen.
