import { describe, expect, it } from 'vitest';
import type { CT_Document, CT_P, CT_R } from '@ooxml/schema';
import { ExclusionStore } from '@ooxml/layout';
import { IdTable } from '@ooxml/wml';
import { DemoLayoutPipeline } from './layout-pipeline.js';
import { breakParagraphToLines } from './line-breaker.js';
import { DemoTextService } from './text-adapter.js';

function run(text: string): CT_R {
  return { runInnerContent: [{ kind: 't', value: { $value: text } }] } as CT_R;
}

function paragraph(text: string): CT_P {
  return { pContent: [{ kind: 'r', value: run(text) }] } as CT_P;
}

function documentWithParagraphs(paragraphs: readonly CT_P[]): CT_Document {
  return {
    body: {
      blockLevelElts: paragraphs.map((value) => ({ kind: 'p', value })),
    },
  } as CT_Document;
}

describe('DemoLayoutPipeline (W4-S1)', () => {
  it('greedily wraps shaped text and preserves source-node runs', () => {
    const ids = new IdTable();
    const paraId = ids.mint('paragraph');
    const runId = ids.mint('run');
    const lines = breakParagraphToLines(paraId, [{ srcNode: runId, text: 'alpha beta gamma' }], {
      textEngine: new DemoTextService().engine,
      exclusions: new ExclusionStore(),
      container: { x: 0, width: 900 },
      lineHeight: 240,
    });

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.isFirst).toBe(true);
    expect(lines.at(-1)?.isLast).toBe(true);
    expect(lines.flatMap((line) => line.segments).every((segment) => segment.runs.length > 0)).toBe(true);
    expect(lines.flatMap((line) => line.segments.flatMap((segment) => segment.runs)).every((item) => item.srcNode === runId)).toBe(true);
  });

  it('wraps lines around a public ExclusionStore float', () => {
    const ids = new IdTable();
    const paraId = ids.mint('paragraph');
    const runId = ids.mint('run');
    const exclusions = new ExclusionStore();
    exclusions.add({ x: 0, y: 0, width: 500, height: 240, wrap: 'square' });
    const lines = breakParagraphToLines(paraId, [{ srcNode: runId, text: 'wrapped text' }], {
      textEngine: new DemoTextService().engine,
      exclusions,
      container: { x: 0, width: 1200 },
      lineHeight: 240,
    });

    expect(lines[0]?.segments[0]?.x).toBeGreaterThanOrEqual(500);
    expect(lines[0]?.segments[0]?.width).toBeLessThan(1200);
  });

  it('paginates public WML paragraphs into discrete page records', () => {
    const pipeline = new DemoLayoutPipeline();
    const doc = documentWithParagraphs(Array.from({ length: 100 }, (_, index) => paragraph(`Paragraph ${index + 1}`)));
    const pages = pipeline.paginate(doc);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page, index) => page.pageIndex === index)).toBe(true);
    expect(pages.every((page) => page.bounds.w > 0 && page.bounds.h > 0)).toBe(true);
    expect(pages.flatMap((page) => page.lines).length).toBe(100);
    expect(pipeline.diagnostics).toEqual([]);
  });
});
