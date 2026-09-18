import { describe, expect, it } from 'vitest';
import {
  formatCombineText,
  getCombineBracketPairs,
  getVerticalOpenTypeFeatures,
  isEastAsianVertical,
  isSidewaysOrientation,
  isVerticalOrientation,
  parseEastAsianLayout,
  resolveVerticalGlyphMetrics,
  scaleVerticalMetrics,
  synthesizeVerticalMetrics,
  textOrientationFromDml,
  textOrientationFromWml,
  type RawVerticalFontMetrics,
  type TextOrientation,
} from './cjk-vertical.js';

describe('CJK & Vertical Text Layout (P4-14)', () => {
  describe('Canonical TextOrientation enum and mappings', () => {
    it('maps WordprocessingML textDirection values correctly', () => {
      expect(textOrientationFromWml('lrTb')).toBe('horizontal');
      expect(textOrientationFromWml('lr')).toBe('horizontal');
      expect(textOrientationFromWml('tbRl')).toBe('vertical-rl');
      expect(textOrientationFromWml('tbRlV')).toBe('vertical-rl');
      expect(textOrientationFromWml('tbLr')).toBe('vertical-lr');
      expect(textOrientationFromWml('tbLrV')).toBe('vertical-lr');
      expect(textOrientationFromWml('btLr')).toBe('sideways-rl');
      expect(textOrientationFromWml(undefined)).toBe('horizontal');
    });

    it('maps DrawingML bodyPr/@vert values correctly', () => {
      expect(textOrientationFromDml('horz')).toBe('horizontal');
      expect(textOrientationFromDml('vert')).toBe('vertical-rl');
      expect(textOrientationFromDml('eaVert')).toBe('vertical-rl');
      expect(textOrientationFromDml('mongolianVert')).toBe('vertical-lr');
      expect(textOrientationFromDml('vert270')).toBe('sideways-lr');
      expect(textOrientationFromDml(undefined)).toBe('horizontal');
    });

    it('correctly classifies orientation categories', () => {
      const orientations: TextOrientation[] = [
        'horizontal',
        'vertical-rl',
        'vertical-lr',
        'sideways-rl',
        'sideways-lr',
      ];

      expect(orientations.map(isVerticalOrientation)).toEqual([false, true, true, true, true]);

      expect(orientations.map(isEastAsianVertical)).toEqual([false, true, true, false, false]);

      expect(orientations.map(isSidewaysOrientation)).toEqual([false, false, false, true, true]);
    });
  });

  describe('CT_EastAsianLayout modeling & Tate-chu-yoko', () => {
    it('parses CT_EastAsianLayout attributes with boolean OnOff handling', () => {
      const layout = parseEastAsianLayout({
        combine: '1' as any,
        combineBrackets: 'square',
        vert: '0' as any,
        vertCompress: 'true' as any,
        id: '123' as any,
      });

      expect(layout.combine).toBe(true);
      expect(layout.combineBrackets).toBe('square');
      expect(layout.vert).toBe(false);
      expect(layout.vertCompress).toBe(true);
      expect(layout.id).toBe(123);
    });

    it('returns empty defaults for undefined layout', () => {
      const layout = parseEastAsianLayout(undefined);
      expect(layout.combine).toBe(false);
      expect(layout.combineBrackets).toBe('none');
      expect(layout.vert).toBe(false);
      expect(layout.vertCompress).toBe(false);
      expect(layout.id).toBeUndefined();
    });

    it('resolves bracket pairs for all ST_CombineBrackets values', () => {
      expect(getCombineBracketPairs('none')).toEqual({ open: '', close: '' });
      expect(getCombineBracketPairs('round')).toEqual({ open: '(', close: ')' });
      expect(getCombineBracketPairs('square')).toEqual({ open: '[', close: ']' });
      expect(getCombineBracketPairs('angle')).toEqual({ open: '\u3008', close: '\u3009' });
      expect(getCombineBracketPairs('curly')).toEqual({ open: '{', close: '}' });
    });

    it('formats combined text enclosed by specified brackets', () => {
      expect(formatCombineText('21', 'round')).toBe('(21)');
      expect(formatCombineText('99', 'angle')).toBe('\u300899\u3009');
      expect(formatCombineText('ABC', 'square')).toBe('[ABC]');
      expect(formatCombineText('12', 'none')).toBe('12');
    });
  });

  describe('Vertical OpenType feature selection', () => {
    it('activates vert and vrt2 in East Asian vertical flow', () => {
      const features = getVerticalOpenTypeFeatures('vertical-rl');
      expect(features).toEqual(['vert', 'vrt2']);
    });

    it('activates punctuation compression (vhal) when vertCompress is true', () => {
      const features = getVerticalOpenTypeFeatures('vertical-rl', {
        combine: false,
        combineBrackets: 'none',
        vert: false,
        vertCompress: true,
      });
      expect(features).toEqual(['vert', 'vrt2', 'vhal']);
    });

    it('suppresses vertical features when combine (Tate-chu-yoko) is true', () => {
      const features = getVerticalOpenTypeFeatures('vertical-rl', {
        combine: true,
        combineBrackets: 'round',
        vert: false,
        vertCompress: false,
      });
      // Combined text is laid out horizontally, so vert/vrt2 must not be activated
      expect(features).toEqual([]);
    });

    it('does not activate vertical features for horizontal or sideways orientation', () => {
      expect(getVerticalOpenTypeFeatures('horizontal')).toEqual([]);
      expect(getVerticalOpenTypeFeatures('sideways-rl')).toEqual([]);
      expect(getVerticalOpenTypeFeatures('sideways-lr')).toEqual([]);
    });
  });

  describe('Vertical metrics fallback & synthesis', () => {
    it('synthesizes vertical advances and origin offsets when vhea/vmtx are missing', () => {
      const synthesized = synthesizeVerticalMetrics({
        unitsPerEm: 2048,
        ascender: 1900,
        horizontalAdvance: 1200,
      });

      expect(synthesized.isSynthesized).toBe(true);
      expect(synthesized.advance).toBe(2048); // 1 em
      expect(synthesized.originX).toBe(-600); // Centered: -1200 / 2
      expect(synthesized.originY).toBe(1900); // Aligned to ascender
      expect(synthesized.tsb).toBe(0);
    });

    it('uses actual vmtx vertical advances when tables are present', () => {
      const rawVertical: RawVerticalFontMetrics = {
        vhea: {
          vertTypoAscender: 880,
          vertTypoDescender: -120,
          vertTypoLineGap: 0,
          advanceHeightMax: 1000,
          numOfLongVerMetrics: 2,
        },
        vmtx: {
          vAdvances: [1000, 1050],
          topSideBearings: [50, 40],
        },
      };

      const resolved = resolveVerticalGlyphMetrics({
        glyphId: 1,
        unitsPerEm: 1000,
        ascender: 880,
        horizontalAdvance: 500,
        rawVertical,
      });

      expect(resolved.isSynthesized).toBe(false);
      expect(resolved.advance).toBe(1050);
      expect(resolved.tsb).toBe(40);
      expect(resolved.originX).toBe(-250);
      expect(resolved.originY).toBe(880);
    });

    it('scales vertical metrics to twips, points, and pixels accurately', () => {
      const metrics = synthesizeVerticalMetrics({
        unitsPerEm: 1000,
        ascender: 800,
        horizontalAdvance: 600,
      });

      // 10 pt font = 20 half-points = 200 twips
      const scaled = scaleVerticalMetrics(metrics, 20, 1000);

      expect(scaled.isSynthesized).toBe(true);
      expect(scaled.advance.twips).toBe(200); // 1 em = 200 twips
      expect(scaled.advance.points).toBe(10);
      expect(scaled.advance.pixels).toBeCloseTo(10 * (4 / 3), 4);

      expect(scaled.originX.twips).toBe(-60); // (-300 * 200) / 1000 = -60
      expect(scaled.originY.twips).toBe(160); // (800 * 200) / 1000 = 160
    });
  });
});
