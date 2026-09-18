import type { NodeId } from '@ooxml/wml';
import type { Segment } from './linebox';

export type TabJc =
  'clear' | 'start' | 'center' | 'end' | 'decimal' | 'bar' | 'num' | 'left' | 'right';
export type TabTlc = 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';

export interface TabStop {
  val: TabJc;
  pos: number;
  leader?: TabTlc;
}

/**
 * Resolves tab stops including inherited merging, clear operations, and default fallback.
 *
 * @param inherited Stops from styles
 * @param direct Stops direct formatting
 * @param defaultTabStop w:defaultTabStop from settings
 * @returns Sorted active tab stops
 */
export function resolveTabStops(
  inherited: TabStop[],
  direct: TabStop[],
  defaultTabStop: number,
): TabStop[] {
  const merged = new Map<number, TabStop>();

  for (const t of inherited) {
    merged.set(t.pos, t);
  }

  for (const t of direct) {
    if (t.val === 'clear') {
      merged.delete(t.pos);
    } else {
      merged.set(t.pos, t);
    }
  }

  const result = Array.from(merged.values()).sort((a, b) => a.pos - b.pos);
  return result;
}

/**
 * Calculates the next tab position.
 * Handles segment exclusions: a tab landing in an exclusion advances to the next segment.
 *
 * @param currentX Current pen position
 * @param stops Resolved tab stops
 * @param defaultTabStop Document default tab stop
 * @param segments Available segments on the line
 * @param currentSegmentIdx The current segment we are in
 */
export function calculateNextTab(
  currentX: number,
  stops: TabStop[],
  defaultTabStop: number,
  segments: Segment[],
  currentSegmentIdx: number,
): { x: number; segmentIdx: number; stop?: TabStop } {
  let nextX = -1;
  let matchedStop: TabStop | undefined;

  // Find the first explicit stop after currentX
  for (const stop of stops) {
    if (stop.pos > currentX) {
      if (stop.val === 'bar') {
        // bar draws without advancing the pen.
        // We skip it for positioning.
        continue;
      }
      nextX = stop.pos;
      matchedStop = stop;
      break;
    }
  }

  // If no explicit stop, use default interval
  if (nextX === -1 && defaultTabStop > 0) {
    const remainder = currentX % defaultTabStop;
    nextX = currentX + (defaultTabStop - remainder);
  } else if (nextX === -1) {
    // If even defaultTabStop is 0, just don't advance (unlikely, but fallback)
    nextX = currentX;
  }

  // Check exclusions: if nextX falls outside the current segment, we might land in an exclusion.
  const currentSeg = segments[currentSegmentIdx];
  if (currentSeg && nextX > currentSeg.x + currentSeg.width) {
    // The tab advances beyond the current segment.
    // Rule: a tab landing in an exclusion advances to the start of the next segment.
    if (currentSegmentIdx + 1 < segments.length) {
      const nextSeg = segments[currentSegmentIdx + 1];
      if (nextSeg) {
        const res: { x: number; segmentIdx: number; stop?: TabStop } = {
          x: nextSeg.x,
          segmentIdx: currentSegmentIdx + 1,
        };
        if (matchedStop) res.stop = matchedStop;
        return res;
      }
    }
  }

  const res: { x: number; segmentIdx: number; stop?: TabStop } = {
    x: nextX,
    segmentIdx: currentSegmentIdx,
  };
  if (matchedStop) res.stop = matchedStop;
  return res;
}
