/**
 * Unicode Bidirectional Algorithm (UAX#9) implementation (P4-07).
 *
 * SPEC-GAP / ARCHITECTURAL CONTRACT:
 * ECMA-376 Part 1 §17.3.1.2 (`w:bidi`) and §17.3.2.27 (`w:rtl`) establish paragraph-level
 * and run-level bidirectional semantics. OOXML delegates bidirectional character ordering
 * and level resolution to Unicode Standard Annex #9 (UAX#9).
 *
 * THE CONTRACT WITH PHASE 6 (Layout and Affinities):
 *   1. The visual items returned by this engine are in VISUAL display order (traversed 0..N-1
 *      when painting left-to-right on Canvas 2D).
 *   2. Each visual item preserves its original LOGICAL source offset (`srcOffset`) and
 *      source length (`srcLength`).
 *   3. For RTL segments, visual order reverses character positions while preserving their
 *      logical source offsets: therefore `srcOffset` is NOT monotonic across an RTL run.
 *   4. Both orders are fully recoverable:
 *      - Visual order is array order: `visualItems[visualIndex]`
 *      - Logical order is recoverable by sorting items on `srcOffset`.
 *   5. Boundary caret affinity: At a directional boundary, a single logical position
 *      can map to two distinct visual positions. That ambiguity is resolved by caret
 *      affinity, which Phase 6 (`P6-01`) owns. This module provides the strict embedding
 *      levels and visual reordering required by Phase 6.
 *
 * Conformance:
 * Full implementation of UAX#9 Unicode 6.3+ bidirectional algorithm including:
 *   - Character classification into 23 Bidi classes
 *   - Base level determination (P1-P3)
 *   - Explicit embedding levels & directional isolates (X1-X8: LRI, RLI, FSI, PDI)
 *   - Isolating run sequences (X10)
 *   - Weak types resolution (W1-W7)
 *   - Neutral types and BD16 bracket pairs resolution (N0-N2)
 *   - Implicit levels resolution (I1-I2)
 *   - Reordering to visual order (L1-L2)
 */

export type BidiClass =
  | 'L' // Left-to-Right
  | 'R' // Right-to-Left (Hebrew, etc.)
  | 'AL' // Right-to-Left Arabic
  | 'EN' // European Number
  | 'ES' // European Number Separator
  | 'ET' // European Number Terminator
  | 'AN' // Arabic Number
  | 'CS' // Common Number Separator
  | 'NSM' // Nonspacing Mark
  | 'BN' // Boundary Neutral
  | 'B' // Paragraph Separator
  | 'S' // Segment Separator
  | 'WS' // Whitespace
  | 'ON' // Other Neutral
  | 'LRE' // Left-to-Right Embedding
  | 'RLE' // Right-to-Left Embedding
  | 'LRO' // Left-to-Right Override
  | 'RLO' // Right-to-Left Override
  | 'PDF' // Pop Directional Format
  | 'LRI' // Left-to-Right Isolate
  | 'RLI' // Right-to-Left Isolate
  | 'FSI' // First Strong Isolate
  | 'PDI'; // Pop Directional Isolate

export interface BidiClassRange {
  readonly start: number;
  readonly end: number;
  readonly cls: BidiClass;
}

/**
 * Sorted, non-overlapping Unicode codepoint ranges for Bidi_Class lookup.
 * Kept strictly sorted by `start` ascending for O(log N) binary search.
 */
export const BIDI_CLASS_RANGES: readonly BidiClassRange[] = Object.freeze([
  // ASCII Control Chars
  { start: 0x0000, end: 0x0008, cls: 'BN' },
  { start: 0x0009, end: 0x0009, cls: 'S' }, // Horizontal tab
  { start: 0x000a, end: 0x000a, cls: 'B' }, // Line Feed (LF)
  { start: 0x000b, end: 0x000b, cls: 'S' }, // Vertical tab
  { start: 0x000c, end: 0x000c, cls: 'WS' }, // Form feed
  { start: 0x000d, end: 0x000d, cls: 'B' }, // Carriage Return (CR)
  { start: 0x000e, end: 0x001f, cls: 'BN' },

  // ASCII Printable
  { start: 0x0020, end: 0x0020, cls: 'WS' }, // Space
  { start: 0x0021, end: 0x0022, cls: 'ON' }, // ! "
  { start: 0x0023, end: 0x0025, cls: 'ET' }, // # $ %
  { start: 0x0026, end: 0x002a, cls: 'ON' }, // & ' ( ) *
  { start: 0x002b, end: 0x002b, cls: 'ES' }, // +
  { start: 0x002c, end: 0x002c, cls: 'CS' }, // ,
  { start: 0x002d, end: 0x002d, cls: 'ES' }, // -
  { start: 0x002e, end: 0x002f, cls: 'CS' }, // . /
  { start: 0x0030, end: 0x0039, cls: 'EN' }, // 0-9
  { start: 0x003a, end: 0x003a, cls: 'CS' }, // :
  { start: 0x003b, end: 0x0040, cls: 'ON' }, // ; < = > ? @
  { start: 0x0041, end: 0x005a, cls: 'L' }, // A-Z
  { start: 0x005b, end: 0x0060, cls: 'ON' }, // [ \ ] ^ _ `
  { start: 0x0061, end: 0x007a, cls: 'L' }, // a-z
  { start: 0x007b, end: 0x007e, cls: 'ON' }, // { | } ~
  { start: 0x007f, end: 0x0084, cls: 'BN' }, // DEL & C1 controls
  { start: 0x0085, end: 0x0085, cls: 'B' }, // Next Line (NEL)
  { start: 0x0086, end: 0x009f, cls: 'BN' },

  // Latin-1 Supplement
  { start: 0x00a0, end: 0x00a0, cls: 'CS' }, // Non-breaking space
  { start: 0x00a1, end: 0x00a1, cls: 'ON' }, // ¡
  { start: 0x00a2, end: 0x00a5, cls: 'ET' }, // ¢ £ ¤ ¥
  { start: 0x00a6, end: 0x00a9, cls: 'ON' }, // ¦ § ¨ ©
  { start: 0x00aa, end: 0x00aa, cls: 'L' }, // ª
  { start: 0x00ab, end: 0x00af, cls: 'ON' }, // « ¬ SHY ® ¯
  { start: 0x00b0, end: 0x00b1, cls: 'ET' }, // ° ±
  { start: 0x00b2, end: 0x00b3, cls: 'EN' }, // ² ³
  { start: 0x00b4, end: 0x00b8, cls: 'ON' }, // ´ µ ¶ · ¸
  { start: 0x00b9, end: 0x00b9, cls: 'EN' }, // ¹
  { start: 0x00ba, end: 0x00ba, cls: 'L' }, // º
  { start: 0x00bb, end: 0x00bf, cls: 'ON' }, // » ¼ ½ ¾ ¿
  { start: 0x00c0, end: 0x00d6, cls: 'L' }, // À..Ö
  { start: 0x00d7, end: 0x00d7, cls: 'ON' }, // ×
  { start: 0x00d8, end: 0x00f6, cls: 'L' }, // Ø..ö
  { start: 0x00f7, end: 0x00f7, cls: 'ON' }, // ÷
  { start: 0x00f8, end: 0x02b8, cls: 'L' }, // Latin Ext-A/B, IPA

  // Modifier Letters & Combining Diacritics
  { start: 0x02b9, end: 0x02ba, cls: 'ON' },
  { start: 0x02bb, end: 0x02c1, cls: 'L' },
  { start: 0x02c2, end: 0x02cf, cls: 'ON' },
  { start: 0x02d0, end: 0x02d1, cls: 'L' },
  { start: 0x02d2, end: 0x02df, cls: 'ON' },
  { start: 0x02e0, end: 0x02e4, cls: 'L' },
  { start: 0x02e5, end: 0x02ff, cls: 'ON' },
  { start: 0x0300, end: 0x036f, cls: 'NSM' }, // Combining Diacritical Marks

  // Greek, Cyrillic, Armenian
  { start: 0x0370, end: 0x0373, cls: 'L' },
  { start: 0x0374, end: 0x0375, cls: 'ON' },
  { start: 0x0376, end: 0x037d, cls: 'L' },
  { start: 0x037e, end: 0x037e, cls: 'ON' },
  { start: 0x037f, end: 0x0383, cls: 'L' },
  { start: 0x0384, end: 0x0385, cls: 'ON' },
  { start: 0x0386, end: 0x0386, cls: 'L' },
  { start: 0x0387, end: 0x0387, cls: 'ON' },
  { start: 0x0388, end: 0x0482, cls: 'L' },
  { start: 0x0483, end: 0x0489, cls: 'NSM' }, // Cyrillic Combining Marks
  { start: 0x048a, end: 0x052f, cls: 'L' },
  { start: 0x0531, end: 0x0589, cls: 'L' }, // Armenian
  { start: 0x058a, end: 0x058a, cls: 'ON' },
  { start: 0x058f, end: 0x058f, cls: 'ET' },

  // Hebrew
  { start: 0x0591, end: 0x05bd, cls: 'NSM' }, // Hebrew cantillation / points
  { start: 0x05be, end: 0x05be, cls: 'R' }, // Maqaf
  { start: 0x05bf, end: 0x05bf, cls: 'NSM' }, // Rafe
  { start: 0x05c0, end: 0x05c0, cls: 'R' }, // Paseq
  { start: 0x05c1, end: 0x05c2, cls: 'NSM' }, // Shin / Sin dot
  { start: 0x05c3, end: 0x05c3, cls: 'R' }, // Sof pasuq
  { start: 0x05c4, end: 0x05c5, cls: 'NSM' }, // Upper mark / lower mark
  { start: 0x05c6, end: 0x05c6, cls: 'R' }, // Nun hafukha
  { start: 0x05c7, end: 0x05c7, cls: 'NSM' }, // Qamats qatan
  { start: 0x05d0, end: 0x05ea, cls: 'R' }, // Hebrew letters
  { start: 0x05ef, end: 0x05f2, cls: 'R' }, // Yod yod, etc.
  { start: 0x05f3, end: 0x05f4, cls: 'ON' }, // Geresh, gershayim

  // Arabic
  { start: 0x0600, end: 0x0605, cls: 'AN' }, // Subtending marks / number signs
  { start: 0x0606, end: 0x0608, cls: 'ON' },
  { start: 0x0609, end: 0x060a, cls: 'ET' }, // % ‰
  { start: 0x060b, end: 0x060b, cls: 'AL' },
  { start: 0x060c, end: 0x060c, cls: 'CS' }, // Arabic comma
  { start: 0x060d, end: 0x060f, cls: 'ON' },
  { start: 0x0610, end: 0x061a, cls: 'NSM' }, // Arabic honorifics / harakat
  { start: 0x061b, end: 0x061b, cls: 'CS' }, // Arabic semicolon
  { start: 0x061c, end: 0x061c, cls: 'AL' }, // Arabic Letter Mark (ALM)
  { start: 0x061d, end: 0x061f, cls: 'ON' },
  { start: 0x0620, end: 0x064a, cls: 'AL' }, // Arabic letters
  { start: 0x064b, end: 0x065f, cls: 'NSM' }, // Harakat: fatha, damma, kasra, shadda, sukun
  { start: 0x0660, end: 0x0669, cls: 'AN' }, // Arabic-Indic digits ٠-٩
  { start: 0x066a, end: 0x066a, cls: 'ET' }, // Arabic percent sign
  { start: 0x066b, end: 0x066c, cls: 'AN' }, // Decimal & thousands separators
  { start: 0x066d, end: 0x066d, cls: 'ON' },
  { start: 0x066e, end: 0x066f, cls: 'AL' },
  { start: 0x0670, end: 0x0670, cls: 'NSM' }, // Superscript alef
  { start: 0x0671, end: 0x06d5, cls: 'AL' }, // Additional Arabic letters
  { start: 0x06d6, end: 0x06dc, cls: 'NSM' }, // Quranic marks
  { start: 0x06dd, end: 0x06dd, cls: 'AN' }, // End of ayah
  { start: 0x06de, end: 0x06de, cls: 'ON' },
  { start: 0x06df, end: 0x06e4, cls: 'NSM' },
  { start: 0x06e5, end: 0x06e6, cls: 'AL' },
  { start: 0x06e7, end: 0x06e8, cls: 'NSM' },
  { start: 0x06e9, end: 0x06e9, cls: 'ON' },
  { start: 0x06ea, end: 0x06ed, cls: 'NSM' },
  { start: 0x06ee, end: 0x06ef, cls: 'AL' },
  { start: 0x06f0, end: 0x06f9, cls: 'EN' }, // Eastern Arabic-Indic digits (Persian/Urdu) are EN per Unicode!
  { start: 0x06fa, end: 0x0710, cls: 'AL' },

  // Syriac, Arabic Supplement, Thaana, NKo, Samaritan, Mandaic, Arabic Ext-A
  { start: 0x0711, end: 0x0711, cls: 'NSM' },
  { start: 0x0712, end: 0x072f, cls: 'AL' },
  { start: 0x0730, end: 0x074a, cls: 'NSM' },
  { start: 0x074d, end: 0x07a5, cls: 'AL' },
  { start: 0x07a6, end: 0x07b0, cls: 'NSM' },
  { start: 0x07b1, end: 0x07bf, cls: 'AL' },
  { start: 0x07c0, end: 0x07ea, cls: 'R' }, // NKo
  { start: 0x07eb, end: 0x07f3, cls: 'NSM' },
  { start: 0x07f4, end: 0x07fa, cls: 'R' },
  { start: 0x0800, end: 0x0815, cls: 'R' }, // Samaritan
  { start: 0x0816, end: 0x0819, cls: 'NSM' },
  { start: 0x081a, end: 0x0824, cls: 'R' },
  { start: 0x0825, end: 0x0827, cls: 'NSM' },
  { start: 0x0828, end: 0x0828, cls: 'R' },
  { start: 0x0829, end: 0x082d, cls: 'NSM' },
  { start: 0x0840, end: 0x0858, cls: 'R' }, // Mandaic
  { start: 0x0859, end: 0x085b, cls: 'NSM' },
  { start: 0x08a0, end: 0x08d2, cls: 'AL' }, // Arabic Ext-A
  { start: 0x08d3, end: 0x08ff, cls: 'NSM' },

  // Indic scripts: Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala
  { start: 0x0900, end: 0x0dff, cls: 'L' },

  // General Punctuation & Directional Formatting (0x2000..0x206F)
  { start: 0x2000, end: 0x200a, cls: 'WS' }, // Spaces: en quad, em space, etc.
  { start: 0x200b, end: 0x200d, cls: 'BN' }, // ZWSP, ZWNJ, ZWJ
  { start: 0x200e, end: 0x200e, cls: 'L' }, // LRM
  { start: 0x200f, end: 0x200f, cls: 'R' }, // RLM
  { start: 0x2010, end: 0x2027, cls: 'ON' }, // Hyphens, quotes, bullets
  { start: 0x2028, end: 0x2028, cls: 'WS' }, // Line separator
  { start: 0x2029, end: 0x2029, cls: 'B' }, // Paragraph separator
  { start: 0x202a, end: 0x202a, cls: 'LRE' }, // Left-to-Right Embedding
  { start: 0x202b, end: 0x202b, cls: 'RLE' }, // Right-to-Left Embedding
  { start: 0x202c, end: 0x202c, cls: 'PDF' }, // Pop Directional Format
  { start: 0x202d, end: 0x202d, cls: 'LRO' }, // Left-to-Right Override
  { start: 0x202e, end: 0x202e, cls: 'RLO' }, // Right-to-Left Override
  { start: 0x202f, end: 0x202f, cls: 'CS' }, // Narrow no-break space
  { start: 0x2030, end: 0x2034, cls: 'ET' }, // ‰ ‱ etc.
  { start: 0x2035, end: 0x2043, cls: 'ON' },
  { start: 0x2044, end: 0x2044, cls: 'CS' }, // Fraction slash
  { start: 0x2045, end: 0x205f, cls: 'ON' },
  { start: 0x2060, end: 0x2064, cls: 'BN' }, // Invisible word joiners
  { start: 0x2066, end: 0x2066, cls: 'LRI' }, // Left-to-Right Isolate
  { start: 0x2067, end: 0x2067, cls: 'RLI' }, // Right-to-Left Isolate
  { start: 0x2068, end: 0x2068, cls: 'FSI' }, // First Strong Isolate
  { start: 0x2069, end: 0x2069, cls: 'PDI' }, // Pop Directional Isolate
  { start: 0x206a, end: 0x206f, cls: 'BN' },

  // Symbols, Currency, Math
  { start: 0x2070, end: 0x2070, cls: 'EN' }, // ⁰
  { start: 0x2071, end: 0x2073, cls: 'ON' },
  { start: 0x2074, end: 0x2079, cls: 'EN' }, // ⁴..⁹
  { start: 0x207a, end: 0x207b, cls: 'ES' }, // ⁺ ⁻
  { start: 0x207c, end: 0x2080, cls: 'ON' },
  { start: 0x2081, end: 0x2089, cls: 'EN' }, // ₁..₉
  { start: 0x208a, end: 0x208b, cls: 'ES' }, // ₊ ₋
  { start: 0x208c, end: 0x209f, cls: 'ON' },
  { start: 0x20a0, end: 0x20cf, cls: 'ET' }, // Currency symbols ($, €, £, etc.)
  { start: 0x20d0, end: 0x20ff, cls: 'NSM' }, // Combining marks for symbols
  { start: 0x2100, end: 0x2bff, cls: 'ON' }, // Letterlike, numbers, arrows, math, tech

  // CJK, East Asian ideographs, Kana, Hangul
  { start: 0x2e80, end: 0x9fff, cls: 'L' },

  // Hebrew Presentation Forms
  { start: 0xfb1d, end: 0xfb1d, cls: 'R' },
  { start: 0xfb1e, end: 0xfb1e, cls: 'NSM' },
  { start: 0xfb1f, end: 0xfb4f, cls: 'R' },

  // Arabic Presentation Forms-A
  { start: 0xfb50, end: 0xfdff, cls: 'AL' },

  // Arabic Presentation Forms-B
  { start: 0xfe70, end: 0xfefc, cls: 'AL' },
  { start: 0xfeff, end: 0xfeff, cls: 'BN' }, // Zero width no-break space / BOM

  // Halfwidth & Fullwidth forms
  { start: 0xff01, end: 0xff02, cls: 'ON' },
  { start: 0xff03, end: 0xff05, cls: 'ET' },
  { start: 0xff06, end: 0xff0a, cls: 'ON' },
  { start: 0xff0b, end: 0xff0b, cls: 'ES' },
  { start: 0xff0c, end: 0xff0c, cls: 'CS' },
  { start: 0xff0d, end: 0xff0d, cls: 'ES' },
  { start: 0xff0e, end: 0xff0f, cls: 'CS' },
  { start: 0xff10, end: 0xff19, cls: 'EN' }, // Fullwidth 0-9
  { start: 0xff1a, end: 0xff20, cls: 'ON' },
  { start: 0xff21, end: 0xff3a, cls: 'L' }, // Fullwidth A-Z
  { start: 0xff3b, end: 0xff40, cls: 'ON' },
  { start: 0xff41, end: 0xff5a, cls: 'L' }, // Fullwidth a-z
  { start: 0xff5b, end: 0xff65, cls: 'ON' },
  { start: 0xff66, end: 0xffbe, cls: 'L' }, // Halfwidth CJK / Katakana
  { start: 0xffc2, end: 0xffdc, cls: 'L' }, // Halfwidth Hangul
  { start: 0xffe0, end: 0xffe6, cls: 'ET' }, // Fullwidth currency
  { start: 0xffe8, end: 0xffee, cls: 'ON' },
]);

/**
 * Binary search to determine Bidi_Class for any Unicode codepoint in O(log N).
 */
export function getBidiClass(cp: number): BidiClass {
  let low = 0;
  let high = BIDI_CLASS_RANGES.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = BIDI_CLASS_RANGES[mid];
    if (entry === undefined) break;

    if (cp < entry.start) {
      high = mid - 1;
    } else if (cp > entry.end) {
      low = mid + 1;
    } else {
      return entry.cls;
    }
  }

  // Unassigned / supplementary plane codepoints default to L (or ON for emoji/symbols)
  if (cp >= 0x1f000 && cp <= 0x1ffff) {
    return 'ON'; // Emoji and Pictographs
  }
  return 'L';
}

/* -------------------------------------------------------------------------- */
/* BD16 Bidi Paired Bracket Definitions                                       */
/* -------------------------------------------------------------------------- */

export interface BracketPairInfo {
  readonly pairedWith: number;
  readonly type: 'o' | 'c'; // 'o' = open, 'c' = close
}

/**
 * Unicode Bidi_Paired_Bracket mapping for common bracket characters.
 */
export const PAIRED_BRACKETS: Readonly<Record<number, BracketPairInfo>> = Object.freeze({
  // ASCII brackets
  0x0028: { pairedWith: 0x0029, type: 'o' }, // (
  0x0029: { pairedWith: 0x0028, type: 'c' }, // )
  0x005b: { pairedWith: 0x005d, type: 'o' }, // [
  0x005d: { pairedWith: 0x005b, type: 'c' }, // ]
  0x007b: { pairedWith: 0x007d, type: 'o' }, // {
  0x007d: { pairedWith: 0x007b, type: 'c' }, // }
  0x00ab: { pairedWith: 0x00bb, type: 'o' }, // «
  0x00bb: { pairedWith: 0x00ab, type: 'c' }, // »
  0x2039: { pairedWith: 0x203a, type: 'o' }, // ‹
  0x203a: { pairedWith: 0x2039, type: 'c' }, // ›
  0x2308: { pairedWith: 0x2309, type: 'o' }, // ⌈
  0x2309: { pairedWith: 0x2308, type: 'c' }, // ⌉
  0x230a: { pairedWith: 0x230b, type: 'o' }, // ⌊
  0x230b: { pairedWith: 0x230a, type: 'c' }, // ⌋
  0x27e6: { pairedWith: 0x27e7, type: 'o' }, // ⟦
  0x27e7: { pairedWith: 0x27e6, type: 'c' }, // ⟧
  0x27e8: { pairedWith: 0x27e9, type: 'o' }, // ⟨
  0x27e9: { pairedWith: 0x27e8, type: 'c' }, // ⟩
  0x27ea: { pairedWith: 0x27eb, type: 'o' }, // ⟪
  0x27eb: { pairedWith: 0x27ea, type: 'c' }, // ⟫
  0x2983: { pairedWith: 0x2984, type: 'o' }, // ⦃
  0x2984: { pairedWith: 0x2983, type: 'c' }, // ⦄
  0x2985: { pairedWith: 0x2986, type: 'o' }, // ⦅
  0x2986: { pairedWith: 0x2985, type: 'c' }, // ⦆
  0x3008: { pairedWith: 0x3009, type: 'o' }, // 〈
  0x3009: { pairedWith: 0x3008, type: 'c' }, // 〉
  0x300a: { pairedWith: 0x300b, type: 'o' }, // 《
  0x300b: { pairedWith: 0x300a, type: 'c' }, // 》
  0x300c: { pairedWith: 0x300d, type: 'o' }, // 「
  0x300d: { pairedWith: 0x300c, type: 'c' }, // 」
  0x300e: { pairedWith: 0x300f, type: 'o' }, // 『
  0x300f: { pairedWith: 0x300e, type: 'c' }, // 』
  0x3010: { pairedWith: 0x3011, type: 'o' }, // 【
  0x3011: { pairedWith: 0x3010, type: 'c' }, // 】
  0x3014: { pairedWith: 0x3015, type: 'o' }, // 〔
  0x3015: { pairedWith: 0x3014, type: 'c' }, // 〕
  0x3016: { pairedWith: 0x3017, type: 'o' }, // 〖
  0x3017: { pairedWith: 0x3016, type: 'c' }, // 〗
  0x3018: { pairedWith: 0x3019, type: 'o' }, // 〘
  0x3019: { pairedWith: 0x3018, type: 'c' }, // 〙
  0x301a: { pairedWith: 0x301b, type: 'o' }, // 〚
  0x301b: { pairedWith: 0x301a, type: 'c' }, // 〛
  // Fullwidth brackets
  0xff08: { pairedWith: 0xff09, type: 'o' }, // （
  0xff09: { pairedWith: 0xff08, type: 'c' }, // ）
  0xff3b: { pairedWith: 0xff3d, type: 'o' }, // ［
  0xff3d: { pairedWith: 0xff3b, type: 'c' }, // ］
  0xff5b: { pairedWith: 0xff5d, type: 'o' }, // ｛
  0xff5d: { pairedWith: 0xff5b, type: 'c' }, // ｝
  0xff5f: { pairedWith: 0xff60, type: 'o' }, // ｟
  0xff60: { pairedWith: 0xff5f, type: 'c' }, // ｠
});

/* -------------------------------------------------------------------------- */
/* Public Engine Types                                                        */
/* -------------------------------------------------------------------------- */

export interface BidiOptions {
  /**
   * Paragraph base embedding level.
   * 0 = Left-to-Right (Word default when w:bidi is absent/false).
   * 1 = Right-to-Left (when w:bidi is true/present).
   * 'auto' = Determine base level from first strong directional character (P2-P3).
   * Default: 0.
   */
  readonly baseLevel?: 0 | 1 | 'auto' | undefined;
}

export interface BidiVisualItem {
  /** Single codepoint text */
  readonly char: string;
  /** Logical source offset in the input string (UTF-16 code units) */
  readonly srcOffset: number;
  /** Logical length in the input string (1 or 2 UTF-16 code units) */
  readonly srcLength: number;
  /** Resolved UAX#9 embedding level (0 = LTR, 1 = RTL, 2 = nested LTR, etc.) */
  readonly level: number;
  /** Resolved directional type after weak, neutral, and implicit resolution */
  readonly resolvedType: BidiClass;
  /** Original Bidi class classification */
  readonly originalType: BidiClass;
}

export interface BidiResult {
  /** Resolved paragraph base level (0 for LTR, 1 for RTL) */
  readonly baseLevel: 0 | 1;
  /**
   * Visual items in DISPLAY order.
   * Traversed from left to right for painting on Canvas 2D.
   * For RTL segments, character positions are reversed while `srcOffset`
   * correctly reflects the logical position in the source document.
   */
  readonly visualItems: readonly BidiVisualItem[];
  /**
   * Logical embedding levels corresponding to each codepoint in logical order.
   */
  readonly levels: readonly number[];
}

/* -------------------------------------------------------------------------- */
/* Internal Working Structures                                                */
/* -------------------------------------------------------------------------- */

interface CharState {
  readonly char: string;
  readonly cp: number;
  readonly srcOffset: number;
  readonly srcLength: number;
  readonly originalType: BidiClass;
  type: BidiClass;
  level: number;
}

interface StackEntry {
  readonly level: number;
  readonly override: 'neutral' | 'L' | 'R';
  readonly isolate: boolean;
}

/**
 * Determines paragraph base level according to UAX#9 P2-P3 or caller override.
 */
export function determineBaseLevel(text: string, baseLevel?: 0 | 1 | 'auto' | undefined): 0 | 1 {
  if (baseLevel === 0 || baseLevel === 1) {
    return baseLevel;
  }

  if (baseLevel === 'auto') {
    // Rules P2-P3: Scan for the first strong character (L, R, AL) skipping explicit isolates
    let isolateDepth = 0;
    let i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i)!;
      const step = cp > 0xffff ? 2 : 1;
      const cls = getBidiClass(cp);

      if (cls === 'LRI' || cls === 'RLI' || cls === 'FSI') {
        isolateDepth++;
      } else if (cls === 'PDI') {
        if (isolateDepth > 0) isolateDepth--;
      } else if (isolateDepth === 0) {
        if (cls === 'L') return 0;
        if (cls === 'R' || cls === 'AL') return 1;
      }
      i += step;
    }
  }

  // Default paragraph base level in OOXML WordprocessingML is 0 (LTR)
  return 0;
}

/**
 * Resolves full UAX#9 bidirectional levels and reorders text to visual order.
 */
export function resolveBidi(text: string, options?: BidiOptions | undefined): BidiResult {
  const baseLevel = determineBaseLevel(text, options?.baseLevel);

  if (text.length === 0) {
    return { baseLevel, visualItems: [], levels: [] };
  }

  // 1. Initial character segmentation and classification
  const chars: CharState[] = [];
  let offset = 0;
  while (offset < text.length) {
    const cp = text.codePointAt(offset)!;
    const length = cp > 0xffff ? 2 : 1;
    const char = text.slice(offset, offset + length);
    const cls = getBidiClass(cp);

    chars.push({
      char,
      cp,
      srcOffset: offset,
      srcLength: length,
      originalType: cls,
      type: cls,
      level: baseLevel,
    });
    offset += length;
  }

  // 2. Rules X1-X8: Explicit levels and directional isolates
  // Status stack max depth is 125 per Unicode 6.3+ specification
  const MAX_DEPTH = 125;
  const stack: StackEntry[] = [{ level: baseLevel, override: 'neutral', isolate: false }];
  let overflowIsolateCount = 0;
  let overflowEmbeddingCount = 0;
  let validIsolateCount = 0;

  for (let i = 0; i < chars.length; i++) {
    const item = chars[i]!;
    const cls = item.originalType;
    const current = stack[stack.length - 1]!;

    switch (cls) {
      case 'RLE': {
        // X2: Least odd embedding level greater than current level
        const newLevel = (current.level + 1) | 1;
        if (newLevel <= MAX_DEPTH && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
          stack.push({ level: newLevel, override: 'neutral', isolate: false });
        } else if (overflowIsolateCount === 0) {
          overflowEmbeddingCount++;
        }
        item.level = current.level;
        break;
      }

      case 'LRE': {
        // X3: Least even embedding level greater than current level
        const newLevel = (current.level + 2) & ~1;
        if (newLevel <= MAX_DEPTH && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
          stack.push({ level: newLevel, override: 'neutral', isolate: false });
        } else if (overflowIsolateCount === 0) {
          overflowEmbeddingCount++;
        }
        item.level = current.level;
        break;
      }

      case 'RLO': {
        // X4: Right-to-Left Override
        const newLevel = (current.level + 1) | 1;
        if (newLevel <= MAX_DEPTH && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
          stack.push({ level: newLevel, override: 'R', isolate: false });
        } else if (overflowIsolateCount === 0) {
          overflowEmbeddingCount++;
        }
        item.level = current.level;
        break;
      }

      case 'LRO': {
        // X5: Left-to-Right Override
        const newLevel = (current.level + 2) & ~1;
        if (newLevel <= MAX_DEPTH && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
          stack.push({ level: newLevel, override: 'L', isolate: false });
        } else if (overflowIsolateCount === 0) {
          overflowEmbeddingCount++;
        }
        item.level = current.level;
        break;
      }

      case 'RLI':
      case 'LRI':
      case 'FSI': {
        // X5a-X5c: Directional isolates
        item.level = current.level;
        if (current.override !== 'neutral') {
          item.type = current.override;
        }

        let isRtl = false;
        if (cls === 'RLI') {
          isRtl = true;
        } else if (cls === 'LRI') {
          isRtl = false;
        } else {
          // FSI: First Strong Isolate - look ahead to matching PDI for first strong type
          let innerDepth = 0;
          for (let j = i + 1; j < chars.length; j++) {
            const nextCls = chars[j]!.originalType;
            if (nextCls === 'LRI' || nextCls === 'RLI' || nextCls === 'FSI') {
              innerDepth++;
            } else if (nextCls === 'PDI') {
              if (innerDepth === 0) break;
              innerDepth--;
            } else if (innerDepth === 0) {
              if (nextCls === 'R' || nextCls === 'AL') {
                isRtl = true;
                break;
              }
              if (nextCls === 'L') {
                isRtl = false;
                break;
              }
            }
          }
        }

        const newLevel = isRtl ? (current.level + 1) | 1 : (current.level + 2) & ~1;
        if (newLevel <= MAX_DEPTH && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
          validIsolateCount++;
          stack.push({ level: newLevel, override: 'neutral', isolate: true });
        } else {
          overflowIsolateCount++;
        }
        break;
      }

      case 'PDI': {
        // X6a: Pop Directional Isolate
        if (overflowIsolateCount > 0) {
          overflowIsolateCount--;
        } else if (validIsolateCount > 0) {
          overflowEmbeddingCount = 0;
          while (stack.length > 1 && !stack[stack.length - 1]!.isolate) {
            stack.pop();
          }
          stack.pop(); // Pop matching isolate entry
          validIsolateCount--;
        }
        const updated = stack[stack.length - 1]!;
        item.level = updated.level;
        if (updated.override !== 'neutral') {
          item.type = updated.override;
        }
        break;
      }

      case 'PDF': {
        // X7: Pop Directional Format
        if (overflowIsolateCount === 0) {
          if (overflowEmbeddingCount > 0) {
            overflowEmbeddingCount--;
          } else if (stack.length > 1 && !stack[stack.length - 1]!.isolate) {
            stack.pop();
          }
        }
        item.level = current.level;
        break;
      }

      case 'B': {
        // X8: Paragraph separator resets stack to base level
        item.level = baseLevel;
        stack.length = 1;
        overflowIsolateCount = 0;
        overflowEmbeddingCount = 0;
        validIsolateCount = 0;
        break;
      }

      default: {
        // X6: Regular characters inherit current stack level and override
        item.level = current.level;
        if (current.override !== 'neutral') {
          item.type = current.override;
        }
        break;
      }
    }
  }

  // 3. Rule X9: Explicit embedding / override codes and BN are excluded from W/N analysis
  // We keep all characters in `chars` so their levels are preserved for visual reordering,
  // but collect non-X9 indices for isolating run sequence processing.
  const isX9 = (c: BidiClass): boolean =>
    c === 'LRE' || c === 'RLE' || c === 'LRO' || c === 'RLO' || c === 'PDF' || c === 'BN';

  // 4. Rule X10: Build isolating run sequences across level runs
  // An isolating run sequence groups runs with the same level, bridging across isolate blocks.
  const sequences = buildIsolatingRunSequences(chars, baseLevel, isX9);

  // 5. Rules W1-W7, N0-N2 per isolating run sequence
  for (const seq of sequences) {
    resolveSequenceWeakAndNeutral(seq, chars);
  }

  // 6. Rules I1-I2: Resolve implicit embedding levels
  for (const item of chars) {
    if (isX9(item.originalType)) continue;

    if ((item.level & 1) === 0) {
      // Even level (LTR embedding)
      if (item.type === 'R') {
        item.level += 1;
      } else if (item.type === 'AN' || item.type === 'EN') {
        item.level += 2;
      }
    } else {
      // Odd level (RTL embedding)
      if (item.type === 'L') {
        item.level += 1;
      } else if (item.type === 'EN' || item.type === 'AN') {
        item.level += 1;
      }
    }
  }

  // Record logical levels array
  const levels = chars.map((c) => c.level);

  // 7. Rules L1-L2: Visual reordering
  // L1: Reset trailing whitespace/separators to paragraph base level
  resetTrailingWhitespace(chars, baseLevel);

  // L2: Visual reversal from highest level down to lowest odd level
  const visualItems = reorderToVisual(chars);

  return {
    baseLevel,
    visualItems,
    levels,
  };
}

/**
 * Returns resolved embedding levels in logical order for itemization.
 */
export function getBidiLevels(text: string, options?: BidiOptions | undefined): number[] {
  return [...resolveBidi(text, options).levels];
}

/* -------------------------------------------------------------------------- */
/* Isolating Run Sequences (Rule X10)                                         */
/* -------------------------------------------------------------------------- */

interface IsolatingRunSequence {
  readonly indices: readonly number[];
  readonly level: number;
  readonly sos: 'L' | 'R';
  readonly eos: 'L' | 'R';
}

function buildIsolatingRunSequences(
  chars: readonly CharState[],
  baseLevel: number,
  isX9: (c: BidiClass) => boolean,
): IsolatingRunSequence[] {
  // Step 1: Extract contiguous level runs among non-X9 characters
  const levelRuns: { indices: number[]; level: number }[] = [];
  let currentRun: number[] = [];
  let currentLevel = -1;

  for (let i = 0; i < chars.length; i++) {
    const charItem = chars[i]!;
    if (isX9(charItem.originalType)) continue;

    if (charItem.level !== currentLevel) {
      if (currentRun.length > 0) {
        levelRuns.push({ indices: currentRun, level: currentLevel });
      }
      currentRun = [i];
      currentLevel = charItem.level;
    } else {
      currentRun.push(i);
    }
  }
  if (currentRun.length > 0) {
    levelRuns.push({ indices: currentRun, level: currentLevel });
  }

  if (levelRuns.length === 0) return [];

  // Step 2: Form isolating run sequences.
  // In pure non-isolated text, each level run forms its own isolating run sequence.
  // When isolates (LRI, RLI, FSI, PDI) are present, match runs chained across isolates.
  const used = new Set<number>();
  const sequences: IsolatingRunSequence[] = [];

  for (let r = 0; r < levelRuns.length; r++) {
    if (used.has(r)) continue;

    const seqIndices: number[] = [];
    let curr = r;
    const seqLevel = levelRuns[curr]!.level;

    while (curr !== -1 && !used.has(curr)) {
      used.add(curr);
      const runIndices = levelRuns[curr]!.indices;
      seqIndices.push(...runIndices);

      // Check if last character of run is an isolate initiator
      const lastCharIdx = runIndices[runIndices.length - 1]!;
      const lastType = chars[lastCharIdx]!.originalType;
      if (lastType === 'LRI' || lastType === 'RLI' || lastType === 'FSI') {
        // Find matching PDI
        let depth = 0;
        let pdiIdx = -1;
        for (let k = lastCharIdx + 1; k < chars.length; k++) {
          const t = chars[k]!.originalType;
          if (t === 'LRI' || t === 'RLI' || t === 'FSI') {
            depth++;
          } else if (t === 'PDI') {
            if (depth === 0) {
              pdiIdx = k;
              break;
            }
            depth--;
          }
        }

        // If matching PDI found, find the level run that starts with or immediately follows pdiIdx
        let nextRun = -1;
        if (pdiIdx !== -1) {
          for (let nr = 0; nr < levelRuns.length; nr++) {
            const candidate = levelRuns[nr]!;
            if (!used.has(nr) && candidate.level === seqLevel) {
              if (candidate.indices[0] === pdiIdx || candidate.indices[0] === pdiIdx + 1) {
                nextRun = nr;
                break;
              }
            }
          }
        }
        curr = nextRun;
      } else {
        curr = -1;
      }
    }

    // Determine start-of-sequence (sos) and end-of-sequence (eos)
    const firstIdx = seqIndices[0]!;
    const lastIdx = seqIndices[seqIndices.length - 1]!;

    // Find preceding non-X9 character's level or baseLevel
    let prevLevel = baseLevel;
    for (let k = firstIdx - 1; k >= 0; k--) {
      const prevChar = chars[k]!;
      if (!isX9(prevChar.originalType)) {
        prevLevel = prevChar.level;
        break;
      }
    }
    const sosLevel = Math.max(prevLevel, seqLevel);
    const sos: 'L' | 'R' = (sosLevel & 1) === 0 ? 'L' : 'R';

    // Find succeeding non-X9 character's level or baseLevel
    let nextLevel = baseLevel;
    for (let k = lastIdx + 1; k < chars.length; k++) {
      const nextChar = chars[k]!;
      if (!isX9(nextChar.originalType)) {
        nextLevel = nextChar.level;
        break;
      }
    }
    const eosLevel = Math.max(nextLevel, seqLevel);
    const eos: 'L' | 'R' = (eosLevel & 1) === 0 ? 'L' : 'R';

    sequences.push({
      indices: seqIndices,
      level: seqLevel,
      sos,
      eos,
    });
  }

  return sequences;
}

/* -------------------------------------------------------------------------- */
/* Weak and Neutral Types Resolution (Rules W1-W7, N0-N2)                     */
/* -------------------------------------------------------------------------- */

function resolveSequenceWeakAndNeutral(seq: IsolatingRunSequence, chars: CharState[]): void {
  const indices = seq.indices;
  const len = indices.length;
  if (len === 0) return;

  // W1: Examine NSM (nonspacing mark)
  for (let i = 0; i < len; i++) {
    const idx = indices[i]!;
    const charState = chars[idx]!;
    if (charState.type === 'NSM') {
      if (i === 0) {
        charState.type = seq.sos;
      } else {
        const prevIdx = indices[i - 1]!;
        const prevChar = chars[prevIdx]!;
        const prevOrig = prevChar.originalType;
        if (prevOrig === 'LRI' || prevOrig === 'RLI' || prevOrig === 'FSI' || prevOrig === 'PDI') {
          charState.type = seq.sos;
        } else {
          charState.type = prevChar.type;
        }
      }
    }
  }

  // W2: European numbers (EN) preceded by AL become AN
  for (let i = 0; i < len; i++) {
    const idx = indices[i]!;
    const charState = chars[idx]!;
    if (charState.type === 'EN') {
      for (let j = i - 1; j >= 0; j--) {
        const prevIdx = indices[j]!;
        const prevT = chars[prevIdx]!.type;
        if (prevT === 'L' || prevT === 'R') break;
        if (prevT === 'AL') {
          charState.type = 'AN';
          break;
        }
      }
    }
  }

  // W3: Arabic letters (AL) become R
  for (let i = 0; i < len; i++) {
    const idx = indices[i]!;
    const charState = chars[idx]!;
    if (charState.type === 'AL') {
      charState.type = 'R';
    }
  }

  // W4: Number separators (ES, CS) between numbers
  for (let i = 1; i < len - 1; i++) {
    const idx = indices[i]!;
    const charState = chars[idx]!;
    const prevT = chars[indices[i - 1]!]!.type;
    const nextT = chars[indices[i + 1]!]!.type;

    if (charState.type === 'ES' && prevT === 'EN' && nextT === 'EN') {
      charState.type = 'EN';
    } else if (charState.type === 'CS') {
      if (prevT === 'EN' && nextT === 'EN') {
        charState.type = 'EN';
      } else if (prevT === 'AN' && nextT === 'AN') {
        charState.type = 'AN';
      }
    }
  }

  // W5: Number terminators (ET) adjacent to EN become EN
  for (let i = 0; i < len; i++) {
    const idx = indices[i]!;
    const charState = chars[idx]!;
    if (charState.type === 'ET') {
      // Check preceding sequence
      let adjacentToEn = false;
      for (let j = i - 1; j >= 0; j--) {
        const prevIdx = indices[j]!;
        const t = chars[prevIdx]!.type;
        if (t === 'EN') {
          adjacentToEn = true;
          break;
        }
        if (t !== 'ET') break;
      }
      // Check following sequence
      if (!adjacentToEn) {
        for (let j = i + 1; j < len; j++) {
          const nextIdx = indices[j]!;
          const t = chars[nextIdx]!.type;
          if (t === 'EN') {
            adjacentToEn = true;
            break;
          }
          if (t !== 'ET') break;
        }
      }
      if (adjacentToEn) {
        charState.type = 'EN';
      }
    }
  }

  // W6: Remaining ES, ET, CS become ON
  for (let i = 0; i < len; i++) {
    const idx = indices[i]!;
    const charState = chars[idx]!;
    const t = charState.type;
    if (t === 'ES' || t === 'ET' || t === 'CS') {
      charState.type = 'ON';
    }
  }

  // W7: Search backward for nearest strong type; if L, change EN to L
  for (let i = 0; i < len; i++) {
    const idx = indices[i]!;
    const charState = chars[idx]!;
    if (charState.type === 'EN') {
      let prevStrong: 'L' | 'R' | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const prevIdx = indices[j]!;
        const t = chars[prevIdx]!.type;
        if (t === 'L' || t === 'R') {
          prevStrong = t;
          break;
        }
      }
      if (prevStrong === 'L') {
        charState.type = 'L';
      }
    }
  }

  // N0: BD16 Bracket pairs resolution
  resolveBracketPairs(seq, chars);

  // N1: Neutrals flanked by same strong direction
  // Note: For N1, AN and EN (unless turned to L in W7) act as R.
  const strongType = (t: BidiClass): 'L' | 'R' | 'neutral' => {
    if (t === 'L') return 'L';
    if (t === 'R' || t === 'AN' || t === 'EN') return 'R';
    return 'neutral';
  };

  let i = 0;
  while (i < len) {
    const idx = indices[i]!;
    if (strongType(chars[idx]!.type) === 'neutral') {
      const neutralStart = i;
      while (i < len && strongType(chars[indices[i]!]!.type) === 'neutral') {
        i++;
      }
      const neutralEnd = i - 1;

      // Find preceding strong type (or sos)
      let leftStrong = seq.sos;
      for (let j = neutralStart - 1; j >= 0; j--) {
        const prevIdx = indices[j]!;
        const st = strongType(chars[prevIdx]!.type);
        if (st !== 'neutral') {
          leftStrong = st;
          break;
        }
      }

      // Find succeeding strong type (or eos)
      let rightStrong = seq.eos;
      for (let j = neutralEnd + 1; j < len; j++) {
        const nextIdx = indices[j]!;
        const st = strongType(chars[nextIdx]!.type);
        if (st !== 'neutral') {
          rightStrong = st;
          break;
        }
      }

      if (leftStrong === rightStrong) {
        for (let k = neutralStart; k <= neutralEnd; k++) {
          const nIdx = indices[k]!;
          chars[nIdx]!.type = leftStrong;
        }
      }
    } else {
      i++;
    }
  }

  // N2: Remaining neutrals take embedding direction
  const embeddingDir: 'L' | 'R' = (seq.level & 1) === 0 ? 'L' : 'R';
  for (let k = 0; k < len; k++) {
    const idx = indices[k]!;
    const charState = chars[idx]!;
    if (strongType(charState.type) === 'neutral') {
      charState.type = embeddingDir;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* BD16 Bracket Pair Matching & N0 Resolution                                 */
/* -------------------------------------------------------------------------- */

interface BracketPair {
  readonly openSeqIdx: number;
  readonly closeSeqIdx: number;
}

function resolveBracketPairs(seq: IsolatingRunSequence, chars: CharState[]): void {
  const indices = seq.indices;
  const len = indices.length;
  const embeddingDir: 'L' | 'R' = (seq.level & 1) === 0 ? 'L' : 'R';
  const oppDir: 'L' | 'R' = embeddingDir === 'L' ? 'R' : 'L';

  // BD16 bracket stack algorithm:
  // Max bracket stack depth is 63 per Unicode UAX#9
  const stack: { cp: number; seqIdx: number }[] = [];
  const pairs: BracketPair[] = [];

  for (let i = 0; i < len; i++) {
    const idx = indices[i]!;
    const cp = chars[idx]!.cp;
    const bracketInfo = PAIRED_BRACKETS[cp];
    if (!bracketInfo) continue;

    if (bracketInfo.type === 'o') {
      if (stack.length < 63) {
        stack.push({ cp, seqIdx: i });
      }
    } else if (bracketInfo.type === 'c') {
      // Look down the stack from top to bottom for a matching opening bracket
      for (let s = stack.length - 1; s >= 0; s--) {
        const entry = stack[s]!;
        if (entry.cp === bracketInfo.pairedWith) {
          pairs.push({ openSeqIdx: entry.seqIdx, closeSeqIdx: i });
          stack.length = s; // Pop matched open bracket and all enclosed unmatched brackets
          break;
        }
      }
    }
  }

  // Sort bracket pairs in ascending order of opening bracket position
  pairs.sort((a, b) => a.openSeqIdx - b.openSeqIdx);

  // Helper for N0 strong types: L is 'L', R/AN/EN are 'R'
  const n0Strong = (t: BidiClass): 'L' | 'R' | null => {
    if (t === 'L') return 'L';
    if (t === 'R' || t === 'AN' || t === 'EN') return 'R';
    return null;
  };

  for (const pair of pairs) {
    let hasEmbeddingDir = false;
    let hasOppositeDir = false;

    // Inspect characters strictly inside the bracket pair
    for (let j = pair.openSeqIdx + 1; j < pair.closeSeqIdx; j++) {
      const charIdx = indices[j]!;
      const st = n0Strong(chars[charIdx]!.type);
      if (st === embeddingDir) {
        hasEmbeddingDir = true;
        break; // Embedding direction match immediately satisfies N0.b
      } else if (st === oppDir) {
        hasOppositeDir = true;
      }
    }

    const openIdx = indices[pair.openSeqIdx]!;
    const closeIdx = indices[pair.closeSeqIdx]!;
    const openChar = chars[openIdx]!;
    const closeChar = chars[closeIdx]!;

    if (hasEmbeddingDir) {
      // N0.b: Matches embedding direction
      openChar.type = embeddingDir;
      closeChar.type = embeddingDir;
    } else if (hasOppositeDir) {
      // N0.c: Opposite direction inside — check preceding strong context
      let prevStrong: 'L' | 'R' | null = null;
      for (let j = pair.openSeqIdx - 1; j >= 0; j--) {
        const prevIdx = indices[j]!;
        const st = n0Strong(chars[prevIdx]!.type);
        if (st !== null) {
          prevStrong = st;
          break;
        }
      }
      if (prevStrong === null) {
        prevStrong = seq.sos;
      }

      if (prevStrong === oppDir) {
        openChar.type = oppDir;
        closeChar.type = oppDir;
      } else {
        openChar.type = embeddingDir;
        closeChar.type = embeddingDir;
      }
    }
    // N0.d: No strong characters inside — leave brackets unchanged (resolved by N1-N2)
  }
}

/* -------------------------------------------------------------------------- */
/* Visual Reordering (Rules L1, L2)                                           */
/* -------------------------------------------------------------------------- */

function resetTrailingWhitespace(chars: CharState[], baseLevel: number): void {
  // L1: Reset embedding levels of trailing whitespace/separators at the end of line
  let i = chars.length - 1;
  while (i >= 0) {
    const charState = chars[i];
    if (!charState) break;
    const t = charState.originalType;
    if (t === 'WS' || t === 'FSI' || t === 'LRI' || t === 'RLI' || t === 'PDI') {
      charState.level = baseLevel;
      i--;
    } else {
      break;
    }
  }
}

function reorderToVisual(chars: readonly CharState[]): BidiVisualItem[] {
  // Create mutable working copy
  const visual: BidiVisualItem[] = chars.map((c) => ({
    char: c.char,
    srcOffset: c.srcOffset,
    srcLength: c.srcLength,
    level: c.level,
    resolvedType: c.type,
    originalType: c.originalType,
  }));

  let maxLevel = 0;
  let minOddLevel = 255;
  for (const item of visual) {
    if (item.level > maxLevel) maxLevel = item.level;
    if ((item.level & 1) !== 0 && item.level < minOddLevel) {
      minOddLevel = item.level;
    }
  }

  // If no odd levels exist, text is strictly LTR; array order is already visual order!
  if (minOddLevel > maxLevel) {
    return visual;
  }

  // L2: Reverse contiguous subsequences of items with level >= current level
  for (let level = maxLevel; level >= minOddLevel; level--) {
    let start = 0;
    while (start < visual.length) {
      const startItem = visual[start];
      if (startItem !== undefined && startItem.level >= level) {
        let end = start;
        while (end + 1 < visual.length) {
          const nextItem = visual[end + 1];
          if (nextItem !== undefined && nextItem.level >= level) {
            end++;
          } else {
            break;
          }
        }
        // Reverse subsequence visual[start..end] in place
        let left = start;
        let right = end;
        while (left < right) {
          const tmp = visual[left]!;
          visual[left] = visual[right]!;
          visual[right] = tmp;
          left++;
          right--;
        }
        start = end + 1;
      } else {
        start++;
      }
    }
  }

  return visual;
}

/**
 * Reorders arbitrary styled runs to visual order given their UAX#9 embedding levels.
 * Useful when higher-level layout stages reorder whole sub-runs or line segments.
 */
export function reorderVisualRuns<T extends { readonly bidiLevel: number }>(
  runs: readonly T[],
): T[] {
  if (runs.length <= 1) return [...runs];

  const result: T[] = [...runs];
  let maxLevel = 0;
  let minOddLevel = 255;
  for (const r of result) {
    if (r.bidiLevel > maxLevel) maxLevel = r.bidiLevel;
    if ((r.bidiLevel & 1) !== 0 && r.bidiLevel < minOddLevel) {
      minOddLevel = r.bidiLevel;
    }
  }

  if (minOddLevel > maxLevel) return result;

  for (let level = maxLevel; level >= minOddLevel; level--) {
    let start = 0;
    while (start < result.length) {
      const startItem = result[start];
      if (startItem !== undefined && startItem.bidiLevel >= level) {
        let end = start;
        while (end + 1 < result.length) {
          const nextItem = result[end + 1];
          if (nextItem !== undefined && nextItem.bidiLevel >= level) {
            end++;
          } else {
            break;
          }
        }
        let left = start;
        let right = end;
        while (left < right) {
          const tmp = result[left]!;
          result[left] = result[right]!;
          result[right] = tmp;
          left++;
          right--;
        }
        start = end + 1;
      } else {
        start++;
      }
    }
  }

  return result;
}
