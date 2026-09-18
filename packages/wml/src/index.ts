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
