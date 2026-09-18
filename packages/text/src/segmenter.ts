/**
 * Grapheme cluster and word segmentation wrapping Intl.Segmenter (P4-08).
 *
 * ARCHITECTURAL BOUNDARY (P4-08 vs P5-04):
 * `Intl.Segmenter` is used strictly for:
 *   1. Grapheme cluster segmentation (feeding caret movement, selection, and backspace in P6-07).
 *      Guarantees that complex clusters such as emoji Zero-Width-Joiner (ZWJ) sequences
 *      (e.g., 👨‍👩‍👧‍👦), skin tone modifiers, and Indic conjuncts (e.g., Devanagari क्ष)
 *      remain unbroken as atomic visual units.
 *   2. Word boundary segmentation (feeding word selection, double-click, and Ctrl+arrow in P6-07).
 *
 * CRITICAL CONSTRAINT — NOT FOR LINE BREAKING:
 * `Intl.Segmenter` does NOT implement UAX#14 Line Breaking Algorithm or ECMA-376 Part 1
 * §17.3.1.18 line-break rules. Line breaking opportunities for OOXML pagination are handled
 * separately in Phase 5 (`P5-04`). Assuming `Intl.Segmenter` with `granularity: 'line'` covers
 * Word document line breaking would break kinsoku rules (forbidden characters at start/end of line),
 * hyphenation, and table pagination.
 *
 * Locale Handling:
 * Word segmentation for Thai, Lao, Khmer, and Japanese is dictionary-based and locale-dependent.
 * Callers MUST pass the document's `w:lang` (e.g., 'th-TH', 'ja-JP', 'en-US', 'ar-SA'),
 * NOT the ambient browser/OS locale.
 */

export interface GraphemeSegment {
  /** The indivisible grapheme cluster text slice */
  readonly text: string;
  /** 0-based UTF-16 code unit offset in the source string */
  readonly index: number;
  /** Length in UTF-16 code units */
  readonly length: number;
}

export interface WordSegment {
  /** The word, punctuation, or whitespace text slice */
  readonly text: string;
  /** 0-based UTF-16 code unit offset in the source string */
  readonly index: number;
  /** Length in UTF-16 code units */
  readonly length: number;
  /**
   * Whether the segment represents a word-like unit (letters/numbers/ideographs)
   * as opposed to punctuation or whitespace.
   */
  readonly isWordLike: boolean;
}

/**
 * Cache of Intl.Segmenter instances keyed by `${granularity}:${locale}`
 * to avoid expensive per-call instantiation during typing and rendering.
 */
const segmenterCache = new Map<string, Intl.Segmenter>();

function getSegmenter(granularity: 'grapheme' | 'word', lang?: string): Intl.Segmenter {
  const normLocale = lang && lang.trim() !== '' ? lang.trim() : 'en-US';
  const cacheKey = `${granularity}:${normLocale}`;

  let segmenter = segmenterCache.get(cacheKey);
  if (segmenter !== undefined) {
    return segmenter;
  }

  try {
    segmenter = new Intl.Segmenter(normLocale, { granularity });
  } catch {
    // If the specific locale tag is invalid or unsupported, fallback to 'en-US'
    try {
      segmenter = new Intl.Segmenter('en-US', { granularity });
    } catch {
      // Defensive fallback for non-conforming hosts
      segmenter = new Intl.Segmenter(undefined, { granularity });
    }
  }

  segmenterCache.set(cacheKey, segmenter);
  return segmenter;
}

/**
 * Segments text into indivisible grapheme clusters respecting the document's language tag.
 *
 * @param text The input string to segment.
 * @param lang ISO/BCP-47 language tag from w:lang (e.g. 'en-US', 'ar-SA', 'th-TH', 'ja-JP').
 */
export function segmentGraphemes(text: string, lang?: string): GraphemeSegment[] {
  if (text.length === 0) return [];

  const segmenter = getSegmenter('grapheme', lang);
  const segments = segmenter.segment(text);
  const result: GraphemeSegment[] = [];

  for (const seg of segments) {
    result.push({
      text: seg.segment,
      index: seg.index,
      length: seg.segment.length,
    });
  }

  return result;
}

/**
 * Segments text into words (including non-word whitespace/punctuation tokens)
 * respecting the document's language tag.
 *
 * @param text The input string to segment.
 * @param lang ISO/BCP-47 language tag from w:lang.
 */
export function segmentWords(text: string, lang?: string): WordSegment[] {
  if (text.length === 0) return [];

  const segmenter = getSegmenter('word', lang);
  const segments = segmenter.segment(text);
  const result: WordSegment[] = [];

  for (const seg of segments) {
    result.push({
      text: seg.segment,
      index: seg.index,
      length: seg.segment.length,
      isWordLike: seg.isWordLike ?? false,
    });
  }

  return result;
}

/**
 * Calculates the next grapheme cluster boundary offset after the given cursor position.
 * Returns text.length if offset is at or beyond the end.
 */
export function nextGraphemeBreak(text: string, offset: number, lang?: string): number {
  if (offset >= text.length) return text.length;
  if (offset < 0) offset = 0;

  const segments = segmentGraphemes(text, lang);
  for (const seg of segments) {
    const end = seg.index + seg.length;
    if (end > offset) {
      return end;
    }
  }
  return text.length;
}

/**
 * Calculates the previous grapheme cluster boundary offset before the given cursor position.
 * Returns 0 if offset is at or before 0.
 */
export function prevGraphemeBreak(text: string, offset: number, lang?: string): number {
  if (offset <= 0) return 0;
  if (offset > text.length) offset = text.length;

  const segments = segmentGraphemes(text, lang);
  let prevBreak = 0;
  for (const seg of segments) {
    if (seg.index >= offset) {
      return prevBreak;
    }
    prevBreak = seg.index;
  }
  return prevBreak;
}

/**
 * Finds the word segment containing or immediately adjacent to the given offset.
 */
export function findWordAt(text: string, offset: number, lang?: string): WordSegment | undefined {
  if (text.length === 0) return undefined;
  const words = segmentWords(text, lang);
  if (words.length === 0) return undefined;

  // Clamped offset
  const clampedOffset = Math.max(0, Math.min(offset, text.length));

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const end = word.index + word.length;
    // For character offsets inside the string, use half-open interval [index, end).
    // If the offset is exactly at the end of the text, match the last segment.
    if (
      (clampedOffset >= word.index && clampedOffset < end) ||
      (clampedOffset === text.length && i === words.length - 1)
    ) {
      return word;
    }
  }

  return words[words.length - 1];
}
