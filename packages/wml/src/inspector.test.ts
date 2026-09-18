import { describe, expect, it } from 'vitest';
import {
  resolveParagraphProperties,
  resolveParaRPrProperties,
  resolveRunProperties,
} from './cascade.js';
import { BUILTIN_DOC_DEFAULTS } from './defaults.js';
import { inspectProperties } from './inspector.js';
import { parseStylesXml } from './styles.js';

const SAMPLE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="left"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
</w:styles>`;

describe('P3-12 Property inspector', () => {
  const styleTable = parseStylesXml(SAMPLE_STYLES_XML);

  it('inspects paragraph properties and reports origin levels', () => {
    const resolved = resolveParagraphProperties({
      docDefaults: BUILTIN_DOC_DEFAULTS,
      styleTable,
      directPPr: {
        pStyle: { val: 'Heading1' },
      },
    });

    const report = inspectProperties(resolved);
    const jcProp = report.properties.get('jc');
    expect(jcProp).toBeDefined();
    expect(jcProp?.value).toBe('center');
    expect(jcProp?.originLayer).toBe('paragraphStyle:Heading1');
    expect(
      report.lines.some((l) => l.includes('jc') && l.includes('paragraphStyle:Heading1')),
    ).toBe(true);
  });

  it('inspects run properties and formats toggle XOR contribution chains', () => {
    // Heading1 (bold: true) + direct (bold: true) -> XOR resolves to bold: false
    const resolved = resolveRunProperties({
      docDefaults: BUILTIN_DOC_DEFAULTS,
      styleTable,
      paragraphStyleId: 'Heading1',
      directRPr: {
        rPrBase: [{ kind: 'b', value: {} }],
      },
    });

    const report = inspectProperties(resolved);
    const bProp = report.properties.get('b');
    expect(bProp).toBeDefined();
    expect(bProp?.value).toBe('false');
    expect(bProp?.originLayer).toBe('direct');
    expect(bProp?.toggleHistory?.length).toBe(2);

    const str = report.toString();
    expect(str).toContain('b');
    expect(str).toContain('direct');
    expect(str).toContain('XOR over:');
    expect(str).toContain('paragraphStyle:Heading1 = true');
    expect(str).toContain('direct = true');
  });

  it('inspects paragraph marks (CT_ParaRPr) as well as runs', () => {
    const resolved = resolveParaRPrProperties({
      docDefaults: BUILTIN_DOC_DEFAULTS,
      styleTable,
      paragraphStyleId: 'Heading1',
      paraRPr: {
        rPrBase: [{ kind: 'sz', value: { val: '40' } }],
      },
    });

    const report = inspectProperties(resolved);
    const szProp = report.properties.get('sz');
    expect(szProp).toBeDefined();
    expect(szProp?.originLayer).toBe('directParaRPr');

    const bProp = report.properties.get('b');
    expect(bProp).toBeDefined();
    expect(bProp?.originLayer).toBe('paragraphStyle:Heading1');
  });
});
