import { describe, it, expect } from 'vitest';
import { serializeLayoutGolden } from './golden';
import type { Line } from './line/linebox';

describe('serializeLayoutGolden', () => {
  const mockLine = (
    paraId: number,
    top: number,
    height: number,
    baseline: number,
    segments: { x: number; w: number }[],
  ): Line => {
    return {
      paraId: paraId as any,
      top,
      height,
      baseline,
      breakKind: 'wrap',
      isFirst: true,
      isLast: true,
      segments: segments.map((s) => ({ x: s.x, width: s.w, direction: 'ltr', runs: [] })),
    };
  };

  it('asserts byte-identical goldens across multiple runs', () => {
    const lines = [
      mockLine(1, 0.1, 240.2, 200.5, [{ x: 0, w: 1000 }]),
      mockLine(1, 240.3, 240.1, 200, [{ x: 0, w: 900 }]),
    ];

    const out1 = serializeLayoutGolden(lines);
    const out2 = serializeLayoutGolden(lines);
    expect(out1).toBe(out2);
    // Should be rounded to twips
    expect(out1).toContain('y=0 h=240 base=201');
    expect(out1).toContain('y=240 h=240 base=200');
  });

  it('asserts adding a paragraph changes only the diff lines for that paragraph and leaves subsequent node IDs intact', () => {
    const linesBefore = [
      mockLine(1, 0, 240, 200, [{ x: 0, w: 1000 }]),
      mockLine(3, 240, 240, 200, [{ x: 0, w: 1000 }]),
    ];

    const linesAfter = [
      mockLine(1, 0, 240, 200, [{ x: 0, w: 1000 }]),
      mockLine(2, 240, 240, 200, [{ x: 0, w: 1000 }]),
      mockLine(3, 480, 240, 200, [{ x: 0, w: 1000 }]),
    ];

    const outBefore = serializeLayoutGolden(linesBefore).split('\n');
    const outAfter = serializeLayoutGolden(linesAfter).split('\n');

    expect(outBefore[0]).toBe(outAfter[0]);
    // The previous p3 is now at index 2, but its l= remains the same since it's keyed by NodeId.
    // l=0 for p3. Only the y offset changed due to paragraph insertion.
    expect(outAfter[2]).toContain('p=3 l=0');
  });

  it('asserts sub-twip rounding eliminates floating noise', () => {
    const l1 = mockLine(1, 10.0000001, 20.9999999, 15.000001, [{ x: 5.00001, w: 100.9999 }]);
    const l2 = mockLine(1, 10.0, 21.0, 15.0, [{ x: 5.0, w: 101.0 }]);
    expect(serializeLayoutGolden([l1])).toBe(serializeLayoutGolden([l2]));
  });
});
