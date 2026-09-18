import { describe, expect, it } from 'vitest';
import {
  findWordAt,
  nextGraphemeBreak,
  prevGraphemeBreak,
  segmentGraphemes,
  segmentWords,
} from './segmenter.js';

describe('Grapheme and Word Segmentation (P4-08)', () => {
  describe('segmentGraphemes', () => {
    it('handles standard ASCII text as single-character graphemes', () => {
      const text = 'Hello';
      const clusters = segmentGraphemes(text, 'en-US');

      expect(clusters).toHaveLength(5);
      expect(clusters.map((c) => c.text)).toEqual(['H', 'e', 'l', 'l', 'o']);
      expect(clusters.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
      expect(clusters.map((c) => c.length)).toEqual([1, 1, 1, 1, 1]);
    });

    it('treats emoji with skin tone modifier as a single indivisible grapheme cluster', () => {
      // Thumbs up + medium skin tone (👍🏽: U+1F44D U+1F3FD = 4 UTF-16 code units)
      const text = 'A👍🏽B';
      const clusters = segmentGraphemes(text, 'en-US');

      expect(clusters).toHaveLength(3);
      expect(clusters[0]!.text).toBe('A');
      expect(clusters[1]!.text).toBe('👍🏽');
      expect(clusters[1]!.length).toBe(4);
      expect(clusters[2]!.text).toBe('B');
    });

    it('treats emoji ZWJ sequence as a single indivisible grapheme cluster', () => {
      // Family emoji: 👨‍👩‍👧‍👦 (Man + ZWJ + Woman + ZWJ + Girl + ZWJ + Boy = 11 UTF-16 code units)
      const family = '👨‍👩‍👧‍👦';
      const text = `Start ${family} End`;
      const clusters = segmentGraphemes(text, 'en-US');

      const familyCluster = clusters.find((c) => c.text === family);
      expect(familyCluster).toBeDefined();
      expect(familyCluster?.length).toBe(family.length);
    });

    it('treats Indic combining clusters (Devanagari) as single units', () => {
      // Devanagari "नमस्ते" (na + ma + sa + virama + ta + e-matra)
      // "स्ते" (sa + virama + te) forms a conjunct cluster
      const text = 'नमस्ते';
      const clusters = segmentGraphemes(text, 'hi-IN');

      expect(clusters.length).toBeGreaterThanOrEqual(3);
      // Ensure the text reassembled equals original
      expect(clusters.map((c) => c.text).join('')).toBe(text);
    });

    it('handles empty text', () => {
      expect(segmentGraphemes('', 'en-US')).toEqual([]);
    });
  });

  describe('segmentWords', () => {
    it('segments English words and marks word-like tokens', () => {
      const text = 'Hello, world! 123';
      const words = segmentWords(text, 'en-US');

      // Check word-like tokens vs punctuation/whitespace
      const wordLike = words.filter((w) => w.isWordLike);
      expect(wordLike.map((w) => w.text)).toEqual(['Hello', 'world', '123']);

      // Check all tokens reconstruct the input
      expect(words.map((w) => w.text).join('')).toBe(text);
    });

    it('segments Arabic words respecting Arabic locale', () => {
      const text = 'مرحبا بالعالم!';
      const words = segmentWords(text, 'ar-SA');

      const wordLike = words.filter((w) => w.isWordLike);
      expect(wordLike.map((w) => w.text)).toEqual(['مرحبا', 'بالعالم']);
    });

    it('segments Thai words without spaces using dictionary-based segmentation', () => {
      // Thai sentence without spaces: ภาษาไทย (Thai language)
      const text = 'ภาษาไทย';
      const words = segmentWords(text, 'th-TH');

      expect(words.length).toBeGreaterThanOrEqual(2);
      expect(words.map((w) => w.text).join('')).toBe(text);
    });

    it('segments Japanese text into words and particles', () => {
      // Japanese: 今日はいい天気ですね (Today is nice weather, isn't it?)
      const text = '今日はいい天気ですね';
      const words = segmentWords(text, 'ja-JP');

      expect(words.length).toBeGreaterThan(1);
      expect(words.map((w) => w.text).join('')).toBe(text);
    });
  });

  describe('Caret navigation helpers', () => {
    it('advances caret by grapheme clusters (nextGraphemeBreak)', () => {
      const text = 'A👍🏽B';
      // 'A' is at 0, length 1 -> break at 1
      expect(nextGraphemeBreak(text, 0)).toBe(1);
      // '👍🏽' starts at 1, length 4 -> next break is 1 + 4 = 5
      expect(nextGraphemeBreak(text, 1)).toBe(5);
      expect(nextGraphemeBreak(text, 3)).toBe(5);
      // 'B' starts at 5, length 1 -> next break is 6
      expect(nextGraphemeBreak(text, 5)).toBe(6);
      expect(nextGraphemeBreak(text, 6)).toBe(6);
    });

    it('moves caret back by grapheme clusters (prevGraphemeBreak)', () => {
      const text = 'A👍🏽B';
      expect(prevGraphemeBreak(text, 6)).toBe(5);
      expect(prevGraphemeBreak(text, 5)).toBe(1);
      expect(prevGraphemeBreak(text, 3)).toBe(1);
      expect(prevGraphemeBreak(text, 1)).toBe(0);
      expect(prevGraphemeBreak(text, 0)).toBe(0);
    });

    it('locates word segment at cursor offset (findWordAt)', () => {
      const text = 'The quick brown fox';
      const word = findWordAt(text, 5); // inside "quick" (index 4..9)
      expect(word?.text).toBe('quick');
      expect(word?.isWordLike).toBe(true);

      const space = findWordAt(text, 3); // space between The and quick
      expect(space?.text).toBe(' ');
      expect(space?.isWordLike).toBe(false);
    });
  });
});
