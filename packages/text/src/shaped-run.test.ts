import { describe, expect, it } from 'vitest';
import {
  CLUSTER_STRIDE,
  createPackedShapedRun,
  GLYPH_ID_OFFSET,
  PackedShapedRun,
  type ClusterInput,
} from './shaped-run.js';

describe('PackedShapedRun (P4-12)', () => {
  it('stores clusters in flat Float64Array storage with CLUSTER_STRIDE = 6', () => {
    const clusters: ClusterInput[] = [
      { glyphId: 65, xAdvance: 120, xOffset: 0, yOffset: 0, srcOffset: 0, srcLength: 1 },
      { glyphId: 66, xAdvance: 130, xOffset: 5, yOffset: -2, srcOffset: 1, srcLength: 1 },
      { glyphId: 67, xAdvance: 140, xOffset: 0, yOffset: 0, srcOffset: 2, srcLength: 1 },
    ];

    const run = createPackedShapedRun({
      faceId: 101,
      fontSize: 24,
      direction: 'ltr',
      script: 'latn',
      clusters,
    });

    expect(run.faceId).toBe(101);
    expect(run.fontSize).toBe(24);
    expect(run.direction).toBe('ltr');
    expect(run.script).toBe('latn');
    expect(run.clusterCount).toBe(3);
    expect(run.totalAdvance).toBe(390);

    // Verify individual field accessors
    expect(run.glyphId(0)).toBe(65);
    expect(run.xAdvance(0)).toBe(120);
    expect(run.xOffset(0)).toBe(0);
    expect(run.yOffset(0)).toBe(0);
    expect(run.srcOffset(0)).toBe(0);
    expect(run.srcLength(0)).toBe(1);

    expect(run.glyphId(1)).toBe(66);
    expect(run.xAdvance(1)).toBe(130);
    expect(run.xOffset(1)).toBe(5);
    expect(run.yOffset(1)).toBe(-2);
    expect(run.srcOffset(1)).toBe(1);
    expect(run.srcLength(1)).toBe(1);

    // Verify underlying Float64Array stride
    const packed = run as PackedShapedRun;
    expect(packed.clusterStorage.length).toBe(3 * CLUSTER_STRIDE);
    expect(packed.clusterStorage[1 * CLUSTER_STRIDE + GLYPH_ID_OFFSET]).toBe(66);
  });

  it('throws RangeError on out-of-bounds accessor calls', () => {
    const run = createPackedShapedRun({
      faceId: 1,
      fontSize: 20,
      direction: 'ltr',
      script: 'latn',
      clusters: [{ glyphId: 10, xAdvance: 50, srcOffset: 0, srcLength: 1 }],
    });

    expect(() => run.glyphId(-1)).toThrow(RangeError);
    expect(() => run.glyphId(1)).toThrow(RangeError);
    expect(() => run.xAdvance(5)).toThrow(RangeError);
  });

  describe('Slicing (O(1) allocation-free view)', () => {
    it('creates lightweight slices sharing cluster storage and calculating totalAdvance in O(1)', () => {
      const clusters: ClusterInput[] = [
        { glyphId: 10, xAdvance: 100, srcOffset: 0, srcLength: 1 },
        { glyphId: 11, xAdvance: 150, srcOffset: 1, srcLength: 1 },
        { glyphId: 12, xAdvance: 200, srcOffset: 2, srcLength: 1 },
        { glyphId: 13, xAdvance: 250, srcOffset: 3, srcLength: 1 },
      ];

      const original = createPackedShapedRun({
        faceId: 42,
        fontSize: 22,
        direction: 'ltr',
        script: 'latn',
        clusters,
      });

      expect(original.totalAdvance).toBe(700);

      // Slice [1..3) -> clusters 11 and 12
      const slice1 = original.slice(1, 3);
      expect(slice1.clusterCount).toBe(2);
      expect(slice1.totalAdvance).toBe(350); // 150 + 200
      expect(slice1.glyphId(0)).toBe(11);
      expect(slice1.xAdvance(0)).toBe(150);
      expect(slice1.srcOffset(0)).toBe(1);
      expect(slice1.glyphId(1)).toBe(12);
      expect(slice1.xAdvance(1)).toBe(200);

      // Verify zero array copy: underlying typed array reference is identical
      const origPacked = original as PackedShapedRun;
      const slicePacked = slice1 as PackedShapedRun;
      expect(slicePacked.clusterStorage).toBe(origPacked.clusterStorage);

      // Slice prefix [0..1) -> cluster 10
      const prefix = original.slice(0, 1);
      expect(prefix.clusterCount).toBe(1);
      expect(prefix.totalAdvance).toBe(100);
      expect(prefix.glyphId(0)).toBe(10);

      // Identity slice returns original instance
      expect(original.slice(0, 4)).toBe(original);
    });

    it('handles out-of-bounds slice ranges by clamping', () => {
      const original = createPackedShapedRun({
        faceId: 1,
        fontSize: 20,
        direction: 'ltr',
        script: 'latn',
        clusters: [
          { glyphId: 1, xAdvance: 100, srcOffset: 0, srcLength: 1 },
          { glyphId: 2, xAdvance: 200, srcOffset: 1, srcLength: 1 },
        ],
      });

      const sliced = original.slice(-5, 10);
      expect(sliced.clusterCount).toBe(2);
      expect(sliced.totalAdvance).toBe(300);

      const empty = original.slice(5, 10);
      expect(empty.clusterCount).toBe(0);
      expect(empty.totalAdvance).toBe(0);
    });
  });

  describe('Source Offset Mapping (clusterAtSourceOffset)', () => {
    it('finds cluster index in LTR runs with multi-code-unit ligatures via binary search', () => {
      // String: "office" -> "o", "ffi" (ligature covering 3 chars), "c", "e"
      const clusters: ClusterInput[] = [
        { glyphId: 101, xAdvance: 100, srcOffset: 0, srcLength: 1 }, // 'o' [0..1)
        { glyphId: 102, xAdvance: 250, srcOffset: 1, srcLength: 3 }, // 'ffi' [1..4)
        { glyphId: 103, xAdvance: 90, srcOffset: 4, srcLength: 1 }, // 'c' [4..5)
        { glyphId: 104, xAdvance: 95, srcOffset: 5, srcLength: 1 }, // 'e' [5..6)
      ];

      const run = createPackedShapedRun({
        faceId: 1,
        fontSize: 22,
        direction: 'ltr',
        script: 'latn',
        clusters,
      });

      // 'o' at offset 0
      expect(run.clusterAtSourceOffset(0)).toBe(0);

      // 'f', 'f', 'i' at offsets 1, 2, 3 all resolve to ligature cluster index 1
      expect(run.clusterAtSourceOffset(1)).toBe(1);
      expect(run.clusterAtSourceOffset(2)).toBe(1);
      expect(run.clusterAtSourceOffset(3)).toBe(1);

      // 'c' at offset 4
      expect(run.clusterAtSourceOffset(4)).toBe(2);

      // 'e' at offset 5
      expect(run.clusterAtSourceOffset(5)).toBe(3);

      // Outside source range
      expect(run.clusterAtSourceOffset(-1)).toBe(-1);
      expect(run.clusterAtSourceOffset(6)).toBe(-1);
      expect(run.clusterAtSourceOffset(99)).toBe(-1);
    });

    it('finds cluster index in RTL runs where visual clusters are ordered left-to-right (decreasing srcOffset)', () => {
      // In RTL, logical text: "سلام" (offsets 0:س, 1:ل, 2:ا, 3:م)
      // Visual order on screen (left to right):
      // visual index 0: 'م' (srcOffset 3, srcLength 1)
      // visual index 1: 'لا' (Lam-Alif ligature, srcOffset 1, srcLength 2)
      // visual index 2: 'س' (srcOffset 0, srcLength 1)
      const clusters: ClusterInput[] = [
        { glyphId: 204, xAdvance: 110, srcOffset: 3, srcLength: 1 }, // 'م'
        { glyphId: 202, xAdvance: 180, srcOffset: 1, srcLength: 2 }, // 'لا'
        { glyphId: 201, xAdvance: 130, srcOffset: 0, srcLength: 1 }, // 'س'
      ];

      const run = createPackedShapedRun({
        faceId: 2,
        fontSize: 26,
        direction: 'rtl',
        script: 'arab',
        clusters,
      });

      // 'س' (logical 0) -> visual index 2
      expect(run.clusterAtSourceOffset(0)).toBe(2);

      // 'ل' (logical 1) and 'ا' (logical 2) -> visual index 1 (Lam-Alif ligature)
      expect(run.clusterAtSourceOffset(1)).toBe(1);
      expect(run.clusterAtSourceOffset(2)).toBe(1);

      // 'م' (logical 3) -> visual index 0
      expect(run.clusterAtSourceOffset(3)).toBe(0);

      // Out of bounds
      expect(run.clusterAtSourceOffset(-1)).toBe(-1);
      expect(run.clusterAtSourceOffset(4)).toBe(-1);
    });

    it('returns -1 for empty shaped run', () => {
      const run = createPackedShapedRun({
        faceId: 1,
        fontSize: 20,
        direction: 'ltr',
        script: 'latn',
        clusters: [],
      });

      expect(run.clusterCount).toBe(0);
      expect(run.totalAdvance).toBe(0);
      expect(run.clusterAtSourceOffset(0)).toBe(-1);
    });
  });
});
