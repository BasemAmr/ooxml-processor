import { describe, expect, it } from 'vitest';
import { parseNumberingXml, resolveNumbering } from './numbering.js';
import { parseStylesXml } from './styles.js';

const SAMPLE_NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="10">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
      <w:rPr>
        <w:b/>
        <w:color w:val="FF0000"/>
      </w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="10"/>
  </w:num>
  <w:num w:numId="2">
    <w:abstractNumId w:val="10"/>
    <w:lvlOverride w:ilvl="0">
      <w:lvl w:ilvl="0">
        <w:pPr>
          <w:ind w:left="1440" w:hanging="720"/>
        </w:pPr>
        <w:rPr>
          <w:i/>
        </w:rPr>
      </w:lvl>
    </w:lvlOverride>
  </w:num>
</w:numbering>`;

const SAMPLE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="numbering" w:styleId="ListBulletStyle">
    <w:name w:val="List Bullet Style"/>
    <w:rPr><w:sz w:val="24"/></w:rPr>
  </w:style>
</w:styles>`;

describe('P3-08 Numbering-derived properties', () => {
  const numberingTable = parseNumberingXml(SAMPLE_NUMBERING_XML);
  const styleTable = parseStylesXml(SAMPLE_STYLES_XML);

  it('resolves numbering definitions and overrides', () => {
    // Normal numId 1
    const res1 = resolveNumbering(
      { numId: { val: 1 }, ilvl: { val: 0 } },
      numberingTable,
      styleTable,
    );
    expect(res1).toBeDefined();
    expect(res1?.numId).toBe(1);
    expect(res1?.ilvl).toBe(0);
    expect(res1?.levelPPr?.ind?.left).toBe(720);
    expect(res1?.glyphRPr).toBeDefined();

    // NumId 2 with lvlOverride
    const res2 = resolveNumbering(
      { numId: { val: 2 }, ilvl: { val: 0 } },
      numberingTable,
      styleTable,
    );
    expect(res2).toBeDefined();
    expect(res2?.levelPPr?.ind?.left).toBe(1440);
  });

  it('numId="0" explicitly resolves to unnumbered (clears inheritance)', () => {
    const res = resolveNumbering({ numId: { val: 0 } }, numberingTable, styleTable);
    expect(res).toBeUndefined();
  });

  it('missing or invalid numId returns undefined', () => {
    expect(resolveNumbering(undefined, numberingTable, styleTable)).toBeUndefined();
    expect(resolveNumbering({ numId: { val: 999 } }, numberingTable, styleTable)).toBeUndefined();
  });
});
