import type { PageLayoutRecord, RelayoutContext, Rect } from '@ooxml/editor';
import type { Line } from '@ooxml/layout';
import type { NodeId } from '@ooxml/wml';
import { DemoLayoutPipeline } from './layout-pipeline';

/** Bridges the editor's incremental relayout driver to the demo's current page snapshot. */
export class DemoRelayoutContext implements RelayoutContext {
  private readonly linesByParagraph = new Map<NodeId, Line[]>();
  private paginationSteps = 0;
  private pages: PageLayoutRecord[];

  constructor(private readonly pipeline: DemoLayoutPipeline, pages: PageLayoutRecord[] = [...pipeline.pageLayouts]) {
    this.pages = pages;
    this.rebuildIndex(pages);
  }

  /** Replaces the snapshot after the host has run the complete layout pipeline. */
  updatePages(pages: readonly PageLayoutRecord[]): void {
    this.pages = [...pages];
    this.rebuildIndex(this.pages);
    this.paginationSteps = 0;
  }

  private rebuildIndex(pages: readonly PageLayoutRecord[]): void {
    this.linesByParagraph.clear();
    for (const page of pages) for (const line of page.lines) {
      const existing = this.linesByParagraph.get(line.paraId);
      if (existing) existing.push(line); else this.linesByParagraph.set(line.paraId, [line]);
    }
  }

  getParagraphLines(para: NodeId): Line[] { return this.linesByParagraph.get(para) ?? []; }

  layoutParagraph(para: NodeId): Line[] {
    // The public RelayoutContext has no model or line-breaker callback. Returning the
    // indexed snapshot is the only safe operation; callers must updatePages() after
    // a full pipeline pagination, rather than pretending text was reflowed here.
    return this.getParagraphLines(para);
  }
  getParagraphBounds(para: NodeId): Rect {
    const lines = this.getParagraphLines(para);
    const first = lines[0];
    return first === undefined ? { x: 0, y: 0, w: 0, h: 0 } : { x: first.segments[0]?.x ?? 0, y: first.top, w: first.segments.reduce((sum, s) => sum + s.width, 0), h: lines.reduce((sum, line) => sum + line.height, 0) };
  }
  getPageOfParagraph(para: NodeId): number {
    return this.pages.findIndex((page) => page.lines.some((line) => line.paraId === para));
  }
  getPage(pageIndex: number): PageLayoutRecord | undefined { return this.pages[pageIndex]; }
  reflowPage(pageIndex: number, cursorState: string): PageLayoutRecord {
    const page = this.pages[pageIndex];
    if (page === undefined) throw new RangeError(`Unknown page ${pageIndex}`);
    return { ...page, endState: `${cursorState}|${page.endState}` };
  }
  get pageCount(): number { return this.pages.length; }
  recordPaginationStep(): void { this.paginationSteps += 1; }
  get paginationRunCount(): number { return this.paginationSteps; }
}
