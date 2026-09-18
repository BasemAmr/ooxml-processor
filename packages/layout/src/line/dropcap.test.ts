import { describe, it, expect } from 'vitest';
import { createDropCapExclusion } from './dropcap';

describe('dropcap', () => {
  it('creates an exclusion for drop', () => {
    const pr = { dropCap: 'drop' as const, lines: 3 };
    const exclusion = createDropCapExclusion(pr, 100, 200, 50, 240);

    // drop places it at containerX
    expect(exclusion.x).toBe(100);
    expect(exclusion.y).toBe(200);
    expect(exclusion.width).toBe(50);
    // height = lines * lineHeight = 3 * 240 = 720
    expect(exclusion.height).toBe(720);
    expect(exclusion.isMargin).toBe(false);
  });

  it('creates an exclusion for margin', () => {
    const pr = { dropCap: 'margin' as const, lines: 2 };
    const exclusion = createDropCapExclusion(pr, 100, 200, 50, 240);

    // margin places it outside the text area (containerX - width)
    expect(exclusion.x).toBe(50);
    expect(exclusion.y).toBe(200);
    expect(exclusion.height).toBe(480);
    expect(exclusion.isMargin).toBe(true);
  });
});
