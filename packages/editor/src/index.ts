// P6-01: Position model
export type { Affinity, LayoutPos, Caret } from './position/types.js';
export { createCaret, caretEquals, isValid } from './position/types.js';

// P6-02: Position mapping
export type { PageLayoutInfo, ParagraphLayoutEntry, LayoutIndex, MappingResult } from './position/map.js';
export { toLayout, toDocument } from './position/map.js';

// P6-03: Hit-testing
export { hitTest, hitTestWord, hitTestParagraph } from './hit-test.js';
