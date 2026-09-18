import { describe, it, expect } from 'vitest';
import type { FontScheme } from '@ooxml/wml';
import { fontForChar } from './rfonts.js';
import { getFontSlotForCodepoint, getFontSlotForChar } from './script.js';

describe('P4-01 & P4-02: Script Classification and rFonts Resolution', () => {
  // Test theme scheme with distinct font faces per collection
  const mockThemeFontScheme: FontScheme = {
    name: 'Test Office Theme',
    major: {
      latin: 'Aptos Display',
      ea: 'Microsoft YaHei',
      cs: 'Calibri',
      fonts: new Map([
        ['Arab', 'Traditional Arabic'],
        ['Jpan', 'Yu Mincho'],
      ]),
    },
    minor: {
      latin: 'Aptos',
      ea: 'SimSun',
      cs: 'Courier New',
      fonts: new Map([
        ['Arab', 'Simplified Arabic'],
        ['Jpan', 'Yu Gothic'],
      ]),
    },
  };

  describe('Slot selection (script.ts)', () => {
    it('classifies ASCII characters to ascii slot', () => {
      expect(getFontSlotForChar('A')).toBe('ascii');
      expect(getFontSlotForChar('z')).toBe('ascii');
      expect(getFontSlotForChar('0')).toBe('ascii');
      expect(getFontSlotForChar(' ')).toBe('ascii');
    });

    it('classifies Latin Extended and European characters to hAnsi slot', () => {
      expect(getFontSlotForChar('é')).toBe('hAnsi');
      expect(getFontSlotForChar('ñ')).toBe('hAnsi');
      expect(getFontSlotForChar('α')).toBe('hAnsi'); // Greek
      expect(getFontSlotForChar('я')).toBe('hAnsi'); // Cyrillic
    });

    it('classifies CJK and Kana to eastAsia slot', () => {
      expect(getFontSlotForChar('中')).toBe('eastAsia'); // Chinese
      expect(getFontSlotForChar('あ')).toBe('eastAsia'); // Hiragana
      expect(getFontSlotForChar('ア')).toBe('eastAsia'); // Katakana
      expect(getFontSlotForChar('한')).toBe('eastAsia'); // Hangul
      expect(getFontSlotForChar('、')).toBe('eastAsia'); // Ideographic comma
    });

    it('classifies Arabic, Hebrew, and Indic to cs slot', () => {
      expect(getFontSlotForChar('م')).toBe('cs'); // Arabic
      expect(getFontSlotForChar('ש')).toBe('cs'); // Hebrew
      expect(getFontSlotForChar('क')).toBe('cs'); // Devanagari
      expect(getFontSlotForChar('ก')).toBe('cs'); // Thai
    });

    it('classifies ambiguous codepoints according to w:hint', () => {
      const emDash = '—'; // U+2014 General Punctuation
      const ellipsis = '…'; // U+2026

      // Default hint -> maps to hAnsi (or ascii if <= 0x7F)
      expect(getFontSlotForChar(emDash, 'default')).toBe('hAnsi');
      expect(getFontSlotForChar(ellipsis, 'default')).toBe('hAnsi');

      // EastAsia hint -> maps to eastAsia
      expect(getFontSlotForChar(emDash, 'eastAsia')).toBe('eastAsia');
      expect(getFontSlotForChar(ellipsis, 'eastAsia')).toBe('eastAsia');
    });

    it('forces cs slot when run options have cs or rtl set', () => {
      expect(getFontSlotForChar('A', undefined, { cs: true })).toBe('cs');
      expect(getFontSlotForChar('中', undefined, { cs: true })).toBe('cs');
      expect(getFontSlotForChar('A', undefined, { rtl: true })).toBe('cs');
      expect(getFontSlotForChar('—', 'eastAsia', { rtl: true })).toBe('cs');
    });
  });

  describe('rFonts resolution (rfonts.ts)', () => {
    it('resolves different font families for a run mixing Latin and CJK text', () => {
      const rFonts = {
        ascii: 'Calibri',
        eastAsia: 'MS Gothic',
      };

      const latinFont = fontForChar('H', rFonts);
      const cjkFont = fontForChar('字', rFonts);

      expect(latinFont).toBe('Calibri');
      expect(cjkFont).toBe('MS Gothic');
      expect(latinFont).not.toBe(cjkFont);
    });

    it('resolves a fixture with only cstheme set to the theme bidi font', () => {
      // Schema attribute is cstheme (lowercase 't')
      const rFonts = {
        cstheme: 'minorBidi',
      };

      // Arabic character 'م' is in the cs slot
      const resolvedFont = fontForChar('م', rFonts, mockThemeFontScheme);
      expect(resolvedFont).toBe('Courier New'); // minor.cs in mockThemeFontScheme
    });

    it('resolves cstheme with majorBidi binding', () => {
      const rFonts = {
        cstheme: 'majorBidi',
      };

      const resolvedFont = fontForChar('ש', rFonts, mockThemeFontScheme);
      expect(resolvedFont).toBe('Calibri'); // major.cs in mockThemeFontScheme
    });

    it('consults w:hint for ambiguous codepoints', () => {
      const rFontsDefault = {
        ascii: 'Arial',
        hAnsi: 'Arial',
        eastAsia: 'SimSun',
        hint: 'default' as const,
      };

      const rFontsEastAsia = {
        ascii: 'Arial',
        hAnsi: 'Arial',
        eastAsia: 'SimSun',
        hint: 'eastAsia' as const,
      };

      const emDash = '—'; // U+2014

      expect(fontForChar(emDash, rFontsDefault)).toBe('Arial');
      expect(fontForChar(emDash, rFontsEastAsia)).toBe('SimSun');
    });

    it('forces cs slot when w:cs or w:rtl is active', () => {
      const rFonts = {
        ascii: 'Arial',
        cs: 'Traditional Arabic',
      };

      // Normally 'Hello' is ascii
      expect(fontForChar('H', rFonts)).toBe('Arial');

      // With w:cs active on run, 'H' resolves to cs font
      expect(fontForChar('H', rFonts, undefined, undefined, { cs: true })).toBe(
        'Traditional Arabic',
      );

      // With w:rtl active on run, 'H' resolves to cs font
      expect(fontForChar('H', rFonts, undefined, undefined, { rtl: true })).toBe(
        'Traditional Arabic',
      );
    });

    it('resolves theme bindings for asciiTheme and eastAsiaTheme', () => {
      const rFonts = {
        asciiTheme: 'minorAscii',
        eastAsiaTheme: 'majorEastAsia',
      };

      expect(fontForChar('A', rFonts, mockThemeFontScheme)).toBe('Aptos'); // minor.latin
      expect(fontForChar('文', rFonts, mockThemeFontScheme)).toBe('Microsoft YaHei'); // major.ea
    });

    it('falls back to default typography when rFonts is empty', () => {
      expect(fontForChar('A')).toBe('Calibri');
      expect(fontForChar('é')).toBe('Calibri');
      expect(fontForChar('字')).toBe('SimSun');
      expect(fontForChar('م')).toBe('Times New Roman');
    });
  });
});
