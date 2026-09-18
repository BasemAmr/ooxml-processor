import { describe, it, expect } from 'vitest';
import { toLayout, toDocument } from './map.js';
import type { LayoutIndex } from './map.js';
import { createCaret, caretEquals } from './types.js';
import type { LayoutPos } from './types.js';
import { IdTable } from '@ooxml/wml';
import type { NodeId } from '@ooxml/wml';
import type { Line, GlyphRun, Segment } from '@ooxml/layout';
import { PackedShapedRun, CLUSTER_STRIDE } from '@ooxml/text';

// ---------------------------------------------------------------------------
// Test helpers: build minimal mock layout data with real PackedShapedRun
// ---------------------------------------------------------------------------

/**
 * Creates a PackedShapedRun from an array of { srcOffset, srcLength, xAdvance }.
 * Minimal clusters suitable for testing position mapping.
 */
function makeRun(
  clusters: { srcOffset: number; srcLength: number; xAdvance: number }[],
  direction: 'ltr' | 'rtl' = 'ltr',
): PackedShapedRun {
  const storage = new Float64Array(clusters.length * CLUSTER_STRIDE);
  let totalAdvance = 0;
  for (let i = 0; i < clusters.length; i++) {
    const base = i * CLUSTER_STRIDE;
    const c = clusters[i]!;
    storage[base + 0] = i;           // glyphId
    storage[base + 1] = c.xAdvance;  // xAdvance
    storage[base + 2] = 0;           // xOffset
    storage[base + 3] = 0;           // yOffset
    storage[base + 4] = c.srcOffset; // srcOffset
    storage[base + 5] = c.srcLength; // srcLength
    totalAdvance += c.xAdvance;
  }
  return new PackedShapedRun({
    faceId: 1,
    fontSize: 24,
    direction,
    script: 'latn',
    clusterStorage: storage,
    clusterCount: clusters.length,
    totalAdvance,
  });
}

function makeGlyphRun(
  srcNode: NodeId,
  clusters: { srcOffset: number; srcLength: number; xAdvance: number }[],
  direction: 'ltr' | 'rtl' = 'ltr',
): GlyphRun {
  return {
    fontKey: 1,
    size: 24,
    srcNode,
    style: {},
    clusters: makeRun(clusters, direction),
  };
}

function makeLine(
  paraId: NodeId,
  options: {
    top?: number;
    height?: number;
    baseline?: number;
    isFirst?: boolean;
    isLast?: boolean;
    breakKind?: 'wrap' | 'paraEnd';
    segments: Segment[];
  },
): Line {
  return {
    paraId,
    top: options.top ?? 0,
    height: options.height ?? 20,
    baseline: options.baseline ?? 16,
    breakKind: options.breakKind ?? 'paraEnd',
    isFirst: options.isFirst ?? true,
    isLast: options.isLast ?? true,
    segments: options.segments,
  };
}

function makeSegment(
  runs: GlyphRun[],
  direction: 'ltr' | 'rtl' = 'ltr',
  x = 0,
): Segment {
  let width = 0;
  for (const r of runs) width += r.clusters.totalAdvance;
  return { x, width, direction, runs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Position mapping (P6-02)', () => {
  it('returns NOT_LAID_OUT for unknown paragraph', () => {
    const table = new IdTable();
    const id = table.mint('paragraph');
    const caret = createCaret({ node: id, offset: 0 });

    const index: LayoutIndex = { paragraphs: new Map(), pages: [] };
    expect(toLayout(caret, index)).toBe('NOT_LAID_OUT');
  });

  describe('single-line paragraph', () => {
    // "Hello" = 5 characters, 5 clusters, each 1 code unit
    function buildSingleLineParagraph() {
      const table = new IdTable();
      const paraId = table.mint('paragraph');

      const clusters = [
        { srcOffset: 0, srcLength: 1, xAdvance: 10 }, // H
        { srcOffset: 1, srcLength: 1, xAdvance: 10 }, // e
        { srcOffset: 2, srcLength: 1, xAdvance: 10 }, // l
        { srcOffset: 3, srcLength: 1, xAdvance: 10 }, // l
        { srcOffset: 4, srcLength: 1, xAdvance: 10 }, // o
      ];

      const run = makeGlyphRun(paraId, clusters);
      const segment = makeSegment([run]);
      const line = makeLine(paraId, {
        segments: [segment],
        isFirst: true,
        isLast: true,
        breakKind: 'paraEnd',
      });

      const index: LayoutIndex = {
        paragraphs: new Map([[paraId, { page: 0, lineIndices: [0] }]]),
        pages: [{ lines: [line], pageIndex: 0 }],
      };

      return { table, paraId, index };
    }

    it('maps offset 0 to first cluster, leading edge', () => {
      const { paraId, index } = buildSingleLineParagraph();
      const caret = createCaret({ node: paraId, offset: 0 });
      const lp = toLayout(caret, index);

      expect(lp).not.toBe('NOT_LAID_OUT');
      const pos = lp as LayoutPos;
      expect(pos.cluster).toBe(0);
      expect(pos.leadingEdge).toBe(true);
    });

    it('maps mid-word offset to correct cluster', () => {
      const { paraId, index } = buildSingleLineParagraph();
      const caret = createCaret({ node: paraId, offset: 3 });
      const lp = toLayout(caret, index);

      expect(lp).not.toBe('NOT_LAID_OUT');
      const pos = lp as LayoutPos;
      expect(pos.cluster).toBe(3);
      expect(pos.leadingEdge).toBe(true);
    });

    it('maps end-of-paragraph offset to trailing edge of last cluster', () => {
      const { paraId, index } = buildSingleLineParagraph();
      // Offset 5 = past all clusters (each is srcLength 1, total 5)
      const caret = createCaret({ node: paraId, offset: 5 });
      const lp = toLayout(caret, index);

      expect(lp).not.toBe('NOT_LAID_OUT');
      const pos = lp as LayoutPos;
      expect(pos.cluster).toBe(4); // last cluster
      expect(pos.leadingEdge).toBe(false); // trailing edge
    });

    it('round-trips every interior position', () => {
      const { paraId, index } = buildSingleLineParagraph();

      for (let offset = 0; offset <= 4; offset++) {
        const caret = createCaret({ node: paraId, offset });
        const lp = toLayout(caret, index);
        expect(lp).not.toBe('NOT_LAID_OUT');

        const roundTripped = toDocument(lp as LayoutPos, index);
        expect(roundTripped.pos.node).toBe(paraId);
        expect(roundTripped.pos.offset).toBe(offset);
      }
    });
  });

  describe('soft-wrap boundary — the critical affinity test', () => {
    // "Hello World" wraps after "Hello" (offset 5).
    // Line 0: "Hello" clusters [0..4], offsets 0..5
    // Line 1: "World" clusters [0..4], offsets 5..10
    // At offset 5: UPSTREAM → line 0 trailing, DOWNSTREAM → line 1 leading
    function buildWrappedParagraph() {
      const table = new IdTable();
      const paraId = table.mint('paragraph');

      const line0Clusters = [
        { srcOffset: 0, srcLength: 1, xAdvance: 10 },
        { srcOffset: 1, srcLength: 1, xAdvance: 10 },
        { srcOffset: 2, srcLength: 1, xAdvance: 10 },
        { srcOffset: 3, srcLength: 1, xAdvance: 10 },
        { srcOffset: 4, srcLength: 1, xAdvance: 10 },
      ];

      const line1Clusters = [
        { srcOffset: 5, srcLength: 1, xAdvance: 10 },
        { srcOffset: 6, srcLength: 1, xAdvance: 10 },
        { srcOffset: 7, srcLength: 1, xAdvance: 10 },
        { srcOffset: 8, srcLength: 1, xAdvance: 10 },
        { srcOffset: 9, srcLength: 1, xAdvance: 10 },
      ];

      const run0 = makeGlyphRun(paraId, line0Clusters);
      const run1 = makeGlyphRun(paraId, line1Clusters);

      const line0 = makeLine(paraId, {
        top: 0,
        segments: [makeSegment([run0])],
        isFirst: true,
        isLast: false,
        breakKind: 'wrap',
      });

      const line1 = makeLine(paraId, {
        top: 20,
        segments: [makeSegment([run1])],
        isFirst: false,
        isLast: true,
        breakKind: 'paraEnd',
      });

      const index: LayoutIndex = {
        paragraphs: new Map([
          [paraId, { page: 0, lineIndices: [0, 1] }],
        ]),
        pages: [{ lines: [line0, line1], pageIndex: 0 }],
      };

      return { table, paraId, index };
    }

    it('UPSTREAM at wrap boundary maps to line 0 (trailing edge)', () => {
      const { paraId, index } = buildWrappedParagraph();
      const caret = createCaret({ node: paraId, offset: 5 }, 'upstream');
      const lp = toLayout(caret, index);

      expect(lp).not.toBe('NOT_LAID_OUT');
      const pos = lp as LayoutPos;
      expect(pos.lineIndex).toBe(0); // line 0
      expect(pos.leadingEdge).toBe(false); // trailing edge
    });

    it('DOWNSTREAM at wrap boundary maps to line 1 (leading edge)', () => {
      const { paraId, index } = buildWrappedParagraph();
      const caret = createCaret({ node: paraId, offset: 5 }, 'downstream');
      const lp = toLayout(caret, index);

      expect(lp).not.toBe('NOT_LAID_OUT');
      const pos = lp as LayoutPos;
      expect(pos.lineIndex).toBe(1); // line 1
      expect(pos.leadingEdge).toBe(true); // leading edge
    });

    it('two affinities at wrap boundary produce different LayoutPos', () => {
      const { paraId, index } = buildWrappedParagraph();
      const up = toLayout(
        createCaret({ node: paraId, offset: 5 }, 'upstream'),
        index,
      ) as LayoutPos;
      const down = toLayout(
        createCaret({ node: paraId, offset: 5 }, 'downstream'),
        index,
      ) as LayoutPos;

      // They must map to different lines
      expect(up.lineIndex).not.toBe(down.lineIndex);
    });

    it('round-trip preserves affinity at wrap boundary', () => {
      const { paraId, index } = buildWrappedParagraph();

      // UPSTREAM round-trip
      const upCaret = createCaret({ node: paraId, offset: 5 }, 'upstream');
      const upLp = toLayout(upCaret, index) as LayoutPos;
      const upRt = toDocument(upLp, index);
      expect(upRt.pos.offset).toBe(5);
      expect(upRt.affinity).toBe('upstream');

      // DOWNSTREAM round-trip
      const downCaret = createCaret({ node: paraId, offset: 5 }, 'downstream');
      const downLp = toLayout(downCaret, index) as LayoutPos;
      const downRt = toDocument(downLp, index);
      expect(downRt.pos.offset).toBe(5);
      expect(downRt.affinity).toBe('downstream');
    });

    it('round-trips every position across both lines', () => {
      const { paraId, index } = buildWrappedParagraph();

      // Offsets 0-4 are strictly on line 0
      for (let offset = 0; offset <= 4; offset++) {
        const caret = createCaret({ node: paraId, offset });
        const lp = toLayout(caret, index) as LayoutPos;
        const rt = toDocument(lp, index);
        expect(rt.pos.offset).toBe(offset);
      }

      // Offsets 5-9 (downstream) are on line 1
      for (let offset = 5; offset <= 9; offset++) {
        const caret = createCaret({ node: paraId, offset }, 'downstream');
        const lp = toLayout(caret, index) as LayoutPos;
        expect(lp.lineIndex).toBe(1);
        const rt = toDocument(lp, index);
        expect(rt.pos.offset).toBe(offset);
      }
    });
  });

  describe('toDocument error handling', () => {
    it('throws on invalid page index', () => {
      const index: LayoutIndex = { paragraphs: new Map(), pages: [] };
      expect(() =>
        toDocument(
          { page: 99, lineIndex: 0, segmentIndex: 0, runIndex: 0, cluster: 0, leadingEdge: true },
          index,
        ),
      ).toThrow('page');
    });
  });
});
