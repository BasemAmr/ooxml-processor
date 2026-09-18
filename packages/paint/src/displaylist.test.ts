import { describe, it, expect } from 'vitest';
import { DisplayList } from './displaylist.js';

describe('DisplayList (P5-13)', () => {
  it('structuredClone succeeds on every item type', () => {
    const list = new DisplayList();

    list.pushGlyphRun(
      'font-1',
      12,
      '#000',
      10,
      20,
      new Uint32Array([1, 2, 3]),
      new Float64Array([10, 20, 15, 20, 20, 20]),
    );
    list.pushRect(0, 0, 100, 100, '#fff');
    list.pushLine(0, 0, 10, 10, 'red', 1, [2, 2]);
    list.pushPath(new Float32Array([0, 0, 0, 10, 10, 10]), 'blue');
    list.pushImage('img-1', 0, 0, 100, 100, 10, 10, 50, 50);
    list.pushClip(0, 0, 200, 200);
    list.pushTransform([1, 0, 0, 1, 10, 10]);
    list.popTransform();
    list.popClip();

    // The gate: this throws if any function, DOM element, or prototype leaks in
    const clonedList = list.clone();

    // Verify lengths match
    expect(clonedList.items.length).toBe(list.items.length);

    // Verify properties match
    expect(clonedList.items[0]?.type).toBe('glyphRun');
    expect((clonedList.items[0] as any).fontKey).toBe('font-1');
  });
});
