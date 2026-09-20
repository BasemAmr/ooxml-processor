import type { CT_Document, CT_P, CT_R } from '@ooxml/schema';
import { ExclusionStore, enumerateSections, fillPage, pageGeometry, textArea, type PageState } from '@ooxml/layout';
import { IdTable, type NodeId } from '@ooxml/wml';
import type { PageLayoutRecord, Rect } from '@ooxml/editor';
import { breakParagraphToLines, type LineBreakerRun } from './line-breaker';
import { DemoTextService } from './text-adapter';

interface BlockLayout { readonly paraId: NodeId; readonly lines: ReturnType<typeof breakParagraphToLines>; }

function textOfRun(run: CT_R): string {
  return run.runInnerContent.filter((item) => item.kind === 't').map((item) => String(item.value.$value ?? '')).join('');
}

function paragraphRuns(p: CT_P, ids: IdTable): LineBreakerRun[] {
  return p.pContent.flatMap((item) => item.kind === 'r' ? [{ srcNode: ids.mint('run'), text: textOfRun(item.value) }] : []);
}

/** Small, deterministic demo pagination slice; unsupported block kinds are reported, not dropped silently. */
export class DemoLayoutPipeline {
  readonly text: DemoTextService;
  readonly ids: IdTable;
  readonly diagnostics: string[] = [];
  private pages: PageLayoutRecord[] = [];
  private blocks: BlockLayout[] = [];

  constructor(text = new DemoTextService(), ids = new IdTable()) { this.text = text; this.ids = ids; }

  paginate(doc: CT_Document): PageLayoutRecord[] {
    this.pages = [];
    this.blocks = [];
    this.diagnostics.length = 0;
    const body = doc.body;
    if (body === undefined) return [];
    const sections = enumerateSections(body);
    let pageIndex = 0;
    for (const section of sections) {
      const geometry = pageGeometry(section.sectPr);
      const area = textArea(geometry, pageIndex + 1);
      const exclusions = new ExclusionStore();
      const sectionBlocks = section.blocks.map((block) => {
        if (block.kind !== 'p') {
          this.diagnostics.push(`unsupported-block:${block.kind}`);
          return { paraId: this.ids.mint('paragraph'), lines: [] };
        }
        const paraId = this.ids.mint('paragraph');
        const lines = breakParagraphToLines(paraId, paragraphRuns(block.value, this.ids), {
          textEngine: this.text.engine, exclusions, container: { x: area.x, width: area.w }, paragraphTop: area.y,
          onDiagnostic: (diagnostic) => this.diagnostics.push(diagnostic),
        });
        return { paraId, lines };
      });
      this.blocks.push(...sectionBlocks);
      const pageState: PageState = { blockIndex: 0, intraBlock: 0, columnIndex: 0, pendingFloats: [], footnoteCarry: [], keepBacklog: [], pageNumber: pageIndex + 1, sectionIndex: pageIndex };
      let state = pageState;
      while (state.blockIndex < sectionBlocks.length) {
        const filled = fillPage(state, {
          availableHeight: area.h,
          blocks: sectionBlocks,
          fragment: (_block, index) => {
            const block = sectionBlocks[index]!;
            const height = block.lines.reduce((sum, line) => sum + line.height, 0);
            return { blockIndex: index, height, complete: true, keepNext: false };
          }, applyKeeps: false,
        });
        const lines = filled.content.fragments.flatMap((fragment) => sectionBlocks[fragment.blockIndex]!.lines);
        const bounds: Rect = { x: 0, y: 0, w: geometry.size.w, h: geometry.size.h };
        this.pages.push({ pageIndex, bounds, lines, endState: `${filled.endState.blockIndex}:${filled.content.height}` });
        pageIndex += 1;
        state = { ...filled.endState, pageNumber: pageIndex + 1 };
      }
      if (sectionBlocks.length === 0) {
        this.pages.push({ pageIndex, bounds: { x: 0, y: 0, w: geometry.size.w, h: geometry.size.h }, lines: [], endState: `section-${pageIndex}` });
        pageIndex += 1;
      }
    }
    return this.pages;
  }

  get pageLayouts(): readonly PageLayoutRecord[] { return this.pages; }
  get blockLayouts(): readonly BlockLayout[] { return this.blocks; }
}
