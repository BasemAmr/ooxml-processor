import { describe, it, expect } from 'vitest';
import type { NodeId } from '@ooxml/wml';
import { PackedShapedRun, createPackedShapedRun } from '@ooxml/text';
import type { RunDirection } from '@ooxml/text';
import { clusterAtSourceOffset, hitTestLine } from './linebox.js';
import type { Line } from './linebox.js';

describe('Line Box (P5-01)', () => {
  it('should map source offset to cluster index', () => {
    // We create a mocked PackedShapedRun to test logic without text engine.
    const run = createPackedShapedRun({
      faceId: 1,
      fontSize: 24,
      direction: 'ltr',
      script: 'latn',
      clusters: [
        { glyphId: 10, xAdvance: 100, xOffset: 0, yOffset: 0, srcOffset: 0, srcLength: 1 },
        { glyphId: 11, xAdvance: 120, xOffset: 0, yOffset: 0, srcOffset: 1, srcLength: 1 },
        { glyphId: 12, xAdvance: 90, xOffset: 0, yOffset: 0, srcOffset: 2, srcLength: 1 },
      ],
    }) as PackedShapedRun;

    const srcNode = 100 as NodeId;
    const line: Line = {
      paraId: 99 as NodeId,
      top: 0,
      height: 24,
      baseline: 20,
      breakKind: 'wrap',
      isFirst: true,
      isLast: false,
      segments: [
        {
          x: 0,
          width: 310,
          direction: 'ltr',
          runs: [{ fontKey: 1, size: 24, srcNode, style: null, clusters: run }],
        },
      ],
    };

    const result = clusterAtSourceOffset(line, srcNode, 1);
    expect(result).not.toBeNull();
    expect(result?.segmentIndex).toBe(0);
    expect(result?.runIndex).toBe(0);
    expect(result?.clusterIndex).toBe(1);

    const notFound = clusterAtSourceOffset(line, srcNode, 5);
    expect(notFound).toBeNull();
  });

  it('should hit test physical coordinate to cluster', () => {
    const run = createPackedShapedRun({
      faceId: 1,
      fontSize: 24,
      direction: 'ltr',
      script: 'latn',
      clusters: [
        { glyphId: 10, xAdvance: 100, xOffset: 0, yOffset: 0, srcOffset: 0, srcLength: 1 },
        { glyphId: 11, xAdvance: 120, xOffset: 0, yOffset: 0, srcOffset: 1, srcLength: 1 },
        { glyphId: 12, xAdvance: 90, xOffset: 0, yOffset: 0, srcOffset: 2, srcLength: 1 },
      ],
    }) as PackedShapedRun;

    const srcNode = 100 as NodeId;
    const line: Line = {
      paraId: 99 as NodeId,
      top: 0,
      height: 24,
      baseline: 20,
      breakKind: 'wrap',
      isFirst: true,
      isLast: false,
      segments: [
        {
          x: 10,
          width: 310,
          direction: 'ltr',
          runs: [{ fontKey: 1, size: 24, srcNode, style: null, clusters: run }],
        },
      ],
    };

    // Before segment
    const hit1 = hitTestLine(line, 5);
    expect(hit1?.affinity).toBe('left');
    expect(hit1?.clusterIndex).toBe(0);

    // Mid first cluster (x: 10..110)
    const hit2 = hitTestLine(line, 40); // 40 is < midpoint (60)
    expect(hit2?.clusterIndex).toBe(0);
    expect(hit2?.affinity).toBe('left');

    const hit3 = hitTestLine(line, 90); // 90 is > midpoint (60)
    expect(hit3?.clusterIndex).toBe(0);
    expect(hit3?.affinity).toBe('right');

    // Mid second cluster (x: 110..230)
    const hit4 = hitTestLine(line, 150);
    expect(hit4?.clusterIndex).toBe(1);
    expect(hit4?.affinity).toBe('left');
  });

  it('should handle memory constraints for 25,000 lines', () => {
    // Benchmark test.
    const numLines = 25000;

    // We share a few shape runs to simulate identical slicing
    const run = createPackedShapedRun({
      faceId: 1,
      fontSize: 24,
      direction: 'ltr',
      script: 'latn',
      clusters: [
        { glyphId: 10, xAdvance: 100, xOffset: 0, yOffset: 0, srcOffset: 0, srcLength: 1 },
        { glyphId: 11, xAdvance: 120, xOffset: 0, yOffset: 0, srcOffset: 1, srcLength: 1 },
      ],
    }) as PackedShapedRun;

    const startMem = process.memoryUsage().heapUsed;

    const lines: Line[] = [];
    for (let i = 0; i < numLines; i++) {
      lines.push({
        paraId: i as NodeId,
        top: i * 24,
        height: 24,
        baseline: 20,
        breakKind: 'wrap',
        isFirst: false,
        isLast: false,
        segments: [
          {
            x: 0,
            width: 220,
            direction: 'ltr',
            runs: [{ fontKey: 1, size: 24, srcNode: i as NodeId, style: null, clusters: run }],
          },
        ],
      });
    }

    const endMem = process.memoryUsage().heapUsed;
    const diffMb = (endMem - startMem) / 1024 / 1024;

    // Memory overhead should be small (usually less than 15MB for 25,000 lines)
    expect(diffMb).toBeLessThan(20);

    // Sub-microsecond query check. We measure total time for many queries.
    const startQ = performance.now();
    for (let i = 0; i < 1000; i++) {
      clusterAtSourceOffset(lines[i]!, i as NodeId, 1);
    }
    const endQ = performance.now();
    // Total time for 1000 queries should be very small (e.g. < 5ms)
    // Means sub-microsecond or low-microsecond per query.
    expect(endQ - startQ).toBeLessThan(10);
  });
});
