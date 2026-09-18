/**
 * Hit-testing: screen point → caret (P6-03).
 *
 * Click and drag map to a caret, including in RTL text, inside table cells,
 * and in the margin.
 *
 * KEY RULE: Hit-testing is a GEOMETRIC question and must walk VISUAL order.
 * Searching clusters in logical order gives wrong results in mixed-direction
 * text because the cluster whose visual x-range contains the point is not
 * found by scanning logical indices.
 *
 * RTL MIDPOINT RULE: "Left half of the cluster → before it" is correct only
 * for LTR. For an RTL cluster the left half is AFTER it in logical order.
 */

import type { Caret, Affinity } from './position/types.js';
import { createCaret } from './position/types.js';
import type { LayoutIndex } from './position/map.js';
import { toDocument } from './position/map.js';
import { hitTestLine } from '@ooxml/layout';
import type { DocPos } from '@ooxml/wml';

/**
 * Maps a screen point to a caret in the document.
 *
 * Algorithm:
 * 1. Find the nearest line by y-distance across all pages
 * 2. Delegate to hitTestLine (from @ooxml/layout) for x-coordinate resolution
 * 3. Apply RTL flip for leading edge determination
 * 4. Convert to Caret via toDocument
 *
 * Click past end of line → UPSTREAM affinity (renders on the clicked line,
 * not the next one).
 */
export function hitTest(
  point: { x: number; y: number },
  index: LayoutIndex,
): Caret | null {
  if (index.pages.length === 0) return null;

  // Find the nearest line across all pages by vertical distance
  let bestPageIdx = -1;
  let bestLineIdx = -1;
  let minYDist = Infinity;

  for (let p = 0; p < index.pages.length; p++) {
    const page = index.pages[p]!;
    for (let l = 0; l < page.lines.length; l++) {
      const line = page.lines[l]!;
      const top = line.top;
      const bottom = top + line.height;

      // Distance from point.y to line's vertical band
      let dist: number;
      if (point.y >= top && point.y <= bottom) {
        dist = 0; // inside the band
      } else if (point.y < top) {
        dist = top - point.y;
      } else {
        dist = point.y - bottom;
      }

      if (dist < minYDist) {
        minYDist = dist;
        bestPageIdx = p;
        bestLineIdx = l;
        if (dist === 0) break; // exact hit, no need to search further on this page
      }
    }
    // If we found an exact vertical hit, stop searching pages
    if (minYDist === 0) break;
  }

  if (bestPageIdx === -1 || bestLineIdx === -1) return null;

  const page = index.pages[bestPageIdx]!;
  const line = page.lines[bestLineIdx]!;

  // hitTestLine handles: segment selection, visual cluster walk, midpoint rule
  const hit = hitTestLine(line, point.x);
  if (!hit) return null;

  const segment = line.segments[hit.segmentIndex]!;
  const isLtr = segment.direction === 'ltr';

  // Apply RTL flip for leading edge:
  // LTR: left half ('left' affinity) → leading edge (before cluster)
  // RTL: left half ('left' affinity) → trailing edge (AFTER cluster) ← THE FLIP
  //      right half ('right' affinity) → leading edge (before cluster in logical order)
  let leadingEdge: boolean;
  if (isLtr) {
    leadingEdge = hit.affinity === 'left';
  } else {
    leadingEdge = hit.affinity === 'right';
  }

  // Convert the geometric hit into a document caret via toDocument.
  // toDocument handles affinity derivation from structural line position.
  const caret = toDocument(
    {
      page: bestPageIdx,
      lineIndex: bestLineIdx,
      segmentIndex: hit.segmentIndex,
      runIndex: hit.runIndex,
      cluster: hit.clusterIndex,
      leadingEdge,
    },
    index,
  );

  // Override: click past end of line → UPSTREAM so caret renders on this line
  if (point.x > hit.xEnd && hit.affinity === 'right') {
    return createCaret(caret.pos, 'upstream', caret.preferredX);
  }

  return caret;
}

/**
 * Maps a screen point to a word boundary range (for double-click selection).
 *
 * Requires a text provider to look up the full text of the source node,
 * since word segmentation needs the complete string (not just the cluster
 * at the hit point). The textProvider callback resolves NodeId → text.
 */
export function hitTestWord(
  point: { x: number; y: number },
  index: LayoutIndex,
  textProvider?: (nodeId: DocPos['node']) => string | undefined,
): { start: DocPos; end: DocPos } | null {
  const caret = hitTest(point, index);
  if (!caret) return null;

  if (!textProvider) {
    // Without text, we can't segment words. Return a zero-width range at the hit.
    return { start: caret.pos, end: caret.pos };
  }

  const text = textProvider(caret.pos.node);
  if (!text) return { start: caret.pos, end: caret.pos };

  // Use Intl.Segmenter to find word boundaries around the hit offset
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const segments = segmenter.segment(text);
  for (const seg of segments) {
    const segEnd = seg.index + seg.segment.length;
    if (caret.pos.offset >= seg.index && caret.pos.offset < segEnd) {
      return {
        start: { node: caret.pos.node, offset: seg.index },
        end: { node: caret.pos.node, offset: segEnd },
      };
    }
  }

  return { start: caret.pos, end: caret.pos };
}

/**
 * Maps a screen point to a paragraph boundary range (for triple-click).
 *
 * Requires a text provider to determine the paragraph's total text length.
 */
export function hitTestParagraph(
  point: { x: number; y: number },
  index: LayoutIndex,
  textProvider?: (nodeId: DocPos['node']) => number | undefined,
): { start: DocPos; end: DocPos } | null {
  const caret = hitTest(point, index);
  if (!caret) return null;

  // Paragraph selection: from offset 0 to the paragraph's text length
  const length = textProvider?.(caret.pos.node) ?? 0;
  return {
    start: { node: caret.pos.node, offset: 0 },
    end: { node: caret.pos.node, offset: length },
  };
}
