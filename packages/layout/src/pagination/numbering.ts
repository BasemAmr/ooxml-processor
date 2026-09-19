export type PageNumberFormat =
  'decimal' | 'upperRoman' | 'lowerRoman' | 'upperLetter' | 'lowerLetter';

function roman(value: number): string {
  const pairs: readonly [number, string][] = [
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
  let n = Math.max(1, Math.floor(value));
  let output = '';
  for (const [unit, glyph] of pairs)
    while (n >= unit) {
      output += glyph;
      n -= unit;
    }
  return output;
}

export function formatPageNumber(value: number, format: PageNumberFormat = 'decimal'): string {
  if (format === 'upperRoman') return roman(value);
  if (format === 'lowerRoman') return roman(value).toLowerCase();
  if (format === 'upperLetter' || format === 'lowerLetter') {
    let n = Math.max(1, Math.floor(value));
    let out = '';
    while (n > 0) {
      n -= 1;
      out = String.fromCharCode(65 + (n % 26)) + out;
      n = Math.floor(n / 26);
    }
    return format === 'lowerLetter' ? out.toLowerCase() : out;
  }
  return String(value);
}

export function pageNumberFor(
  pageInSection: number,
  start = 1,
  format: PageNumberFormat = 'decimal',
  chapter?: number,
  separator = '-',
): string {
  const value = formatPageNumber(start + pageInSection - 1, format);
  return chapter === undefined ? value : `${chapter}${separator}${value}`;
}
