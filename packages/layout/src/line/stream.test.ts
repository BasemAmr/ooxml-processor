import { describe, it, expect } from 'vitest';
import type { NodeId } from '@ooxml/wml';
import { PackedShapedRun, createPackedShapedRun } from '@ooxml/text';
import { buildInlineStream } from './stream.js';
import type { InlineItem, TextItem, AnnotationItem, DrawingItem, BreakItem } from './stream.js';

describe('Inline Item Stream (P5-02)', () => {
  it('should preserve zero-width annotations exactly between text items', () => {
    const text1: TextItem = {
      kind: 'text',
      srcNode: 1 as NodeId,
      shapedRun: createPackedShapedRun({
        faceId: 1,
        fontSize: 24,
        direction: 'ltr',
        script: 'latn',
        clusters: [
          { glyphId: 10, xAdvance: 100, xOffset: 0, yOffset: 0, srcOffset: 0, srcLength: 1 },
        ],
      }) as PackedShapedRun,
      breakOpportunities: new Uint8Array([0]),
    };

    const text2: TextItem = {
      kind: 'text',
      srcNode: 2 as NodeId,
      shapedRun: createPackedShapedRun({
        faceId: 1,
        fontSize: 24,
        direction: 'ltr',
        script: 'latn',
        clusters: [
          { glyphId: 11, xAdvance: 100, xOffset: 0, yOffset: 0, srcOffset: 0, srcLength: 1 },
        ],
      }) as PackedShapedRun,
      breakOpportunities: new Uint8Array([0]),
    };

    const annotation: AnnotationItem = {
      kind: 'annotation',
      srcNode: 3 as NodeId,
      marker: { type: 'bookmarkStart', id: 1 },
    };

    // Build stream
    const stream = buildInlineStream([text1, annotation, text2]);

    expect(stream.length).toBe(3);
    expect(stream[0]!.kind).toBe('text');
    expect(stream[1]!.kind).toBe('annotation'); // survived in the exact position
    expect(stream[2]!.kind).toBe('text');
  });

  it('should occupy space for inline drawings', () => {
    const drawing: DrawingItem = {
      kind: 'drawing',
      srcNode: 4 as NodeId,
      inline: true,
      width: 500,
      height: 300,
    };

    const stream = buildInlineStream([drawing]);
    expect(stream.length).toBe(1);
    expect(stream[0]!.kind).toBe('drawing');
    const d = stream[0] as DrawingItem;
    expect(d.width).toBe(500);
    expect(d.height).toBe(300);
  });

  it('should capture line breaks with clear attribute', () => {
    const br: BreakItem = {
      kind: 'break',
      srcNode: 5 as NodeId,
      breakKind: 'line',
      clear: 'left',
    };

    const stream = buildInlineStream([br]);
    expect(stream.length).toBe(1);
    expect(stream[0]!.kind).toBe('break');

    const b = stream[0] as BreakItem;
    expect(b.breakKind).toBe('line');
    expect(b.clear).toBe('left');
  });
});
