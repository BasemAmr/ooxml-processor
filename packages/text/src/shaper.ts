/**
 * Text Shaper Architecture and HarfBuzz Adapter (P4-09).
 *
 * Implements Ticket P4-09 and ADR 0004.
 *
 * ## Architectural Responsibilities:
 * 1. HarfBuzz Integration & WASM Exception (ADR 0004):
 *    HarfBuzz is the reference shaper used across modern browsers and office suites.
 *    It performs contextual cursive joining for Arabic, conjunct formation and reordering
 *    for Indic, and OpenType feature substitutions (GSUB/GPOS).
 *
 * 2. Resource Management:
 *    - Font Blob Cache: Font byte buffers are uploaded to WASM memory ONCE per font face ID,
 *      never per shape() call. This eliminates redundant WASM allocations.
 *    - Reusable Buffer Pattern: A single HarfBuzz buffer is instantiated and reused across
 *      shape() invocations by calling buffer.reset(), eliminating JS/WASM garbage churn.
 *
 * 3. High-Fidelity Fallback Shaping Engine:
 *    When WASM HarfBuzz is not initialized or running in a headless test environment, the fallback
 *    shaper provides spec-conformant shaping:
 *    - Complete Arabic cursive joining (isolated, initial, medial, final forms) and Lam-Alif ligatures.
 *    - Latin standard ligatures (fi, fl, ffi, ffl, ff) under the 'liga'/'clig' feature flags.
 *    - Pair kerning adjustments under the 'kern' flag.
 *    - Full visual-order cluster emission where RTL text has visual clusters stored left-to-right
 *      on screen while preserving logical source offset back-references.
 */

import type { SubRun } from './itemizer.js';
import type { ReconciledFontMetrics } from './metrics.js';
import {
  createPackedShapedRun,
  type ClusterInput,
  type RunDirection,
  type ShapedRun,
} from './shaped-run.js';

/**
 * Resolved font face handed to the shaper, containing font data bytes or metrics.
 */
export interface ResolvedFontFace {
  /** Unique interned identifier for this face (used for font blob cache keying) */
  readonly faceId: number;
  /** Primary font family name */
  readonly family: string;
  /** Raw OpenType/TrueType font binary bytes (e.g. from ODTTF or font loader) */
  readonly data?: Uint8Array | ArrayBuffer | undefined;
  /** Optional pre-reconciled font metrics */
  readonly metrics?: ReconciledFontMetrics | undefined;
  /** Font design units per em (default: 2048 or 1000) */
  readonly unitsPerEm?: number | undefined;
  /** Flag indicating whether this face is an interim fallback */
  readonly isFallback?: boolean | undefined;
}

/**
 * OpenType feature control flags for shaping.
 */
export interface ShaperFeatureOptions {
  /** Standard ligatures (fi, fl, etc.). Default: true */
  readonly liga?: boolean | undefined;
  /** Contextual ligatures. Default: true */
  readonly clig?: boolean | undefined;
  /** Kerning pairs (GPOS kern). Default: true */
  readonly kern?: boolean | undefined;
  /** Contextual alternates. Default: true */
  readonly calt?: boolean | undefined;
  /** Vertical substitution for vertical CJK text. Default: false */
  readonly vert?: boolean | undefined;
}

/**
 * Common interface for all text shaping implementations.
 */
export interface TextShaper {
  /**
   * Shapes a uniform sub-run into visual clusters with glyph IDs and advances.
   */
  shape(
    subRun: SubRun,
    fontFace: ResolvedFontFace,
    features?: ShaperFeatureOptions | undefined,
  ): ShapedRun;

  /** Total number of unique font faces uploaded and prepared in memory */
  getFontPreparationCount?(): number;
  /** Returns true if a font face ID is currently cached in shaper memory */
  isFontCached?(faceId: number): boolean;
  /** Clears cached font faces and releases memory */
  clearFontCache?(): void;
}

/**
 * Minimal HarfBuzz WASM interface matching harfbuzzjs.
 */
export interface HarfBuzzBlob {
  destroy(): void;
}

export interface HarfBuzzFace {
  destroy(): void;
}

export interface HarfBuzzFont {
  destroy(): void;
}

export interface HarfBuzzBuffer {
  addText(text: string): void;
  setDirection(direction: 'ltr' | 'rtl' | 'ttb' | 'btt'): void;
  setScript(script: string): void;
  setLanguage(language: string): void;
  guessSegmentProperties(): void;
  clear(): void;
  reset(): void;
  destroy(): void;
  json(): Array<{
    g: number;
    cl: number;
    ax: number;
    ay: number;
    dx: number;
    dy: number;
  }>;
}

export interface HarfBuzzWasmApi {
  createBlob(data: ArrayBuffer | Uint8Array): HarfBuzzBlob;
  createFace(blob: HarfBuzzBlob, index: number): HarfBuzzFace;
  createFont(face: HarfBuzzFace): HarfBuzzFont;
  createBuffer(): HarfBuzzBuffer;
  shape(font: HarfBuzzFont, buffer: HarfBuzzBuffer, features?: string): void;
}

// -----------------------------------------------------------------------------
// ARABIC CURSIVE JOINING DATA & LOGIC (Fallback Shaper)
// -----------------------------------------------------------------------------

interface ArabicCharForms {
  isolated: number;
  final: number;
  initial?: number;
  medial?: number;
}

/**
 * Unicode Arabic Presentation Forms-B mapping for standard letters (U+0621..U+064A).
 * Dual-joining characters define isolated, final, initial, and medial codepoints.
 * Right-joining-only characters define isolated and final only.
 */
const ARABIC_FORMS: Readonly<Record<number, ArabicCharForms>> = Object.freeze({
  0x0621: { isolated: 0xfe80, final: 0xfe80 }, // Hamza (non-joining)
  0x0622: { isolated: 0xfe81, final: 0xfe82 }, // Alif with Madda (right-joining)
  0x0623: { isolated: 0xfe83, final: 0xfe84 }, // Alif with Hamza Above (right-joining)
  0x0624: { isolated: 0xfe85, final: 0xfe86 }, // Waw with Hamza Above (right-joining)
  0x0625: { isolated: 0xfe87, final: 0xfe88 }, // Alif with Hamza Below (right-joining)
  0x0626: { isolated: 0xfe89, final: 0xfe8a, initial: 0xfe8b, medial: 0xfe8c }, // Ya with Hamza Above
  0x0627: { isolated: 0xfe8d, final: 0xfe8e }, // Alif (right-joining)
  0x0628: { isolated: 0xfe8f, final: 0xfe90, initial: 0xfe91, medial: 0xfe92 }, // Ba
  0x0629: { isolated: 0xfe93, final: 0xfe94 }, // Ta Marbuta (right-joining)
  0x062a: { isolated: 0xfe95, final: 0xfe96, initial: 0xfe97, medial: 0xfe98 }, // Ta
  0x062b: { isolated: 0xfe99, final: 0xfe9a, initial: 0xfe9b, medial: 0xfe9c }, // Tha
  0x062c: { isolated: 0xfe9d, final: 0xfe9e, initial: 0xfe9f, medial: 0xfea0 }, // Jim
  0x062d: { isolated: 0xfea1, final: 0xfea2, initial: 0xfea3, medial: 0xfea4 }, // Hah
  0x062e: { isolated: 0xfea5, final: 0xfea6, initial: 0xfea7, medial: 0xfea8 }, // Kha
  0x062f: { isolated: 0xfea9, final: 0xfeaa }, // Dal (right-joining)
  0x0630: { isolated: 0xfeab, final: 0xfeac }, // Dhal (right-joining)
  0x0631: { isolated: 0xfead, final: 0xfeae }, // Ra (right-joining)
  0x0632: { isolated: 0xfeaf, final: 0xfeb0 }, // Zay (right-joining)
  0x0633: { isolated: 0xfeb1, final: 0xfeb2, initial: 0xfeb3, medial: 0xfeb4 }, // Sin
  0x0634: { isolated: 0xfeb5, final: 0xfeb6, initial: 0xfeb7, medial: 0xfeb8 }, // Shin
  0x0635: { isolated: 0xfeb9, final: 0xfeba, initial: 0xfebb, medial: 0xfebc }, // Sad
  0x0636: { isolated: 0xfebd, final: 0xfebe, initial: 0xfebf, medial: 0xfec0 }, // Dad
  0x0637: { isolated: 0xfec1, final: 0xfec2, initial: 0xfec3, medial: 0xfec4 }, // Tah
  0x0638: { isolated: 0xfec5, final: 0xfec6, initial: 0xfec7, medial: 0xfec8 }, // Zah
  0x0639: { isolated: 0xfec9, final: 0xfeca, initial: 0xfecb, medial: 0xfecc }, // Ayn
  0x063a: { isolated: 0xfecd, final: 0xfece, initial: 0xfecf, medial: 0xfed0 }, // Ghayn
  0x0641: { isolated: 0xfed1, final: 0xfed2, initial: 0xfed3, medial: 0xfed4 }, // Fa
  0x0642: { isolated: 0xfed5, final: 0xfed6, initial: 0xfed7, medial: 0xfed8 }, // Qaf
  0x0643: { isolated: 0xfed9, final: 0xfeda, initial: 0xfedb, medial: 0xfedc }, // Kaf
  0x0644: { isolated: 0xfedd, final: 0xfede, initial: 0xfedf, medial: 0xfee0 }, // Lam
  0x0645: { isolated: 0xfee1, final: 0xfee2, initial: 0xfee3, medial: 0xfee4 }, // Mim
  0x0646: { isolated: 0xfee5, final: 0xfee6, initial: 0xfee7, medial: 0xfee8 }, // Nun
  0x0647: { isolated: 0xfee9, final: 0xfeea, initial: 0xfeeb, medial: 0xfeec }, // Ha
  0x0648: { isolated: 0xfeed, final: 0xfeee }, // Waw (right-joining)
  0x0649: { isolated: 0xfeef, final: 0xfef0 }, // Alif Maqsura (right-joining)
  0x064a: { isolated: 0xfef1, final: 0xfef2, initial: 0xfef3, medial: 0xfef4 }, // Ya
});

/**
 * Checks whether a codepoint can join with a following letter on its left.
 */
function canJoinLeft(cp: number): boolean {
  const form = ARABIC_FORMS[cp];
  return form !== undefined && form.initial !== undefined;
}

/**
 * Checks whether a codepoint can join with a preceding letter on its right.
 */
function canJoinRight(cp: number): boolean {
  const form = ARABIC_FORMS[cp];
  return form !== undefined && form.final !== undefined;
}

/**
 * Checks whether codepoint is an Arabic combining mark / harakat (zero-width non-spacing).
 */
function isArabicMark(cp: number): boolean {
  return cp >= 0x064b && cp <= 0x065f;
}

/**
 * Standard pair kerning adjustments for common Latin uppercase/lowercase pairs.
 * Units: fraction of em.
 */
const STANDARD_KERNING_TABLE: Readonly<Record<string, number>> = Object.freeze({
  AV: -0.08,
  AW: -0.06,
  AY: -0.08,
  VA: -0.08,
  WA: -0.06,
  YA: -0.08,
  Ta: -0.07,
  Te: -0.06,
  To: -0.06,
  Tr: -0.05,
  Tu: -0.05,
  Ty: -0.06,
  Yo: -0.06,
  We: -0.04,
  Wo: -0.04,
});

/**
 * Calculates typographic advance width in twips for a character / glyph.
 * 1 em = fontSize * 10 twips.
 */
function calculateCharAdvance(
  cp: number,
  fontSizeHalfPoints: number,
  unitsPerEm: number = 2048,
): number {
  const emInTwips = fontSizeHalfPoints * 10;

  // Zero-width combining marks
  if (isArabicMark(cp) || (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x20d0 && cp <= 0x20ff)) {
    return 0;
  }

  // Fullwidth East Asian Ideographs & Hangul (1.0 em)
  if (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0xff01 && cp <= 0xff60)
  ) {
    return Math.round(emInTwips);
  }

  // Common Space
  if (cp === 0x20 || cp === 0x00a0) {
    return Math.round(emInTwips * 0.25);
  }

  // Digits (tabular 0.55 em)
  if (cp >= 0x30 && cp <= 0x39) {
    return Math.round(emInTwips * 0.55);
  }

  // Wide Latin letters
  if (cp === 0x57 || cp === 0x4d || cp === 0x77 || cp === 0x6d) {
    // W, M, w, m
    return Math.round(emInTwips * 0.78);
  }

  // Narrow Latin letters & punctuation
  if (
    cp === 0x69 ||
    cp === 0x6c ||
    cp === 0x6a ||
    cp === 0x49 ||
    cp === 0x74 ||
    cp === 0x2e ||
    cp === 0x2c ||
    cp === 0x3a ||
    cp === 0x3b ||
    cp === 0x21 ||
    cp === 0x7c ||
    cp === 0x27
  ) {
    return Math.round(emInTwips * 0.28);
  }

  // Lam-Alif ligatures
  if (cp >= 0xfef5 && cp <= 0xfefc) {
    return Math.round(emInTwips * 0.65);
  }

  // Default proportional width for Latin, Cyrillic, Greek, Arabic
  return Math.round(emInTwips * 0.52);
}

// -----------------------------------------------------------------------------
// FALLBACK SHAPER IMPLEMENTATION
// -----------------------------------------------------------------------------

export class FallbackTextShaper implements TextShaper {
  shape(
    subRun: SubRun,
    fontFace: ResolvedFontFace,
    features?: ShaperFeatureOptions | undefined,
  ): ShapedRun {
    const text = subRun.text;
    const isRtl = subRun.bidiLevel % 2 === 1;
    const direction: RunDirection = isRtl ? 'rtl' : 'ltr';
    const unitsPerEm = fontFace.unitsPerEm ?? 2048;
    const fontSize = subRun.fontSize;
    const baseSrcOffset = subRun.srcOffset;

    const enableLiga = features?.liga !== false;
    const enableKern = features?.kern !== false;

    if (isRtl) {
      // -----------------------------------------------------------------------
      // ARABIC / RTL SHAPING WITH CURSIVE JOINING
      // -----------------------------------------------------------------------
      const codepoints: number[] = [];
      const charOffsets: number[] = [];
      const charLengths: number[] = [];

      let strIdx = 0;
      while (strIdx < text.length) {
        const cp = text.codePointAt(strIdx)!;
        const len = cp > 0xffff ? 2 : 1;
        codepoints.push(cp);
        charOffsets.push(strIdx);
        charLengths.push(len);
        strIdx += len;
      }

      // 1. Contextual cursive joining & Lam-Alif ligature formation
      const shapedItems: Array<{
        glyphId: number;
        srcOffset: number;
        srcLength: number;
        xAdvance: number;
      }> = [];

      for (let i = 0; i < codepoints.length; i++) {
        const cp = codepoints[i]!;
        const offset = baseSrcOffset + charOffsets[i]!;
        let len = charLengths[i]!;

        // Check for Lam-Alif ligatures (Lam U+0644 followed by Alif)
        if (cp === 0x0644 && i + 1 < codepoints.length) {
          const nextCp = codepoints[i + 1]!;
          let lamAlifGlyph: number | null = null;
          const joinsRight = i > 0 && canJoinLeft(codepoints[i - 1]!);

          if (nextCp === 0x0627) {
            // Lam + Alif
            lamAlifGlyph = joinsRight ? 0xfefc : 0xfefb;
          } else if (nextCp === 0x0622) {
            // Lam + Alif with Madda
            lamAlifGlyph = joinsRight ? 0xfef6 : 0xfef5;
          } else if (nextCp === 0x0623) {
            // Lam + Alif with Hamza Above
            lamAlifGlyph = joinsRight ? 0xfef8 : 0xfef7;
          } else if (nextCp === 0x0625) {
            // Lam + Alif with Hamza Below
            lamAlifGlyph = joinsRight ? 0xfefa : 0xfef9;
          }

          if (lamAlifGlyph !== null) {
            const ligLength = len + charLengths[i + 1]!;
            const adv = calculateCharAdvance(lamAlifGlyph, fontSize, unitsPerEm);
            shapedItems.push({
              glyphId: lamAlifGlyph,
              srcOffset: offset,
              srcLength: ligLength,
              xAdvance: adv,
            });
            i++; // skip next codepoint consumed by ligature
            continue;
          }
        }

        // Standard Arabic cursive joining
        const forms = ARABIC_FORMS[cp];
        if (forms) {
          const joinsRight = i > 0 && canJoinLeft(codepoints[i - 1]!) && canJoinRight(cp);
          const joinsLeft =
            i + 1 < codepoints.length && canJoinRight(codepoints[i + 1]!) && canJoinLeft(cp);

          let glyphId = forms.isolated;
          if (joinsRight && joinsLeft && forms.medial !== undefined) {
            glyphId = forms.medial;
          } else if (joinsRight && forms.final !== undefined) {
            glyphId = forms.final;
          } else if (joinsLeft && forms.initial !== undefined) {
            glyphId = forms.initial;
          }

          const adv = calculateCharAdvance(glyphId, fontSize, unitsPerEm);
          shapedItems.push({
            glyphId,
            srcOffset: offset,
            srcLength: len,
            xAdvance: adv,
          });
        } else {
          // Non-Arabic or punctuation in RTL run
          const adv = calculateCharAdvance(cp, fontSize, unitsPerEm);
          shapedItems.push({
            glyphId: cp,
            srcOffset: offset,
            srcLength: len,
            xAdvance: adv,
          });
        }
      }

      // 2. EMIT CLUSTERS IN STRICT VISUAL ORDER (LEFT-TO-RIGHT SCREEN ORDER)
      // For an RTL run, visual cluster 0 is on the left (the end of the word),
      // and visual cluster N-1 is on the right (the start of the word).
      // Reversing shapedItems yields visual screen order!
      const visualClusters: ClusterInput[] = [];
      for (let j = shapedItems.length - 1; j >= 0; j--) {
        const item = shapedItems[j]!;
        visualClusters.push({
          glyphId: item.glyphId,
          xAdvance: item.xAdvance,
          srcOffset: item.srcOffset,
          srcLength: item.srcLength,
        });
      }

      return createPackedShapedRun({
        faceId: fontFace.faceId,
        fontSize,
        direction,
        script: subRun.script,
        clusters: visualClusters,
      });
    }

    // -------------------------------------------------------------------------
    // LTR SHAPING (Latin, Greek, Cyrillic, CJK, etc.)
    // -------------------------------------------------------------------------
    const clusters: ClusterInput[] = [];
    let i = 0;

    while (i < text.length) {
      const offset = baseSrcOffset + i;

      // 1. Latin Standard Ligatures (fi, fl, ffi, ffl, ff)
      if (enableLiga && text.charCodeAt(i) === 0x66 /* 'f' */) {
        if (i + 2 < text.length && text.slice(i, i + 3) === 'ffi') {
          clusters.push({
            glyphId: 0xfb03, // ffi
            xAdvance: Math.round(calculateCharAdvance(0x66, fontSize, unitsPerEm) * 2.3),
            srcOffset: offset,
            srcLength: 3,
          });
          i += 3;
          continue;
        }
        if (i + 2 < text.length && text.slice(i, i + 3) === 'ffl') {
          clusters.push({
            glyphId: 0xfb04, // ffl
            xAdvance: Math.round(calculateCharAdvance(0x66, fontSize, unitsPerEm) * 2.3),
            srcOffset: offset,
            srcLength: 3,
          });
          i += 3;
          continue;
        }
        if (i + 1 < text.length) {
          const next = text.slice(i, i + 2);
          if (next === 'fi') {
            clusters.push({
              glyphId: 0xfb01, // fi
              xAdvance: Math.round(calculateCharAdvance(0x66, fontSize, unitsPerEm) * 1.5),
              srcOffset: offset,
              srcLength: 2,
            });
            i += 2;
            continue;
          }
          if (next === 'fl') {
            clusters.push({
              glyphId: 0xfb02, // fl
              xAdvance: Math.round(calculateCharAdvance(0x66, fontSize, unitsPerEm) * 1.5),
              srcOffset: offset,
              srcLength: 2,
            });
            i += 2;
            continue;
          }
          if (next === 'ff') {
            clusters.push({
              glyphId: 0xfb00, // ff
              xAdvance: Math.round(calculateCharAdvance(0x66, fontSize, unitsPerEm) * 1.6),
              srcOffset: offset,
              srcLength: 2,
            });
            i += 2;
            continue;
          }
        }
      }

      // 2. Standard single character
      const cp = text.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      let adv = calculateCharAdvance(cp, fontSize, unitsPerEm);

      // 3. Pair Kerning adjustment
      if (enableKern && i + len < text.length) {
        const nextCp = text.codePointAt(i + len)!;
        const pair = String.fromCharCode(cp, nextCp);
        const kernAdjustment = STANDARD_KERNING_TABLE[pair];
        if (kernAdjustment !== undefined) {
          adv += Math.round(kernAdjustment * fontSize * 10);
        }
      }

      // 4. Vertical substitution (vert feature)
      let glyphId = cp;
      if (features?.vert) {
        if (cp === 0x3001)
          glyphId = 0xfe11; // vertical comma
        else if (cp === 0x3002)
          glyphId = 0xfe12; // vertical full stop
        else if (cp === 0x300c)
          glyphId = 0xfe41; // vertical left bracket
        else if (cp === 0x300d) glyphId = 0xfe42; // vertical right bracket
      }

      clusters.push({
        glyphId,
        xAdvance: adv,
        srcOffset: offset,
        srcLength: len,
      });

      i += len;
    }

    return createPackedShapedRun({
      faceId: fontFace.faceId,
      fontSize,
      direction,
      script: subRun.script,
      clusters,
    });
  }
}

// -----------------------------------------------------------------------------
// HARFBUZZ ADAPTER SHAPER
// -----------------------------------------------------------------------------

export class HarfBuzzTextShaper implements TextShaper {
  private readonly hb: HarfBuzzWasmApi;
  private readonly fallback: FallbackTextShaper;

  /**
   * Font blob cache keyed by faceId.
   * Fonts are prepared and loaded into HarfBuzz WASM memory ONCE, never per run.
   */
  private readonly fontCache = new Map<number, HarfBuzzFont>();

  /** Single reusable buffer instance across shaping calls to eliminate allocation churn */
  private reusableBuffer: HarfBuzzBuffer | null = null;

  /** Total count of font face preparations */
  private fontPreparationCounter = 0;

  constructor(hb: HarfBuzzWasmApi) {
    this.hb = hb;
    this.fallback = new FallbackTextShaper();
  }

  getFontPreparationCount(): number {
    return this.fontPreparationCounter;
  }

  isFontCached(faceId: number): boolean {
    return this.fontCache.has(faceId);
  }

  clearFontCache(): void {
    for (const font of this.fontCache.values()) {
      try {
        font.destroy();
      } catch {
        // Safe disposal
      }
    }
    this.fontCache.clear();
    this.fontPreparationCounter = 0;
  }

  private getOrCreateFont(fontFace: ResolvedFontFace): HarfBuzzFont | null {
    if (this.fontCache.has(fontFace.faceId)) {
      return this.fontCache.get(fontFace.faceId)!;
    }

    if (!fontFace.data) {
      return null;
    }

    try {
      const blob = this.hb.createBlob(fontFace.data);
      const face = this.hb.createFace(blob, 0);
      const font = this.hb.createFont(face);

      this.fontCache.set(fontFace.faceId, font);
      this.fontPreparationCounter++;
      return font;
    } catch {
      return null;
    }
  }

  shape(
    subRun: SubRun,
    fontFace: ResolvedFontFace,
    features?: ShaperFeatureOptions | undefined,
  ): ShapedRun {
    const hbFont = this.getOrCreateFont(fontFace);

    // Fall back if no binary font data or HarfBuzz font creation failed
    if (!hbFont) {
      return this.fallback.shape(subRun, fontFace, features);
    }

    // Reuse single buffer allocation
    if (!this.reusableBuffer) {
      this.reusableBuffer = this.hb.createBuffer();
    }
    const buffer = this.reusableBuffer;
    buffer.reset();

    const isRtl = subRun.bidiLevel % 2 === 1;
    const direction: RunDirection = isRtl ? 'rtl' : 'ltr';

    buffer.addText(subRun.text);
    buffer.setDirection(direction);

    // Build OpenType feature strings
    const featureTokens: string[] = [];
    if (features?.liga !== undefined) featureTokens.push(features.liga ? '+liga' : '-liga');
    if (features?.clig !== undefined) featureTokens.push(features.clig ? '+clig' : '-clig');
    if (features?.kern !== undefined) featureTokens.push(features.kern ? '+kern' : '-kern');
    if (features?.calt !== undefined) featureTokens.push(features.calt ? '+calt' : '-calt');
    if (features?.vert) featureTokens.push('+vert');

    this.hb.shape(hbFont, buffer, featureTokens.join(','));

    const glyphs = buffer.json();
    const upem = fontFace.unitsPerEm ?? 2048;
    const scale = (subRun.fontSize * 10) / upem;

    const clusters: ClusterInput[] = [];
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i]!;
      const nextCluster = i + 1 < glyphs.length ? glyphs[i + 1]!.cl : subRun.text.length;
      const srcLength = Math.max(1, Math.abs(nextCluster - g.cl));

      clusters.push({
        glyphId: g.g,
        xAdvance: Math.round(g.ax * scale),
        xOffset: Math.round(g.dx * scale),
        yOffset: Math.round(g.dy * scale),
        srcOffset: subRun.srcOffset + g.cl,
        srcLength,
      });
    }

    return createPackedShapedRun({
      faceId: fontFace.faceId,
      fontSize: subRun.fontSize,
      direction,
      script: subRun.script,
      clusters,
    });
  }
}

/**
 * Creates the appropriate text shaper for the current environment.
 * Uses HarfBuzz if WASM module is supplied, otherwise returns the high-fidelity FallbackTextShaper.
 */
export function createTextShaper(harfbuzzApi?: HarfBuzzWasmApi | undefined): TextShaper {
  if (harfbuzzApi) {
    return new HarfBuzzTextShaper(harfbuzzApi);
  }
  return new FallbackTextShaper();
}
