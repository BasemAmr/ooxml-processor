import { describe, expect, it } from 'vitest';
import {
  determineBaseLevel,
  getBidiClass,
  getBidiLevels,
  reorderVisualRuns,
  resolveBidi,
} from './bidi.js';

describe('UAX#9 Bidi Engine (P4-07)', () => {
  describe('Bidi Class character classification', () => {
    it('classifies Latin letters as L', () => {
      expect(getBidiClass('A'.charCodeAt(0))).toBe('L');
      expect(getBidiClass('z'.charCodeAt(0))).toBe('L');
    });

    it('classifies Hebrew letters as R', () => {
      expect(getBidiClass(0x05d0)).toBe('R'); // Alef
      expect(getBidiClass(0x05ea)).toBe('R'); // Tav
    });

    it('classifies Arabic letters as AL', () => {
      expect(getBidiClass(0x0627)).toBe('AL'); // Arabic Alef
      expect(getBidiClass(0x064a)).toBe('AL'); // Arabic Yeh
    });

    it('classifies European and Arabic digits accurately', () => {
      expect(getBidiClass('5'.charCodeAt(0))).toBe('EN');
      expect(getBidiClass(0x0660)).toBe('AN'); // Arabic-Indic digit 0 (٠)
      expect(getBidiClass(0x0665)).toBe('AN'); // Arabic-Indic digit 5 (٥)
      expect(getBidiClass(0x06f4)).toBe('EN'); // Eastern Arabic-Indic 4 (۴) is EN per Unicode!
    });

    it('classifies whitespace, separators and neutrals', () => {
      expect(getBidiClass(' '.charCodeAt(0))).toBe('WS');
      expect(getBidiClass('+'.charCodeAt(0))).toBe('ES');
      expect(getBidiClass(','.charCodeAt(0))).toBe('CS');
      expect(getBidiClass('('.charCodeAt(0))).toBe('ON');
      expect(getBidiClass(0x2029)).toBe('B'); // Paragraph separator
    });

    it('classifies directional isolates and explicit controls', () => {
      expect(getBidiClass(0x2066)).toBe('LRI');
      expect(getBidiClass(0x2067)).toBe('RLI');
      expect(getBidiClass(0x2068)).toBe('FSI');
      expect(getBidiClass(0x2069)).toBe('PDI');
      expect(getBidiClass(0x202a)).toBe('LRE');
      expect(getBidiClass(0x202b)).toBe('RLE');
      expect(getBidiClass(0x202c)).toBe('PDF');
    });
  });

  describe('Paragraph base level determination (P1-P3)', () => {
    it('defaults to 0 (LTR) when unspecified', () => {
      expect(determineBaseLevel('Hello')).toBe(0);
      expect(determineBaseLevel('')).toBe(0);
    });

    it('respects explicit base level (w:bidi)', () => {
      expect(determineBaseLevel('Hello', 1)).toBe(1);
      expect(determineBaseLevel('مرحبا', 0)).toBe(0);
    });

    it('auto-detects base level from first strong character', () => {
      expect(determineBaseLevel('Hello world', 'auto')).toBe(0);
      expect(determineBaseLevel('مرحبا بك', 'auto')).toBe(1);
      expect(determineBaseLevel('123 שלום', 'auto')).toBe(1); // Digits are EN (weak), first strong is Hebrew R
      expect(determineBaseLevel('123 abc', 'auto')).toBe(0); // First strong is Latin L
    });
  });

  describe('Pure LTR and Pure RTL text', () => {
    it('handles pure LTR text with zero level and monotonic visual order', () => {
      const text = 'Hello';
      const result = resolveBidi(text, { baseLevel: 0 });

      expect(result.baseLevel).toBe(0);
      expect(result.levels).toEqual([0, 0, 0, 0, 0]);
      expect(result.visualItems.map((v) => v.char).join('')).toBe('Hello');

      // Check Phase 6 contract: srcOffset matches logical position
      result.visualItems.forEach((item, index) => {
        expect(item.srcOffset).toBe(index);
        expect(item.srcLength).toBe(1);
        expect(item.level).toBe(0);
      });
    });

    it('handles pure RTL Arabic text in RTL paragraph with reversed visual order', () => {
      // Arabic "عرب" (Ain, Reh, Beh)
      const text = 'عرب';
      const result = resolveBidi(text, { baseLevel: 1 });

      expect(result.baseLevel).toBe(1);
      expect(result.levels).toEqual([1, 1, 1]);

      // In visual order (left-to-right painting), the last character 'ب' is painted first
      expect(result.visualItems.map((v) => v.char).join('')).toBe('برع');

      // CRITICAL Phase 6 Contract check:
      // visualItems[0] is 'ب', but its srcOffset must be 2!
      expect(result.visualItems[0]!.char).toBe('ب');
      expect(result.visualItems[0]!.srcOffset).toBe(2);

      expect(result.visualItems[1]!.char).toBe('ر');
      expect(result.visualItems[1]!.srcOffset).toBe(1);

      expect(result.visualItems[2]!.char).toBe('ع');
      expect(result.visualItems[2]!.srcOffset).toBe(0);
    });
  });

  describe('Mixed bidirectional text', () => {
    it('handles Latin text inside an RTL Arabic paragraph (level 2 nested LTR)', () => {
      // RTL paragraph: "عرب HTML تم"
      const text = 'عرب HTML تم';
      const result = resolveBidi(text, { baseLevel: 1 });

      expect(result.baseLevel).toBe(1);

      // Arabic chars have level 1, Latin chars have level 2 (1 + 1 via rule I2)
      // 'ع'(1) 'ر'(1) 'ب'(1) ' '(1) 'H'(2) 'T'(2) 'M'(2) 'L'(2) ' '(1) 'ت'(1) 'م'(1)
      expect(result.levels[4]).toBe(2); // 'H'
      expect(result.levels[5]).toBe(2); // 'T'
      expect(result.levels[6]).toBe(2); // 'M'
      expect(result.levels[7]).toBe(2); // 'L'

      // In visual order:
      // Arabic "تم" reversed ('م', 'ت'), then ' ', then "HTML" in LTR order, then ' ', then "عرب" reversed ('ب', 'ر', 'ع')
      const visualStr = result.visualItems.map((v) => v.char).join('');
      expect(visualStr).toBe('مت HTML برع');

      // Verify that HTML characters keep their relative LTR logical offsets
      const hItem = result.visualItems.find((v) => v.char === 'H');
      const tItem = result.visualItems.find((v) => v.char === 'T');
      expect(hItem?.srcOffset).toBe(4);
      expect(tItem?.srcOffset).toBe(5);
    });

    it('handles Arabic text inside an LTR paragraph', () => {
      // LTR paragraph: "Hello عرب World"
      const text = 'Hello عرب World';
      const result = resolveBidi(text, { baseLevel: 0 });

      expect(result.baseLevel).toBe(0);
      // 'Hello ' -> level 0, 'عرب' -> level 1, ' World' -> level 0
      expect(result.levels[0]).toBe(0); // 'H'
      expect(result.levels[6]).toBe(1); // 'ع'
      expect(result.levels[7]).toBe(1); // 'ر'
      expect(result.levels[8]).toBe(1); // 'ب'

      const visualStr = result.visualItems.map((v) => v.char).join('');
      expect(visualStr).toBe('Hello برع World');

      // Check logical offset preservation
      expect(result.visualItems[6]!.char).toBe('ب');
      expect(result.visualItems[6]!.srcOffset).toBe(8);
      expect(result.visualItems[7]!.char).toBe('ر');
      expect(result.visualItems[7]!.srcOffset).toBe(7);
      expect(result.visualItems[8]!.char).toBe('ع');
      expect(result.visualItems[8]!.srcOffset).toBe(6);
    });

    it('handles European digits in Arabic context (Rule W2 -> AN)', () => {
      // In Arabic text, European numbers following AL become AN (level 2 in RTL embedding)
      const text = 'سعر 15 جنيه';
      const result = resolveBidi(text, { baseLevel: 1 });

      // In W2: '1' and '5' preceded by 'سعر' (AL) become AN.
      // In I2: odd level 1 + AN -> level 2.
      expect(result.levels[4]).toBe(2); // '1'
      expect(result.levels[5]).toBe(2); // '5'
      // Digits inside Arabic remain LTR: '1' then '5'
      const visualStr = result.visualItems.map((v) => v.char).join('');
      expect(visualStr).toContain('15');
    });
  });

  describe('BD16 Bracket pair resolution (Rule N0)', () => {
    it('resolves bracket pairs enclosing Latin in RTL Arabic context', () => {
      // In RTL Arabic text: "نص (word) هنا"
      // Rule N0: Inside '(' and ')' is "word" (L, opposing direction to R).
      // Preceding strong type before '(' is 'نص' (R).
      // Since prevStrong ('R') != oppDir ('L'), brackets resolve to embedding direction 'R'!
      const text = 'نص (word) هنا';
      const result = resolveBidi(text, { baseLevel: 1 });

      const openParen = result.visualItems.find((v) => v.srcOffset === 3);
      const closeParen = result.visualItems.find((v) => v.srcOffset === 8);

      expect(openParen?.resolvedType).toBe('R');
      expect(closeParen?.resolvedType).toBe('R');
      expect(openParen?.level).toBe(1);
      expect(closeParen?.level).toBe(1);
    });

    it('resolves bracket pairs enclosing Arabic in LTR English context', () => {
      // In LTR context: "Text (عرب) end"
      // Inside '(' and ')' is Arabic (R, opposing to L).
      // Preceding strong type before '(' is 'Text' (L).
      // Since prevStrong ('L') != oppDir ('R'), brackets resolve to embedding direction 'L'!
      const text = 'Text (عرب) end';
      const result = resolveBidi(text, { baseLevel: 0 });

      const openParen = result.visualItems.find((v) => v.srcOffset === 5);
      const closeParen = result.visualItems.find((v) => v.srcOffset === 9);

      expect(openParen?.resolvedType).toBe('L');
      expect(closeParen?.resolvedType).toBe('L');
      expect(openParen?.level).toBe(0);
      expect(closeParen?.level).toBe(0);
    });

    it('resolves bracket pairs enclosing digits in RTL context', () => {
      // "سعر (123)" in RTL
      // Digits EN in Arabic context turn to AN (Rule W2).
      // AN acts as strong R in N0.
      // Brackets match embedding direction R!
      const text = 'سعر (123)';
      const result = resolveBidi(text, { baseLevel: 1 });

      const openParen = result.visualItems.find((v) => v.srcOffset === 4);
      const closeParen = result.visualItems.find((v) => v.srcOffset === 8);

      expect(openParen?.resolvedType).toBe('R');
      expect(closeParen?.resolvedType).toBe('R');
    });
  });

  describe('Directional Isolates (Rules X5a-X5c, X6a)', () => {
    it('isolates embedded directional text using RLI and PDI', () => {
      // LTR paragraph with RLI ... PDI
      // U+2067 = RLI, U+2069 = PDI
      const text = `Hello \u2067عرب\u2069 World`;
      const result = resolveBidi(text, { baseLevel: 0 });

      // Inside isolate, Arabic gets odd level (1)
      const arabLevels = getBidiLevels(text, { baseLevel: 0 });
      expect(arabLevels[7]).toBe(1); // 'ع'
      expect(arabLevels[8]).toBe(1); // 'ر'
      expect(arabLevels[9]).toBe(1); // 'ب'

      // Outside isolate, Latin gets level 0
      expect(arabLevels[0]).toBe(0); // 'H'
      expect(arabLevels[11]).toBe(0); // 'W'

      // In visual order, Arabic is reversed
      const visualStr = result.visualItems.map((v) => v.char).join('');
      expect(visualStr).toContain('برع');
    });

    it('handles First Strong Isolate (FSI)', () => {
      // U+2068 = FSI, U+2069 = PDI
      // FSI inspects inside: if first strong is Arabic, behaves as RLI
      const text = `Label: \u2068مرحبا\u2069`;
      const result = resolveBidi(text, { baseLevel: 0 });

      // Arabic characters inside FSI have level 1
      expect(result.levels[8]).toBe(1); // 'م'
    });
  });

  describe('reorderVisualRuns helper', () => {
    it('reorders run slices according to embedding levels', () => {
      const runs = [
        { text: 'Hello ', bidiLevel: 0 },
        { text: 'عرب ', bidiLevel: 1 },
        { text: 'World', bidiLevel: 0 },
      ];

      const reordered = reorderVisualRuns(runs);
      // Run with level 1 reverses if adjacent with level >= 1
      expect(reordered).toHaveLength(3);
      expect(reordered[0]!.text).toBe('Hello ');
      expect(reordered[1]!.text).toBe('عرب ');
      expect(reordered[2]!.text).toBe('World');
    });

    it('reorders runs in RTL base paragraph', () => {
      const runs = [
        { text: 'عرب ', bidiLevel: 1 },
        { text: 'English', bidiLevel: 2 },
        { text: ' تم', bidiLevel: 1 },
      ];

      const reordered = reorderVisualRuns(runs);
      // Level 2 reversed within, then level 1 reversed
      // Level 2: [عرب, English, تم] -> level >= 2 reversed (English alone)
      // Level 1: all three reversed -> [تم, English, عرب]
      expect(reordered[0]!.text).toBe(' تم');
      expect(reordered[1]!.text).toBe('English');
      expect(reordered[2]!.text).toBe('عرب ');
    });
  });
});
