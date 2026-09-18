/**
 * @ooxml/text — Font resolution, shaping, segmentation, bidi, measurement cache.
 */

// P4-02: Script classification & font slot selection
export type { FontSlot, ScriptSlot, ScriptRange, ScriptSlotOptions } from './script.js';
export { UNICODE_SCRIPT_RANGES, getFontSlotForCodepoint, getFontSlotForChar } from './script.js';

// P4-01: rFonts resolution & theme font binding
export type { ResolvedRFonts } from './rfonts.js';
export { DEFAULT_SLOT_FONTS, fontForChar } from './rfonts.js';

// P4-03: Font Table, PANOSE distance, and Substitution Ladder
export type {
  FontTable,
  SubstitutionStep,
  AvailableFontInfo,
  SubstitutionResult,
  ParsedFontSig,
} from './fonts.js';
export {
  METRIC_COMPATIBLE_FONTS,
  PANOSE_WEIGHTS,
  parseFontSig,
  checkFontCoverage,
  parsePanose,
  panoseDistance,
  getGenericFamily,
  createFontTable,
  parseFontTableXml,
  substituteFont,
} from './fonts.js';

// P4-04: Embedded font de-obfuscation (ODTTF)
export {
  SFNT_TAG_TRUETYPE,
  SFNT_TAG_OTTO,
  SFNT_TAG_TRUE,
  SFNT_TAG_TYP1,
  VALID_SFNT_TAGS,
  isValidSfntTag,
  parseFontKeyGuid,
  readSfntVersion,
  deobfuscateFont,
  obfuscateFont,
} from './odttf.js';

// P4-07: UAX#9 Bidirectional Engine
export type {
  BidiClass,
  BidiClassRange,
  BracketPairInfo,
  BidiOptions,
  BidiVisualItem,
  BidiResult,
} from './bidi.js';
export {
  BIDI_CLASS_RANGES,
  PAIRED_BRACKETS,
  getBidiClass,
  determineBaseLevel,
  resolveBidi,
  getBidiLevels,
  reorderVisualRuns,
} from './bidi.js';

// P4-08: Grapheme and Word Segmentation
export type { GraphemeSegment, WordSegment } from './segmenter.js';
export {
  segmentGraphemes,
  segmentWords,
  nextGraphemeBreak,
  prevGraphemeBreak,
  findWordAt,
} from './segmenter.js';

// P4-06: Sub-run Itemization
export type { ItemizeOptions, SubRun, ParagraphRunInput } from './itemizer.js';
export { itemizeText, itemizeParagraphRuns } from './itemizer.js';

// P4-13: Font Metrics Reconciliation & OpenType Table Parsing
export type {
  FontMetricsStrategy,
  HeadTableMetrics,
  HheaTableMetrics,
  Os2TableMetrics,
  RawFontMetrics,
  ReconciledFontMetrics,
  MetricDimensions,
  ScaledFontMetrics,
} from './metrics.js';
export {
  OS2_FS_SELECTION_USE_TYPO_METRICS,
  FONT_METRICS_STRATEGY,
  parseSfntTableDirectory,
  parseFontTables,
  reconcileFontMetrics,
  scaleFontMetrics,
} from './metrics.js';

// P4-14: Vertical Text and CJK East Asian Layout
export type {
  TextOrientation,
  ST_TextVerticalType,
  ResolvedEastAsianLayout,
  BracketPair,
  VerticalGlyphMetrics,
  VheaTableMetrics,
  VmtxTableMetrics,
  RawVerticalFontMetrics,
  ScaledVerticalMetrics,
} from './cjk-vertical.js';
export {
  DEFAULT_EAST_ASIAN_LAYOUT,
  isVerticalOrientation,
  isEastAsianVertical,
  isSidewaysOrientation,
  textOrientationFromWml,
  textOrientationFromDml,
  parseEastAsianLayout,
  getCombineBracketPairs,
  formatCombineText,
  getVerticalOpenTypeFeatures,
  parseVerticalFontTables,
  synthesizeVerticalMetrics,
  resolveVerticalGlyphMetrics,
  scaleVerticalMetrics,
} from './cjk-vertical.js';

// P4-05: FontFace Loading & FOUT Mitigation
export type {
  FontLoadStatus,
  FontFaceDescriptors,
  FontStateRecord,
  FontLoadResult,
  FontSettledEvent,
  FontSettledListener,
  FontSourceResolver,
  FontFaceApiAdapter,
  FontLoaderOptions,
} from './font-loader.js';
export { BrowserFontFaceAdapter, FontLoader } from './font-loader.js';

// P4-12: ShapedRun Representation & Packed Cluster Storage
export type {
  RunDirection,
  ShapedRun,
  PackedShapedRunOptions,
  ClusterInput,
} from './shaped-run.js';
export {
  CLUSTER_STRIDE,
  GLYPH_ID_OFFSET,
  X_ADVANCE_OFFSET,
  X_OFFSET_OFFSET,
  Y_OFFSET_OFFSET,
  SRC_OFFSET_OFFSET,
  SRC_LENGTH_OFFSET,
  PackedShapedRun,
  createPackedShapedRun,
} from './shaped-run.js';

// P4-09: Text Shaper Architecture & HarfBuzz Adapter
export type {
  ResolvedFontFace,
  ShaperFeatureOptions,
  TextShaper,
  HarfBuzzBlob,
  HarfBuzzFace,
  HarfBuzzFont,
  HarfBuzzBuffer,
  HarfBuzzWasmApi,
} from './shaper.js';
export { FallbackTextShaper, HarfBuzzTextShaper, createTextShaper } from './shaper.js';

// P4-10: The measureText Fast Path & Eligibility Predicate
export type { FastPathOptions } from './fast-path.js';
export { isFastPathEligible, calculateFastCharAdvance, measureFastPath } from './fast-path.js';

// P4-11: The Measurement Cache (Two-tier, Memory-bounded, Zero-allocation)
export type { L1CacheNode, CacheStats, MeasurementCacheOptions } from './cache.js';
export {
  DEFAULT_MAX_CACHE_BYTES,
  NODE_METADATA_OVERHEAD_BYTES,
  estimateShapedRunBytes,
  TextInternTable,
  FeatureSetInternTable,
  MeasurementCache,
} from './cache.js';

// Phase 4 Multi-Script Text Engine & Orchestrator
export type {
  FaceResolver,
  TextEngineOptions,
  ShapedSubRunResult,
  ParagraphShapingResult,
} from './text-engine.js';
export { TextEngine } from './text-engine.js';
