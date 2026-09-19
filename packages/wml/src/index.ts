export type { NodeId, NodeKind } from './id.js';
export { IdTable, NODE_KINDS } from './id.js';

export type { DocPos, AbsPos, NodeExtent } from './pos.js';
export {
  createDocPos,
  docPosEquals,
  asAbsPos,
  PositionMapper,
  createPositionMapper,
} from './pos.js';

export type { Gravity, IntervalId, Interval } from './interval.js';
export { DEFAULT_START_GRAVITY, DEFAULT_END_GRAVITY, IntervalStore } from './interval.js';

export type {
  AnnotationKind,
  AnnotationKey,
  Annotation,
  DiagnosticCode,
  AnnotationDiagnostic,
  PositionalMarker,
} from './annotations.js';
export {
  makeAnnotationKey,
  DIAGNOSTIC_CAP,
  AnnotationStore,
  extractParagraphAnnotations,
  injectParagraphAnnotations,
  extractBodyAnnotations,
  injectBodyAnnotations,
} from './annotations.js';

// P3-04 Style Graph & basedOn Cycle Detection
export type {
  StyleDiagnosticCode,
  StyleDiagnostic,
  StyleFlags,
  Style,
  LatentStyleException,
  LatentStyleTable,
} from './styles.js';
export { StyleTable, parseStyles, parseStylesXml } from './styles.js';

// P3-05 w:docDefaults
export type { DocDefaults } from './defaults.js';
export {
  BUILTIN_DOC_DEFAULTS,
  getRPrBaseProperty,
  parseDocDefaults,
  resolveDocDefaults,
  parseDocDefaultsXml,
} from './defaults.js';

// P3-10 Theme Resolution
export type {
  ThemeDiagnosticCode,
  ThemeDiagnostic,
  FontCollection,
  FontScheme,
  ColorScheme,
  ColorMap,
  Theme,
  ThemeFontSlot,
} from './theme.js';
export {
  FALLBACK_FONT_SCHEME,
  FALLBACK_COLOR_SCHEME,
  parseTheme,
  parseThemeXml,
  resolveThemeFont,
  resolveSchemeColor,
} from './theme.js';

// P3-13 settings.xml and compatibility flags
export type { CompatSettingTriple, CompatSettings, LayoutSettings } from './settings.js';
export { parseSettings, parseSettingsXml } from './settings.js';

// P3-07 Toggle-property XOR
export type { OnOffState } from './toggle.js';
export {
  TOGGLE_PROPERTIES,
  NON_TOGGLE_ONOFF_PROPERTIES,
  isToggleProperty,
  toOnOffState,
  toggleCombine,
} from './toggle.js';

// P3-08 Numbering-derived properties
export type { NumberingTable, ResolvedNumbering } from './numbering.js';
export { parseNumbering, parseNumberingXml, resolveNumbering } from './numbering.js';

export * from './fields/index.js';
export type {
  NumberingDiagnostic,
  NumberingLevelLike,
  NumberingParagraphLike,
  NumberingFoldOptions,
  NumberingFoldResult,
} from './numbering-layout.js';
export {
  formatNumber,
  renderLevelText,
  foldNumbering,
  normalizeBulletCodePoint,
} from './numbering-layout.js';
export type {
  BookmarkRange,
  HyperlinkTarget,
  HyperlinkNavigation,
  RevisionLike,
  RevisionDecision,
  RevisionEdit,
  ContentControlLike,
  CrossReferenceContext,
  TocOptions,
  TocEntry,
  NoteKind,
  NoteContent,
  CommentContent,
  SdtLock,
  SdtPolicy,
  ArtBorderTile,
  ArtBorderTiles,
  PageDecoration,
} from './features.js';
export {
  resolveHyperlink,
  hyperlinkNavigation,
  bookmarkHref,
  resolveBookmark,
  displayRevisions,
  applyRevisions,
  revisionEdits,
  applyRevisionBatch,
  resolveCrossReference,
  parseTocSwitches,
  renderTocEntries,
  filterRenderableNotes,
  noteNumber,
  renderFootnoteReference,
  resolveComment,
  sdtPolicy,
  tileArtBorder,
  tileArtBorderPieces,
  resolvePageDecoration,
  contentControlText,
  isUnsupportedContentControlKind,
} from './features.js';

// P3-09 Table conditional formatting and w:cnfStyle
export type { TableConditionMapping, CnfAttributes, TableCellPosition } from './table-style.js';
export {
  TABLE_CONDITION_MAPPINGS,
  CNF_BIT_ORDER,
  CONDITIONAL_PRECEDENCE,
  parseCnfConditions,
  deriveGeometryConditions,
  resolveTableConditionalLayers,
} from './table-style.js';

// P3-06 Cascade order
export type {
  PropertyOrigin,
  ResolvedProperties,
  PropertyLayer,
  ParagraphCascadeContext,
  RunCascadeContext,
  ParagraphMarkRunContext,
  ResolveParaRPrContext,
} from './cascade.js';
export {
  resolveCascadeStack,
  resolveParagraphProperties,
  resolveRunProperties,
  resolveParagraphMarkRunProperties,
  resolveParaRPrProperties,
} from './cascade.js';

// P3-11 Resolved-property cache
export type { CacheStats, InvalidationGenerations } from './cache.js';
export { hashDirectProps, buildCacheKey, ResolvedPropertyCache } from './cache.js';

// P3-12 Property inspector
export type { InspectedProperty, InspectionReport } from './inspector.js';
export { inspectProperties } from './inspector.js';
