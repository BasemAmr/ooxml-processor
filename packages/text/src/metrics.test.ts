import { describe, expect, it } from 'vitest';
import {
  FONT_METRICS_STRATEGY,
  OS2_FS_SELECTION_USE_TYPO_METRICS,
  parseFontTables,
  parseSfntTableDirectory,
  reconcileFontMetrics,
  scaleFontMetrics,
  type RawFontMetrics,
} from './metrics.js';

/**
 * Builds a binary TrueType/OpenType font buffer with head, hhea, and OS/2 tables.
 */
function buildMockFontBuffer(options: {
  unitsPerEm?: number;
  hheaAscender?: number;
  hheaDescender?: number;
  hheaLineGap?: number;
  os2FsSelection?: number;
  os2TypoAscender?: number;
  os2TypoDescender?: number;
  os2TypoLineGap?: number;
  os2WinAscent?: number;
  os2WinDescent?: number;
  os2Version?: number;
  os2SxHeight?: number;
  os2SCapHeight?: number;
}): Uint8Array {
  const unitsPerEm = options.unitsPerEm ?? 2048;
  const hheaAscender = options.hheaAscender ?? 1900;
  const hheaDescender = options.hheaDescender ?? -500;
  const hheaLineGap = options.hheaLineGap ?? 140;
  const fsSelection = options.os2FsSelection ?? 0;
  const typoAscender = options.os2TypoAscender ?? 1800;
  const typoDescender = options.os2TypoDescender ?? -400;
  const typoLineGap = options.os2TypoLineGap ?? 200;
  const winAscent = options.os2WinAscent ?? 2100;
  const winDescent = options.os2WinDescent ?? 600;
  const os2Version = options.os2Version ?? 2;
  const sxHeight = options.os2SxHeight ?? 1100;
  const sCapHeight = options.os2SCapHeight ?? 1450;

  // sfnt header: 12 bytes + 3 table records (16 bytes each) = 60 bytes
  // Table 1: head (54 bytes)
  // Table 2: hhea (36 bytes)
  // Table 3: OS/2 (96 bytes for v2)
  const headOffset = 64;
  const headLength = 54;
  const hheaOffset = 128;
  const hheaLength = 36;
  const os2Offset = 176;
  const os2Length = 96;

  const totalSize = os2Offset + os2Length;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // sfnt header: 0x00010000 TrueType
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, 3, false); // 3 tables
  view.setUint16(6, 32, false);
  view.setUint16(8, 1, false);
  view.setUint16(10, 16, false);

  // Table record 1: 'head'
  // Tag: 0x68656164
  view.setUint32(12, 0x68656164, false);
  view.setUint32(16, 0, false);
  view.setUint32(20, headOffset, false);
  view.setUint32(24, headLength, false);

  // Table record 2: 'hhea'
  // Tag: 0x68686561
  view.setUint32(28, 0x68686561, false);
  view.setUint32(32, 0, false);
  view.setUint32(36, hheaOffset, false);
  view.setUint32(40, hheaLength, false);

  // Table record 3: 'OS/2'
  // Tag: 0x4F532F32
  view.setUint32(44, 0x4f532f32, false);
  view.setUint32(48, 0, false);
  view.setUint32(52, os2Offset, false);
  view.setUint32(56, os2Length, false);

  // Fill 'head' table: unitsPerEm at offset + 18
  view.setUint16(headOffset + 18, unitsPerEm, false);

  // Fill 'hhea' table: ascender at +4, descender at +6, lineGap at +8
  view.setInt16(hheaOffset + 4, hheaAscender, false);
  view.setInt16(hheaOffset + 6, hheaDescender, false);
  view.setInt16(hheaOffset + 8, hheaLineGap, false);

  // Fill 'OS/2' table:
  view.setUint16(os2Offset + 0, os2Version, false);
  view.setUint16(os2Offset + 62, fsSelection, false);
  view.setInt16(os2Offset + 68, typoAscender, false);
  view.setInt16(os2Offset + 70, typoDescender, false);
  view.setInt16(os2Offset + 72, typoLineGap, false);
  view.setUint16(os2Offset + 74, winAscent, false);
  view.setUint16(os2Offset + 76, winDescent, false);
  if (os2Version >= 2) {
    view.setInt16(os2Offset + 86, sxHeight, false);
    view.setInt16(os2Offset + 88, sCapHeight, false);
  }

  return buffer;
}

describe('Font Metrics (P4-13)', () => {
  describe('Binary OpenType table parsing', () => {
    it('parses sfnt directory and extracts head, hhea, and OS/2 tables', () => {
      const buf = buildMockFontBuffer({
        unitsPerEm: 1000,
        hheaAscender: 800,
        hheaDescender: -200,
        hheaLineGap: 100,
        os2FsSelection: OS2_FS_SELECTION_USE_TYPO_METRICS,
        os2TypoAscender: 750,
        os2TypoDescender: -250,
        os2TypoLineGap: 120,
        os2WinAscent: 850,
        os2WinDescent: 300,
        os2Version: 2,
        os2SxHeight: 500,
        os2SCapHeight: 700,
      });

      const dir = parseSfntTableDirectory(buf);
      expect(dir.has('head')).toBe(true);
      expect(dir.has('hhea')).toBe(true);
      expect(dir.has('OS/2')).toBe(true);

      const parsed = parseFontTables(buf);
      expect(parsed.unitsPerEm).toBe(1000);
      expect(parsed.head?.unitsPerEm).toBe(1000);

      expect(parsed.hhea).toEqual({
        ascender: 800,
        descender: -200,
        lineGap: 100,
      });

      expect(parsed.os2?.version).toBe(2);
      expect(parsed.os2?.fsSelection).toBe(OS2_FS_SELECTION_USE_TYPO_METRICS);
      expect(parsed.os2?.sTypoAscender).toBe(750);
      expect(parsed.os2?.sTypoDescender).toBe(-250);
      expect(parsed.os2?.sTypoLineGap).toBe(120);
      expect(parsed.os2?.usWinAscent).toBe(850);
      expect(parsed.os2?.usWinDescent).toBe(300);
      expect(parsed.os2?.sxHeight).toBe(500);
      expect(parsed.os2?.sCapHeight).toBe(700);
    });

    it('handles buffer with missing optional tables gracefully', () => {
      const minimal = new Uint8Array(12);
      const view = new DataView(minimal.buffer);
      view.setUint32(0, 0x00010000, false);
      view.setUint16(4, 0, false); // 0 tables

      const parsed = parseFontTables(minimal);
      expect(parsed.unitsPerEm).toBe(1000);
      expect(parsed.hhea).toBeUndefined();
      expect(parsed.os2).toBeUndefined();
    });
  });

  describe('Reconciling competing metrics', () => {
    const rawWithTypoBit: RawFontMetrics = {
      unitsPerEm: 2048,
      hhea: {
        ascender: 1950,
        descender: -550,
        lineGap: 100,
      },
      os2: {
        version: 4,
        fsSelection: OS2_FS_SELECTION_USE_TYPO_METRICS, // Bit 7 set
        sTypoAscender: 1700,
        sTypoDescender: -430,
        sTypoLineGap: 250,
        usWinAscent: 2150,
        usWinDescent: 620,
      },
    };

    it('prioritizes OS/2 Typo metrics when USE_TYPO_METRICS (bit 7) is set', () => {
      const reconciled = reconcileFontMetrics(rawWithTypoBit);

      expect(reconciled.useTypoMetrics).toBe(true);
      expect(reconciled.source).toBe('typo-metrics');
      expect(reconciled.ascent).toBe(1700);
      expect(reconciled.descent).toBe(-430);
      expect(reconciled.lineGap).toBe(250);
      // Line spacing = 1700 - (-430) + 250 = 2380
      expect(reconciled.lineSpacing).toBe(2380);
    });

    const rawWithoutTypoBit: RawFontMetrics = {
      unitsPerEm: 2048,
      hhea: {
        ascender: 1950,
        descender: -550,
        lineGap: 100,
      },
      os2: {
        version: 3,
        fsSelection: 0, // Bit 7 NOT set
        sTypoAscender: 1700,
        sTypoDescender: -430,
        sTypoLineGap: 250,
        usWinAscent: 2150,
        usWinDescent: 620,
      },
    };

    it('applies FONT_METRICS_STRATEGY (win-metrics-zero-gap) when USE_TYPO_METRICS is unset', () => {
      expect(FONT_METRICS_STRATEGY).toBe('win-metrics-zero-gap');

      const reconciled = reconcileFontMetrics(rawWithoutTypoBit);

      expect(reconciled.useTypoMetrics).toBe(false);
      expect(reconciled.source).toBe('win-metrics');
      expect(reconciled.ascent).toBe(2150);
      expect(reconciled.descent).toBe(-620);
      expect(reconciled.lineGap).toBe(0);
      // Line spacing = 2150 - (-620) + 0 = 2770
      expect(reconciled.lineSpacing).toBe(2770);
    });

    it('supports hhea-metrics fallback strategy override', () => {
      const reconciled = reconcileFontMetrics(rawWithoutTypoBit, 'hhea-metrics');

      expect(reconciled.source).toBe('hhea-metrics');
      expect(reconciled.ascent).toBe(1950);
      expect(reconciled.descent).toBe(-550);
      expect(reconciled.lineGap).toBe(100);
      // Line spacing = 1950 - (-550) + 100 = 2600
      expect(reconciled.lineSpacing).toBe(2600);
    });

    it('supports typo-metrics-always fallback strategy override', () => {
      const reconciled = reconcileFontMetrics(rawWithoutTypoBit, 'typo-metrics-always');

      expect(reconciled.source).toBe('typo-metrics');
      expect(reconciled.ascent).toBe(1700);
      expect(reconciled.descent).toBe(-430);
      expect(reconciled.lineGap).toBe(250);
    });

    it('falls back to hhea when OS/2 is absent under win-metrics strategy', () => {
      const rawOnlyHhea: RawFontMetrics = {
        unitsPerEm: 1000,
        hhea: {
          ascender: 800,
          descender: -200,
          lineGap: 50,
        },
      };

      const reconciled = reconcileFontMetrics(rawOnlyHhea, 'win-metrics-zero-gap');
      expect(reconciled.source).toBe('hhea-metrics');
      expect(reconciled.ascent).toBe(800);
      expect(reconciled.descent).toBe(-200);
      expect(reconciled.lineGap).toBe(50);
    });
  });

  describe('scaleFontMetrics', () => {
    it('scales metrics accurately to twips, points, and pixels', () => {
      const raw: RawFontMetrics = {
        unitsPerEm: 2000,
        os2: {
          version: 4,
          fsSelection: OS2_FS_SELECTION_USE_TYPO_METRICS,
          sTypoAscender: 1600, // 80%
          sTypoDescender: -400, // 20%
          sTypoLineGap: 200, // 10%
          usWinAscent: 1800,
          usWinDescent: 500,
        },
      };

      // 12pt font = 24 half-points = 240 twips = 16 pixels (at 96 DPI: 12 * 96 / 72 = 16)
      const scaled = scaleFontMetrics(raw, 24);

      expect(scaled.fontSizeHalfPoints).toBe(24);
      expect(scaled.unitsPerEm).toBe(2000);

      // Points: 12 pt emHeight
      expect(scaled.points.emHeight).toBe(12);
      expect(scaled.points.ascent).toBeCloseTo(12 * (1600 / 2000), 4); // 9.6 pt
      expect(scaled.points.descent).toBeCloseTo(12 * (-400 / 2000), 4); // -2.4 pt
      expect(scaled.points.lineGap).toBeCloseTo(12 * (200 / 2000), 4); // 1.2 pt
      expect(scaled.points.lineSpacing).toBeCloseTo(9.6 - -2.4 + 1.2, 4); // 13.2 pt

      // Twips: 240 twips emHeight
      expect(scaled.twips.emHeight).toBe(240);
      expect(scaled.twips.ascent).toBe(Math.round((1600 * 240) / 2000)); // 192 twips
      expect(scaled.twips.descent).toBe(Math.round((-400 * 240) / 2000)); // -48 twips
      expect(scaled.twips.lineGap).toBe(Math.round((200 * 240) / 2000)); // 24 twips
      expect(scaled.twips.lineSpacing).toBe(192 - -48 + 24); // 264 twips

      // Pixels: 16 px emHeight
      expect(scaled.pixels.emHeight).toBeCloseTo(16, 4);
      expect(scaled.pixels.ascent).toBeCloseTo(16 * (1600 / 2000), 4); // 12.8 px
      expect(scaled.pixels.descent).toBeCloseTo(16 * (-400 / 2000), 4); // -3.2 px
      expect(scaled.pixels.lineGap).toBeCloseTo(16 * (200 / 2000), 4); // 1.6 px
      expect(scaled.pixels.lineSpacing).toBeCloseTo(12.8 - -3.2 + 1.6, 4); // 17.6 px
    });
  });
});
