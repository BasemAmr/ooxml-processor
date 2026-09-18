import { toLayout } from './position/map.js';
import type { Caret } from './position/types.js';
import type { LayoutIndex } from './position/map.js';

export interface Rect { x: number; y: number; w: number; h: number; }

export function caretRect(caret: Caret, index: LayoutIndex): Rect | null {
  const lp = toLayout(caret, index);
  if (lp === 'NOT_LAID_OUT') return null;

  const page = index.pages[lp.page];
  if (!page) return null;
  const line = page.lines[lp.lineIndex];
  if (!line) return null;
  const segment = line.segments[lp.segmentIndex];
  if (!segment) return null;

  let x = segment.x;
  for (let r = 0; r <= lp.runIndex; r++) {
    const run = segment.runs[r]!;
    const limit = (r === lp.runIndex) ? lp.cluster : run.clusters.clusterCount;
    for (let c = 0; c < limit; c++) {
      x += run.clusters.xAdvance(c);
    }
  }

  const run = segment.runs[lp.runIndex]!;
  const advance = run.clusters.clusterCount > 0 && lp.cluster < run.clusters.clusterCount
    ? run.clusters.xAdvance(lp.cluster)
    : 0;

  const isRtl = segment.direction === 'rtl';
  let caretX: number;

  if (isRtl) {
    caretX = lp.leadingEdge ? x + advance : x;
  } else {
    caretX = lp.leadingEdge ? x : x + advance;
  }

  return {
    x: caretX,
    y: line.top,
    w: 1,
    h: line.height,
  };
}

export interface CaretBlinkState { visible: boolean; timer: number | null; }

export function startBlink(onToggle: (visible: boolean) => void): CaretBlinkState {
  const state: CaretBlinkState = { visible: true, timer: null };
  onToggle(state.visible);
  state.timer = setInterval(() => {
    state.visible = !state.visible;
    onToggle(state.visible);
  }, 500) as unknown as number;
  return state;
}

export function stopBlink(state: CaretBlinkState): void {
  if (state.timer !== null) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

export function suspendBlink(state: CaretBlinkState): void {
  stopBlink(state);
  state.visible = true;
}

export function resumeBlink(state: CaretBlinkState, onToggle: (visible: boolean) => void): void {
  suspendBlink(state);
  onToggle(state.visible);
  state.timer = setInterval(() => {
    state.visible = !state.visible;
    onToggle(state.visible);
  }, 500) as unknown as number;
}
