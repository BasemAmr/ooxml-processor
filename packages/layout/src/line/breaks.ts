/**
 * Line break opportunity resolution (P5-04)
 * Implementing UAX#14 basic categories and JLREQ kinsoku rules.
 */

export interface BreakOptions {
  /** Apply Kinsoku rules for Japanese/CJK (default: true) */
  kinsoku?: boolean;
  /** Allow punctuation to overflow the line (default: false) */
  overflowPunct?: boolean;
  /** Word wrap. If false/'0', allows break anywhere even mid-word (default: true) */
  wordWrap?: boolean;
}

// UAX#14 / Kinsoku classification sets
const CLOSING_BRACKETS = new Set([')', ']', '}', '）', '〕', '】', '」', '』']);
const OPENING_BRACKETS = new Set(['(', '[', '{', '（', '〔', '【', '「', '『']);
const PUNCTUATION = new Set(['、', '。', '，', '．', '？', '！', ',', '.', '?', '!']);
const SMALL_KANA = new Set([
  'ぁ',
  'ぃ',
  'ぅ',
  'ぇ',
  'ぉ',
  'っ',
  'ゃ',
  'ゅ',
  'ょ',
  'ゎ',
  'ァ',
  'ィ',
  'ゥ',
  'ェ',
  'ォ',
  'ッ',
  'ャ',
  'ュ',
  'ョ',
  'ヮ',
  'ヵ',
  'ヶ',
]);

function isAlphaNumeric(code: number): boolean {
  // ASCII Alphanumeric
  if (code >= 0x0030 && code <= 0x0039) return true; // 0-9
  if (code >= 0x0041 && code <= 0x005a) return true; // A-Z
  if (code >= 0x0061 && code <= 0x007a) return true; // a-z
  // Ext Latin
  if (code >= 0x00c0 && code <= 0x024f) return true;
  return false;
}

function isIdeographic(code: number): boolean {
  // CJK Unified Ideographs, Hiragana, Katakana
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  if (code >= 0x3040 && code <= 0x309f) return true;
  if (code >= 0x30a0 && code <= 0x30ff) return true;
  return false;
}

/**
 * Returns a Uint8Array of length text.length.
 * Array[i] === 1 means there is a valid break opportunity AFTER text[i].
 *
 * @param text The text to find break opportunities in.
 * @param options Break rules configuration.
 * @returns Uint8Array mapping to codepoint indices where 1 indicates a break opportunity.
 */
export function findBreakOpportunities(text: string, options: BreakOptions = {}): Uint8Array {
  const kinsoku = options.kinsoku !== false;
  const wordWrap = options.wordWrap !== false;

  const len = text.length;
  const breaks = new Uint8Array(len);

  if (len === 0) return breaks;

  // We loop and determine if we can break between i and i+1.
  for (let i = 0; i < len - 1; i++) {
    const char = text[i]!;
    const nextChar = text[i + 1]!;
    const code = char.charCodeAt(0);
    const nextCode = nextChar.charCodeAt(0);

    // Mandatory breaks
    if (char === '\n' || char === '\r') {
      breaks[i] = 1;
      continue;
    }
    // Prevent breaking after NBSP or WJ
    if (char === '\u00A0' || char === '\u2060' || char === '\u2011') {
      breaks[i] = 0;
      continue;
    }

    if (!wordWrap) {
      // wordWrap=false allows breaking anywhere mid-word (Latin and CJK alike)
      // but kinsoku might still apply if enabled. We evaluate kinsoku first.
      let canBreak = true;
      if (kinsoku) {
        if (OPENING_BRACKETS.has(char)) canBreak = false; // Never end line
        if (CLOSING_BRACKETS.has(nextChar)) canBreak = false; // Never begin line
        if (PUNCTUATION.has(nextChar)) canBreak = false;
        if (SMALL_KANA.has(nextChar)) canBreak = false;
      }
      breaks[i] = canBreak ? 1 : 0;
      continue;
    }

    // Default UAX#14-ish logic for Word Wrap
    let canBreak = false;

    // Space creates a break opportunity after it (except before another space)
    if (char === ' ' || char === '\t') {
      canBreak = true;
    } else if (char === '\u00AD') {
      // Soft hyphen
      canBreak = true;
    } else if (char === '-') {
      // regular hyphen
      canBreak = true;
    } else {
      // Between Ideographs (CJK) there is usually a break opportunity
      const isCjk = isIdeographic(code);
      const nextIsCjk = isIdeographic(nextCode);

      if (isCjk || nextIsCjk) {
        canBreak = true;
      }

      // Prevent breaking between alphanumerics
      if (isAlphaNumeric(code) && isAlphaNumeric(nextCode)) {
        canBreak = false;
      }
    }

    // Kinsoku restrictions (override previous decisions)
    if (kinsoku) {
      if (OPENING_BRACKETS.has(char)) {
        // Never end line with an opening bracket
        canBreak = false;
      }
      if (CLOSING_BRACKETS.has(nextChar) || PUNCTUATION.has(nextChar) || SMALL_KANA.has(nextChar)) {
        // Never begin line with closing bracket, punctuation, or small kana
        canBreak = false;
      }
    }

    breaks[i] = canBreak ? 1 : 0;
  }

  // The very last character has a break opportunity after it by definition,
  // unless we're handling paragraphs specially elsewhere, but we mark it 1.
  if (len > 0) {
    breaks[len - 1] = 1;
  }

  return breaks;
}
