import { describe, it, expect } from 'vitest';
import { hitTest, hitTestWord, hitTestParagraph } from './hit-test.js';
import type { LayoutIndex } from './position/map.js';
import { IdTable } from '@ooxml/wml';
import type { NodeId } from '@ooxml/wml';
import type { Line, GlyphRun, Segment } from '@ooxml/layout';
import { PackedShapedRun, CLUSTER_STRIDE } from '@ooxml/text';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRun(
  clusters: { srcOffset: number; srcLength: number; xAdvance: number }[],
  direction: 'ltr' | 'rtl' = 'ltr',
): PackedShapedRun {
  const storage = new Float64Array(clusters.length * CLUSTER_STRIDE);
  let totalAdvance = 0;
  for (let i = 0; i < clusters.length; i++) {
    const base = i * CLUSTER_STRIDE;
    const c = clusters[i]!;
    storage[base + 0] = i;
    storage[base + 1] = c.xAdvance;
    storage[base + 2] = 0;
    storage[base + 3] = 0;
    storage[base + 4] = c.srcOffset;
    storage[base + 5] = c.srcLength;
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

function buildLtrLine(table: IdTable): { paraId: NodeId; index: LayoutIndex } {
  const paraId = table.mint('paragraph');

  // "ABC" — 3 clusters, each 20 twips wide, starting at x=0
  const clusters = [
    { srcOffset: 0, srcLength: 1, xAdvance: 20 },
    { srcOffset: 1, srcLength: 1, xAdvance: 20 },
    { srcOffset: 2, srcLength: 1, xAdvance: 20 },
  ];

  const run = makeGlyphRun(paraId, clusters, 'ltr');
  const segment: Segment = { x: 0, width: 60, direction: 'ltr', runs: [run] };
  const line: Line = {
    paraId,
    top: 0,
    height: 20,
    baseline: 16,
    breakKind: 'paraEnd',
    isFirst: true,
    isLast: true,
    segments: [segment],
  };

  const index: LayoutIndex = {
    paragraphs: new Map([[paraId, { page: 0, lineIndices: [0] }]]),
    pages: [{ lines: [line], pageIndex: 0 }],
  };

  return { paraId, index };
}

function buildRtlLine(table: IdTable): { paraId: NodeId; index: LayoutIndex } {
  const paraId = table.mint('paragraph');

  // RTL "אבג" — 3 clusters, each 20 twips wide
  // Visual order: cluster 0 is leftmost on screen = logical END
  //   visual[0] = srcOffset 2 (ג), visual[1] = srcOffset 1 (ב), visual[2] = srcOffset 0 (א)
  const clusters = [
    { srcOffset: 2, srcLength: 1, xAdvance: 20 },
    { srcOffset: 1, srcLength: 1, xAdvance: 20 },
    { srcOffset: 0, srcLength: 1, xAdvance: 20 },
  ];

  const run = makeGlyphRun(paraId, clusters, 'rtl');
  const segment: Segment = { x: 0, width: 60, direction: 'rtl', runs: [run] };
  const line: Line = {
    paraId,
    top: 0,
    height: 20,
    baseline: 16,
    breakKind: 'paraEnd',
    isFirst: true,
    isLast: true,
    segments: [segment],
  };

  const index: LayoutIndex = {
    paragraphs: new Map([[paraId, { page: 0, lineIndices: [0] }]]),
    pages: [{ lines: [line], pageIndex: 0 }],
  };

  return { paraId, index };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hit-testing (P6-03)', () => {
  it('returns null for empty layout index', () => {
    const index: LayoutIndex = { paragraphs: new Map(), pages: [] };
    expect(hitTest({ x: 0, y: 0 }, index)).toBeNull();
  });

  describe('LTR line', () => {
    it('hit at x=5 (left half of first cluster) returns offset 0', () => {
      const table = new IdTable();
      const { paraId, index } = buildLtrLine(table);

      // x=5 is in the left half of cluster 0 (0..20, midpoint 10)
      const caret = hitTest({ x: 5, y: 10 }, index);
      expect(caret).not.toBeNull();
      expect(caret!.pos.node).toBe(paraId);
      expect(caret!.pos.offset).toBe(0); // before cluster 0
    });

    it('hit at x=15 (right half of first cluster) returns offset 1', () => {
      const table = new IdTable();
      const { paraId, index } = buildLtrLine(table);

      // x=15 is in the right half of cluster 0 → after it → offset 1
      const caret = hitTest({ x: 15, y: 10 }, index);
      expect(caret).not.toBeNull();
      expect(caret!.pos.node).toBe(paraId);
      expect(caret!.pos.offset).toBe(1);
    });

    it('hit past end of line returns upstream affinity', () => {
      const table = new IdTable();
      const { paraId, index } = buildLtrLine(table);

      // x=200 is way past the 60-width line
      const caret = hitTest({ x: 200, y: 10 }, index);
      expect(caret).not.toBeNull();
      expect(caret!.affinity).toBe('upstream');
    });

    it('hit above all lines snaps to nearest line', () => {
      const table = new IdTable();
      const { paraId, index } = buildLtrLine(table);

      // y=-100 is above the line at top=0
      const caret = hitTest({ x: 5, y: -100 }, index);
      expect(caret).not.toBeNull();
      expect(caret!.pos.node).toBe(paraId);
    });

    it('hit below all lines snaps to nearest line', () => {
      const table = new IdTable();
      const { paraId, index } = buildLtrLine(table);

      const caret = hitTest({ x: 5, y: 1000 }, index);
      expect(caret).not.toBeNull();
      expect(caret!.pos.node).toBe(paraId);
    });
  });

  describe('RTL line', () => {
    it('left half of RTL cluster maps to AFTER the cluster (the flip)', () => {
      const table = new IdTable();
      const { paraId, index } = buildRtlLine(table);

      // Cluster 0 spans x=[0,20), midpoint=10. It has srcOffset=2.
      // RTL flip: left half ('left' affinity from hitTestLine) → trailing edge
      // So hitting x=5 should give us the TRAILING edge (leadingEdge=false)
      // which means srcOffset = 2 + 1 = 3 (after the cluster)
      const caret = hitTest({ x: 5, y: 10 }, index);
      expect(caret).not.toBeNull();
      // In RTL, left half → after cluster → higher offset
      expect(caret!.pos.offset).toBe(3);
    });

    it('right half of RTL cluster maps to BEFORE the cluster', () => {
      const table = new IdTable();
      const { paraId, index } = buildRtlLine(table);

      // Cluster 0 spans x=[0,20), srcOffset=2
      // RTL flip: right half ('right' affinity) → leading edge
      // So hitting x=15 should give us the LEADING edge → srcOffset = 2
      const caret = hitTest({ x: 15, y: 10 }, index);
      expect(caret).not.toBeNull();
      expect(caret!.pos.offset).toBe(2);
    });
  });

  describe('hitTestWord', () => {
    it('returns zero-width range without text provider', () => {
      const table = new IdTable();
      const { index } = buildLtrLine(table);

      const result = hitTestWord({ x: 5, y: 10 }, index);
      expect(result).not.toBeNull();
      expect(result!.start.offset).toBe(result!.end.offset);
    });

    it('returns word boundaries with text provider', () => {
      const table = new IdTable();
      const { paraId, index } = buildLtrLine(table);

      const result = hitTestWord({ x: 5, y: 10 }, index, (nodeId) => {
        if (nodeId === paraId) return 'ABC';
        return undefined;
      });
      expect(result).not.toBeNull();
      // "ABC" is one word token, so start=0, end=3
      expect(result!.start.offset).toBe(0);
      expect(result!.end.offset).toBe(3);
    });
  });

  describe('hitTestParagraph', () => {
    it('returns full paragraph range with text length provider', () => {
      const table = new IdTable();
      const { paraId, index } = buildLtrLine(table);

      const result = hitTestParagraph({ x: 5, y: 10 }, index, (nodeId) => {
        if (nodeId === paraId) return 3; // "ABC" length
        return undefined;
      });
      expect(result).not.toBeNull();
      expect(result!.start.offset).toBe(0);
      expect(result!.end.offset).toBe(3);
    });
  });
});
