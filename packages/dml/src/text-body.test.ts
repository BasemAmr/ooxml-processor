import { describe, expect, it } from 'vitest';
import { layoutTextBody } from './text-body.js';

describe('DrawingML text body layout', () => {
  it('applies insets, stored autofit and vertical centering', () => {
    const out = layoutTextBody(
      {
        bodyPr: {
          lIns: 95250,
          tIns: 95250,
          rIns: 95250,
          bIns: 95250,
          anchor: 'ctr',
          textAutofit: { kind: 'normAutofit', value: { fontScale: 50000 } },
        },
        p: [{ textRun: [{ kind: 'r', value: { t: 'hello' } }] }],
      },
      { x: 0, y: 0, width: 200, height: 100 },
    );
    expect(out.scale).toBeCloseTo(0.5);
    expect(out.bounds.x).toBeCloseTo(10);
    expect(out.lines[0]?.y).toBeGreaterThan(0);
  });
  it('maps vert270 to a flow orientation', () =>
    expect(
      layoutTextBody(
        { bodyPr: { vert: 'vert270' }, p: [{ textRun: [] }] },
        { x: 0, y: 0, width: 20, height: 20 },
      ).orientation,
    ).toBe('vertical270'));
});
