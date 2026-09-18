import type { DisplayList, DisplayItem, GlyphRunItem } from './displaylist';

export interface BatchStats {
  stateTransitions: number;
}

export type BatchedDisplayItem =
  | {
      type: 'glyphBatch';
      fontKey: string | number;
      size: number;
      color: string;
      runs: GlyphRunItem[];
    }
  | DisplayItem;

/**
 * Batches display items to minimize Canvas 2D state changes.
 *
 * Invariants:
 * - NEVER reorder across ClipPush, ClipPop, TransformPush, TransformPop.
 * - Preserve paint order within each batch.
 * - Minimize state transitions by batching GlyphRunItems with the same (fontKey, size, color).
 */
export function batchDisplayList(list: DisplayList): {
  items: BatchedDisplayItem[];
  stats: BatchStats;
} {
  const items: BatchedDisplayItem[] = [];
  let stats: BatchStats = { stateTransitions: 0 };

  let currentBatch: {
    fontKey: string | number;
    size: number;
    color: string;
    runs: GlyphRunItem[];
  } | null = null;
  let lastFont = '';
  let lastColor = '';

  const flushBatch = () => {
    if (currentBatch) {
      items.push({
        type: 'glyphBatch',
        fontKey: currentBatch.fontKey,
        size: currentBatch.size,
        color: currentBatch.color,
        runs: currentBatch.runs,
      });
      const fontStr = `${currentBatch.size}px ${currentBatch.fontKey}`;
      if (fontStr !== lastFont) {
        stats.stateTransitions++;
        lastFont = fontStr;
      }
      if (currentBatch.color !== lastColor) {
        stats.stateTransitions++;
        lastColor = currentBatch.color;
      }
      currentBatch = null;
    }
  };

  for (const item of list.items) {
    if (
      item.type === 'clipPush' ||
      item.type === 'clipPop' ||
      item.type === 'transformPush' ||
      item.type === 'transformPop'
    ) {
      flushBatch();
      items.push(item);
    } else if (item.type === 'glyphRun') {
      if (
        currentBatch &&
        currentBatch.fontKey === item.fontKey &&
        currentBatch.size === item.size &&
        currentBatch.color === item.color
      ) {
        currentBatch.runs.push(item);
      } else {
        flushBatch();
        currentBatch = { fontKey: item.fontKey, size: item.size, color: item.color, runs: [item] };
      }
    } else {
      flushBatch();
      items.push(item);
      // Rects, lines etc can also cause state transitions, we'll increment them loosely here
      stats.stateTransitions++;
      lastFont = '';
      lastColor = '';
    }
  }
  flushBatch();

  return { items, stats };
}
