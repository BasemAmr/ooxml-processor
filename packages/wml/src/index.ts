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
