import { describe, it, expect } from 'vitest';
import { breakParagraph } from './breaker.js';
import type { LineBreakContext } from './breaker.js';
import type { InlineItem, TextItem, BreakItem } from './stream.js';
import { PackedShapedRun } from '@ooxml/text';

describe('Greedy Line Breaker (P5-03)', () => {
  it('breaks greedily and never looks back', () => {
    const clusterCount = 10;
    const storage = new Float64Array(clusterCount * 6);
    for (let i = 0; i < clusterCount; i++) {
      storage[i * 6 + 1] = 100; // xAdvance
    }

    const mockRun = new PackedShapedRun({
      faceId: 1,
      fontSize: 12,
      direction: 'ltr',
      script: 'latn',
      clusterStorage: storage,
      clusterCount: clusterCount,
    });

    const breakOpportunities = new Uint8Array(clusterCount);
    breakOpportunities[4] = 1; // opportunity after 5th char (width 500)
    breakOpportunities[7] = 1; // opportunity after 8th char (width 800)
    breakOpportunities[9] = 1;

    const items: InlineItem[] = [
      {
        kind: 'text',
        srcNode: 1 as any, // mocking NodeId
        shapedRun: mockRun,
        breakOpportunities,
      } as TextItem,
    ];

    let diagnostics: string[] = [];
    const context: LineBreakContext = {
      paragraphId: 2 as any, // mocking NodeId
      paragraphTop: 0,
      containerWidth: 1000,
      availableSegments: (y, h) => [{ x: 0, width: 600 }],
      reportDiagnostic: (msg) => diagnostics.push(msg),
    };

    const lines = breakParagraph(items, context);

    expect(lines.length).toBe(2);
    expect(lines[0]!.segments[0]!.width).toBe(500);

    expect(lines[1]!.segments[0]!.width).toBe(500);
  });

  it('handles unbreakable overflow', () => {
    const clusterCount = 5;
    const storage = new Float64Array(clusterCount * 6);
    for (let i = 0; i < clusterCount; i++) {
      storage[i * 6 + 1] = 200; // xAdvance total 1000
    }

    const mockRun = new PackedShapedRun({
      faceId: 1,
      fontSize: 12,
      direction: 'ltr',
      script: 'latn',
      clusterStorage: storage,
      clusterCount: clusterCount,
    });

    const breakOpportunities = new Uint8Array(clusterCount);
    breakOpportunities[4] = 1; // End of run

    const items: InlineItem[] = [
      {
        kind: 'text',
        srcNode: 1 as any,
        shapedRun: mockRun,
        breakOpportunities,
      } as TextItem,
    ];

    let diagnostics: string[] = [];
    const context: LineBreakContext = {
      paragraphId: 2 as any,
      paragraphTop: 0,
      containerWidth: 500,
      availableSegments: (y, h) => [{ x: 0, width: 500 }],
      reportDiagnostic: (msg) => diagnostics.push(msg),
    };

    const lines = breakParagraph(items, context);

    expect(diagnostics).toContain('unbreakable-overflow');
    expect(lines.length).toBeGreaterThan(0);
  });
});
