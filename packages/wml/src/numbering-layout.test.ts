import { describe, expect, it } from 'vitest';
import { foldNumbering, formatNumber, normalizeBulletCodePoint } from './numbering-layout.js';

describe('phase 10 numbering display', () => {
  it('covers the unusual format arms and Word letter repetition', () => {
    expect(formatNumber(27, 'upperLetter')).toBe('AA');
    expect(formatNumber(2, 'none')).toBe('');
    expect(formatNumber(2, 'japaneseCounting')).toBe('二');
    expect(formatNumber(7, 'thaiNumbers')).toBe('๗');
  });
  it('consumes startOverride once and checkpoints the fold', () => {
    const result = foldNumbering(
      [
        { id: 'a', numId: 1, ilvl: 0, level: { start: 1, startOverride: 4, lvlText: '%1.' } },
        { id: 'b', numId: 1, ilvl: 0, level: { start: 1, startOverride: 4, lvlText: '%1.' } },
      ],
      { checkpointEvery: 1 },
    );
    expect(result.labels.get('a')).toBe('4.');
    expect(result.labels.get('b')).toBe('5.');
    expect(result.checkpoints.size).toBe(2);
  });
  it('normalizes private-use symbol and wingdings bullets only for symbol fonts', () => {
    expect(normalizeBulletCodePoint(0xf0b7, 'Symbol')).toBe(0xb7);
    expect(normalizeBulletCodePoint(0xf0b7, 'Arial')).toBe(0xf0b7);
  });
});
