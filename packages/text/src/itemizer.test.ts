import { describe, expect, it } from 'vitest';
import { itemizeParagraphRuns, itemizeText } from './itemizer.js';

describe('Run Itemization (P4-06)', () => {
  describe('Minimal boundary rule', () => {
    it('keeps adjacent characters of same script, font, and bidi level in a single sub-run', () => {
      // Latin text containing potential ligatures ("office")
      const text = 'office';
      const subRuns = itemizeText(text, {
        rFonts: { ascii: 'Calibri' },
        fontSize: 24, // 12pt
      });

      expect(subRuns).toHaveLength(1);
      expect(subRuns[0]!.text).toBe('office');
      expect(subRuns[0]!.fontFamily).toBe('Calibri');
      expect(subRuns[0]!.script).toBe('ascii');
      expect(subRuns[0]!.fontSize).toBe(24);
      expect(subRuns[0]!.bidiLevel).toBe(0);
      expect(subRuns[0]!.srcOffset).toBe(0);
      expect(subRuns[0]!.srcLength).toBe(6);
    });

    it('splits Latin and CJK characters into distinct sub-runs with appropriate fonts', () => {
      // "Hello 世界" -> "Hello " (Calibri, ascii) + "世界" (SimSun, eastAsia)
      const text = 'Hello 世界';
      const subRuns = itemizeText(text, {
        rFonts: {
          ascii: 'Calibri',
          eastAsia: 'SimSun',
        },
      });

      expect(subRuns).toHaveLength(2);

      // First sub-run: "Hello "
      expect(subRuns[0]!.text).toBe('Hello ');
      expect(subRuns[0]!.fontFamily).toBe('Calibri');
      expect(subRuns[0]!.script).toBe('ascii');
      expect(subRuns[0]!.bidiLevel).toBe(0);
      expect(subRuns[0]!.srcOffset).toBe(0);
      expect(subRuns[0]!.srcLength).toBe(6);

      // Second sub-run: "世界"
      expect(subRuns[1]!.text).toBe('世界');
      expect(subRuns[1]!.fontFamily).toBe('SimSun');
      expect(subRuns[1]!.script).toBe('eastAsia');
      expect(subRuns[1]!.bidiLevel).toBe(0);
      expect(subRuns[1]!.srcOffset).toBe(6);
      expect(subRuns[1]!.srcLength).toBe(2);
    });

    it('splits Latin and Arabic characters into distinct sub-runs with differing bidi levels and scripts', () => {
      // "Hello مرحبا" in LTR paragraph
      const text = 'Hello مرحبا';
      const subRuns = itemizeText(text, {
        rFonts: {
          ascii: 'Calibri',
          cs: 'Times New Roman',
        },
        baseLevel: 0,
      });

      expect(subRuns).toHaveLength(2);

      // "Hello " -> ascii, Calibri, level 0
      expect(subRuns[0]!.text).toBe('Hello ');
      expect(subRuns[0]!.fontFamily).toBe('Calibri');
      expect(subRuns[0]!.script).toBe('ascii');
      expect(subRuns[0]!.bidiLevel).toBe(0);

      // "مرحبا" -> cs, Times New Roman, level 1
      expect(subRuns[1]!.text).toBe('مرحبا');
      expect(subRuns[1]!.fontFamily).toBe('Times New Roman');
      expect(subRuns[1]!.script).toBe('cs');
      expect(subRuns[1]!.bidiLevel).toBe(1);
    });
  });

  describe('Complex script formatting and size differentiation', () => {
    it('applies fontSizeCs to complex script and fontSize to Latin', () => {
      // In Word, Latin might be 11pt (22 half-pts) and Complex Script 14pt (28 half-pts)
      const text = 'Hello مرحبا';
      const subRuns = itemizeText(text, {
        fontSize: 22,
        fontSizeCs: 28,
        rFonts: {
          ascii: 'Calibri',
          cs: 'Traditional Arabic',
        },
      });

      expect(subRuns).toHaveLength(2);
      expect(subRuns[0]!.fontSize).toBe(22);
      expect(subRuns[1]!.fontSize).toBe(28);
      expect(subRuns[1]!.fontFamily).toBe('Traditional Arabic');
    });

    it('applies boldCs and italicCs to complex script', () => {
      const text = 'Hello مرحبا';
      const subRuns = itemizeText(text, {
        bold: false,
        boldCs: true,
        italic: true,
        italicCs: false,
      });

      expect(subRuns).toHaveLength(2);
      // Latin: bold = false, italic = true
      expect(subRuns[0]!.bold).toBe(false);
      expect(subRuns[0]!.italic).toBe(true);

      // Arabic: bold = true (via boldCs), italic = false (via italicCs)
      expect(subRuns[1]!.bold).toBe(true);
      expect(subRuns[1]!.italic).toBe(false);
    });

    it('forces cs script slot when w:cs or w:rtl is set on run', () => {
      // Latin text in a run marked w:cs="1"
      const text = 'Latin In CS Run';
      const subRuns = itemizeText(text, {
        cs: true,
        rFonts: {
          cs: 'Times New Roman',
          ascii: 'Calibri',
        },
      });

      expect(subRuns).toHaveLength(1);
      expect(subRuns[0]!.script).toBe('cs');
      expect(subRuns[0]!.fontFamily).toBe('Times New Roman');
    });
  });

  describe('itemizeParagraphRuns', () => {
    it('resolves UAX#9 levels across run boundaries in a paragraph', () => {
      const runs = [
        { text: 'عرب ', options: { rFonts: { cs: 'Times New Roman' }, rtl: true } },
        { text: 'HTML', options: { rFonts: { ascii: 'Courier New' } } },
        { text: ' تم', options: { rFonts: { cs: 'Times New Roman' }, rtl: true } },
      ];

      // RTL paragraph base level 1
      const subRuns = itemizeParagraphRuns(runs, 1);

      expect(subRuns).toHaveLength(3);
      // Arabic runs have bidi level 1
      expect(subRuns[0]!.text).toBe('عرب ');
      expect(subRuns[0]!.bidiLevel).toBe(1);
      expect(subRuns[0]!.srcOffset).toBe(0);

      // Latin HTML embedded in RTL paragraph has bidi level 2
      expect(subRuns[1]!.text).toBe('HTML');
      expect(subRuns[1]!.bidiLevel).toBe(2);
      expect(subRuns[1]!.srcOffset).toBe(4);
      expect(subRuns[1]!.fontFamily).toBe('Courier New');

      expect(subRuns[2]!.text).toBe(' تم');
      expect(subRuns[2]!.bidiLevel).toBe(1);
      expect(subRuns[2]!.srcOffset).toBe(8);
    });
  });

  describe('Stability and edge cases', () => {
    it('is strictly deterministic across repeated runs', () => {
      const text = 'Word 世界 مرحبا!';
      const opts = {
        rFonts: { ascii: 'Calibri', eastAsia: 'SimSun', cs: 'Amiri' },
        fontSize: 24,
      };

      const result1 = itemizeText(text, opts);
      const result2 = itemizeText(text, opts);

      expect(result1).toEqual(result2);
    });

    it('returns empty array for empty string or empty runs', () => {
      expect(itemizeText('')).toEqual([]);
      expect(itemizeParagraphRuns([])).toEqual([]);
      expect(itemizeParagraphRuns([{ text: '' }])).toEqual([]);
    });
  });
});
