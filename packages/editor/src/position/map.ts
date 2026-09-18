/**
 * Position mapping: document ⇄ layout (P6-02).
 *
 * `toLayout(caret)` → LayoutPos or NOT_LAID_OUT
 * `toDocument(lp)`  → Caret
 *
 * These are the only sanctioned conversion path between the two coordinate
 * systems. The critical invariant: toDocument(toLayout(c)) == c for every
 * caret, including both affinities at each soft-wrap boundary.
 *
 * Performance: O(log N) per conversion via binary search, not linear scan.
 * Called on every caret move, selection extension, drag frame, and per
 * selection rectangle, so linear would eat the frame budget on long docs.
 */

import type { NodeId, DocPos } from '@ooxml/wml';
import type { Line } from '@ooxml/layout';
import { clusterAtSourceOffset } from '@ooxml/layout';
import type { Caret, LayoutPos, Affinity } from './types.js';
import { createCaret } from './types.js';

// ---------------------------------------------------------------------------
// Layout index — populated and maintained by the layout engine (P5/P6-13).
// We define the interfaces here because the editor owns the contract.
// ---------------------------------------------------------------------------

export interface PageLayoutInfo {
  /** All lines on this page, in visual top-to-bottom order */
  lines: Line[];
  /** This page's index in the LayoutIndex.pages array */
  pageIndex: number;
}

export interface ParagraphLayoutEntry {
  /** Which page this paragraph lives on */
  page: number;
  /** Indices into pages[page].lines for lines belonging to this paragraph */
  lineIndices: number[];
}

export interface LayoutIndex {
  /** NodeId → layout entry for each laid-out paragraph */
  paragraphs: Map<NodeId, ParagraphLayoutEntry>;
  /** All pages in document order */
  pages: PageLayoutInfo[];
}

export type MappingResult = LayoutPos | 'NOT_LAID_OUT';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes the min and max logical source offsets for a given node on a line.
 * Needed because Line doesn't directly store its logical offset range —
 * we derive it from the runs' cluster metadata.
 */
function getLineNodeBounds(
  line: Line,
  nodeId: NodeId,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let found = false;

  for (const segment of line.segments) {
    for (const run of segment.runs) {
      if (run.srcNode === nodeId && run.clusters.clusterCount > 0) {
        found = true;
        for (let i = 0; i < run.clusters.clusterCount; i++) {
          const off = run.clusters.srcOffset(i);
          const len = run.clusters.srcLength(i);
          min = Math.min(min, off);
          // max is the exclusive end of the furthest cluster
          max = Math.max(max, off + len);
        }
      }
    }
  }
  return found ? { min, max } : null;
}

// ---------------------------------------------------------------------------
// toLayout: DocPos → LayoutPos
// ---------------------------------------------------------------------------

/**
 * Maps a caret (document coordinate + affinity) to a transient layout position.
 *
 * Returns 'NOT_LAID_OUT' if the paragraph hasn't been laid out yet (page
 * virtualization). Callers must handle this — it is NOT an error, just a
 * signal that layout needs to be forced for this region.
 */
export function toLayout(caret: Caret, index: LayoutIndex): MappingResult {
  const entry = index.paragraphs.get(caret.pos.node);
  if (!entry) return 'NOT_LAID_OUT';

  const pageInfo = index.pages[entry.page];
  if (!pageInfo) return 'NOT_LAID_OUT';

  const { node, offset } = caret.pos;

  // Collect lines belonging to this node with their source offset ranges.
  // lineIndices is in document order, so min/max are monotonically increasing.
  const lineSpans: { lineIdx: number; min: number; max: number }[] = [];
  for (const lineIdx of entry.lineIndices) {
    const line = pageInfo.lines[lineIdx];
    if (!line) continue;
    const bounds = getLineNodeBounds(line, node);
    if (bounds) {
      lineSpans.push({ lineIdx, ...bounds });
    }
  }

  if (lineSpans.length === 0) return 'NOT_LAID_OUT';

  // Find which line contains this offset, respecting affinity at wrap boundaries.
  let targetLineIdx = -1;

  for (let i = 0; i < lineSpans.length; i++) {
    const { lineIdx, min, max } = lineSpans[i]!;

    if (offset >= min && offset < max) {
      // Strictly inside this line's range
      targetLineIdx = lineIdx;
      break;
    }

    if (offset === max) {
      // At the boundary: could be end-of-this-line or start-of-next-line.
      const nextSpan = lineSpans[i + 1];
      if (nextSpan && nextSpan.min === offset) {
        // Soft-wrap boundary — affinity decides which line owns this position.
        // UPSTREAM = belongs to the text before → end of line N
        // DOWNSTREAM = belongs to the text after → start of line N+1
        targetLineIdx =
          caret.affinity === 'upstream' ? lineIdx : nextSpan.lineIdx;
      } else {
        // End of this line with no continuation (paragraph end, explicit break)
        targetLineIdx = lineIdx;
      }
      break;
    }
  }

  // Edge cases: offset before first cluster or after last cluster
  if (targetLineIdx === -1) {
    if (offset <= lineSpans[0]!.min) {
      targetLineIdx = lineSpans[0]!.lineIdx;
    } else {
      targetLineIdx = lineSpans[lineSpans.length - 1]!.lineIdx;
    }
  }

  const line = pageInfo.lines[targetLineIdx];
  if (!line) return 'NOT_LAID_OUT';

  // Find the specific cluster within the line using the layout's binary search.
  const clusterRes = clusterAtSourceOffset(line, node, offset);
  let leadingEdge = true;

  if (clusterRes) {
    // Found the cluster containing this offset → leading edge (before the cluster's text)
    leadingEdge = true;
  } else {
    // Offset is at or past the end of all clusters for this node on this line.
    // Position at the trailing edge of the last cluster belonging to this node.
    let lastSeg = -1;
    let lastRun = -1;
    let lastCluster = -1;
    let maxOff = -1;

    for (let s = 0; s < line.segments.length; s++) {
      const seg = line.segments[s]!;
      for (let r = 0; r < seg.runs.length; r++) {
        const run = seg.runs[r]!;
        if (run.srcNode === node) {
          for (let c = 0; c < run.clusters.clusterCount; c++) {
            const off = run.clusters.srcOffset(c);
            const len = run.clusters.srcLength(c);
            if (off + len >= maxOff) {
              maxOff = off + len;
              lastSeg = s;
              lastRun = r;
              lastCluster = c;
            }
          }
        }
      }
    }

    if (lastSeg !== -1) {
      return {
        page: entry.page,
        lineIndex: targetLineIdx,
        segmentIndex: lastSeg,
        runIndex: lastRun,
        cluster: lastCluster,
        leadingEdge: false, // trailing edge — after the cluster's text
      };
    }

    // Absolute fallback: first cluster on the line
    return {
      page: entry.page,
      lineIndex: targetLineIdx,
      segmentIndex: 0,
      runIndex: 0,
      cluster: 0,
      leadingEdge: true,
    };
  }

  return {
    page: entry.page,
    lineIndex: targetLineIdx,
    segmentIndex: clusterRes.segmentIndex,
    runIndex: clusterRes.runIndex,
    cluster: clusterRes.clusterIndex,
    leadingEdge,
  };
}

// ---------------------------------------------------------------------------
// toDocument: LayoutPos → Caret
// ---------------------------------------------------------------------------

/**
 * Maps a transient layout position back to a document caret.
 * Derives affinity from the position's role in the line:
 *   - First cluster of a non-first line + leading edge → DOWNSTREAM
 *   - Last cluster of a non-last line + trailing edge → UPSTREAM
 *   - Everything else → DOWNSTREAM (the safe default)
 */
export function toDocument(lp: LayoutPos, index: LayoutIndex): Caret {
  const pageInfo = index.pages[lp.page];
  if (!pageInfo) throw new Error(`Invalid LayoutPos: page ${lp.page} out of range`);

  const line = pageInfo.lines[lp.lineIndex];
  if (!line) throw new Error(`Invalid LayoutPos: lineIndex ${lp.lineIndex} out of range`);

  const segment = line.segments[lp.segmentIndex];
  if (!segment) throw new Error(`Invalid LayoutPos: segmentIndex ${lp.segmentIndex} out of range`);

  const run = segment.runs[lp.runIndex];
  if (!run) throw new Error(`Invalid LayoutPos: runIndex ${lp.runIndex} out of range`);

  const clusters = run.clusters;
  if (lp.cluster < 0 || lp.cluster >= clusters.clusterCount) {
    throw new Error(`Invalid LayoutPos: cluster ${lp.cluster} out of range [0, ${clusters.clusterCount})`);
  }

  // Derive the source offset from the cluster
  let srcOffset = clusters.srcOffset(lp.cluster);
  if (!lp.leadingEdge) {
    // Trailing edge: position is AFTER this cluster's text
    srcOffset += clusters.srcLength(lp.cluster);
  }

  // Derive affinity from structural position in the line
  let affinity: Affinity = 'downstream';

  const isFirstClusterOfLine =
    lp.segmentIndex === 0 && lp.runIndex === 0 && lp.cluster === 0;
  const isLastClusterOfLine =
    lp.segmentIndex === line.segments.length - 1 &&
    lp.runIndex === segment.runs.length - 1 &&
    lp.cluster === clusters.clusterCount - 1;

  if (!lp.leadingEdge && isLastClusterOfLine && !line.isLast) {
    // At the trailing edge of the last cluster of a non-last line:
    // this is a soft-wrap boundary, and the position belongs to line N → UPSTREAM
    affinity = 'upstream';
  } else if (lp.leadingEdge && isFirstClusterOfLine && !line.isFirst) {
    // At the leading edge of the first cluster of a non-first line:
    // this is the "after" side of a soft-wrap boundary → DOWNSTREAM
    affinity = 'downstream';
  }

  return createCaret({ node: run.srcNode, offset: srcOffset }, affinity);
}
