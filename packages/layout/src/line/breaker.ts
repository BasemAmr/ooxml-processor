import type { NodeId } from '@ooxml/wml';
import type { InlineItem, TextItem } from './stream.js';
import type { Line, Segment, GlyphRun, BreakKind } from './linebox.js';
import type { RunDirection } from '@ooxml/text';

export interface SegmentAvailability {
  x: number;
  width: number;
}

export interface LineBreakContext {
  paragraphId: NodeId;
  paragraphTop: number;
  containerWidth: number;

  /** Query available space avoiding floats. */
  availableSegments(y: number, height: number): SegmentAvailability[];

  /** Report diagnostics (e.g., 'unbreakable-overflow') */
  reportDiagnostic(msg: string): void;
}

interface ItemCursor {
  itemIndex: number;
  clusterIndex: number; // For Text items, the index within shapedRun
}

export function breakParagraph(items: readonly InlineItem[], context: LineBreakContext): Line[] {
  const lines: Line[] = [];
  let y = context.paragraphTop;
  let cursor: ItemCursor = { itemIndex: 0, clusterIndex: 0 };

  const totalItems = items.length;

  while (cursor.itemIndex < totalItems) {
    let provisionalHeight = 240;
    let provisionalBaseline = 190;

    let hasRequeried = false;
    let finalLine: Line | null = null;

    while (true) {
      const segs = context.availableSegments(y, provisionalHeight);

      if (segs.length === 0) {
        y += provisionalHeight;
        break;
      }

      let lineSegments: Segment[] = [];
      let currentCursor = { ...cursor };
      let maxHeight = 0;
      let lineBreakKind: BreakKind = 'wrap';
      let done = false;

      for (const availSeg of segs) {
        let segmentRuns: GlyphRun[] = [];
        let currentWidth = 0;
        let lastOpportunity: {
          cursor: ItemCursor;
          runs: GlyphRun[];
          width: number;
          height: number;
        } | null = null;

        let segCursor = { ...currentCursor };
        let segFull = false;

        while (segCursor.itemIndex < totalItems && !segFull) {
          const item = items[segCursor.itemIndex]!;

          if (item.kind === 'text') {
            const textItem = item as TextItem;
            const run = textItem.shapedRun;
            let runStart = segCursor.clusterIndex;
            let c = runStart;

            while (c < run.clusterCount) {
              const advance = run.xAdvance(c);
              const isOpp = textItem.breakOpportunities[c] === 1;

              if (currentWidth + advance > availSeg.width) {
                if (lastOpportunity) {
                  segFull = true;
                  currentWidth = lastOpportunity.width;
                  segmentRuns = lastOpportunity.runs;
                  segCursor = lastOpportunity.cursor;
                  break;
                } else {
                  // Unbreakable overflow!
                  context.reportDiagnostic('unbreakable-overflow');
                  currentWidth += advance;
                  c++;
                  segFull = true;

                  // Record this forced slice
                  const sliced = run.slice(runStart, c);
                  segmentRuns.push({
                    fontKey: run.faceId,
                    size: run.fontSize,
                    srcNode: textItem.srcNode,
                    style: null,
                    clusters: sliced as any,
                  });
                  segCursor.clusterIndex = c;
                  maxHeight = Math.max(maxHeight, run.fontSize * 2 || 240);
                  if (c === run.clusterCount) {
                    segCursor.itemIndex++;
                    segCursor.clusterIndex = 0;
                  }
                  break;
                }
              }

              currentWidth += advance;
              c++;

              if (isOpp) {
                const sliced = run.slice(runStart, c);
                const currentRuns = [
                  ...segmentRuns,
                  {
                    fontKey: run.faceId,
                    size: run.fontSize,
                    srcNode: textItem.srcNode,
                    style: null,
                    clusters: sliced as any,
                  },
                ];
                lastOpportunity = {
                  cursor: { itemIndex: segCursor.itemIndex, clusterIndex: c },
                  runs: currentRuns,
                  width: currentWidth,
                  height: run.fontSize * 2,
                };
              }
            }

            if (!segFull && c > runStart) {
              const sliced = run.slice(runStart, c);
              segmentRuns.push({
                fontKey: run.faceId,
                size: run.fontSize,
                srcNode: textItem.srcNode,
                style: null,
                clusters: sliced as any,
              });
              segCursor.clusterIndex = c;
              maxHeight = Math.max(maxHeight, run.fontSize * 2 || 240);

              if (c === run.clusterCount) {
                segCursor.itemIndex++;
                segCursor.clusterIndex = 0;
              }
            }
          } else if (item.kind === 'break') {
            lineBreakKind = item.breakKind as BreakKind;
            segCursor.itemIndex++;
            segCursor.clusterIndex = 0;
            done = true;
            break;
          } else {
            segCursor.itemIndex++;
            segCursor.clusterIndex = 0;
          }
        }

        if (segmentRuns.length > 0) {
          lineSegments.push({
            x: availSeg.x,
            width: currentWidth,
            direction: 'ltr' as RunDirection,
            runs: segmentRuns,
          });
        }

        currentCursor = segCursor;
        if (done || currentCursor.itemIndex >= totalItems) {
          break;
        }
      }

      if (
        currentCursor.itemIndex === cursor.itemIndex &&
        currentCursor.clusterIndex === cursor.clusterIndex
      ) {
        cursor.itemIndex++;
        break;
      }

      const newHeight = maxHeight || 240;
      if (!hasRequeried && newHeight !== provisionalHeight) {
        hasRequeried = true;
        const newSegs = context.availableSegments(y, newHeight);
        if (JSON.stringify(newSegs) !== JSON.stringify(segs)) {
          provisionalHeight = newHeight;
          continue;
        }
      }

      finalLine = {
        paraId: context.paragraphId,
        top: y,
        height: newHeight,
        baseline: provisionalBaseline,
        breakKind: lineBreakKind,
        isFirst: lines.length === 0,
        isLast: currentCursor.itemIndex >= totalItems,
        segments: lineSegments,
      };

      cursor = currentCursor;
      break;
    }

    if (finalLine) {
      lines.push(finalLine);
      y += finalLine.height;
    }
  }

  if (lines.length > 0) {
    lines[lines.length - 1]!.isLast = true;
  }

  return lines;
}
