import { describe, expect, it } from 'vitest';
import type { CT_P, CT_R } from '@ooxml/schema';
import { DocumentStyleManager } from './style-adapter.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('DocumentStyleManager', () => {
  it('resolves basedOn inheritance and preserves provenance', () => {
    const manager = new DocumentStyleManager({
      stylesXml: `<w:styles xmlns:w="${W}">
        <w:style w:type="paragraph" w:styleId="Base"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
        <w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
      </w:styles>`,
    });
    const paragraph = { pPr: { pStyle: { val: 'Child' } }, pContent: [] } as unknown as CT_P;
    const resolved = manager.resolveParagraph(paragraph);
    expect(resolved.values.get('jc')).toBe('center');
    expect(resolved.provenance.get('jc')?.layer).toBe('paragraphStyle:Base');
    expect(resolved.provenance.get('spacing')?.layer).toBe('paragraphStyle:Child');
  });

  it('truncates basedOn cycles without hanging', () => {
    const manager = new DocumentStyleManager({
      stylesXml: `<w:styles xmlns:w="${W}">
        <w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style>
        <w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style>
      </w:styles>`,
    });
    const paragraph = { pPr: { pStyle: { val: 'A' } }, pContent: [] } as unknown as CT_P;
    expect(() => manager.resolveParagraph(paragraph)).not.toThrow();
    expect(manager.styleTable.diagnostics.some((d) => d.code === 'STYLE_CYCLE')).toBe(true);
  });

  it('handles absent parts and absent direct properties', () => {
    const manager = new DocumentStyleManager();
    const paragraph = { pContent: [] } as unknown as CT_P;
    const run = { runInnerContent: [] } as unknown as CT_R;
    expect(manager.resolveParagraph(paragraph).values.get('spacing')).toBeDefined();
    expect(manager.resolveRun(run).values.get('sz')).toEqual({ val: 22 });
    expect(manager.resolveThemeFont('minorAscii')).toBe('Calibri');
    expect(manager.resolveSchemeColor('tx1')).toBe('000000');
  });
});
