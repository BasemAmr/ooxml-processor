/**
 * Font Metrics Reconciliation and OpenType Table Parsing (P4-13).
 *
 * Implements Ticket P4-13.
 *
 * ## SPEC-GAP & UNVERIFIABLE-HERE
 *
 * OpenType fonts carry three competing metric sets that frequently disagree:
 *   1. `hhea` table: `ascender`, `descender`, `lineGap` (Mac QuickDraw heritage).
 *   2. `OS/2` table Typo metrics: `sTypoAscender`, `sTypoDescender`, `sTypoLineGap` (typographic intent).
 *   3. `OS/2` table Win metrics: `usWinAscent`, `usWinDescent` (Windows GDI clipping limits).
 *
 * In OpenType specification version 1.3+, `fsSelection` bit 7 (`USE_TYPO_METRICS`) was introduced:
 *   - If bit 7 is set (1), conforming renderers MUST use OS/2 typo metrics (`sTypoAscender`,
 *     `sTypoDescender`, `sTypoLineGap`) and ignore `hhea` / Win metrics for line layout.
 *   - If bit 7 is NOT set (0), the standard leaves the choice of fallback to the platform/application.
 *
 * WORD BEHAVIOR SPEC-GAP (F6 / G1):
 * On Windows, Microsoft Word's legacy and modern font metric resolution differs across engine versions:
 *   - Classic Word GDI layout (pre-2013 / compatibility mode) historically used `usWinAscent` and
 *     `usWinDescent` when bit 7 was clear, setting lineGap to 0. This prevented accent clipping
 *     but caused line spacing to explode on fonts with inflated clipping boxes.
 *   - DirectWrite and modern Word versions prioritize `USE_TYPO_METRICS` where set, but for legacy fonts
 *     (where bit 7 is 0) they apply complex heuristic clamping between `hhea` and `usWinAscent`.
 *
 * On this host (Linux/Docker/headless CI), live Microsoft Word is NOT runnable (UNVERIFIABLE-HERE per F6).
 * Therefore, we define the exact fallback behavior in a single named constant:
 *   `FONT_METRICS_STRATEGY`
 *
 * Later phases (Phase 5 Line Box, Phase 6 Caret/Selection, Phase 7 Pagination) MUST consume the reconciled
 * metrics produced by this module rather than reading raw tables. If comparison against a live Word instance
 * indicates an adjustment is needed, updating `FONT_METRICS_STRATEGY` fixes metric resolution document-wide.
 */

/**
 * Bit 7 in OS/2 table `fsSelection` field: USE_TYPO_METRICS.
 * When set, sTypoAscender, sTypoDescender, and sTypoLineGap take precedence over hhea/win metrics.
 */
export const OS2_FS_SELECTION_USE_TYPO_METRICS = 0x0080;

/**
 * Metric resolution strategy options when `USE_TYPO_METRICS` (fsSelection bit 7) is NOT set.
 */
export type FontMetricsStrategy =
  | 'win-metrics-zero-gap' // Classic Word GDI: ascent=usWinAscent, descent=-usWinDescent, lineGap=0
  | 'hhea-metrics' // Mac / WebKit fallback: ascent=hhea.ascender, descent=hhea.descender, lineGap=hhea.lineGap
  | 'typo-metrics-always'; // Spec-ideal fallback: sTypoAscender, sTypoDescender, sTypoLineGap

/**
 * Documented fallback strategy for fonts where fsSelection bit 7 is clear.
 *
 * SPEC-GAP / UNVERIFIABLE-HERE:
 * We default to 'win-metrics-zero-gap' because Word on Windows historically anchored line layout
 * to Windows GDI clipping bounds when USE_TYPO_METRICS was absent, preventing accent clipping
 * on standard Windows core fonts.
 */
export const FONT_METRICS_STRATEGY: FontMetricsStrategy = 'win-metrics-zero-gap';

/**
 * Parsed `head` table data relevant to metrics.
 */
export interface HeadTableMetrics {
  readonly unitsPerEm: number;
  readonly xMin?: number | undefined;
  readonly yMin?: number | undefined;
  readonly xMax?: number | undefined;
  readonly yMax?: number | undefined;
}

/**
 * Parsed `hhea` table metrics (horizontal header).
 */
export interface HheaTableMetrics {
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
}

/**
 * Parsed `OS/2` table metrics (OS/2 and Windows Metrics table).
 */
export interface Os2TableMetrics {
  readonly version: number;
  readonly fsSelection: number;
  readonly sTypoAscender: number;
  readonly sTypoDescender: number;
  readonly sTypoLineGap: number;
  readonly usWinAscent: number;
  readonly usWinDescent: number;
  readonly sxHeight?: number | undefined;
  readonly sCapHeight?: number | undefined;
}

/**
 * Raw OpenType metrics collected from font tables before reconciliation.
 */
export interface RawFontMetrics {
  readonly unitsPerEm: number;
  readonly head?: HeadTableMetrics | undefined;
  readonly hhea?: HheaTableMetrics | undefined;
  readonly os2?: Os2TableMetrics | undefined;
}

/**
 * Reconciled font metrics in font design units (FUnits).
 */
export interface ReconciledFontMetrics {
  readonly unitsPerEm: number;
  /** Distance from baseline to top of font ascender in font units (positive) */
  readonly ascent: number;
  /** Distance from baseline to bottom of font descender in font units (negative) */
  readonly descent: number;
  /** Additional line gap between lines in font units (>= 0) */
  readonly lineGap: number;
  /** Total line height = ascent - descent + lineGap */
  readonly lineSpacing: number;
  /** True if OS/2 fsSelection bit 7 (USE_TYPO_METRICS) was set */
  readonly useTypoMetrics: boolean;
  /** Metric set source that determined the final metrics */
  readonly source: 'typo-metrics' | 'win-metrics' | 'hhea-metrics';
  /** Optional x-height in font units (if present in OS/2 v2+) */
  readonly xHeight?: number | undefined;
  /** Optional cap-height in font units (if present in OS/2 v2+) */
  readonly capHeight?: number | undefined;
}

/**
 * Scaled metric values in a specific typographic measurement unit.
 */
export interface MetricDimensions {
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly lineSpacing: number;
  readonly emHeight: number;
}

/**
 * Font metrics scaled to a specific font size, expressed across twips, points, and pixels.
 */
export interface ScaledFontMetrics {
  readonly fontSizeHalfPoints: number;
  readonly unitsPerEm: number;
  readonly twips: MetricDimensions;
  readonly points: MetricDimensions;
  readonly pixels: MetricDimensions;
  readonly reconciled: ReconciledFontMetrics;
}

/**
 * Parses table records from the sfnt table directory of an OpenType/TrueType font.
 */
export function parseSfntTableDirectory(
  buffer: ArrayBuffer | Uint8Array,
): Map<string, { offset: number; length: number }> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.byteLength < 12) {
    throw new Error('Font buffer too small to contain sfnt table directory header.');
  }

  const numTables = view.getUint16(4, false);
  const tables = new Map<string, { offset: number; length: number }>();

  let recordOffset = 12;
  for (let i = 0; i < numTables; i++) {
    if (recordOffset + 16 > view.byteLength) break;

    // Tag is 4 ASCII characters (e.g. 'head', 'hhea', 'OS/2')
    const tag = String.fromCharCode(
      view.getUint8(recordOffset),
      view.getUint8(recordOffset + 1),
      view.getUint8(recordOffset + 2),
      view.getUint8(recordOffset + 3),
    );
    const offset = view.getUint32(recordOffset + 8, false);
    const length = view.getUint32(recordOffset + 12, false);

    tables.set(tag, { offset, length });
    recordOffset += 16;
  }

  return tables;
}

/**
 * Parses raw OpenType font tables (`head`, `hhea`, `OS/2`) from a font buffer.
 */
export function parseFontTables(buffer: ArrayBuffer | Uint8Array): RawFontMetrics {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = parseSfntTableDirectory(bytes);

  // 1. Parse 'head' table
  const headRecord = tables.get('head');
  let head: HeadTableMetrics | undefined;
  let unitsPerEm = 1000; // Standard fallback for CFF

  if (headRecord && headRecord.offset + 44 <= view.byteLength) {
    const o = headRecord.offset;
    unitsPerEm = view.getUint16(o + 18, false);
    head = {
      unitsPerEm,
      xMin: view.getInt16(o + 36, false),
      yMin: view.getInt16(o + 38, false),
      xMax: view.getInt16(o + 40, false),
      yMax: view.getInt16(o + 42, false),
    };
  }

  // 2. Parse 'hhea' table
  const hheaRecord = tables.get('hhea');
  let hhea: HheaTableMetrics | undefined;
  if (hheaRecord && hheaRecord.offset + 10 <= view.byteLength) {
    const o = hheaRecord.offset;
    hhea = {
      ascender: view.getInt16(o + 4, false),
      descender: view.getInt16(o + 6, false),
      lineGap: view.getInt16(o + 8, false),
    };
  }

  // 3. Parse 'OS/2' table
  const os2Record = tables.get('OS/2');
  let os2: Os2TableMetrics | undefined;
  if (os2Record && os2Record.offset + 78 <= view.byteLength) {
    const o = os2Record.offset;
    const version = view.getUint16(o, false);
    const fsSelection = view.getUint16(o + 62, false);
    const sTypoAscender = view.getInt16(o + 68, false);
    const sTypoDescender = view.getInt16(o + 70, false);
    const sTypoLineGap = view.getInt16(o + 72, false);
    const usWinAscent = view.getUint16(o + 74, false);
    const usWinDescent = view.getUint16(o + 76, false);

    let sxHeight: number | undefined;
    let sCapHeight: number | undefined;
    // Version 2 and above adds sxHeight (offset 86) and sCapHeight (offset 88)
    if (version >= 2 && os2Record.length >= 90 && o + 90 <= view.byteLength) {
      sxHeight = view.getInt16(o + 86, false);
      sCapHeight = view.getInt16(o + 88, false);
    }

    os2 = {
      version,
      fsSelection,
      sTypoAscender,
      sTypoDescender,
      sTypoLineGap,
      usWinAscent,
      usWinDescent,
      sxHeight,
      sCapHeight,
    };
  }

  return {
    unitsPerEm,
    head,
    hhea,
    os2,
  };
}

/**
 * Reconciles competing OpenType font metric sets according to the OpenType spec
 * and the configured FONT_METRICS_STRATEGY.
 */
export function reconcileFontMetrics(
  raw: RawFontMetrics,
  strategy: FontMetricsStrategy = FONT_METRICS_STRATEGY,
): ReconciledFontMetrics {
  const unitsPerEm = raw.unitsPerEm > 0 ? raw.unitsPerEm : 1000;
  const os2 = raw.os2;
  const hhea = raw.hhea;

  // Check fsSelection bit 7: USE_TYPO_METRICS
  const useTypoMetrics =
    os2 !== undefined && (os2.fsSelection & OS2_FS_SELECTION_USE_TYPO_METRICS) !== 0;

  let ascent: number;
  let descent: number;
  let lineGap: number;
  let source: 'typo-metrics' | 'win-metrics' | 'hhea-metrics';

  if (useTypoMetrics && os2 !== undefined) {
    // OpenType spec 1.3+: USE_TYPO_METRICS bit 7 dominates all other metric sets
    ascent = os2.sTypoAscender;
    // Descender in typo metrics is signed (normally negative). We ensure it is non-positive.
    descent = os2.sTypoDescender <= 0 ? os2.sTypoDescender : -os2.sTypoDescender;
    lineGap = Math.max(0, os2.sTypoLineGap);
    source = 'typo-metrics';
  } else {
    // Bit 7 is unset: apply fallback strategy
    switch (strategy) {
      case 'win-metrics-zero-gap': {
        if (os2 !== undefined) {
          ascent = os2.usWinAscent;
          // usWinDescent is an unsigned magnitude; descent in font coordinates is negative
          descent = -os2.usWinDescent;
          lineGap = 0;
          source = 'win-metrics';
        } else if (hhea !== undefined) {
          ascent = hhea.ascender;
          descent = hhea.descender <= 0 ? hhea.descender : -hhea.descender;
          lineGap = Math.max(0, hhea.lineGap);
          source = 'hhea-metrics';
        } else {
          // Ultimate fallback: typical default proportions (80% ascent, 20% descent)
          ascent = Math.round(unitsPerEm * 0.8);
          descent = -Math.round(unitsPerEm * 0.2);
          lineGap = 0;
          source = 'win-metrics';
        }
        break;
      }

      case 'hhea-metrics': {
        if (hhea !== undefined) {
          ascent = hhea.ascender;
          descent = hhea.descender <= 0 ? hhea.descender : -hhea.descender;
          lineGap = Math.max(0, hhea.lineGap);
          source = 'hhea-metrics';
        } else if (os2 !== undefined) {
          ascent = os2.sTypoAscender;
          descent = os2.sTypoDescender <= 0 ? os2.sTypoDescender : -os2.sTypoDescender;
          lineGap = Math.max(0, os2.sTypoLineGap);
          source = 'typo-metrics';
        } else {
          ascent = Math.round(unitsPerEm * 0.8);
          descent = -Math.round(unitsPerEm * 0.2);
          lineGap = 0;
          source = 'hhea-metrics';
        }
        break;
      }

      case 'typo-metrics-always':
      default: {
        if (os2 !== undefined) {
          ascent = os2.sTypoAscender;
          descent = os2.sTypoDescender <= 0 ? os2.sTypoDescender : -os2.sTypoDescender;
          lineGap = Math.max(0, os2.sTypoLineGap);
          source = 'typo-metrics';
        } else if (hhea !== undefined) {
          ascent = hhea.ascender;
          descent = hhea.descender <= 0 ? hhea.descender : -hhea.descender;
          lineGap = Math.max(0, hhea.lineGap);
          source = 'hhea-metrics';
        } else {
          ascent = Math.round(unitsPerEm * 0.8);
          descent = -Math.round(unitsPerEm * 0.2);
          lineGap = 0;
          source = 'typo-metrics';
        }
        break;
      }
    }
  }

  const lineSpacing = ascent - descent + lineGap;

  return {
    unitsPerEm,
    ascent,
    descent,
    lineGap,
    lineSpacing,
    useTypoMetrics,
    source,
    xHeight: os2?.sxHeight,
    capHeight: os2?.sCapHeight,
  };
}

/**
 * Scales font metrics to a specified font size in half-points.
 *
 * OOXML Measurement Units:
 *   - fontSizeHalfPoints: 1 pt = 2 half-points (e.g. 24 for 12 pt).
 *   - 1 pt = 20 twips (twip = twentieth of an imperial point).
 *   - fontSizeTwips = fontSizeHalfPoints * 10.
 *   - In 96-DPI CSS/Canvas pixels: 1 pt = 96/72 px = 4/3 px.
 *     1 twip = 1/20 pt = 96 / (72 * 20) px = 1/15 px = 0.066666... px.
 *
 * @param input Raw or already-reconciled font metrics.
 * @param fontSizeHalfPoints Font size in half-points (e.g. 22 for 11pt Calibri).
 * @param strategy Fallback strategy if input is raw metrics.
 */
export function scaleFontMetrics(
  input: RawFontMetrics | ReconciledFontMetrics,
  fontSizeHalfPoints: number,
  strategy: FontMetricsStrategy = FONT_METRICS_STRATEGY,
): ScaledFontMetrics {
  const reconciled: ReconciledFontMetrics =
    'source' in input ? input : reconcileFontMetrics(input, strategy);

  const em = reconciled.unitsPerEm > 0 ? reconciled.unitsPerEm : 1000;

  // Font size in points: fontSizeHalfPoints / 2
  const ptSize = fontSizeHalfPoints / 2;
  // Font size in twips: (fontSizeHalfPoints / 2) * 20 = fontSizeHalfPoints * 10
  const twipSize = fontSizeHalfPoints * 10;
  // Font size in pixels: ptSize * (96 / 72) = ptSize * (4 / 3)
  const pxSize = ptSize * (4 / 3);

  // Twip scaling (rounded to whole twips for layout box stability)
  const toTwips = (funits: number) => Math.round((funits * twipSize) / em);
  const twipAscent = toTwips(reconciled.ascent);
  const twipDescent = toTwips(reconciled.descent);
  const twipLineGap = toTwips(reconciled.lineGap);
  const twipLineSpacing = twipAscent - twipDescent + twipLineGap;

  // Points scaling
  const toPoints = (funits: number) => (funits * ptSize) / em;
  const ptAscent = toPoints(reconciled.ascent);
  const ptDescent = toPoints(reconciled.descent);
  const ptLineGap = toPoints(reconciled.lineGap);
  const ptLineSpacing = ptAscent - ptDescent + ptLineGap;

  // Pixels scaling
  const toPixels = (funits: number) => (funits * pxSize) / em;
  const pxAscent = toPixels(reconciled.ascent);
  const pxDescent = toPixels(reconciled.descent);
  const pxLineGap = toPixels(reconciled.lineGap);
  const pxLineSpacing = pxAscent - pxDescent + pxLineGap;

  return {
    fontSizeHalfPoints,
    unitsPerEm: em,
    twips: {
      ascent: twipAscent,
      descent: twipDescent,
      lineGap: twipLineGap,
      lineSpacing: twipLineSpacing,
      emHeight: twipSize,
    },
    points: {
      ascent: ptAscent,
      descent: ptDescent,
      lineGap: ptLineGap,
      lineSpacing: ptLineSpacing,
      emHeight: ptSize,
    },
    pixels: {
      ascent: pxAscent,
      descent: pxDescent,
      lineGap: pxLineGap,
      lineSpacing: pxLineSpacing,
      emHeight: pxSize,
    },
    reconciled,
  };
}
