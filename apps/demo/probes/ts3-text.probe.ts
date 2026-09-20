import { TextEngine, FontLoader, resolveBidi, segmentWords, createPackedShapedRun, MeasurementCache } from '@ooxml/text';
export function probeText(): void { void new TextEngine(); void new FontLoader(); void resolveBidi('text'); void segmentWords('text'); void createPackedShapedRun; void new MeasurementCache(); }
