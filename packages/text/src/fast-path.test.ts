import { describe, expect, it } from 'vitest';
import { isFastPathEligible, measureFastPath, type FastPathOptions } from './fast-path.js';
import type { SubRun } from './itemizer.js';
import { FallbackTextShaper, type ResolvedFontFace } from './shaper.js';

describe('measureText Fast Path & Differential Test Suite (P4-10)', () => {
  const shaper = new FallbackTextShaper();

  const fontFace: ResolvedFontFace = {
    faceId: 10,
    family: 'Calibri',
    unitsPerEm: 2048,
  };

  const corpus: Array<{
    name: string;
    text: string;
    script: 'ascii' | 'hAnsi' | 'cs' | 'eastAsia';
    bidiLevel: number;
    options?: FastPathOptions;
    shouldBeEligible: boolean;
  }> = [
    {
      name: 'Simple Latin Sentence',
      text: 'The quick brown fox jumps over the lazy dog.',
      script: 'ascii',
      bidiLevel: 0,
      shouldBeEligible: true,
    },
    {
      name: 'Greek text',
      text: 'Εν αρχη ην ο Λογος',
      script: 'hAnsi',
      bidiLevel: 0,
      shouldBeEligible: true,
    },
    {
      name: 'Cyrillic text',
      text: 'В начале было Слово',
      script: 'hAnsi',
      bidiLevel: 0,
      shouldBeEligible: true,
    },
    {
      name: 'Latin with ligatures (default: enabled)',
      text: 'office flag difficult workflow',
      script: 'ascii',
      bidiLevel: 0,
      shouldBeEligible: false, // Contains 'ffi', 'fl', 'ff'
    },
    {
      name: 'Latin with ligatures disabled explicitly',
      text: 'office flag difficult workflow',
      script: 'ascii',
      bidiLevel: 0,
      options: { ligatures: 'none' },
      shouldBeEligible: true, // Eligible because ligatures are disabled
    },
    {
      name: 'Arabic text (Complex Script)',
      text: 'بسم الله الرحمن الرحيم',
      script: 'cs',
      bidiLevel: 1, // RTL
      shouldBeEligible: false,
    },
    {
      name: 'CJK text (East Asian)',
      text: '天地玄黃 宇宙洪荒',
      script: 'eastAsia',
      bidiLevel: 0,
      shouldBeEligible: false,
    },
    {
      name: 'Devanagari Indic text (Complex Script)',
      text: 'नमस्ते दुनिया',
      script: 'cs',
      bidiLevel: 0,
      shouldBeEligible: false,
    },
    {
      name: 'Latin text with combining diacritic mark',
      text: 'cafe\u0301', // 'e' followed by combining acute mark U+0301
      script: 'ascii',
      bidiLevel: 0,
      shouldBeEligible: false,
    },
    {
      name: 'Run with kerning threshold active',
      text: 'AV WA',
      script: 'ascii',
      bidiLevel: 0,
      options: { kernThreshold: 20 }, // fontSize 24 >= 20 -> kerning active
      shouldBeEligible: false,
    },
    {
      name: 'Run with kerning threshold inactive',
      text: 'AV WA',
      script: 'ascii',
      bidiLevel: 0,
      options: { kernThreshold: 40 }, // fontSize 24 < 40 -> kerning inactive
      shouldBeEligible: true,
    },
    {
      name: 'Run with character spacing adjustment',
      text: 'Spaced',
      script: 'ascii',
      bidiLevel: 0,
      options: { spacing: 20 },
      shouldBeEligible: false,
    },
    {
      name: 'Run with character scaling adjustment',
      text: 'Scaled',
      script: 'ascii',
      bidiLevel: 0,
      options: { w: 120 },
      shouldBeEligible: false,
    },
  ];

  describe('Strict Allowlist Predicate (isFastPathEligible)', () => {
    for (const item of corpus) {
      it(`evaluates eligibility correctly for: ${item.name}`, () => {
        const subRun: SubRun = {
          text: item.text,
          fontFamily: 'Calibri',
          fontSize: 24,
          script: item.script,
          bidiLevel: item.bidiLevel,
          srcOffset: 0,
          srcLength: item.text.length,
        };

        const eligible = isFastPathEligible(subRun, item.options);
        expect(eligible).toBe(item.shouldBeEligible);
      });
    }

    it('rejects unrecognised script tags and emojis', () => {
      const emojiRun: SubRun = {
        text: 'Hello \uD83D\uDE00',
        fontFamily: 'Calibri',
        fontSize: 24,
        script: 'ascii',
        bidiLevel: 0,
        srcOffset: 0,
        srcLength: 8,
      };
      expect(isFastPathEligible(emojiRun)).toBe(false);
    });
  });

  describe('Differential Verification: Fast Path vs Shaper Path', () => {
    it('produces identical advances within 0.01 tolerance for every fast-path eligible run', () => {
      let eligibleCount = 0;

      for (const item of corpus) {
        const subRun: SubRun = {
          text: item.text,
          fontFamily: 'Calibri',
          fontSize: 24,
          script: item.script,
          bidiLevel: item.bidiLevel,
          srcOffset: 0,
          srcLength: item.text.length,
        };

        const isEligible = isFastPathEligible(subRun, item.options);
        if (!isEligible) continue;

        eligibleCount++;

        // Fast path measurement
        const fastRun = measureFastPath(subRun, fontFace, item.options);

        // Shaper path (with ligatures and kerning matching fast-path conditions)
        const shapedRun = shaper.shape(subRun, fontFace, {
          liga: false,
          kern: false,
        });

        // 1. Total advance assertion
        const diff = Math.abs(fastRun.totalAdvance - shapedRun.totalAdvance);
        expect(diff).toBeLessThanOrEqual(0.01);

        // 2. Cluster count assertion
        expect(fastRun.clusterCount).toBe(shapedRun.clusterCount);

        // 3. Per-cluster advances assertion
        for (let i = 0; i < fastRun.clusterCount; i++) {
          const clusterDiff = Math.abs(fastRun.xAdvance(i) - shapedRun.xAdvance(i));
          expect(clusterDiff).toBeLessThanOrEqual(0.01);
          expect(fastRun.srcOffset(i)).toBe(shapedRun.srcOffset(i));
          expect(fastRun.srcLength(i)).toBe(shapedRun.srcLength(i));
        }
      }

      expect(eligibleCount).toBeGreaterThan(0);
    });
  });

  describe('Corpus Hit Rate Metrics', () => {
    it('computes and reports fast-path hit rate across the test corpus', () => {
      let eligibleCount = 0;
      const totalCount = corpus.length;

      for (const item of corpus) {
        const subRun: SubRun = {
          text: item.text,
          fontFamily: 'Calibri',
          fontSize: 24,
          script: item.script,
          bidiLevel: item.bidiLevel,
          srcOffset: 0,
          srcLength: item.text.length,
        };

        if (isFastPathEligible(subRun, item.options)) {
          eligibleCount++;
        }
      }

      const hitRatePercent = (eligibleCount / totalCount) * 100;
      // In our balanced corpus (with complex Arabic, CJK, Indic, combining marks, ligatures, scaling),
      // hit rate should be accurately reported
      expect(hitRatePercent).toBeGreaterThan(0);
      expect(hitRatePercent).toBeLessThan(100);

      // Report hit rate metric
      console.log(
        `[P4-10 Fast Path Metrics] Corpus hit rate: ${hitRatePercent.toFixed(1)}% (${eligibleCount}/${totalCount} eligible runs)`,
      );
    });
  });
});
