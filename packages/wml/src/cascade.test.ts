import { describe, expect, it } from 'vitest';
import { resolveParagraphProperties, resolveRunProperties } from './cascade.js';
import { BUILTIN_DOC_DEFAULTS } from './defaults.js';
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
  <w:style w:type="character" w:styleId="Strong">
    <w:name w:val="Strong"/>
    <w:rPr>
      <w:b/>
    </w:rPr>
  </w:style>
</w:styles>`;

describe('P3-06 Cascade order', () => {
  const styleTable = parseStylesXml(SAMPLE_STYLES_XML);

  it('resolves paragraph properties root-first: child style overrides ancestor', () => {
    const res = resolveParagraphProperties({
      docDefaults: BUILTIN_DOC_DEFAULTS,
      styleTable,
      directPPr: {
        pStyle: { val: 'Heading1' },
      },
    });

    // Normal sets jc="left", Heading1 sets jc="center"
    expect(res.values.get('jc')).toBe('center');
    expect(res.provenance.get('jc')?.layer).toBe('paragraphStyle:Heading1');
  });

  it('direct formatting overrides style properties', () => {
    const res = resolveParagraphProperties({
      docDefaults: BUILTIN_DOC_DEFAULTS,
      styleTable,
      directPPr: {
        pStyle: { val: 'Heading1' },
        jc: { val: 'right' },
      },
    });

    expect(res.values.get('jc')).toBe('right');
    expect(res.provenance.get('jc')?.layer).toBe('direct');
  });

  it('resolves run properties with toggle XOR across style and direct formatting', () => {
    // 1. Heading1 sets bold -> true
    const res1 = resolveRunProperties({
      docDefaults: BUILTIN_DOC_DEFAULTS,
      styleTable,
      paragraphStyleId: 'Heading1',
    });
    expect(res1.values.get('b')).toBe('true');

    // 2. Heading1 (bold) + direct bold -> XOR resolves to not bold (false)
    const res2 = resolveRunProperties({
      docDefaults: BUILTIN_DOC_DEFAULTS,
      styleTable,
      paragraphStyleId: 'Heading1',
      directRPr: {
        rPrBase: [{ kind: 'b', value: {} }], // <w:b/> -> true
      },
    });
    expect(res2.values.get('b')).toBe('false');
    const prov = res2.provenance.get('b');
    expect(prov?.layer).toBe('direct');
    expect(prov?.toggleHistory?.length).toBe(2);
  });
});
