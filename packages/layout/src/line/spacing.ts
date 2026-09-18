export type LineSpacingRule = 'auto' | 'exact' | 'atLeast';

export interface ParagraphSpacing {
  before: number; // twips
  after: number; // twips
  line: number;
  lineRule: LineSpacingRule;
  contextualSpacing?: boolean;
}

export interface ResolvedSpacing {
  before: number;
  after: number;
}

/**
 * Resolves inter-paragraph spacing rules including collapse and contextual spacing.
 * Adjacent paragraph spacing takes the max, not the sum, EXCEPT across tables/page tops (handled upstream).
 *
 * SPEC-GAP: contextualSpacing suppresses before/after between paragraphs OF THE SAME STYLE.
 * We resolve "same style" as same styleId, as it's the most robust way in Word without complex content matching.
 *
 * SPEC-GAP: Autospacing (beforeAutospacing/afterAutospacing) overrides @before/@after with a font-derived value.
 * We use 14pt (280 twips) for autospacing as the normative fallback.
 */
export function resolveParagraphSpacing(
  current: ParagraphSpacing,
  prev: ParagraphSpacing | null,
  isSameStyleId: boolean,
  isPageTop: boolean,
  hasAutoBefore: boolean,
  hasAutoAfter: boolean,
): ResolvedSpacing {
  let before = hasAutoBefore ? 280 : current.before;
  let after = hasAutoAfter ? 280 : current.after;

  // Contextual spacing suppresses before/after if same style.
  if (current.contextualSpacing && isSameStyleId) {
    before = 0;
    after = 0;
  }

  // Spacing before is suppressed at page top
  if (isPageTop) {
    before = 0;
  } else if (prev) {
    // Adjacent spacing takes the max(prev.after, current.before), it does not sum them.
    // To implement this properly for the current paragraph, we adjust its before spacing
    // such that the distance between prev and current equals max(prev.after, current.before).
    // The renderer usually applies prev.after, so the current paragraph's effective before
    // should be max(0, current.before - prev.after).
    const prevAfter = prev.contextualSpacing && isSameStyleId ? 0 : prev.after;
    before = Math.max(0, before - prevAfter);
  }

  return { before, after };
}

/**
 * Applies w:line spacing rule to a provisional line height.
 *
 * @param provisionalHeight Baseline height (ascent + descent) in twips
 * @param line w:line value
 * @param rule ST_LineSpacingRule
 */
export function applyLineSpacingRule(
  provisionalHeight: number,
  line: number,
  rule: LineSpacingRule,
): number {
  switch (rule) {
    case 'auto':
      // line is in 240ths of a line (240 = single, 360 = 1.5x)
      return (provisionalHeight * line) / 240;
    case 'exact':
      // exact clips. Returns the exact twips value.
      return line;
    case 'atLeast':
      // line is twips, a floor
      return Math.max(provisionalHeight, line);
    default:
      return provisionalHeight;
  }
}
