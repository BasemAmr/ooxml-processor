import { describe, expect, it, vi } from 'vitest';
import type { SubRun } from './itemizer.js';
import {
  createTextShaper,
  FallbackTextShaper,
  HarfBuzzTextShaper,
  type HarfBuzzBuffer,
  type HarfBuzzFont,
  type HarfBuzzWasmApi,
  type ResolvedFontFace,
} from './shaper.js';

describe('Text Shaper Architecture & Fallback Engine (P4-09)', () => {
  const defaultFontFace: ResolvedFontFace = {
    faceId: 1,
    family: 'Calibri',
    unitsPerEm: 2048,
  };

  const arabicFontFace: ResolvedFontFace = {
    faceId: 2,
    family: 'Amiri',
    unitsPerEm: 2048,
  };

  describe('FallbackTextShaper', () => {
    const shaper = new FallbackTextShaper();

    it('shapes standard Latin text into uniform visual clusters', () => {
      const subRun: SubRun = {
        text: 'Word',
        fontFamily: 'Calibri',
        fontSize: 24, // 12pt = 24 half-points = 240 twips per em
        script: 'ascii',
        bidiLevel: 0,
        srcOffset: 0,
        srcLength: 4,
      };

      const shaped = shaper.shape(subRun, defaultFontFace);
      expect(shaped.clusterCount).toBe(4);
      expect(shaped.direction).toBe('ltr');
      expect(shaped.totalAdvance).toBeGreaterThan(0);

      // Verify logical offsets and lengths tile source
      expect(shaped.srcOffset(0)).toBe(0);
      expect(shaped.srcLength(0)).toBe(1);
      expect(shaped.srcOffset(3)).toBe(3);
      expect(shaped.srcLength(3)).toBe(1);
    });

    it('forms Latin ligatures when liga feature is enabled, preserves individual characters when disabled', () => {
      const subRun: SubRun = {
        text: 'office',
        fontFamily: 'Calibri',
        fontSize: 24,
        script: 'ascii',
        bidiLevel: 0,
        srcOffset: 10,
        srcLength: 6,
      };

      // With liga enabled (default)
      const shapedWithLiga = shaper.shape(subRun, defaultFontFace, { liga: true });
      // 'o' (0), 'ffi' ligature (1), 'c' (2), 'e' (3) -> 4 clusters
      expect(shapedWithLiga.clusterCount).toBe(4);
      expect(shapedWithLiga.glyphId(1)).toBe(0xfb03); // ffi ligature
      expect(shapedWithLiga.srcOffset(1)).toBe(11); // 'ffi' starts at 10 + 1 = 11
      expect(shapedWithLiga.srcLength(1)).toBe(3); // spans 3 code units

      // With liga disabled
      const shapedWithoutLiga = shaper.shape(subRun, defaultFontFace, { liga: false });
      // All 6 characters separate
      expect(shapedWithoutLiga.clusterCount).toBe(6);
      expect(shapedWithoutLiga.glyphId(1)).toBe(0x66); // 'f'
      expect(shapedWithoutLiga.srcLength(1)).toBe(1);
    });

    it('applies pair kerning when kern is enabled', () => {
      const subRun: SubRun = {
        text: 'AV',
        fontFamily: 'Calibri',
        fontSize: 24,
        script: 'ascii',
        bidiLevel: 0,
        srcOffset: 0,
        srcLength: 2,
      };

      const shapedWithKern = shaper.shape(subRun, defaultFontFace, { kern: true });
      const shapedWithoutKern = shaper.shape(subRun, defaultFontFace, { kern: false });

      // 'A' before 'V' has a negative kerning adjustment, reducing total advance
      expect(shapedWithKern.totalAdvance).toBeLessThan(shapedWithoutKern.totalAdvance);
    });

    it('shapes Arabic text with contextual cursive joining and emits in visual order', () => {
      // Logical string: "كتب" (ك: initial 0xFEDB, ت: medial 0xFE98, ب: final 0xFE90)
      const subRun: SubRun = {
        text: 'كتب',
        fontFamily: 'Amiri',
        fontSize: 28,
        script: 'cs',
        bidiLevel: 1, // RTL
        srcOffset: 0,
        srcLength: 3,
      };

      const shaped = shaper.shape(subRun, arabicFontFace);
      expect(shaped.direction).toBe('rtl');
      expect(shaped.clusterCount).toBe(3);

      // In RTL, clusters are emitted in VISUAL order (left-to-right screen order).
      // Leftmost on screen is the word's end: ب (final form, logical index 2)
      expect(shaped.glyphId(0)).toBe(0xfe90); // Ba final
      expect(shaped.srcOffset(0)).toBe(2);

      // Middle on screen is ت (medial form, logical index 1)
      expect(shaped.glyphId(1)).toBe(0xfe98); // Ta medial
      expect(shaped.srcOffset(1)).toBe(1);

      // Rightmost on screen is the word's beginning: ك (initial form, logical index 0)
      expect(shaped.glyphId(2)).toBe(0xfedb); // Kaf initial
      expect(shaped.srcOffset(2)).toBe(0);

      // Verify binary search maps logical offsets correctly to visual indices
      expect(shaped.clusterAtSourceOffset(0)).toBe(2);
      expect(shaped.clusterAtSourceOffset(1)).toBe(1);
      expect(shaped.clusterAtSourceOffset(2)).toBe(0);
    });

    it('forms Arabic Lam-Alif ligatures', () => {
      // Logical string: "لا" (Lam + Alif)
      const subRun: SubRun = {
        text: 'لا',
        fontFamily: 'Amiri',
        fontSize: 28,
        script: 'cs',
        bidiLevel: 1,
        srcOffset: 5,
        srcLength: 2,
      };

      const shaped = shaper.shape(subRun, arabicFontFace);
      expect(shaped.clusterCount).toBe(1);
      expect(shaped.glyphId(0)).toBe(0xfefb); // Isolated Lam-Alif ligature
      expect(shaped.srcOffset(0)).toBe(5);
      expect(shaped.srcLength(0)).toBe(2);
      expect(shaped.clusterAtSourceOffset(5)).toBe(0);
      expect(shaped.clusterAtSourceOffset(6)).toBe(0);
    });

    it('applies vertical substitution for CJK punctuation with vert feature', () => {
      const subRun: SubRun = {
        text: '\u3001', // CJK comma
        fontFamily: 'SimSun',
        fontSize: 24,
        script: 'eastAsia',
        bidiLevel: 0,
        srcOffset: 0,
        srcLength: 1,
      };

      const shapedVert = shaper.shape(subRun, defaultFontFace, { vert: true });
      expect(shapedVert.glyphId(0)).toBe(0xfe11); // vertical comma

      const shapedHoriz = shaper.shape(subRun, defaultFontFace, { vert: false });
      expect(shapedHoriz.glyphId(0)).toBe(0x3001); // horizontal comma
    });
  });

  describe('HarfBuzzTextShaper & Adapter', () => {
    it('caches font blobs by faceId and reuses buffers across shaping calls', () => {
      let createBlobCount = 0;
      let createFaceCount = 0;
      let createFontCount = 0;
      let createBufferCount = 0;
      let bufferResetCount = 0;

      const mockBuffer: HarfBuzzBuffer = {
        addText: vi.fn(),
        setDirection: vi.fn(),
        setScript: vi.fn(),
        setLanguage: vi.fn(),
        guessSegmentProperties: vi.fn(),
        clear: vi.fn(),
        reset: vi.fn(() => {
          bufferResetCount++;
        }),
        destroy: vi.fn(),
        json: vi.fn(() => [
          { g: 65, cl: 0, ax: 1000, ay: 0, dx: 0, dy: 0 },
          { g: 66, cl: 1, ax: 1000, ay: 0, dx: 0, dy: 0 },
        ]),
      };

      const mockHbFont: HarfBuzzFont = {
        destroy: vi.fn(),
      };

      const mockHbApi: HarfBuzzWasmApi = {
        createBlob: vi.fn(() => {
          createBlobCount++;
          return { destroy: vi.fn() };
        }),
        createFace: vi.fn(() => {
          createFaceCount++;
          return { destroy: vi.fn() };
        }),
        createFont: vi.fn(() => {
          createFontCount++;
          return mockHbFont;
        }),
        createBuffer: vi.fn(() => {
          createBufferCount++;
          return mockBuffer;
        }),
        shape: vi.fn(),
      };

      const shaper = new HarfBuzzTextShaper(mockHbApi);
      const fontFaceWithBytes: ResolvedFontFace = {
        faceId: 99,
        family: 'CustomFont',
        data: new Uint8Array([0, 1, 2, 3]),
        unitsPerEm: 2048,
      };

      const subRun: SubRun = {
        text: 'AB',
        fontFamily: 'CustomFont',
        fontSize: 24,
        script: 'ascii',
        bidiLevel: 0,
        srcOffset: 0,
        srcLength: 2,
      };

      // First run: uploads font and instantiates buffer
      const run1 = shaper.shape(subRun, fontFaceWithBytes);
      expect(createBlobCount).toBe(1);
      expect(createFaceCount).toBe(1);
      expect(createFontCount).toBe(1);
      expect(createBufferCount).toBe(1);
      expect(shaper.getFontPreparationCount()).toBe(1);
      expect(shaper.isFontCached(99)).toBe(true);
      expect(run1.clusterCount).toBe(2);

      // Second run: MUST reuse font and single buffer (no new allocation)
      const run2 = shaper.shape(subRun, fontFaceWithBytes);
      expect(createBlobCount).toBe(1); // Not incremented!
      expect(createFaceCount).toBe(1); // Not incremented!
      expect(createFontCount).toBe(1); // Not incremented!
      expect(createBufferCount).toBe(1); // Reused!
      expect(bufferResetCount).toBe(2); // Buffer was reset and reused
      expect(run2.clusterCount).toBe(2);

      // Clear font cache
      shaper.clearFontCache();
      expect(shaper.isFontCached(99)).toBe(false);
      expect(shaper.getFontPreparationCount()).toBe(0);
    });

    it('seamlessly delegates to fallback when font has no binary data', () => {
      const mockHbApi: HarfBuzzWasmApi = {
        createBlob: vi.fn(),
        createFace: vi.fn(),
        createFont: vi.fn(),
        createBuffer: vi.fn(),
        shape: vi.fn(),
      };

      const shaper = createTextShaper(mockHbApi);
      const subRun: SubRun = {
        text: 'Hello',
        fontFamily: 'Calibri',
        fontSize: 22,
        script: 'ascii',
        bidiLevel: 0,
        srcOffset: 0,
        srcLength: 5,
      };

      // Font face without .data
      const shaped = shaper.shape(subRun, defaultFontFace);
      expect(shaped.clusterCount).toBe(5);
      expect(shaped.totalAdvance).toBeGreaterThan(0);
      // HarfBuzz WASM createBlob was not invoked
      expect(mockHbApi.createBlob).not.toHaveBeenCalled();
    });
  });
});
