/**
 * Vertical Text and East Asian (CJK) Layout (P4-14).
 *
 * Implements Ticket P4-14.
 *
 * Architectural Invariants:
 *   1. Unified TextOrientation Model:
 *      Single canonical enum shared across P4-14, P7-11 (`w:textDirection`), and P9-16 (`a:bodyPr/@vert`).
 *      Prevents divergent orientation handling across WordprocessingML and DrawingML.
 *   2. East Asian Layout Modeling:
 *      Models `CT_EastAsianLayout` attributes (`@combine`, `@combineBrackets`, `@vert`, `@vertCompress`).
 *      In Tate-chū-yoko (`@combine`), 2–4 horizontal characters are set within a 1-em square box
 *      wrapped with the specified bracket pair.
 *   3. OpenType Vertical Features:
 *      Vertical runs activate 'vert' and 'vrt2' feature tags for vertical glyph substitution.
 *      Runs marked with `@combine` (horizontal-in-vertical) do NOT activate vertical features.
 *   4. Vertical Metrics Fallback:
 *      Latin and many CJK-incomplete fonts lack `vhea` / `vmtx` tables. When vertical metrics tables
 *      are absent, vertical advances and origins are synthesised deterministically:
 *        advance = unitsPerEm
 *        originX = -horizontalAdvance / 2 (centers glyph on vertical line)
 *        originY = ascender
 */

import type { CT_EastAsianLayout, ST_CombineBrackets, ST_TextDirection } from '@ooxml/schema';
import { dmlMainTypes, runtime } from '@ooxml/schema';
import { parseSfntTableDirectory } from './metrics.js';

export type ST_TextVerticalType = dmlMainTypes.ST_TextVerticalType;

/**
 * Canonical text orientation enum shared across OOXML formats.
 *
 * Mappings:
 *   - 'horizontal': standard horizontal layout (WML `lrTb`, DML `horz`).
 *   - 'vertical-rl': top-to-bottom, lines advance right-to-left (classic CJK vertical; WML `tbRl`, DML `vert`, `eaVert`).
 *   - 'vertical-lr': top-to-bottom, lines advance left-to-right (Mongolian vertical; WML `tbLr`, DML `mongolianVert`).
 *   - 'sideways-rl': text rotated 90° CCW / 270° CW (bottom-to-top; WML `btLr`).
 *   - 'sideways-lr': text rotated 90° CW (top-to-bottom; DML `vert270`).
 */
export type TextOrientation =
  'horizontal' | 'vertical-rl' | 'vertical-lr' | 'sideways-rl' | 'sideways-lr';

/**
 * Checks whether the text orientation flows vertically or sideways.
 */
export function isVerticalOrientation(orientation: TextOrientation): boolean {
  return orientation !== 'horizontal';
}

/**
 * Checks whether the text orientation is true East Asian top-to-bottom vertical flow.
 */
export function isEastAsianVertical(orientation: TextOrientation): boolean {
  return orientation === 'vertical-rl' || orientation === 'vertical-lr';
}

/**
 * Checks whether the text orientation is sideways-rotated text.
 */
export function isSidewaysOrientation(orientation: TextOrientation): boolean {
  return orientation === 'sideways-rl' || orientation === 'sideways-lr';
}

/**
 * Maps WordprocessingML `w:textDirection` (`ST_TextDirection`) to canonical `TextOrientation`.
 */
export function textOrientationFromWml(
  dir?: ST_TextDirection | string | undefined,
): TextOrientation {
  if (!dir) return 'horizontal';

  switch (dir) {
    case 'tbRl':
    case 'tbRlV':
    case 'tb':
      return 'vertical-rl';

    case 'tbLr':
    case 'tbLrV':
      return 'vertical-lr';

    case 'btLr':
    case 'lrTbV':
      return 'sideways-rl';

    case 'lrTb':
    case 'lr':
    case 'rl':
    case 'rlV':
    case 'lrV':
    default:
      return 'horizontal';
  }
}

/**
 * Maps DrawingML `a:bodyPr/@vert` (`ST_TextVerticalType`) to canonical `TextOrientation`.
 */
export function textOrientationFromDml(
  vert?: ST_TextVerticalType | string | undefined,
): TextOrientation {
  if (!vert) return 'horizontal';

  switch (vert) {
    case 'vert':
    case 'eaVert':
    case 'wordArtVert':
    case 'wordArtVertRtl':
      return 'vertical-rl';

    case 'mongolianVert':
      return 'vertical-lr';

    case 'vert270':
      return 'sideways-lr';

    case 'horz':
    default:
      return 'horizontal';
  }
}

/**
 * Resolved East Asian layout properties for a run.
 */
export interface ResolvedEastAsianLayout {
  /** Horizontal-in-vertical (Tate-chū-yoko): combines multiple characters into 1 em box */
  readonly combine: boolean;
  /** Enclosing brackets style for combined characters */
  readonly combineBrackets: ST_CombineBrackets;
  /** Force upright vs rotated in vertical text flow */
  readonly vert: boolean;
  /** Punctuation compression in vertical text */
  readonly vertCompress: boolean;
  /** Optional layout ID from CT_EastAsianLayout */
  readonly id?: number | undefined;
}

/**
 * Default empty East Asian layout properties.
 */
export const DEFAULT_EAST_ASIAN_LAYOUT: ResolvedEastAsianLayout = Object.freeze({
  combine: false,
  combineBrackets: 'none',
  vert: false,
  vertCompress: false,
});

/**
 * Parses and resolves `CT_EastAsianLayout` AST attributes into a normalized struct.
 */
export function parseEastAsianLayout(
  layout?: CT_EastAsianLayout | undefined,
): ResolvedEastAsianLayout {
  if (!layout) return DEFAULT_EAST_ASIAN_LAYOUT;

  const parseBool = (val: unknown): boolean => {
    if (val === undefined || val === null) return false;
    if (typeof val === 'boolean') return val;
    try {
      return runtime.parseOnOff(val as any);
    } catch {
      return false;
    }
  };

  const combine = parseBool(layout.combine);
  const combineBrackets: ST_CombineBrackets = layout.combineBrackets ?? 'none';
  const vert = parseBool(layout.vert);
  const vertCompress = parseBool(layout.vertCompress);
  const id = layout.id !== undefined ? Number(layout.id) : undefined;

  return {
    combine,
    combineBrackets,
    vert,
    vertCompress,
    id,
  };
}

/**
 * Bracket character pairs for East Asian combined text (`ST_CombineBrackets`).
 */
export interface BracketPair {
  readonly open: string;
  readonly close: string;
}

/**
 * Returns bracket characters corresponding to the given `ST_CombineBrackets` style.
 */
export function getCombineBracketPairs(brackets: ST_CombineBrackets): BracketPair {
  switch (brackets) {
    case 'round':
      return { open: '(', close: ')' };
    case 'square':
      return { open: '[', close: ']' };
    case 'angle':
      // U+3008 LEFT ANGLE BRACKET and U+3009 RIGHT ANGLE BRACKET (standard CJK punctuation)
      return { open: '\u3008', close: '\u3009' };
    case 'curly':
      return { open: '{', close: '}' };
    case 'none':
    default:
      return { open: '', close: '' };
  }
}

/**
 * Formats combined horizontal-in-vertical text with its enclosing brackets.
 */
export function formatCombineText(text: string, brackets: ST_CombineBrackets): string {
  const pair = getCombineBracketPairs(brackets);
  return `${pair.open}${text}${pair.close}`;
}

/**
 * Selects OpenType feature tags applicable to a run given its orientation and East Asian layout.
 *
 * Rules:
 *   - In East Asian vertical text (`vertical-rl`, `vertical-lr`), activates `'vert'` (Vertical Alternates)
 *     and `'vrt2'` (Vertical Alternates and Rotation).
 *   - Exception: In Tate-chū-yoko (`combine: true`), the run is rendered horizontally inside the vertical line,
 *     so `'vert'` and `'vrt2'` are NOT activated.
 *   - If `vertCompress` is set, activates `'vhal'` (Alternate Half Widths in vertical flow) or `'halt'`.
 */
export function getVerticalOpenTypeFeatures(
  orientation: TextOrientation,
  layout?: ResolvedEastAsianLayout | CT_EastAsianLayout | undefined,
): readonly string[] {
  // Horizontal text has no vertical features
  if (!isEastAsianVertical(orientation)) {
    return Object.freeze([]);
  }

  const resolved = layout && 'combine' in layout ? layout : parseEastAsianLayout(layout);

  // Tate-chū-yoko renders horizontally: suppress vertical alternate glyphs
  if (resolved.combine) {
    return Object.freeze([]);
  }

  const features: string[] = ['vert', 'vrt2'];

  // Punctuation compression
  if (resolved.vertCompress) {
    features.push('vhal');
  }

  return Object.freeze(features);
}

/**
 * Vertical metrics for a glyph in font design units.
 */
export interface VerticalGlyphMetrics {
  /** Vertical advance height along the column direction (positive down) */
  readonly advance: number;
  /** X-coordinate origin offset relative to glyph horizontal origin (centers glyph on vertical line) */
  readonly originX: number;
  /** Y-coordinate origin offset relative to glyph horizontal origin (aligns to ascender) */
  readonly originY: number;
  /** Top side bearing in font units */
  readonly tsb: number;
  /** True if metrics were synthesized due to missing vhea/vmtx tables */
  readonly isSynthesized: boolean;
}

/**
 * Parsed `vhea` table data from OpenType font.
 */
export interface VheaTableMetrics {
  readonly vertTypoAscender: number;
  readonly vertTypoDescender: number;
  readonly vertTypoLineGap: number;
  readonly advanceHeightMax: number;
  readonly numOfLongVerMetrics: number;
}

/**
 * Parsed `vmtx` table data from OpenType font.
 */
export interface VmtxTableMetrics {
  readonly vAdvances: readonly number[];
  readonly topSideBearings: readonly number[];
}

/**
 * Parsed vertical font tables.
 */
export interface RawVerticalFontMetrics {
  readonly vhea?: VheaTableMetrics | undefined;
  readonly vmtx?: VmtxTableMetrics | undefined;
}

/**
 * Parses `vhea` and `vmtx` OpenType tables from raw font binary.
 */
export function parseVerticalFontTables(
  buffer: ArrayBuffer | Uint8Array,
  numGlyphs?: number,
): RawVerticalFontMetrics {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = parseSfntTableDirectory(bytes);

  const vheaRecord = tables.get('vhea');
  let vhea: VheaTableMetrics | undefined;

  if (vheaRecord && vheaRecord.offset + 36 <= view.byteLength) {
    const o = vheaRecord.offset;
    vhea = {
      vertTypoAscender: view.getInt16(o + 4, false),
      vertTypoDescender: view.getInt16(o + 6, false),
      vertTypoLineGap: view.getInt16(o + 8, false),
      advanceHeightMax: view.getUint16(o + 10, false),
      numOfLongVerMetrics: view.getUint16(o + 34, false),
    };
  }

  const vmtxRecord = tables.get('vmtx');
  let vmtx: VmtxTableMetrics | undefined;

  if (vmtxRecord && vhea) {
    const o = vmtxRecord.offset;
    const count = vhea.numOfLongVerMetrics;
    const vAdvances: number[] = [];
    const topSideBearings: number[] = [];

    let cur = o;
    for (let i = 0; i < count; i++) {
      if (cur + 4 > view.byteLength) break;
      vAdvances.push(view.getUint16(cur, false));
      topSideBearings.push(view.getInt16(cur + 2, false));
      cur += 4;
    }

    // Remaining glyphs share the last advance height
    if (numGlyphs && numGlyphs > count && vAdvances.length > 0) {
      const lastAdv = vAdvances[vAdvances.length - 1]!;
      for (let i = count; i < numGlyphs; i++) {
        if (cur + 2 > view.byteLength) break;
        vAdvances.push(lastAdv);
        topSideBearings.push(view.getInt16(cur, false));
        cur += 2;
      }
    }

    vmtx = {
      vAdvances,
      topSideBearings,
    };
  }

  return { vhea, vmtx };
}

/**
 * Synthesizes vertical glyph metrics when `vhea`/`vmtx` are absent (the standard case for Latin fonts).
 *
 * Formulas:
 *   advance = unitsPerEm
 *   originX = -horizontalAdvance / 2 (or -unitsPerEm / 2)
 *   originY = ascender
 *   tsb = 0
 */
export function synthesizeVerticalMetrics(options: {
  unitsPerEm: number;
  ascender: number;
  horizontalAdvance?: number | undefined;
}): VerticalGlyphMetrics {
  const em = options.unitsPerEm > 0 ? options.unitsPerEm : 1000;
  const hAdv =
    options.horizontalAdvance !== undefined && options.horizontalAdvance > 0
      ? options.horizontalAdvance
      : em;

  return {
    advance: em,
    originX: -Math.round(hAdv / 2),
    originY: options.ascender,
    tsb: 0,
    isSynthesized: true,
  };
}

/**
 * Resolves vertical metrics for a glyph, using `vhea`/`vmtx` if present or synthesizing if absent.
 */
export function resolveVerticalGlyphMetrics(options: {
  glyphId: number;
  unitsPerEm: number;
  ascender: number;
  horizontalAdvance?: number | undefined;
  rawVertical?: RawVerticalFontMetrics | undefined;
}): VerticalGlyphMetrics {
  const { glyphId, unitsPerEm, ascender, horizontalAdvance, rawVertical } = options;

  if (rawVertical?.vmtx && glyphId < rawVertical.vmtx.vAdvances.length) {
    const adv = rawVertical.vmtx.vAdvances[glyphId]!;
    const tsb = rawVertical.vmtx.topSideBearings[glyphId] ?? 0;
    const hAdv = horizontalAdvance ?? unitsPerEm;

    return {
      advance: adv,
      originX: -Math.round(hAdv / 2),
      originY: ascender,
      tsb,
      isSynthesized: false,
    };
  }

  return synthesizeVerticalMetrics({
    unitsPerEm,
    ascender,
    horizontalAdvance,
  });
}

/**
 * Scaled vertical metrics expressed across twips, points, and pixels.
 */
export interface ScaledVerticalMetrics {
  readonly advance: {
    readonly twips: number;
    readonly points: number;
    readonly pixels: number;
  };
  readonly originX: {
    readonly twips: number;
    readonly points: number;
    readonly pixels: number;
  };
  readonly originY: {
    readonly twips: number;
    readonly points: number;
    readonly pixels: number;
  };
  readonly isSynthesized: boolean;
}

/**
 * Scales vertical metrics to a specific font size in half-points.
 */
export function scaleVerticalMetrics(
  metrics: VerticalGlyphMetrics,
  fontSizeHalfPoints: number,
  unitsPerEm: number,
): ScaledVerticalMetrics {
  const em = unitsPerEm > 0 ? unitsPerEm : 1000;
  const ptSize = fontSizeHalfPoints / 2;
  const twipSize = fontSizeHalfPoints * 10;
  const pxSize = ptSize * (4 / 3);

  const toTwips = (f: number) => Math.round((f * twipSize) / em);
  const toPoints = (f: number) => (f * ptSize) / em;
  const toPixels = (f: number) => (f * pxSize) / em;

  return {
    advance: {
      twips: toTwips(metrics.advance),
      points: toPoints(metrics.advance),
      pixels: toPixels(metrics.advance),
    },
    originX: {
      twips: toTwips(metrics.originX),
      points: toPoints(metrics.originX),
      pixels: toPixels(metrics.originX),
    },
    originY: {
      twips: toTwips(metrics.originY),
      points: toPoints(metrics.originY),
      pixels: toPixels(metrics.originY),
    },
    isSynthesized: metrics.isSynthesized,
  };
}
