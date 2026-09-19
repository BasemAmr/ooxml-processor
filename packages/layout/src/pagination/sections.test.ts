import { describe, expect, it } from 'vitest';
import type { CT_Body } from '@ooxml/schema';
import { enumerateSections } from './sections';
import { pageGeometry, textArea } from './geometry';

const p = (sectPr?: object) =>
  ({ kind: 'p', value: { pContent: [], ...(sectPr ? { pPr: { sectPr } } : {}) } }) as never;

describe('pagination section and geometry helpers', () => {
  it('keeps a paragraph terminator in its own section', () => {
    const body = { blockLevelElts: [p(), p({}), p()], sectPr: {} } as unknown as CT_Body;
    const result = enumerateSections(body);
    expect(result).toHaveLength(3);
    expect(result[0]?.blocks).toHaveLength(1);
    expect(result[1]?.blocks).toHaveLength(1);
    expect(result[2]?.blocks).toHaveLength(1);
  });

  it('uses dimensions over the informational orientation attribute', () => {
    const geometry = pageGeometry({
      hdrFtrReferences: [],
      pgSz: { w: 12000, h: 16000, orient: 'landscape' },
    });
    expect(geometry.size).toMatchObject({ w: 12000, h: 16000, orient: 'portrait' });
  });

  it('adds gutter on the binding edge and mirrors it on even pages', () => {
    const geometry = pageGeometry(
      { hdrFtrReferences: [], pgMar: { left: 100, right: 200, gutter: 50 } },
      { mirrorMargins: true },
    );
    expect(textArea(geometry, 1).x).toBe(150);
    expect(textArea(geometry, 2).x).toBe(100);
    expect(textArea(geometry, 2).w).toBe(textArea(geometry, 1).w);
  });
});
