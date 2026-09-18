// P6-01: Position model
export type { Affinity, LayoutPos, Caret } from './position/types.js';
export { createCaret, caretEquals, isValid } from './position/types.js';

// P6-02: Position mapping
export type { PageLayoutInfo, ParagraphLayoutEntry, LayoutIndex, MappingResult } from './position/map.js';
export { toLayout, toDocument } from './position/map.js';

// P6-03: Hit-testing
export { hitTest, hitTestWord, hitTestParagraph } from './hit-test.js';

// P6-04: Caret geometry
export type { Rect, CaretBlinkState } from './caret.js';
export { caretRect, startBlink, stopBlink, suspendBlink, resumeBlink } from './caret.js';

// P6-05: Selection model
export type { Selection } from './selection/model.js';
export {
  createCollapsed,
  createRange,
  createTableRect,
  normalizeSelection,
  selectionEquals,
  isCollapsed,
  selectionContains,
  selectionStartEnd,
} from './selection/model.js';

// P6-06: Selection geometry
export { selectionRects } from './selection/geometry.js';

// P6-07: Keyboard navigation
export type { NavigationPolicy } from './navigation/index.js';
export {
  moveHorizontal,
  moveVertical,
  moveByWord,
  moveToLineEdge,
  moveToDocumentEdge,
  extendSelection,
} from './navigation/index.js';

// P6-08: Input proxy
export type { InputProxyOptions } from './input/proxy.js';
export { InputProxy } from './input/proxy.js';

// P6-09: IME composition
export type { CompositionState } from './input/ime.js';
export {
  createCompositionState,
  onCompositionStart,
  onCompositionUpdate,
  onCompositionEnd,
  cancelComposition,
} from './input/ime.js';

// P6-16: Accessibility mirror
export type { AccessibilityMirror } from './a11y/mirror.js';
export { createAccessibilityMirror } from './a11y/mirror.js';
