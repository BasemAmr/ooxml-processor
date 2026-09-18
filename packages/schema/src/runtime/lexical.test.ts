import { describe, expect, it } from 'vitest';
import {
  formatList,
  formatNumber,
  formatXsdBoolean,
  parseDecimal,
  parseDouble,
  parseInteger,
  parseList,
  parseXsdBoolean,
} from './lexical.js';

describe('lexical format(parse(x)) fixpoints', () => {
  it.each([
    ['integer', parseInteger, formatNumber, ['0', '-7', '42']],
    ['decimal', parseDecimal, formatNumber, ['0', '-7.5', '42.25']],
    ['double', parseDouble, formatNumber, ['0', '-7.5', '1e3', 'INF', '-INF', 'NaN']],
  ])('%s is idempotent after canonicalization', (_name, parse, format, values) => {
    for (const lexical of values) {
      const value = parse(lexical);
      expect(value).not.toBeUndefined();
      const once = format(value!);
      expect(format(parse(once)!)).toBe(once);
    }
  });

  it('formats booleans and lists through their parsers', () => {
    for (const lexical of ['true', 'false', '1', '0']) {
      const value = parseXsdBoolean(lexical);
      expect(value).not.toBeUndefined();
      expect(formatXsdBoolean(parseXsdBoolean(formatXsdBoolean(value!))!)).toBe(
        formatXsdBoolean(value!),
      );
    }
    const values = parseList('  1\t2  3 ', parseInteger);
    expect(values).toEqual([1, 2, 3]);
    expect(parseList(formatList(values!, formatNumber), parseInteger)).toEqual(values);
  });
});
