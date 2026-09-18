/**
 * The hand-authored runtime.
 *
 * Everything in this directory is written by hand, for one of three reasons:
 * no schema exists for it (Markup Compatibility is ECMA-376 Part 3, which has
 * no XSD), the schema does not say what the specification means (`ST_OnOff`'s
 * absent-means-true rule is prose), or it is machinery the generated code calls
 * rather than a shape the generator could describe (the cursor and the sink).
 *
 * Generated readers and writers import from here. Nothing here imports anything
 * generated, so the dependency runs one way and this layer can be tested on its
 * own.
 */

/* --- The contract: events, cursor, sink, raw capture ---------------------- */
export type {
  NamespaceUri,
  RawChild,
  RawNode,
  XmlAttr,
  XmlComment,
  XmlCursor,
  XmlEndElement,
  XmlEvent,
  XmlParseLimits,
  XmlPosition,
  XmlProcessingInstruction,
  XmlSink,
  XmlStartElement,
  XmlText,
} from './xml.js';
export { DEFAULT_PARSE_LIMITS, XmlParseError } from './xml.js';

/* --- Parsing -------------------------------------------------------------- */
export { createCursor, createCursorOverRaw } from './cursor.js';

/* --- Reading -------------------------------------------------------------- */
export type { Dialect, NsUris, ReadContext, ReadDiagnostic, ReadDiagnosticCode } from './read.js';
export {
  createReadContext,
  DIAGNOSTIC_CAP,
  isIgnorableWhitespace,
  requireStart,
} from './read.js';
export { readScalar } from './reader-scalar.js';

/* --- Writing -------------------------------------------------------------- */
export type { WriteContext } from './write.js';
export { createWriteContext, uriFor } from './write.js';

/* --- Serialization -------------------------------------------------------- */
export type { StringSinkOptions } from './sink.js';
export {
  createRawSink,
  createStringSink,
  escapeAttributeValue,
  escapeText,
  XmlSinkError,
} from './sink.js';

/* --- Simple-type lexical codecs -------------------------------------------- */
export {
  collapse,
  formatList,
  formatNumber,
  formatXsdBoolean,
  parseDecimal,
  parseDouble,
  parseInteger,
  parseList,
  parseXsdBoolean,
} from './lexical.js';

/* --- Namespaces ----------------------------------------------------------- */
export {
  CONVENTIONAL_PREFIXES,
  conventionalPrefix,
  MC_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
} from './namespaces.js';

/* --- Simple-type codecs --------------------------------------------------- */
export {
  formatOnOff,
  formatOnOffPreserving,
  isOnOffLexical,
  ON_OFF_LEXICAL_FORMS,
  ON_OFF_TRANSITIONAL_ONLY_FORMS,
  OnOffValueError,
  parseOnOff,
  parseOnOffAttr,
  parseOnOffOr,
} from './onoff.js';

/* --- Measurements --------------------------------------------------------- */
export type {
  BarePercentScale,
  Degree60k,
  EighthPoint,
  Emu,
  HalfPoint,
  Pct1000,
  Pct50,
  Percent,
  Point,
  Px,
  Twip,
} from './units.js';
export {
  DEGREE60K_PER_DEGREE,
  degree60k,
  degree60kToDegrees,
  degree60kToRadians,
  degreesToDegree60k,
  eighthPoint,
  eighthPointToEmu,
  eighthPointToHalfPoint,
  eighthPointToPoint,
  eighthPointToPx,
  eighthPointToTwip,
  EMU_PER_INCH,
  EMU_PER_POINT,
  EMU_PER_PX,
  EMU_PER_TWIP,
  emu,
  emuToEighthPoint,
  emuToHalfPoint,
  emuToInches,
  emuToMm,
  emuToPoint,
  emuToPx,
  emuToTwip,
  formatDegree60k,
  formatEighthPoints,
  formatEmu,
  formatHalfPoints,
  formatPercentage,
  formatTwips,
  formatUniversalMeasure,
  fractionToPercent,
  halfPoint,
  halfPointToEighthPoint,
  halfPointToEmu,
  halfPointToPoint,
  halfPointToPx,
  halfPointToTwip,
  inchesToEmu,
  inchesToTwip,
  MeasurementValueError,
  MM_PER_INCH,
  mmToEmu,
  mmToTwip,
  parseDrawingMLPercentage,
  parseEighthPointMeasure,
  parseHpsMeasure,
  parsePercentage,
  parseSignedHpsMeasure,
  parseSignedTwipsMeasure,
  parseTablePercent,
  parseTwipsMeasure,
  pct1000,
  pct1000ToPercent,
  pct50,
  pct50ToPercent,
  percent,
  percentToFraction,
  percentToPct1000,
  percentToPct50,
  POINT_PER_INCH,
  point,
  pointToEighthPoint,
  pointToEmu,
  pointToHalfPoint,
  pointToPx,
  pointToTwip,
  PX_PER_INCH,
  px,
  pxToEighthPoint,
  pxToEmu,
  pxToHalfPoint,
  pxToPoint,
  pxToTwip,
  radiansToDegree60k,
  TWIP_PER_INCH,
  TWIP_PER_POINT,
  TWIP_PER_PX,
  twip,
  twipToEighthPoint,
  twipToEmu,
  twipToHalfPoint,
  twipToInches,
  twipToMm,
  twipToPoint,
  twipToPx,
} from './units.js';

/* --- Markup Compatibility (ECMA-376 Part 3) ------------------------------- */
export type { McAction, McDecision, McErrorCode, McSelection } from './mce.js';
export {
  isAlternateContent,
  MC_NAMES,
  McContext,
  McError,
  McResolver,
  QNameSet,
} from './mce.js';

/* --- Unknown-content preservation ----------------------------------------- */
export type { PositionedRaw } from './preserve.js';
export { sortPositioned } from './preserve.js';
