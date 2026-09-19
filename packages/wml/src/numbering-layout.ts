/** Phase 10 numbering display and the document-order counter fold. */
export interface NumberingDiagnostic {
  readonly code: string;
  readonly message: string;
}
export interface NumberingLevelLike {
  readonly start?: number;
  readonly numFmt?: string;
  readonly lvlText?: string;
  readonly lvlRestart?: number;
  readonly isLgl?: boolean;
  readonly tentative?: boolean;
  /** Optional per-numbering-instance override; consumed on first use only. */
  readonly startOverride?: number;
  /** Custom picture supplied by CT_NumFmt/@w:format. */
  readonly customFormat?: string;
}
export interface NumberingParagraphLike {
  readonly id: string;
  readonly numId?: number;
  readonly ilvl?: number;
  readonly level?: NumberingLevelLike;
  /** Optional complete level table for correct per-level restart semantics. */
  readonly levels?: ReadonlyMap<number, NumberingLevelLike>;
}
export interface NumberingFoldOptions {
  readonly checkpointEvery?: number;
  readonly diagnostics?: NumberingDiagnostic[];
}
export interface NumberingFoldResult {
  readonly labels: ReadonlyMap<string, string>;
  readonly checkpoints: ReadonlyMap<number, ReadonlyMap<number, readonly number[]>>;
  readonly scanned: number;
}
const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
function roman(value: number): string {
  let n = Math.min(Math.trunc(value), 3999);
  let out = '';
  for (const [unit, glyph] of ROMAN)
    while (n >= unit) {
      out += glyph;
      n -= unit;
    }
  return out;
}
const UNVERIFIED_FORMATS = new Set([
  'ideographDigital',
  'japaneseCounting',
  'aiueo',
  'iroha',
  'japaneseLegal',
  'japaneseDigitalTenThousand',
  'ganada',
  'chosung',
  'decimalEnclosedCircleChinese',
  'ideographEnclosedCircle',
  'ideographTraditional',
  'ideographZodiac',
  'ideographZodiacTraditional',
  'taiwaneseCounting',
  'ideographLegalTraditional',
  'taiwaneseCountingThousand',
  'taiwaneseDigital',
  'chineseCounting',
  'chineseLegalSimplified',
  'chineseCountingThousand',
  'koreanDigital',
  'koreanCounting',
  'koreanLegal',
  'koreanDigital2',
  'vietnameseCounting',
  'hebrew1',
  'hebrew2',
  'arabicAlpha',
  'arabicAbjad',
  'hindiVowels',
  'hindiConsonants',
  'hindiNumbers',
  'hindiCounting',
  'thaiLetters',
  'thaiNumbers',
  'thaiCounting',
  'bahtText',
  'dollarText',
]);
function alpha(value: number, upper: boolean): string {
  if (value <= 0) return '';
  const glyph = String.fromCharCode(((value - 1) % 26) + 65);
  const repeat = Math.floor((value - 1) / 26) + 1;
  const text = glyph.repeat(repeat);
  return upper ? text : text.toLowerCase();
}

const CJK_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const JAPANESE_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const GREEK_LIKE = [
  'α',
  'β',
  'γ',
  'δ',
  'ε',
  'ζ',
  'η',
  'θ',
  'ι',
  'κ',
  'λ',
  'μ',
  'ν',
  'ξ',
  'ο',
  'π',
  'ρ',
  'σ',
  'τ',
  'υ',
  'φ',
  'χ',
  'ψ',
  'ω',
];
const HINDI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
function translateDigits(value: number, digits: readonly string[]): string {
  return String(value).replace(/[0-9]/g, (d) => digits[Number(d)] ?? d);
}
function cjk(value: number): string {
  if (value < 10) return CJK_DIGITS[value] ?? String(value);
  if (value < 20) return `十${value === 10 ? '' : CJK_DIGITS[value - 10]}`;
  if (value < 100)
    return `${CJK_DIGITS[Math.floor(value / 10)]}十${value % 10 ? CJK_DIGITS[value % 10] : ''}`;
  return translateDigits(value, CJK_DIGITS);
}
function hebrew(value: number): string {
  // UNVERIFIABLE-HERE: Hebrew numbering follows gematria with special 15/16 forms.
  const units = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  if (value < 10) return units[value] ?? String(value);
  return translateDigits(value, units);
}
function cardinal(value: number): string {
  const ones = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ];
  if (value < 20) return ones[value] ?? String(value);
  if (value < 100) {
    const ten = tens[Math.floor(value / 10)] ?? String(value);
    const one = ones[value % 10] ?? '';
    return `${ten}${value % 10 ? `-${one}` : ''}`;
  }
  return String(value);
}
export function formatNumber(
  value: number,
  format = 'decimal',
  custom?: string,
  diagnostics?: NumberingDiagnostic[],
): string {
  const n = Math.max(0, Math.trunc(value));
  if (UNVERIFIED_FORMATS.has(format)) {
    diagnostics?.push({
      code: 'unverified-number-format',
      message: `Number format ${format} is UNVERIFIABLE-HERE; published-table approximation used`,
    });
  }
  switch (format) {
    case 'none':
    case 'bullet':
      return '';
    case 'upperRoman':
      return roman(n);
    case 'lowerRoman':
      return roman(n).toLowerCase();
    case 'upperLetter':
      return alpha(n, true);
    case 'lowerLetter':
      return alpha(n, false);
    case 'decimalZero':
      return String(n).padStart(2, '0');
    case 'hex':
      return n.toString(16).toUpperCase();
    case 'decimalEnclosedCircle':
      return n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n) : String(n);
    case 'decimalEnclosedFullstop':
      return `${n}.`;
    case 'decimalEnclosedParen':
      return `(${n})`;
    case 'ordinal': {
      const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
      return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : suffix}`;
    }
    case 'cardinalText':
      return cardinal(n);
    case 'ordinalText':
      return `${cardinal(n)}th`;
    case 'chicago':
      return String(n);
    case 'numberInDash':
      return `-${n}-`;
    case 'decimalFullWidth':
    case 'decimalFullWidth2':
      return translateDigits(n, ['０', '１', '２', '３', '４', '５', '６', '７', '８', '９']);
    case 'decimalHalfWidth':
      return String(n);
    case 'japaneseCounting':
    case 'japaneseLegal':
    case 'japaneseDigitalTenThousand':
      return n < 10000 ? cjk(n).replace(/零/g, '〇') : translateDigits(n, JAPANESE_DIGITS);
    case 'chineseCounting':
    case 'chineseLegalSimplified':
    case 'chineseCountingThousand':
    case 'taiwaneseCounting':
    case 'taiwaneseCountingThousand':
    case 'ideographTraditional':
    case 'ideographLegalTraditional':
      return cjk(n);
    case 'taiwaneseDigital':
    case 'ideographDigital':
      return translateDigits(n, CJK_DIGITS);
    case 'ideographZodiac':
    case 'ideographZodiacTraditional':
      return (
        ['鼠', '牛', '虎', '兔', '龍', '蛇', '馬', '羊', '猴', '雞', '狗', '豬'][
          Math.max(0, n - 1) % 12
        ] ?? String(n)
      );
    case 'aiueo':
    case 'aiueoFullWidth':
      return (
        ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ'][Math.max(0, n - 1) % 10] ??
        String(n)
      );
    case 'iroha':
    case 'irohaFullWidth':
      return (
        ['い', 'ろ', 'は', 'に', 'ほ', 'へ', 'と', 'ち', 'り', 'ぬ'][Math.max(0, n - 1) % 10] ??
        String(n)
      );
    case 'decimalEnclosedCircleChinese':
    case 'ideographEnclosedCircle':
      return n >= 1 && n <= 10
        ? (['㊀', '㊁', '㊂', '㊃', '㊄', '㊅', '㊆', '㊇', '㊈', '㊉'][n - 1] ?? String(n))
        : String(n);
    case 'ganada':
    case 'chosung':
      return GREEK_LIKE[Math.max(0, n - 1) % GREEK_LIKE.length] ?? String(n);
    case 'koreanDigital':
    case 'koreanDigital2':
    case 'koreanCounting':
    case 'koreanLegal':
      return translateDigits(n, ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']);
    case 'russianLower':
    case 'russianUpper':
      return alpha(n, format === 'russianUpper');
    case 'vietnameseCounting':
      return translateDigits(n, [
        'không',
        'một',
        'hai',
        'ba',
        'bốn',
        'năm',
        'sáu',
        'bảy',
        'tám',
        'chín',
      ]);
    case 'hebrew1':
    case 'hebrew2':
      return hebrew(n);
    case 'arabicAlpha':
    case 'arabicAbjad':
      return translateDigits(n, ['ا', 'ب', 'ج', 'د', 'ه', 'و', 'ز', 'ح', 'ط', 'ي']);
    case 'hindiVowels':
    case 'hindiConsonants':
    case 'hindiNumbers':
    case 'hindiCounting':
      return translateDigits(n, HINDI_DIGITS);
    case 'thaiLetters':
      return (
        ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ', 'ช', 'ซ', 'ฌ', 'ญ'][Math.max(0, n - 1) % 10] ?? String(n)
      );
    case 'thaiNumbers':
    case 'thaiCounting':
      return translateDigits(n, THAI_DIGITS);
    case 'bahtText':
    case 'dollarText':
      return `${cardinal(n)} ${format === 'bahtText' ? 'baht' : 'dollars'}`;
    case 'custom':
      diagnostics?.push({
        code: 'custom-number-format',
        message: `Unsupported custom numbering format${custom ? `: ${custom}` : ''}; decimal used`,
      });
      return String(n);
    default:
      if (format !== 'decimal')
        diagnostics?.push({
          code: 'unverified-number-format',
          message: `Number format ${format} is unverified; decimal used`,
        });
      return String(n);
  }
}
export function renderLevelText(
  template: string,
  counters: readonly number[],
  level: NumberingLevelLike,
): string {
  return template.replace(/%([1-9])/g, (_m, d: string) =>
    formatNumber(counters[Number(d) - 1] ?? 0, level.isLgl ? 'decimal' : level.numFmt),
  );
}
export function foldNumbering(
  paragraphs: readonly NumberingParagraphLike[],
  options: NumberingFoldOptions = {},
): NumberingFoldResult {
  const states = new Map<number, number[]>(),
    seenLevels = new Map<number, Set<number>>(),
    labels = new Map<string, string>(),
    checkpoints = new Map<number, ReadonlyMap<number, readonly number[]>>();
  const every = Math.max(1, options.checkpointEvery ?? 64);
  let scanned = 0;
  for (const p of paragraphs) {
    if (p.numId === undefined || p.level === undefined || p.level.tentative) continue;
    const level = Math.max(0, Math.min(8, p.ilvl ?? 0));
    const state = states.get(p.numId) ?? Array.from({ length: 9 }, () => 0);
    const seen = seenLevels.get(p.numId) ?? new Set<number>();
    const current = state[level] ?? 0;
    // startOverride is a one-shot value. Subsequent restarts use CT_Lvl/w:start.
    state[level] = seen.has(level) ? current + 1 : (p.level.startOverride ?? p.level.start ?? 1);
    seen.add(level);
    // Absent lvlRestart means restart on any higher-level advance; zero means never.
    for (let i = level + 1; i < 9; i++) {
      const restart = p.levels?.get(i)?.lvlRestart ?? p.level.lvlRestart;
      if (restart === 0) continue;
      if (restart === undefined || restart <= level + 1) state[i] = 0;
    }
    states.set(p.numId, state);
    seenLevels.set(p.numId, seen);
    labels.set(p.id, renderLevelText(p.level.lvlText ?? `%${level + 1}.`, state, p.level));
    scanned++;
    if (scanned % every === 0)
      checkpoints.set(scanned, new Map([...states].map(([id, v]) => [id, [...v]])));
  }
  return { labels, checkpoints, scanned };
}
export function normalizeBulletCodePoint(codePoint: number, fontFamily?: string): number {
  return fontFamily?.toLowerCase().includes('symbol') ||
    fontFamily?.toLowerCase().includes('wingdings')
    ? codePoint >= 0xf000 && codePoint <= 0xf0ff
      ? codePoint - 0xf000
      : codePoint
    : codePoint;
}
