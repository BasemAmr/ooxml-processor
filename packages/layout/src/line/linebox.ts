/**
 * Line Box Representation (P5-01)
 */

import type { NodeId } from '@ooxml/wml';
import type { PackedShapedRun, RunDirection } from '@ooxml/text';

/**
 * A glyph run within a segment, tying layout geometry back to the source node
 * and mapping precise offsets to a packed cluster storage.
 */
export interface GlyphRun {
  /** The interned font face identifier */
  fontKey: number;
  /** Font size in half-points */
  size: number;
  /** The source w:r node identity */
  srcNode: NodeId;
  /**
   * Stored resolved style information for the run.
   * `any` used for now to be agnostic of the actual style object shape.
   */
  style: any;
  /**
   * The flat numeric clusters representing glyph metrics and source mapping.
   * Clusters must be sliced/viewed rather than copied for performance.
   */
  clusters: PackedShapedRun;
}

/**
 * A continuous horizontal segment of text on a line.
 * Lines can have multiple segments if they are broken around float exclusions.
 */
export interface Segment {
  /** The X coordinate relative to the containing block (in twips/points) */
  x: number;
  /** The width of the segment */
  width: number;
  /** Base text direction of the segment */
  direction: RunDirection;
  /**
   * The shaped glyph runs that make up this segment.
   * Ordered in visual left-to-right sequence on screen.
   */
  runs: GlyphRun[];
}

/**
 * Break reason for a line box.
 */
export type BreakKind = 'wrap' | 'explicit' | 'paraEnd' | 'page' | 'column';

/**
 * A Line Box, representing one visual line of layout text.
 */
export interface Line {
  /** The NodeId of the parent paragraph */
  paraId: NodeId;
  /** The Y coordinate relative to the containing block */
  top: number;
  /** The total height of the line */
  height: number;
  /** The distance from `top` to the baseline */
  baseline: number;
  /** Why this line ended */
  breakKind: BreakKind;
  /** True if this is the first line of the paragraph */
  isFirst: boolean;
  /** True if this is the last line of the paragraph */
  isLast: boolean;
  /**
   * Segments of the line. Length >= 1.
   * Split into multiple segments by floating exclusions or drop caps.
   */
  segments: Segment[];
}

export interface ClusterMappingResult {
  segmentIndex: number;
  runIndex: number;
  clusterIndex: number;
}

/**
 * Maps a logical source offset in a specific source node to its segment, run, and visual cluster index.
 * Uses O(log N) binary search inside the shaped run.
 *
 * @param line The line box to query
 * @param srcNode The NodeId of the run element
 * @param srcOffset The logical character offset within the source node
 * @returns The mapping result, or null if the offset is not contained in this line.
 */
export function clusterAtSourceOffset(
  line: Line,
  srcNode: NodeId,
  srcOffset: number,
): ClusterMappingResult | null {
  // We must scan through segments and runs since a source node could potentially
  // span multiple runs or be split across segments.
  for (let s = 0; s < line.segments.length; s++) {
    const segment = line.segments[s]!;
    for (let r = 0; r < segment.runs.length; r++) {
      const run = segment.runs[r]!;
      if (run.srcNode === srcNode) {
        // Binary search within the packed run
        const clusterIndex = run.clusters.clusterAtSourceOffset(srcOffset);
        if (clusterIndex !== -1) {
          return { segmentIndex: s, runIndex: r, clusterIndex };
        }
      }
    }
  }
  return null;
}

export type CaretAffinity = 'left' | 'right';

export interface HitTestResult {
  segmentIndex: number;
  runIndex: number;
  clusterIndex: number;
  srcNode: NodeId;
  srcOffset: number;
  affinity: CaretAffinity;
  xStart: number;
  xEnd: number;
}

/**
 * Maps a physical horizontal coordinate to the closest segment, visual cluster,
 * and logical srcOffset, with caret affinity.
 *
 * @param line The line box
 * @param x The horizontal coordinate
 * @returns Hit test result containing logical mapping and geometric bounds.
 */
export function hitTestLine(line: Line, x: number): HitTestResult | null {
  if (line.segments.length === 0) return null;

  // Find the closest segment
  let bestSegmentIdx = -1;
  let minDistance = Infinity;

  for (let s = 0; s < line.segments.length; s++) {
    const segment = line.segments[s]!;
    if (x >= segment.x && x <= segment.x + segment.width) {
      bestSegmentIdx = s;
      break;
    }
    const distStart = Math.abs(x - segment.x);
    const distEnd = Math.abs(x - (segment.x + segment.width));
    const dist = Math.min(distStart, distEnd);
    if (dist < minDistance) {
      minDistance = dist;
      bestSegmentIdx = s;
    }
  }

  if (bestSegmentIdx === -1) bestSegmentIdx = 0; // Fallback to first
  const segment = line.segments[bestSegmentIdx]!;
  if (segment.runs.length === 0) return null;

  // If before segment
  if (x <= segment.x) {
    const run = segment.runs[0]!;
    const clusters = run.clusters;
    return {
      segmentIndex: bestSegmentIdx,
      runIndex: 0,
      clusterIndex: 0,
      srcNode: run.srcNode,
      srcOffset: clusters.clusterCount > 0 ? clusters.srcOffset(0) : 0,
      affinity: 'left',
      xStart: segment.x,
      xEnd: segment.x + (clusters.clusterCount > 0 ? clusters.xAdvance(0) : 0),
    };
  }

  // Iterate clusters to find coordinate
  let currentX = segment.x;
  for (let r = 0; r < segment.runs.length; r++) {
    const run = segment.runs[r]!;
    const clusters = run.clusters;

    for (let c = 0; c < clusters.clusterCount; c++) {
      const advance = clusters.xAdvance(c);
      const startX = currentX;
      const endX = currentX + advance;

      if (x >= startX && x <= endX) {
        // We are within this cluster. Determine affinity based on midpoint.
        const midpoint = startX + advance / 2;
        const affinity = x < midpoint ? 'left' : 'right';

        return {
          segmentIndex: bestSegmentIdx,
          runIndex: r,
          clusterIndex: c,
          srcNode: run.srcNode,
          srcOffset: clusters.srcOffset(c),
          affinity,
          xStart: startX,
          xEnd: endX,
        };
      }
      currentX = endX;
    }
  }

  // If after segment, snap to the last cluster of the last run
  const lastRunIdx = segment.runs.length - 1;
  const lastRun = segment.runs[lastRunIdx]!;
  const lastClusters = lastRun.clusters;
  const lastClusterIdx = Math.max(0, lastClusters.clusterCount - 1);
  const startX =
    currentX - (lastClusters.clusterCount > 0 ? lastClusters.xAdvance(lastClusterIdx) : 0);

  return {
    segmentIndex: bestSegmentIdx,
    runIndex: lastRunIdx,
    clusterIndex: lastClusterIdx,
    srcNode: lastRun.srcNode,
    srcOffset: lastClusters.clusterCount > 0 ? lastClusters.srcOffset(lastClusterIdx) : 0,
    affinity: 'right',
    xStart: startX,
    xEnd: currentX,
  };
}
