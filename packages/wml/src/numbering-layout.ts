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
}
export interface NumberingParagraphLike {
  readonly id: string;
  readonly numId?: number;
  readonly ilvl?: number;
  readonly level?: NumberingLevelLike;
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
function alpha(value: number, upper: boolean): string {
  if (value <= 0) return '';
  const glyph = String.fromCharCode(((value - 1) % 26) + 65);
  return upper ? glyph : glyph.toLowerCase();
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
    labels = new Map<string, string>(),
    checkpoints = new Map<number, ReadonlyMap<number, readonly number[]>>();
  const every = Math.max(1, options.checkpointEvery ?? 64);
  let scanned = 0;
  for (const p of paragraphs) {
    if (p.numId === undefined || p.level === undefined || p.level.tentative) continue;
    const level = Math.max(0, Math.min(8, p.ilvl ?? 0));
    const state = states.get(p.numId) ?? Array.from({ length: 9 }, () => 0);
    const current = state[level] ?? 0;
    state[level] = current === 0 ? (p.level.start ?? 1) : current + 1;
    for (let i = level + 1; i < 9; i++) state[i] = 0;
    states.set(p.numId, state);
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
