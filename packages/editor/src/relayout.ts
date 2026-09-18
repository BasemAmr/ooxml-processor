import type { NodeId } from '@ooxml/wml';
import type { Line } from '@ooxml/layout';
import type { Rect } from './caret.js';

export interface DirtySet {
  paragraphs: Set<NodeId>;
  pages: Set<number>;
  globalFields: boolean;
}

export interface OutflowState {
  lastLineEndPos: number;
  totalHeight: number;
  trailingKeepConstraints: boolean;
  pendingFloatIds: string[];
  footnoteRefsEmitted: number;
}

export function computeOutflowState(lines: readonly Line[]): OutflowState {
  if (lines.length === 0) {
    return {
      lastLineEndPos: 0,
      totalHeight: 0,
      trailingKeepConstraints: false,
      pendingFloatIds: [],
      footnoteRefsEmitted: 0,
    };
  }

  let totalHeight = 0;
  for (const line of lines) {
    totalHeight += line.height;
  }

  // Derive lastLineEndPos from last segment/run of the last line
  const lastLine = lines[lines.length - 1]!;
  let lastEnd = 0;
  if (lastLine.segments.length > 0) {
    const lastSeg = lastLine.segments[lastLine.segments.length - 1]!;
    if (lastSeg.runs.length > 0) {
      const lastRun = lastSeg.runs[lastSeg.runs.length - 1]!;
      const count = lastRun.clusters.clusterCount;
      if (count > 0) {
        lastEnd = lastRun.clusters.srcOffset(count - 1) + lastRun.clusters.srcLength(count - 1);
      }
    }
  }

  return {
    lastLineEndPos: lastEnd,
    totalHeight,
    trailingKeepConstraints: false,
    pendingFloatIds: [],
    footnoteRefsEmitted: 0,
  };
}

export function areOutflowsEqual(a: OutflowState, b: OutflowState): boolean {
  if (a.lastLineEndPos !== b.lastLineEndPos) return false;
  if (Math.abs(a.totalHeight - b.totalHeight) > 0.001) return false;
  if (a.trailingKeepConstraints !== b.trailingKeepConstraints) return false;
  if (a.footnoteRefsEmitted !== b.footnoteRefsEmitted) return false;
  if (a.pendingFloatIds.length !== b.pendingFloatIds.length) return false;
  for (let i = 0; i < a.pendingFloatIds.length; i++) {
    if (a.pendingFloatIds[i] !== b.pendingFloatIds[i]) return false;
  }
  return true;
}

export interface PageLayoutRecord {
  pageIndex: number;
  bounds: Rect;
  lines: Line[];
  endState: string; // Token/hash of end state
}

export interface RelayoutContext {
  getParagraphLines(para: NodeId): Line[];
  layoutParagraph(para: NodeId): Line[];
  getParagraphBounds(para: NodeId): Rect;
  getPageOfParagraph(para: NodeId): number;
  getPage(pageIndex: number): PageLayoutRecord | undefined;
  reflowPage(pageIndex: number, cursorState: string): PageLayoutRecord;
  pageCount: number;
  recordPaginationStep?(): void;
}

export interface RepaintSet {
  rects: Rect[];
  pages: Set<number>;
  paginationRuns: number;
}

export function relayout(dirty: DirtySet, ctx: RelayoutContext): RepaintSet {
  const repaint: RepaintSet = {
    rects: [],
    pages: new Set(),
    paginationRuns: 0,
  };

  const dirtyPages = new Set<number>(dirty.pages);

  // ---- Stage 1: line-level, per dirty paragraph, in document order --------
  for (const para of dirty.paragraphs) {
    const oldLines = ctx.getParagraphLines(para);
    const oldOutflow = computeOutflowState(oldLines);

    const newLines = ctx.layoutParagraph(para);
    const newOutflow = computeOutflowState(newLines);

    if (areOutflowsEqual(oldOutflow, newOutflow)) {
      // EARLY STOP: Outflow unchanged -> no pagination work at all!
      // This is the common case for ordinary typing within existing line boundaries.
      repaint.rects.push(ctx.getParagraphBounds(para));
      continue;
    }

    // Outflow changed: page needs pagination
    dirtyPages.add(ctx.getPageOfParagraph(para));
  }

  // If no pages were marked dirty and no global field invalidation, stop here!
  if (dirtyPages.size === 0 && !dirty.globalFields) {
    return repaint;
  }

  // ---- Stage 2: pagination, forward from the earliest dirty page ----------
  let p = Math.min(...dirtyPages);
  let cursor = `start-of-page-${p}`;
  const HARD_PAGE_CAP = 1000;

  while (p < ctx.pageCount && p < HARD_PAGE_CAP) {
    ctx.recordPaginationStep?.();
    repaint.paginationRuns++;

    const oldPage = ctx.getPage(p);
    const newPage = ctx.reflowPage(p, cursor);

    repaint.pages.add(p);
    repaint.rects.push(newPage.bounds);

    // Resynchronisation condition:
    // If endState matches oldPage.endState and no global fields are dirty,
    // everything after page p is guaranteed identical -> EARLY STOP!
    if (!dirty.globalFields && oldPage && newPage.endState === oldPage.endState) {
      break;
    }

    cursor = newPage.endState;
    p++;
  }

  if (dirty.globalFields) {
    for (let i = 0; i < ctx.pageCount; i++) {
      repaint.pages.add(i);
      const page = ctx.getPage(i);
      if (page) {
        repaint.rects.push(page.bounds);
      }
    }
  }

  return repaint;
}
