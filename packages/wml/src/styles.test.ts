import { describe, it, expect } from 'vitest';
import type { CT_Styles } from '@ooxml/schema';
import { parseStyles, parseStylesXml } from './styles.js';

describe('P3-04 Style Graph and basedOn Cycle Detection', () => {
  it('parses styles into StyleTable with byId, defaults, and latent styles', () => {
    const raw: CT_Styles = {
      style: [
        {
          styleId: 'Normal',
          type: 'paragraph',
          default: true,
          name: { val: 'Normal' },
          qFormat: {},
          pPr: { spacing: { after: 160 } },
          tblStylePr: [],
        },
        {
          styleId: 'DefaultParagraphFont',
          type: 'character',
          default: true,
          name: { val: 'Default Paragraph Font' },
          tblStylePr: [],
        },
      ],
      latentStyles: {
        count: 267,
        defLockedState: false,
        defUIPriority: 99,
        defSemiHidden: true,
        defUnhideWhenUsed: true,
        defQFormat: false,
        lsdException: [
          {
            name: 'Normal',
            uiPriority: 0,
            qFormat: true,
            semiHidden: false,
            unhideWhenUsed: false,
          },
        ],
      },
    };

    const table = parseStyles(raw);

    expect(table.byId.size).toBe(2);
    expect(table.defaults.get('paragraph')).toBe('Normal');
    expect(table.defaults.get('character')).toBe('DefaultParagraphFont');

    const normal = table.byId.get('Normal');
    expect(normal).toBeDefined();
    expect(normal?.flags.qFormat).toBe(true);
    expect(normal?.pPr?.spacing?.after).toBe(160);

    // Latent styles modeled for UI
    expect(table.latent.count).toBe(267);
    expect(table.latent.defLockedState).toBe(false);
    expect(table.latent.defUIPriority).toBe(99);
    expect(table.latent.exceptions.get('Normal')?.qFormat).toBe(true);
  });

  it('first in document order wins on default collision with diagnostic', () => {
    const raw: CT_Styles = {
      style: [
        {
          styleId: 'FirstNormal',
          type: 'paragraph',
          default: true,
          name: { val: 'First Normal' },
          tblStylePr: [],
        },
        {
          styleId: 'SecondNormal',
          type: 'paragraph',
          default: true,
          name: { val: 'Second Normal' },
          tblStylePr: [],
        },
      ],
    };

    const table = parseStyles(raw);
    expect(table.defaults.get('paragraph')).toBe('FirstNormal');
    expect(table.diagnostics.length).toBe(1);
    expect(table.diagnostics[0]?.code).toBe('STYLE_DUPLICATE_DEFAULT');
    expect(table.diagnostics[0]?.styleId).toBe('SecondNormal');
    expect(table.diagnostics[0]?.targetId).toBe('FirstNormal');
  });

  it('resolves normal inheritance chain self-first then ancestors', () => {
    const raw: CT_Styles = {
      style: [
        {
          styleId: 'Normal',
          type: 'paragraph',
          name: { val: 'Normal' },
          tblStylePr: [],
        },
        {
          styleId: 'Heading1',
          type: 'paragraph',
          name: { val: 'Heading 1' },
          basedOn: { val: 'Normal' },
          tblStylePr: [],
        },
        {
          styleId: 'Heading2',
          type: 'paragraph',
          name: { val: 'Heading 2' },
          basedOn: { val: 'Heading1' },
          tblStylePr: [],
        },
      ],
    };

    const table = parseStyles(raw);
    const chain = table.chain('Heading2');

    expect(chain.map((s) => s.id)).toEqual(['Heading2', 'Heading1', 'Normal']);
    expect(table.diagnostics.length).toBe(0);
  });

  it('detects cycles in basedOn chain and truncates without hanging or throwing', () => {
    const raw: CT_Styles = {
      style: [
        {
          styleId: 'StyleA',
          type: 'paragraph',
          name: { val: 'Style A' },
          basedOn: { val: 'StyleB' },
          tblStylePr: [],
        },
        {
          styleId: 'StyleB',
          type: 'paragraph',
          name: { val: 'Style B' },
          basedOn: { val: 'StyleC' },
          tblStylePr: [],
        },
        {
          styleId: 'StyleC',
          type: 'paragraph',
          name: { val: 'Style C' },
          basedOn: { val: 'StyleA' }, // cycle!
          tblStylePr: [],
        },
      ],
    };

    const table = parseStyles(raw);
    const chain = table.chain('StyleA');

    // Should return traversed nodes and truncate without infinite loop
    expect(chain.map((s) => s.id)).toEqual(['StyleA', 'StyleB', 'StyleC']);
    const cycleDiag = table.diagnostics.find((d) => d.code === 'STYLE_CYCLE');
    expect(cycleDiag).toBeDefined();
    expect(cycleDiag?.styleId).toBe('StyleC');
    expect(cycleDiag?.targetId).toBe('StyleA');
  });

  it('detects self-cycle (style basedOn itself)', () => {
    const raw: CT_Styles = {
      style: [
        {
          styleId: 'SelfRef',
          type: 'paragraph',
          name: { val: 'Self Ref' },
          basedOn: { val: 'SelfRef' },
          tblStylePr: [],
        },
      ],
    };

    const table = parseStyles(raw);
    const chain = table.chain('SelfRef');

    expect(chain.map((s) => s.id)).toEqual(['SelfRef']);
    expect(table.diagnostics.some((d) => d.code === 'STYLE_CYCLE')).toBe(true);
  });

  it('stops at boundary on cross-type basedOn with diagnostic', () => {
    const raw: CT_Styles = {
      style: [
        {
          styleId: 'CharBase',
          type: 'character',
          name: { val: 'Char Base' },
          tblStylePr: [],
        },
        {
          styleId: 'ParaStyle',
          type: 'paragraph',
          name: { val: 'Para Style' },
          basedOn: { val: 'CharBase' },
          tblStylePr: [],
        },
      ],
    };

    const table = parseStyles(raw);
    const chain = table.chain('ParaStyle');

    // Cross-type stops at boundary, does not include CharBase
    expect(chain.map((s) => s.id)).toEqual(['ParaStyle']);
    const diag = table.diagnostics.find((d) => d.code === 'STYLE_CROSS_TYPE');
    expect(diag).toBeDefined();
    expect(diag?.styleId).toBe('ParaStyle');
    expect(diag?.targetId).toBe('CharBase');
  });

  it('handles missing basedOn target by degrading to no basedOn with diagnostic', () => {
    const raw: CT_Styles = {
      style: [
        {
          styleId: 'Dangling',
          type: 'paragraph',
          name: { val: 'Dangling' },
          basedOn: { val: 'DeletedStyle' },
          tblStylePr: [],
        },
      ],
    };

    const table = parseStyles(raw);
    const chain = table.chain('Dangling');

    expect(chain.map((s) => s.id)).toEqual(['Dangling']);
    const diag = table.diagnostics.find((d) => d.code === 'STYLE_MISSING_BASE');
    expect(diag).toBeDefined();
    expect(diag?.styleId).toBe('Dangling');
    expect(diag?.targetId).toBe('DeletedStyle');
  });

  it('parses XML markup with wmlReader', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="both"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
</w:styles>`;

    const table = parseStylesXml(xml);
    expect(table.byId.size).toBe(2);
    expect(table.defaults.get('paragraph')).toBe('Normal');

    const h1 = table.byId.get('Heading1');
    expect(h1).toBeDefined();
    expect(h1?.name).toBe('heading 1');
    expect(h1?.basedOn).toBe('Normal');
    expect(h1?.next).toBe('Normal');
    expect(h1?.uiPriority).toBe(9);
    expect(h1?.flags.qFormat).toBe(true);

    const chain = table.chain('Heading1');
    expect(chain.map((s) => s.id)).toEqual(['Heading1', 'Normal']);
  });
});
