import { describe, it, expect, vi } from 'vitest';
import { relayout, computeOutflowState, areOutflowsEqual } from './relayout.js';
import type { DirtySet, RelayoutContext, PageLayoutRecord } from './relayout.js';
import { IdTable } from '@ooxml/wml';
import type { NodeId } from '@ooxml/wml';
import type { Line } from '@ooxml/layout';

function makeMockLine(height: number, lastEnd = 10): Line {
  return {
    paraId: 1 as unknown as NodeId,
    top: 0,
    height,
    baseline: height * 0.8,
    breakKind: 'paraEnd',
    isFirst: true,
    isLast: true,
    segments: [
      {
        x: 0,
        width: 100,
        direction: 'ltr',
        runs: [
          {
            fontKey: 1,
            size: 24,
            srcNode: 1 as unknown as NodeId,
            style: {},
            clusters: {
              clusterCount: 1,
              srcOffset: () => 0,
              srcLength: () => lastEnd,
              xAdvance: () => 100,
              clusterAtSourceOffset: () => 0,
            } as any,
          },
        ],
      },
    ],
  };
}

describe('Incremental Relayout Driver (P6-13)', () => {
  it('computes outflow state and checks equality accurately', () => {
    const l1 = [makeMockLine(20, 5)];
    const l2 = [makeMockLine(20, 5)];
    const l3 = [makeMockLine(40, 5)]; // different height
    const l4 = [makeMockLine(20, 8)]; // different end pos

    const o1 = computeOutflowState(l1);
    const o2 = computeOutflowState(l2);
    const o3 = computeOutflowState(l3);
    const o4 = computeOutflowState(l4);

    expect(areOutflowsEqual(o1, o2)).toBe(true);
    expect(areOutflowsEqual(o1, o3)).toBe(false);
    expect(areOutflowsEqual(o1, o4)).toBe(false);
  });

  it('triggers ZERO pagination work on ordinary typing when outflow is unchanged (Stage 1 early stop)', () => {
    const table = new IdTable();
    const paraId = table.mint('paragraph');

    let paginationSteps = 0;
    const ctx: RelayoutContext = {
      getParagraphLines: () => [makeMockLine(20, 10)],
      layoutParagraph: () => [makeMockLine(20, 10)], // unchanged height & end
      getParagraphBounds: () => ({ x: 0, y: 0, w: 500, h: 20 }),
      getPageOfParagraph: () => 3,
      getPage: (p) => ({
        pageIndex: p,
        bounds: { x: 0, y: p * 800, w: 600, h: 800 },
        lines: [],
        endState: `end-page-${p}`,
      }),
      reflowPage: (p, cursor) => ({
        pageIndex: p,
        bounds: { x: 0, y: p * 800, w: 600, h: 800 },
        lines: [],
        endState: cursor,
      }),
      pageCount: 100,
      recordPaginationStep: () => {
        paginationSteps++;
      },
    };

    const dirty: DirtySet = {
      paragraphs: new Set([paraId]),
      pages: new Set(),
      globalFields: false,
    };

    const repaint = relayout(dirty, ctx);

    // ZERO pagination steps performed!
    expect(paginationSteps).toBe(0);
    expect(repaint.paginationRuns).toBe(0);
    expect(repaint.pages.size).toBe(0);
    expect(repaint.rects).toHaveLength(1); // Only paragraph bounds repainted
  });

  it('paginates only up to resync point on line count change (Stage 2 early stop)', () => {
    const table = new IdTable();
    const paraId = table.mint('paragraph');

    let paginationSteps = 0;
    const pageRecords = new Map<number, PageLayoutRecord>();
    for (let i = 0; i < 50; i++) {
      pageRecords.set(i, {
        pageIndex: i,
        bounds: { x: 0, y: i * 800, w: 600, h: 800 },
        lines: [],
        endState: `state-${i}`,
      });
    }

    const ctx: RelayoutContext = {
      getParagraphLines: () => [makeMockLine(20, 10)],
      layoutParagraph: () => [makeMockLine(40, 20)], // Height changed!
      getParagraphBounds: () => ({ x: 0, y: 0, w: 500, h: 40 }),
      getPageOfParagraph: () => 5, // on page 5
      getPage: (p) => pageRecords.get(p),
      reflowPage: (p) => {
        // Suppose page 5 and 6 reflow differently, but page 7 converges to old state-7
        const endState = p === 7 ? 'state-7' : `new-state-${p}`;
        return {
          pageIndex: p,
          bounds: { x: 0, y: p * 800, w: 600, h: 800 },
          lines: [],
          endState,
        };
      },
      pageCount: 50,
      recordPaginationStep: () => {
        paginationSteps++;
      },
    };

    const dirty: DirtySet = {
      paragraphs: new Set([paraId]),
      pages: new Set(),
      globalFields: false,
    };

    const repaint = relayout(dirty, ctx);

    // Started at page 5, reflowed page 5, 6, and stopped at page 7 because endState matched!
    // Total runs: 3 pages (5, 6, 7), NOT all 50 pages.
    expect(paginationSteps).toBe(3);
    expect(repaint.pages.has(5)).toBe(true);
    expect(repaint.pages.has(6)).toBe(true);
    expect(repaint.pages.has(7)).toBe(true);
    expect(repaint.pages.has(8)).toBe(false);
  });

  it('repaints all pages when globalFields is true', () => {
    const table = new IdTable();
    const paraId = table.mint('paragraph');

    const ctx: RelayoutContext = {
      getParagraphLines: () => [makeMockLine(20, 10)],
      layoutParagraph: () => [makeMockLine(20, 10)],
      getParagraphBounds: () => ({ x: 0, y: 0, w: 500, h: 20 }),
      getPageOfParagraph: () => 0,
      getPage: (p) => ({
        pageIndex: p,
        bounds: { x: 0, y: p * 800, w: 600, h: 800 },
        lines: [],
        endState: `state-${p}`,
      }),
      reflowPage: (p, cursor) => ({
        pageIndex: p,
        bounds: { x: 0, y: p * 800, w: 600, h: 800 },
        lines: [],
        endState: cursor,
      }),
      pageCount: 5,
    };

    const dirty: DirtySet = {
      paragraphs: new Set([paraId]),
      pages: new Set(),
      globalFields: true,
    };

    const repaint = relayout(dirty, ctx);
    expect(repaint.pages.size).toBe(5);
  });
});
