import { describe, expect, it, vi } from 'vitest';
import { createFillStyle, imageCrop, resolveDmlColor } from './fills.js';

describe('DrawingML fills', () => {
  it('creates a solid colour and applies source crop percentages', () => {
    expect(
      createFillStyle(
        {
          kind: 'solidFill',
          value: { colorChoice: { kind: 'srgbClr', value: { val: '336699', colorTransform: [] } } },
        },
        { x: 0, y: 0, width: 100, height: 50 },
        {},
      ),
    ).toContain('51,102,153');
    expect(imageCrop({ srcRect: { l: 10000, t: 20000, r: 10000, b: 20000 } }, 1000, 500)).toEqual({
      sx: 100,
      sy: 100,
      sw: 800,
      sh: 300,
    });
  });
  it('uses a linear gradient when the canvas supplies one', () => {
    const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
    const ctx = { createLinearGradient: vi.fn(() => gradient) };
    const out = createFillStyle(
      {
        kind: 'gradFill',
        value: {
          gsLst: {
            gs: [
              {
                pos: 0,
                colorChoice: { kind: 'srgbClr', value: { val: '000000', colorTransform: [] } },
              },
              {
                pos: 100000,
                colorChoice: { kind: 'srgbClr', value: { val: 'ffffff', colorTransform: [] } },
              },
            ],
          },
          shadeProperties: { kind: 'lin', value: { ang: 0 } },
        },
      },
      { x: 0, y: 0, width: 100, height: 50 },
      ctx,
    );
    expect(out).toBe(gradient);
    expect(gradient.addColorStop).toHaveBeenCalledTimes(2);
  });
  it('keeps unknown colours visibly non-transparent', () =>
    expect(
      resolveDmlColor({ kind: 'prstClr', value: { val: 'notAColour', colorTransform: [] } }).a,
    ).toBe(1));
});
