import { describe, expect, it } from 'vitest';
import { frameWrapToWrapMode, groupFramedParagraphs, resolveFramePosition } from './frame-pr.js';

describe('legacy framePr', () => {
  it('groups consecutive paragraphs into one frame', () => {
    const frame = { w: 100, h: 50, wrap: 'around' as const };
    expect(
      groupFramedParagraphs([{ value: 1, frame }, { value: 2, frame }, { value: 3 }]).map(
        (group) => group.length,
      ),
    ).toEqual([2, 1]);
  });
  it('maps legacy wrap modes and aligns a frame', () => {
    expect(frameWrapToWrapMode('notBeside')).toBe('topAndBottom');
    expect(
      resolveFramePosition(
        { w: 20, h: 10, xAlign: 'center', yAlign: 'bottom' },
        { x: 0, y: 0, width: 100, height: 80 },
      ),
    ).toEqual({ x: 40, y: 70, width: 20, height: 10 });
  });
});
