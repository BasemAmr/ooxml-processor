import { describe, it, expect } from 'vitest';
import type { CT_DocDefaults } from '@ooxml/schema';
import {
  parseDocDefaults,
  resolveDocDefaults,
  parseDocDefaultsXml,
  getRPrBaseProperty,
  BUILTIN_DOC_DEFAULTS,
} from './defaults.js';

describe('P3-05 w:docDefaults', () => {
  it('traverses the two wrapper levels: rPrDefault/rPr and pPrDefault/pPr', () => {
    const raw: CT_DocDefaults = {
      rPrDefault: {
        rPr: {
          rPrBase: [
            { kind: 'sz', value: { val: 24 } }, // 12pt
            { kind: 'rFonts', value: { ascii: 'Arial' } },
          ],
        },
      },
      pPrDefault: {
        pPr: {
          spacing: { after: 200, line: 240 },
        },
      },
    };

    const parsed = parseDocDefaults(raw);
    expect(getRPrBaseProperty(parsed.rPr, 'sz')?.val).toBe(24);
    expect(getRPrBaseProperty(parsed.rPr, 'rFonts')?.ascii).toBe('Arial');
    expect(parsed.pPr?.spacing?.after).toBe(200);
  });

  it('handles empty wrappers gracefully', () => {
    const raw: CT_DocDefaults = {
      rPrDefault: {},
      pPrDefault: {},
    };

    const parsed = parseDocDefaults(raw);
    expect(parsed.rPr).toBeUndefined();
    expect(parsed.pPr).toBeUndefined();
  });

  it('resolves absent docDefaults with BUILTIN_DOC_DEFAULTS table', () => {
    const resolved = resolveDocDefaults(undefined);

    expect(resolved.rPr).toBe(BUILTIN_DOC_DEFAULTS.rPr);
    expect(resolved.pPr).toBe(BUILTIN_DOC_DEFAULTS.pPr);

    // Verify SPEC-GAP typography values
    const sz = getRPrBaseProperty(resolved.rPr, 'sz');
    const szCs = getRPrBaseProperty(resolved.rPr, 'szCs');
    const rFonts = getRPrBaseProperty(resolved.rPr, 'rFonts');

    expect(sz?.val).toBe(22); // 11pt
    expect(szCs?.val).toBe(22);
    expect(rFonts?.ascii).toBe('Calibri');
    expect(rFonts?.cs).toBe('Times New Roman');
    expect(resolved.pPr?.spacing?.line).toBe(240); // Single spacing
    expect(resolved.pPr?.spacing?.after).toBe(160); // 8pt
  });

  it('fills only missing wrapper when one is present', () => {
    const raw: CT_DocDefaults = {
      rPrDefault: {
        rPr: {
          rPrBase: [
            { kind: 'sz', value: { val: 28 } }, // 14pt
          ],
        },
      },
    };

    const resolved = resolveDocDefaults(raw);
    expect(getRPrBaseProperty(resolved.rPr, 'sz')?.val).toBe(28);
    // pPr was absent, so it gets the builtin default
    expect(resolved.pPr).toBe(BUILTIN_DOC_DEFAULTS.pPr);
  });

  it('parses docDefaults from XML string traversing wrappers', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:docDefaults xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:rPrDefault>
    <w:rPr>
      <w:rFonts w:asciiTheme="minorHAnsi" w:cstheme="minorBidi"/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:rPrDefault>
  <w:pPrDefault>
    <w:pPr>
      <w:spacing w:after="160" w:line="259" w:lineRule="auto"/>
    </w:pPr>
  </w:pPrDefault>
</w:docDefaults>`;

    const parsed = parseDocDefaultsXml(xml);
    const sz = getRPrBaseProperty(parsed.rPr, 'sz');
    const rFonts = getRPrBaseProperty(parsed.rPr, 'rFonts');

    expect(sz?.val).toBe(22);
    expect(rFonts?.asciiTheme).toBe('minorHAnsi');
    expect(parsed.pPr?.spacing?.after).toBe(160);
    expect(parsed.pPr?.spacing?.line).toBe(259);
  });
});
