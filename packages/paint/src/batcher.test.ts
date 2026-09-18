import { describe, it, expect } from 'vitest';
import { batchDisplayList } from './batcher';
import { DisplayList } from './displaylist';

describe('Glyph-Run Batching', () => {
  it('batches runs with identical font/size/color', () => {
    const list = new DisplayList();
    list.pushGlyphRun('Arial', 12, 'black', 0, 0, new Uint32Array(), new Float64Array());
    list.pushGlyphRun('Arial', 12, 'black', 100, 0, new Uint32Array(), new Float64Array());

    const { items, stats } = batchDisplayList(list);

    expect(items.length).toBe(1);
    expect(items[0]!.type).toBe('glyphBatch');
    expect((items[0] as any).runs.length).toBe(2);
    expect(stats.stateTransitions).toBe(2); // 1 for font, 1 for color
  });

  it('never reorders across a ClipPush or TransformPush', () => {
    const list = new DisplayList();
    list.pushGlyphRun('Arial', 12, 'black', 0, 0, new Uint32Array(), new Float64Array());
    list.pushClip(0, 0, 100, 100);
    list.pushGlyphRun('Arial', 12, 'black', 10, 10, new Uint32Array(), new Float64Array());

    const { items } = batchDisplayList(list);

    expect(items.length).toBe(3);
    expect(items[0]!.type).toBe('glyphBatch');
    expect(items[1]!.type).toBe('clipPush');
    expect(items[2]!.type).toBe('glyphBatch');
  });

  it('preserves paint order within each batch', () => {
    const list = new DisplayList();
    list.pushGlyphRun('Arial', 12, 'black', 0, 0, new Uint32Array(), new Float64Array());
    list.pushGlyphRun('Arial', 12, 'black', 10, 0, new Uint32Array(), new Float64Array());

    const { items } = batchDisplayList(list);
    const batch = items[0] as any;
    expect(batch.runs[0].x).toBe(0);
    expect(batch.runs[1].x).toBe(10);
  });
});
