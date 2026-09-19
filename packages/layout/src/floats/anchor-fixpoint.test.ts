import { describe, expect, it } from 'vitest';
import { resolveAnchorsWithWrapFixpoint } from './anchor-fixpoint.js';

const page = {
  x: 0,
  y: 0,
  width: 600,
  height: 800,
  marginLeft: 40,
  marginRight: 40,
  marginTop: 40,
  marginBottom: 40,
};
describe('anchor wrap fixpoint', () => {
  it('resolves page anchors without entering the text loop', () => {
    const result = resolveAnchorsWithWrapFixpoint([
      {
        id: 'page',
        spec: {
          h: { relativeFrom: 'page', kind: 'offset', value: 4 },
          v: { relativeFrom: 'page', kind: 'offset', value: 5 },
          width: 20,
          height: 20,
        },
        context: { page },
      },
    ]);
    expect(result).toMatchObject({ iterations: 0, converged: true, positions: [{ x: 4, y: 5 }] });
  });

  it('terminates an oscillating paragraph anchor deterministically', () => {
    const input = {
      id: 'p',
      spec: {
        h: { relativeFrom: 'margin' as const, kind: 'offset' as const, value: 0 },
        v: { relativeFrom: 'paragraph' as const, kind: 'offset' as const, value: 0 },
        width: 10,
        height: 10,
      },
      context: { page, paragraph: { x: 0, y: 0, width: 100, height: 20 } },
    };
    let flip = true;
    const result = resolveAnchorsWithWrapFixpoint([input], {
      relayout: () =>
        [
          {
            ...input,
            context: {
              ...input.context,
              paragraph: { x: 0, y: flip ? 10 : 0, width: 100, height: 20 },
            },
          },
        ].map((value) => {
          flip = !flip;
          return value;
        }),
    });
    expect(result.oscillated).toBe(true);
    expect(result.positions[0]!.y).toBe(0);
  });
});
