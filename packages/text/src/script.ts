/**
 * Per-character script and font slot classification (P4-02).
 *
 * SPEC-GAP:
 * ECMA-376 Part 1 §17.3.2.26 (`rFonts`) establishes that font family resolution
 * occurs per-character across four distinct font slots:
 *   1. `ascii` — Basic Latin characters (U+0000..U+007F)
 *   2. `hAnsi` — High ANSI characters (Latin-1 Supplement, Latin Extended, Cyrillic, Greek, etc.)
 *   3. `eastAsia` — CJK Ideographs, Kana, Hangul, Bopomofo, CJK symbols & punctuation
 *   4. `cs` — Complex scripts (Arabic, Hebrew, Syriac, Indic scripts, Thai, Lao, Khmer, etc.)
 *
 * The specification states the architectural intent but leaves the exact Unicode
 * codepoint-to-slot mapping unspecified (non-normative). In Microsoft Word, the
 * mapping is derived from Windows GDI/Uniscribe classification and Unicode block definitions.
 * This file formalizes that mapping into an ordered, data-driven range table with
 * binary search lookup.
 *
 * In addition:
 *   - "Ambiguous" characters (e.g. general punctuation, currency symbols, math operators)
 *     consult `w:hint` ('default' -> ascii/hAnsi, 'eastAsia' -> eastAsia).
 *   - A run-level `w:cs` or `w:rtl` property forcibly overrides the slot to `cs` for
 *     all characters in that run, regardless of their individual codepoints.
 */

import type { ST_Hint } from '@ooxml/schema';

export type FontSlot = 'ascii' | 'hAnsi' | 'eastAsia' | 'cs';
export type ScriptSlot = FontSlot | 'ambiguous';

export interface ScriptRange {
  readonly start: number;
  readonly end: number;
  readonly slot: ScriptSlot;
}

/**
 * Data-driven range table mapping Unicode codepoint intervals to script font slots.
 * Kept strictly sorted in ascending order with no overlapping ranges to enable
 * O(log N) binary search.
 */
export const UNICODE_SCRIPT_RANGES: readonly ScriptRange[] = Object.freeze([
  // ASCII / Basic Latin
  { start: 0x0000, end: 0x007f, slot: 'ascii' },

  // High ANSI: Latin-1 Supplement, Latin Extended-A/B, IPA
  { start: 0x0080, end: 0x02af, slot: 'hAnsi' },

  // Spacing Modifier Letters (often shared across Latin and East Asian contexts)
  { start: 0x02b0, end: 0x02ff, slot: 'ambiguous' },

  // Combining Diacritical Marks
  { start: 0x0300, end: 0x036f, slot: 'hAnsi' },

  // Greek, Coptic, Cyrillic, Cyrillic Supplement
  { start: 0x0370, end: 0x052f, slot: 'hAnsi' },

  // Armenian
  { start: 0x0530, end: 0x058f, slot: 'hAnsi' },

  // Complex Script: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, Arabic Ext-A
  { start: 0x0590, end: 0x08ff, slot: 'cs' },

  // Complex Script: Indic scripts (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala)
  { start: 0x0900, end: 0x0dff, slot: 'cs' },

  // Complex Script: Thai
  { start: 0x0e00, end: 0x0e7f, slot: 'cs' },

  // Complex Script: Lao
  { start: 0x0e80, end: 0x0eff, slot: 'cs' },

  // Complex Script: Tibetan
  { start: 0x0f00, end: 0x0fff, slot: 'cs' },

  // Complex Script: Myanmar
  { start: 0x1000, end: 0x109f, slot: 'cs' },

  // Georgian (handled as hAnsi in Windows ANSI/GDI font mapping)
  { start: 0x10a0, end: 0x10ff, slot: 'hAnsi' },

  // East Asia: Hangul Jamo
  { start: 0x1100, end: 0x11ff, slot: 'eastAsia' },

  // Complex Script: Ethiopic
  { start: 0x1200, end: 0x139f, slot: 'cs' },

  // Cherokee, Canadian Aboriginal, Ogham, Runic
  { start: 0x13a0, end: 0x177f, slot: 'hAnsi' },

  // Complex Script: Khmer
  { start: 0x1780, end: 0x17ff, slot: 'cs' },

  // Complex Script: Mongolian
  { start: 0x1800, end: 0x18af, slot: 'cs' },

  // Complex Script: Limbu, Tai Le, New Tai Lue, Buginese, Tai Tham, Balinese, Sundanese, Batak, Lepcha, Ol Chiki
  { start: 0x1900, end: 0x1c7f, slot: 'cs' },

  // Complex Script: Vedic Extensions
  { start: 0x1cd0, end: 0x1cff, slot: 'cs' },

  // Phonetic Extensions, Combining Diacritical Marks Supplement
  { start: 0x1d00, end: 0x1dff, slot: 'hAnsi' },

  // Latin Extended Additional, Greek Extended
  { start: 0x1e00, end: 0x1fff, slot: 'hAnsi' },

  // Ambiguous: General Punctuation (quotes, dashes, spaces, ellipsis)
  { start: 0x2000, end: 0x206f, slot: 'ambiguous' },

  // Ambiguous: Superscripts, Subscripts, Currency, Combining Marks for Symbols
  { start: 0x2070, end: 0x20ff, slot: 'ambiguous' },

  // Ambiguous: Letterlike Symbols, Number Forms, Arrows
  { start: 0x2100, end: 0x21ff, slot: 'ambiguous' },

  // Ambiguous: Mathematical Operators, Misc Technical, Control Pictures, OCR
  { start: 0x2200, end: 0x245f, slot: 'ambiguous' },

  // Ambiguous: Enclosed Alphanumerics, Box Drawing, Block Elements, Geometric Shapes
  { start: 0x2460, end: 0x25ff, slot: 'ambiguous' },

  // Ambiguous: Miscellaneous Symbols, Dingbats, Misc Math & Arrows
  { start: 0x2600, end: 0x2bff, slot: 'ambiguous' },

  // East Asia: CJK Radicals, Kangxi Radicals, Ideographic Description Characters
  { start: 0x2e80, end: 0x2fff, slot: 'eastAsia' },

  // East Asia: CJK Symbols and Punctuation (ideographic comma, full stop, quotes)
  { start: 0x3000, end: 0x303f, slot: 'eastAsia' },

  // East Asia: Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, Kanbun
  { start: 0x3040, end: 0x31bf, slot: 'eastAsia' },

  // East Asia: CJK Strokes, Katakana Phonetic Extensions, Enclosed CJK Letters, CJK Compatibility
  { start: 0x31c0, end: 0x33ff, slot: 'eastAsia' },

  // East Asia: CJK Unified Ideographs Extension A, Yijing Hexagrams
  { start: 0x3400, end: 0x4dff, slot: 'eastAsia' },

  // East Asia: CJK Unified Ideographs
  { start: 0x4e00, end: 0x9fff, slot: 'eastAsia' },

  // East Asia: Yi Syllables and Radicals
  { start: 0xa000, end: 0xa4cf, slot: 'eastAsia' },

  // Complex Script: Lisu, Vai
  { start: 0xa4d0, end: 0xa63f, slot: 'cs' },

  // Cyrillic Extended-B
  { start: 0xa640, end: 0xa69f, slot: 'hAnsi' },

  // Complex Script: Syloti Nagri, Phags-pa, Saurashtra, Devanagari Extended, Kayah Li, Rejang
  { start: 0xa800, end: 0xa95f, slot: 'cs' },

  // East Asia: Hangul Jamo Extended-A
  { start: 0xa960, end: 0xa97f, slot: 'eastAsia' },

  // Complex Script: Javanese, Cham, Myanmar Ext-A, Tai Viet, Meetei Mayek, Ethiopic Ext-A
  { start: 0xa980, end: 0xabff, slot: 'cs' },

  // East Asia: Hangul Syllables, Hangul Jamo Extended-B
  { start: 0xac00, end: 0xd7ff, slot: 'eastAsia' },

  // East Asia: CJK Compatibility Ideographs
  { start: 0xf900, end: 0xfaff, slot: 'eastAsia' },

  // Latin Presentation Forms (ligatures ff, fi, fl, ffi, ffl) -> hAnsi
  { start: 0xfb00, end: 0xfb06, slot: 'hAnsi' },

  // Hebrew Presentation Forms -> cs
  { start: 0xfb1d, end: 0xfb4f, slot: 'cs' },

  // Arabic Presentation Forms-A -> cs
  { start: 0xfb50, end: 0xfdff, slot: 'cs' },

  // Combining Half Marks -> hAnsi
  { start: 0xfe20, end: 0xfe2f, slot: 'hAnsi' },

  // East Asia: CJK Compatibility Forms
  { start: 0xfe30, end: 0xfe4f, slot: 'eastAsia' },

  // Ambiguous: Small Form Variants
  { start: 0xfe50, end: 0xfe6f, slot: 'ambiguous' },

  // Complex Script: Arabic Presentation Forms-B
  { start: 0xfe70, end: 0xfeff, slot: 'cs' },

  // East Asia: Halfwidth and Fullwidth Forms
  { start: 0xff00, end: 0xffef, slot: 'eastAsia' },

  // Supplementary Complex Scripts (Linear B, ancient Greek, Old Persian, Ugaritic, etc.)
  { start: 0x10000, end: 0x10fff, slot: 'cs' },

  // Supplementary Complex Scripts (Brahmi, Kaithi, Sharada, etc.)
  { start: 0x11000, end: 0x11fff, slot: 'cs' },

  // Supplementary East Asia: CJK Unified Ideographs Extensions B..I & Compat Supp
  { start: 0x20000, end: 0x2fa1f, slot: 'eastAsia' },
]);

/**
 * Binary search over UNICODE_SCRIPT_RANGES to find matching ScriptSlot.
 * Runs in O(log N) where N = number of ranges.
 */
function findScriptSlot(cp: number): ScriptSlot {
  let low = 0;
  let high = UNICODE_SCRIPT_RANGES.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = UNICODE_SCRIPT_RANGES[mid];
    if (entry === undefined) {
      break;
    }

    if (cp < entry.start) {
      high = mid - 1;
    } else if (cp > entry.end) {
      low = mid + 1;
    } else {
      return entry.slot;
    }
  }

  // Unclassified codepoints default to hAnsi (e.g. unassigned Latin-adjacent planes)
  return 'hAnsi';
}

export interface ScriptSlotOptions {
  /**
   * Run-level complex script flag (w:cs). When true, forces the cs slot.
   */
  readonly cs?: boolean | undefined;
  /**
   * Run-level right-to-left flag (w:rtl). When true, forces the cs slot.
   */
  readonly rtl?: boolean | undefined;
}

/**
 * Resolves the font slot ('ascii' | 'hAnsi' | 'eastAsia' | 'cs') for a single codepoint.
 *
 * Rules:
 *   1. Run-level `w:cs` or `w:rtl` forces the `cs` slot unconditionally.
 *   2. Ambiguous codepoints consult `w:hint`:
 *      - `hint === 'eastAsia'` -> `eastAsia`
 *      - `hint === 'default'` (or absent) -> `ascii` if cp <= 0x7F else `hAnsi`.
 *   3. Unambiguous codepoints map directly according to `UNICODE_SCRIPT_RANGES`.
 */
export function getFontSlotForCodepoint(
  cp: number,
  hint?: ST_Hint | undefined,
  options?: ScriptSlotOptions | undefined,
): FontSlot {
  // Run-level w:cs or w:rtl forces the cs slot regardless of codepoint
  if (options?.cs === true || options?.rtl === true) {
    return 'cs';
  }

  const rawSlot = findScriptSlot(cp);

  if (rawSlot === 'ambiguous') {
    // Ambiguous ranges (e.g. punctuation, math, symbols) consult w:hint
    if (hint === 'eastAsia') {
      return 'eastAsia';
    }
    // 'default' hint or undefined uses ascii if <= 0x7F, otherwise hAnsi
    return cp <= 0x7f ? 'ascii' : 'hAnsi';
  }

  return rawSlot;
}

/**
 * Resolves the font slot for a character string. Uses the first Unicode codepoint.
 */
export function getFontSlotForChar(
  char: string,
  hint?: ST_Hint | undefined,
  options?: ScriptSlotOptions | undefined,
): FontSlot {
  const cp = char.codePointAt(0) ?? 0;
  return getFontSlotForCodepoint(cp, hint, options);
}
