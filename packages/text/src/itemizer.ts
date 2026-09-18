/**
 * Sub-run itemization combining script selection, font resolution, bidi, and styling (P4-06).
 *
 * Implements Ticket P4-06.
 *
 * ## Architectural Role & The Minimal Boundary Rule
 * The itemizer splits a text run into maximal uniform sub-runs.
 * A sub-run is the atomic unit accepted by the font shaper (HarfBuzz / Canvas 2D).
 *
 * Each sub-run is guaranteed to be uniform in:
 *   1. Resolved font family (P4-01 / rfonts.ts)
 *   2. Script font slot (P4-02 / script.ts: ascii, hAnsi, eastAsia, cs)
 *   3. Font size (half-points, honoring w:sz vs w:szCs)
 *   4. UAX#9 embedding level (P4-07 / bidi.ts)
 *   5. Resolved formatting flags (bold/boldCs, italic/italicCs, color)
 *
 * THE MINIMAL BOUNDARY RULE:
 * Adjacent characters that share identical script, font family, font size, bidi level,
 * and styling MUST NOT be split into separate sub-runs.
 * Over-splitting destroys typographic shaping:
 *   - Latin ligatures (e.g., "fi", "fl", "ffi") cannot form across sub-run boundaries.
 *   - Arabic cursive joining (initial, medial, final, isolated forms) and mark attachment
 *     cannot form across sub-run boundaries.
 *   - Indic conjunct formation requires whole clusters to be presented to the shaper.
 *
 * Stability:
 * Itemization is strictly deterministic: identical text and formatting produce
 * identical sub-run boundaries on every invocation.
 */

import type { CT_Fonts } from '@ooxml/schema';
import type { FontScheme } from '@ooxml/wml';
import { getBidiLevels, type BidiOptions } from './bidi.js';
import { fontForChar, type ResolvedRFonts } from './rfonts.js';
import { getFontSlotForCodepoint, type FontSlot } from './script.js';

export interface ItemizeOptions {
  /** Resolved rFonts properties or CT_Fonts AST node */
  readonly rFonts?: ResolvedRFonts | CT_Fonts | undefined;
  /** Theme font scheme for resolving *Theme bindings */
  readonly themeFontScheme?: FontScheme | undefined;
  /** ISO/BCP-47 language tag (e.g. 'en-US', 'ar-SA', 'ja-JP') */
  readonly lang?: string | undefined;
  /** Regular font size in half-points (1 pt = 2 half-points). Default: 22 (11pt) */
  readonly fontSize?: number | undefined;
  /** Complex-script font size in half-points (w:szCs). Defaults to fontSize */
  readonly fontSizeCs?: number | undefined;
  /** Run-level complex script flag (w:cs). Forces cs slot for all characters. */
  readonly cs?: boolean | undefined;
  /** Run-level right-to-left flag (w:rtl). Forces cs slot for all characters. */
  readonly rtl?: boolean | undefined;
  /**
   * Paragraph-level base embedding level (from paragraph w:bidi).
   * 0 = LTR, 1 = RTL, 'auto' = first strong character (default: 0).
   */
  readonly baseLevel?: 0 | 1 | 'auto' | undefined;
  /** Bold formatting (w:b) */
  readonly bold?: boolean | undefined;
  /** Complex-script bold formatting (w:bCs) */
  readonly boldCs?: boolean | undefined;
  /** Italic formatting (w:i) */
  readonly italic?: boolean | undefined;
  /** Complex-script italic formatting (w:iCs) */
  readonly italicCs?: boolean | undefined;
  /** Text color (hex RGB or theme color) */
  readonly color?: string | undefined;
  /** Text highlight color */
  readonly highlight?: string | undefined;
  /** Underline styling */
  readonly underline?: string | undefined;
  /** Strikethrough (w:strike) */
  readonly strike?: boolean | undefined;
  /** Double strikethrough (w:dstrike) */
  readonly dstrike?: boolean | undefined;
  /** Vertical alignment (superscript / subscript) */
  readonly vertAlign?: 'baseline' | 'superscript' | 'subscript' | undefined;
}

export interface SubRun {
  /** Text slice for this uniform segment (in logical order) */
  readonly text: string;
  /** Resolved font family name (e.g., 'Calibri', 'SimSun', 'Times New Roman') */
  readonly fontFamily: string;
  /** Font size in half-points (1 pt = 2 half-points) */
  readonly fontSize: number;
  /** Script slot classified for font resolution */
  readonly script: FontSlot;
  /** Resolved UAX#9 embedding level (0 = LTR, 1 = RTL, 2 = nested LTR, etc.) */
  readonly bidiLevel: number;
  /** Starting logical character offset in original text (UTF-16 code units) */
  readonly srcOffset: number;
  /** Logical length in UTF-16 code units */
  readonly srcLength: number;
  /** Bold styling applicable to this sub-run */
  readonly bold?: boolean | undefined;
  /** Italic styling applicable to this sub-run */
  readonly italic?: boolean | undefined;
  /** Font color */
  readonly color?: string | undefined;
  /** Highlight color */
  readonly highlight?: string | undefined;
  /** Underline styling */
  readonly underline?: string | undefined;
  /** Strikethrough */
  readonly strike?: boolean | undefined;
  /** Double strikethrough */
  readonly dstrike?: boolean | undefined;
  /** Vertical alignment */
  readonly vertAlign?: 'baseline' | 'superscript' | 'subscript' | undefined;
}

/**
 * Mutable builder for accumulating characters into a uniform sub-run.
 */
interface SubRunBuilder {
  chars: string[];
  fontFamily: string;
  fontSize: number;
  script: FontSlot;
  bidiLevel: number;
  srcOffset: number;
  srcLength: number;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  color?: string | undefined;
  highlight?: string | undefined;
  underline?: string | undefined;
  strike?: boolean | undefined;
  dstrike?: boolean | undefined;
  vertAlign?: 'baseline' | 'superscript' | 'subscript' | undefined;
}

/**
 * Default font size in half-points when not specified in rPr or docDefaults (11pt = 22).
 */
const DEFAULT_FONT_SIZE_HALF_POINTS = 22;

/**
 * Splits a text string with run options into maximal uniform sub-runs.
 *
 * @param text The input string to itemize.
 * @param options Run styling and bidi parameters.
 * @param precomputedLevels Optional precomputed UAX#9 levels for paragraph-level context.
 * @param baseOffset Optional logical offset in parent paragraph text (default: 0).
 */
export function itemizeText(
  text: string,
  options?: ItemizeOptions | undefined,
  precomputedLevels?: readonly number[] | undefined,
  baseOffset: number = 0,
): SubRun[] {
  if (text.length === 0) return [];

  // Resolve UAX#9 levels for the text if not precomputed at paragraph level
  const levels = precomputedLevels ?? getBidiLevels(text, { baseLevel: options?.baseLevel });

  const subRuns: SubRun[] = [];
  let current: SubRunBuilder | null = null;

  let strOffset = 0;
  let cpIndex = 0;

  const defaultSize = options?.fontSize ?? DEFAULT_FONT_SIZE_HALF_POINTS;
  const csSize = options?.fontSizeCs ?? defaultSize;

  const scriptOptions = { cs: options?.cs, rtl: options?.rtl };

  while (strOffset < text.length) {
    const cp = text.codePointAt(strOffset)!;
    const charLen = cp > 0xffff ? 2 : 1;
    const char = text.slice(strOffset, strOffset + charLen);

    // 1. Classify script font slot
    const script = getFontSlotForCodepoint(cp, options?.rFonts?.hint, scriptOptions);

    // 2. Resolve font family
    const fontFamily = fontForChar(
      cp,
      options?.rFonts,
      options?.themeFontScheme,
      options?.lang,
      scriptOptions,
    );

    // 3. Resolve font size (complex script uses w:szCs if defined, else w:sz)
    const fontSize = script === 'cs' ? csSize : defaultSize;

    // 4. Resolve bidi level
    const bidiLevel = levels[cpIndex] ?? 0;

    // 5. Resolve script-aware bold/italic flags
    const bold =
      script === 'cs' && options?.boldCs !== undefined ? options.boldCs : (options?.bold ?? false);
    const italic =
      script === 'cs' && options?.italicCs !== undefined
        ? options.italicCs
        : (options?.italic ?? false);

    const color = options?.color;
    const highlight = options?.highlight;
    const underline = options?.underline;
    const strike = options?.strike;
    const dstrike = options?.dstrike;
    const vertAlign = options?.vertAlign;

    // Check if character can be appended to current sub-run under Minimal Boundary Rule
    if (
      current !== null &&
      current.fontFamily === fontFamily &&
      current.fontSize === fontSize &&
      current.script === script &&
      current.bidiLevel === bidiLevel &&
      current.bold === bold &&
      current.italic === italic &&
      current.color === color &&
      current.highlight === highlight &&
      current.underline === underline &&
      current.strike === strike &&
      current.dstrike === dstrike &&
      current.vertAlign === vertAlign
    ) {
      // Append character to current sub-run without splitting
      current.chars.push(char);
      current.srcLength += charLen;
    } else {
      // Flush previous sub-run if present
      if (current !== null) {
        subRuns.push(flushBuilder(current));
      }
      // Start a new sub-run
      current = {
        chars: [char],
        fontFamily,
        fontSize,
        script,
        bidiLevel,
        srcOffset: baseOffset + strOffset,
        srcLength: charLen,
        bold,
        italic,
        color,
        highlight,
        underline,
        strike,
        dstrike,
        vertAlign,
      };
    }

    strOffset += charLen;
    cpIndex++;
  }

  if (current !== null) {
    subRuns.push(flushBuilder(current));
  }

  return subRuns;
}

function flushBuilder(builder: SubRunBuilder): SubRun {
  return {
    text: builder.chars.join(''),
    fontFamily: builder.fontFamily,
    fontSize: builder.fontSize,
    script: builder.script,
    bidiLevel: builder.bidiLevel,
    srcOffset: builder.srcOffset,
    srcLength: builder.srcLength,
    bold: builder.bold,
    italic: builder.italic,
    color: builder.color,
    highlight: builder.highlight,
    underline: builder.underline,
    strike: builder.strike,
    dstrike: builder.dstrike,
    vertAlign: builder.vertAlign,
  };
}

export interface ParagraphRunInput {
  /** Text content of the run */
  readonly text: string;
  /** Run styling and font options */
  readonly options?: ItemizeOptions | undefined;
}

/**
 * Itemizes multiple runs across an entire paragraph.
 *
 * Resolves UAX#9 bidirectional embedding levels globally across the whole paragraph
 * text (satisfying UAX#9 P1-P3 and cross-run weak/neutral interactions), then itemizes
 * each run into minimal uniform sub-runs.
 *
 * @param runs Array of run texts and styling.
 * @param paragraphBaseLevel Paragraph embedding level (from paragraph w:bidi, default: 0).
 */
export function itemizeParagraphRuns(
  runs: readonly ParagraphRunInput[],
  paragraphBaseLevel?: 0 | 1 | 'auto' | undefined,
): SubRun[] {
  if (runs.length === 0) return [];

  // 1. Concatenate text of all runs to establish whole-paragraph context for UAX#9
  const fullText = runs.map((r) => r.text).join('');
  const paragraphLevels = getBidiLevels(fullText, { baseLevel: paragraphBaseLevel });

  // 2. Itemize each run using sliced embedding levels
  const subRuns: SubRun[] = [];
  let cpOffset = 0;
  let strOffset = 0;

  for (const run of runs) {
    if (run.text.length === 0) continue;

    // Count codepoints in this run's text
    let runCpCount = 0;
    for (let i = 0; i < run.text.length;) {
      const cp = run.text.codePointAt(i)!;
      i += cp > 0xffff ? 2 : 1;
      runCpCount++;
    }

    const runLevels = paragraphLevels.slice(cpOffset, cpOffset + runCpCount);
    const itemized = itemizeText(run.text, run.options, runLevels, strOffset);
    subRuns.push(...itemized);

    cpOffset += runCpCount;
    strOffset += run.text.length;
  }

  return subRuns;
}
