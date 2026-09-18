/**
 * Text Engine & Multi-Script Shaping Orchestrator (Phase 4 Verification Gate).
 *
 * ## Architectural Role:
 * The TextEngine is the central coordinator for text itemization, caching, and shaping
 * across `packages/text/`. It orchestrates the full pipeline:
 *
 *   Paragraph Run Input / Text String
 *           │
 *           ▼
 *   Sub-run Itemizer (P4-06 / itemizer.ts)
 *   - Per-character script selection (P4-02 / script.ts)
 *   - w:rFonts family resolution (P4-01 / rfonts.ts)
 *   - UAX#9 Bidirectional embedding levels (P4-07 / bidi.ts)
 *           │
 *           ▼
 *   Font Face Resolution & Mapping (P4-03, P4-05)
 *           │
 *           ▼
 *   Fast Path Eligibility Check (P4-10 / fast-path.ts)
 *           │
 *           ▼
 *   Measurement Cache Query (P4-11 / cache.ts) [Zero-Allocation L1]
 *      ├── Cache HIT  ──> Return Cached ShapedRun directly (0 allocs)
 *      └── Cache MISS ──> Fast Path (P4-10) or HarfBuzz/Fallback Shaper (P4-09)
 *                         └── Store in Cache (Memory-Bounded LRU)
 *
 * ## Decision D3 WASM Exception Justification (ADR 0004):
 * The core project architecture enforces a strict "no WASM in the core" constraint.
 * Decision D3 approved `harfbuzzjs` (~200 KB WASM) as the SINGLE exception to this rule.
 *
 * ### Justification:
 * 1. Canvas 2D's `measureText()` returns only an advance width. It does NOT report glyph
 *    identifiers, per-glyph x/y placement offsets, or cluster back-references into source text.
 * 2. Without cluster boundaries, accurate caret placement, hit-testing, and selection geometry
 *    across complex scripts are impossible.
 * 3. Canvas 2D cannot perform contextual cursive joining for Arabic (isolated, initial,
 *    medial, final forms) or conjunct reordering for Indic scripts.
 * 4. Pure JS alternatives (e.g. opentype.js) lack comprehensive GSUB/GPOS feature support and
 *    fail on complex-script edge cases.
 * 5. HarfBuzz is the reference shaper utilized by Chromium, Firefox, and LibreOffice. Its
 *    inclusion guarantees typographic parity with desktop office suites.
 *
 * ## Verification Constraint F6 Caveat:
 * Per constraint F6, typographical rendering and advance measurements cannot be verified
 * against live Microsoft Word or LibreOffice instances in this headless/CI test environment
 * (`UNVERIFIABLE-HERE`). All metrics, bidi algorithms, and script classifications are anchored
 * to normative Unicode standards (UAX#9, UAX#14, UAX#24, UAX#50) and OpenType specifications.
 */

import type { CT_Fonts } from '@ooxml/schema';
import { MeasurementCache } from './cache.js';
import { isFastPathEligible, measureFastPath, type FastPathOptions } from './fast-path.js';
import {
  itemizeParagraphRuns,
  itemizeText,
  type ItemizeOptions,
  type ParagraphRunInput,
  type SubRun,
} from './itemizer.js';
import type { FontSlot } from './script.js';
import {
  createTextShaper,
  type ResolvedFontFace,
  type ShaperFeatureOptions,
  type TextShaper,
} from './shaper.js';
import type { ShapedRun } from './shaped-run.js';

/**
 * Function resolving a font family and script slot into a concrete ResolvedFontFace.
 */
export type FaceResolver = (family: string, script: FontSlot) => ResolvedFontFace;

/**
 * Configuration options for the TextEngine.
 */
export interface TextEngineOptions {
  /** Shaper instance. Defaults to createTextShaper() (HarfBuzz if available, else FallbackTextShaper) */
  readonly shaper?: TextShaper | undefined;
  /** Measurement cache instance. Defaults to new MeasurementCache() */
  readonly cache?: MeasurementCache | undefined;
  /** Default font face resolver. If omitted, an internal auto-registering resolver is used */
  readonly resolveFace?: FaceResolver | undefined;
}

/**
 * Measurement output for a single sub-run within a shaped paragraph.
 */
export interface ShapedSubRunResult {
  /** The itemized uniform sub-run */
  readonly subRun: SubRun;
  /** Resolved font face used for shaping */
  readonly fontFace: ResolvedFontFace;
  /** The resulting shaped run (visual order clusters, logical source offsets) */
  readonly shapedRun: ShapedRun;
  /** True if this result was retrieved from the L1 measurement cache */
  readonly cached: boolean;
  /** True if this run used the measureText fast path instead of full shaping */
  readonly fastPath: boolean;
}

/**
 * Composite result of shaping an entire paragraph.
 */
export interface ParagraphShapingResult {
  /** Array of shaped sub-runs */
  readonly runs: readonly ShapedSubRunResult[];
  /** Total cumulative horizontal advance of the paragraph in twips */
  readonly totalAdvance: number;
  /** Ratio of cache hits during this shaping pass [0.0..1.0] */
  readonly passHitRate: number;
}

/**
 * High-performance text shaping and measurement engine.
 */
export class TextEngine {
  readonly shaper: TextShaper;
  readonly cache: MeasurementCache;
  private readonly customResolver?: FaceResolver | undefined;

  /** Internal registry mapping "family:script" to auto-allocated ResolvedFontFace */
  private readonly faceRegistry = new Map<string, ResolvedFontFace>();
  private nextFaceId = 1;

  constructor(options?: TextEngineOptions | undefined) {
    this.shaper = options?.shaper ?? createTextShaper();
    this.cache = options?.cache ?? new MeasurementCache();
    this.customResolver = options?.resolveFace;
  }

  /**
   * Resolves or creates a concrete `ResolvedFontFace` for a font family and script slot.
   */
  resolveFontFace(family: string, script: FontSlot): ResolvedFontFace {
    if (this.customResolver) {
      return this.customResolver(family, script);
    }

    const key = `${family}:${script}`;
    let face = this.faceRegistry.get(key);
    if (face === undefined) {
      face = {
        faceId: this.nextFaceId++,
        family,
        unitsPerEm: 2048,
      };
      this.faceRegistry.set(key, face);
    }
    return face;
  }

  /**
   * Shapes a single text run into one or more `ShapedRun`s, utilizing itemization,
   * fast-path qualification, and L1 measurement caching.
   */
  shapeRun(
    text: string,
    options?: ItemizeOptions | undefined,
    fastPathOptions?: FastPathOptions | undefined,
    featureOptions?: ShaperFeatureOptions | undefined,
  ): ShapedSubRunResult[] {
    if (text.length === 0) return [];

    const subRuns = itemizeText(text, options);
    const results: ShapedSubRunResult[] = [];

    const featId = this.cache.featureInterner.intern(featureOptions);

    for (const subRun of subRuns) {
      const fontFace = this.resolveFontFace(subRun.fontFamily, subRun.script);
      const textHandle = this.cache.textInterner.intern(subRun.text);

      // 1. Hot-Path Zero-Allocation Cache Query
      const cached = this.cache.getL1(fontFace.faceId, subRun.fontSize, featId, textHandle);
      if (cached !== undefined) {
        results.push({
          subRun,
          fontFace,
          shapedRun: cached,
          cached: true,
          fastPath: false,
        });
        continue;
      }

      // 2. Cache Miss: Evaluate Fast-Path Eligibility (P4-10)
      const eligible = isFastPathEligible(subRun, fastPathOptions);
      let shapedRun: ShapedRun;

      if (eligible) {
        shapedRun = measureFastPath(subRun, fontFace, fastPathOptions);
      } else {
        shapedRun = this.shaper.shape(subRun, fontFace, featureOptions);
      }

      // 3. Store in Memory-Bounded L1 Cache
      this.cache.putL1(fontFace.faceId, subRun.fontSize, featId, textHandle, shapedRun);

      results.push({
        subRun,
        fontFace,
        shapedRun,
        cached: false,
        fastPath: eligible,
      });
    }

    return results;
  }

  /**
   * Shapes an entire paragraph across multiple runs.
   *
   * Resolves UAX#9 bidirectional levels globally across the concatenated paragraph
   * text to guarantee correct cross-run weak/neutral resolution (BD16 bracket pairing,
   * numbers following RTL characters), then itemizes and shapes each sub-run.
   */
  shapeParagraph(
    runs: readonly ParagraphRunInput[],
    paragraphBaseLevel?: 0 | 1 | 'auto' | undefined,
    featureOptions?: ShaperFeatureOptions | undefined,
  ): ParagraphShapingResult {
    if (runs.length === 0) {
      return { runs: [], totalAdvance: 0, passHitRate: 0 };
    }

    const subRuns = itemizeParagraphRuns(runs, paragraphBaseLevel);
    const results: ShapedSubRunResult[] = [];
    let totalAdvance = 0;
    let hitsThisPass = 0;

    const featId = this.cache.featureInterner.intern(featureOptions);

    for (const subRun of subRuns) {
      const fontFace = this.resolveFontFace(subRun.fontFamily, subRun.script);
      const textHandle = this.cache.textInterner.intern(subRun.text);

      // 1. Check L1 Cache
      const cached = this.cache.getL1(fontFace.faceId, subRun.fontSize, featId, textHandle);
      if (cached !== undefined) {
        hitsThisPass++;
        totalAdvance += cached.totalAdvance;
        results.push({
          subRun,
          fontFace,
          shapedRun: cached,
          cached: true,
          fastPath: false,
        });
        continue;
      }

      // 2. Cache Miss: Fast Path vs Shaper
      const eligible = isFastPathEligible(subRun);
      let shapedRun: ShapedRun;

      if (eligible) {
        shapedRun = measureFastPath(subRun, fontFace);
      } else {
        shapedRun = this.shaper.shape(subRun, fontFace, featureOptions);
      }

      // 3. Populate L1 Cache
      this.cache.putL1(fontFace.faceId, subRun.fontSize, featId, textHandle, shapedRun);
      totalAdvance += shapedRun.totalAdvance;

      results.push({
        subRun,
        fontFace,
        shapedRun,
        cached: false,
        fastPath: eligible,
      });
    }

    const passHitRate = subRuns.length > 0 ? hitsThisPass / subRuns.length : 0;
    return {
      runs: results,
      totalAdvance,
      passHitRate,
    };
  }

  // ---------------------------------------------------------------------------
  // INVALIDATION & CACHE CONTROL
  // ---------------------------------------------------------------------------

  /**
   * Invalidates all cache entries for a given font face ID (called on font load/error).
   */
  invalidateFace(faceId: number): number {
    return this.cache.invalidateFace(faceId);
  }

  /**
   * Invalidates cache entries when a text string is modified.
   */
  invalidateText(text: string): number {
    const handle = this.cache.textInterner.getHandle(text);
    if (handle === undefined) return 0;
    return this.cache.invalidateText(handle);
  }

  /**
   * Clears all cached measurements.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
