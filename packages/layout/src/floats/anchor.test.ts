import { describe, expect, it } from 'vitest';
import { resolveAnchor, type AnchorContext } from './anchor.js';

const context: AnchorContext = {
  page: {
    x: 0,
    y: 0,
    width: 600,
    height: 800,
    marginLeft: 50,
    marginRight: 50,
    marginTop: 40,
    marginBottom: 40,
  },
  pageNumber: 1,
  mirrorMargins: true,
};
describe('anchor resolution', () => {
  it('simplePos overrides axis positioning', () => {
    expect(
      resolveAnchor(
        {
          simplePos: { x: 12, y: 30 },
          h: { relativeFrom: 'page', kind: 'align', value: 'right' },
          v: { relativeFrom: 'page', kind: 'align', value: 'bottom' },
          width: 100,
          height: 20,
        },
        context,
      ),
    ).toMatchObject({ x: 12, y: 30 });
  });
  it('resolves page and margin alignments', () => {
    expect(
      resolveAnchor(
        {
          h: { relativeFrom: 'margin', kind: 'align', value: 'center' },
          v: { relativeFrom: 'page', kind: 'align', value: 'center' },
          width: 100,
          height: 20,
        },
        context,
      ),
    ).toMatchObject({ x: 250, y: 390 });
  });
  it('flips inside/outside on even mirrored pages', () => {
    const even = { ...context, pageNumber: 2 };
    const spec = {
      h: { relativeFrom: 'margin' as const, kind: 'align' as const, value: 'inside' as const },
      v: { relativeFrom: 'page' as const, kind: 'offset' as const, value: 0 },
      width: 20,
      height: 20,
    };
    expect(resolveAnchor(spec, context).x).toBe(50);
    expect(resolveAnchor(spec, even).x).toBe(50);
  });
});
