import { describe, it, expect } from 'vitest';
import {
  parseFontTableXml,
  createFontTable,
  parsePanose,
  panoseDistance,
  substituteFont,
  parseFontSig,
  checkFontCoverage,
  getGenericFamily,
  METRIC_COMPATIBLE_FONTS,
  type AvailableFontInfo,
} from './fonts.js';

describe('P4-03: Font Table & PANOSE Substitution', () => {
  const sampleFontTableXml = `
    <w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:font w:name="Calibri">
        <w:panose1 w:val="020F0502020204030204"/>
        <w:charset w:val="00"/>
        <w:family w:val="swiss"/>
        <w:pitch w:val="variable"/>
        <w:sig w:usb0="E00002FF" w:usb1="4000787B" w:usb2="00000000" w:usb3="00000000" w:csb0="0000019F" w:csb1="00000000"/>
      </w:font>
      <w:font w:name="Times New Roman">
        <w:altName w:val="Times"/>
        <w:panose1 w:val="02020603050405020304"/>
        <w:family w:val="roman"/>
        <w:pitch w:val="variable"/>
      </w:font>
      <w:font w:name="Courier New">
        <w:panose1 w:val="02070309020205020404"/>
        <w:family w:val="modern"/>
        <w:pitch w:val="fixed"/>
      </w:font>
      <w:font w:name="SimSun">
        <w:panose1 w:val="02010600030101010101"/>
        <w:family w:val="auto"/>
        <w:pitch w:val="variable"/>
        <w:sig w:usb0="00000003" w:usb1="08000000" w:usb2="00000000" w:usb3="00000000" w:csb0="00040001" w:csb1="00000000"/>
      </w:font>
      <w:font w:name="CustomEmbedded">
        <w:embedRegular w:id="rId10" w:fontKey="{12345678-1234-1234-1234-123456789012}"/>
      </w:font>
    </w:fonts>
  `;

  it('parses fontTable.xml correctly', () => {
    const table = parseFontTableXml(sampleFontTableXml);
    expect(table.getFont('Calibri')).toBeDefined();
    expect(table.getFont('calibri')).toBeDefined(); // Case-insensitive
    expect(table.getFont('Times New Roman')).toBeDefined();
    expect(table.getFont('SimSun')).toBeDefined();
  });

  describe('PANOSE Parsing & Distance', () => {
    it('parses 20-hex-character PANOSE strings', () => {
      // "020F0502020204030204"
      // 02, 0F=15, 05=5, 02, 02, 02, 04, 03, 02, 04
      const p = parsePanose('020F0502020204030204');
      expect(p).toEqual([2, 15, 5, 2, 2, 2, 4, 3, 2, 4]);
    });

    it('computes 0 distance for identical PANOSE vectors', () => {
      const p1 = [2, 15, 5, 2, 2, 2, 4, 3, 2, 4];
      const p2 = [2, 15, 5, 2, 2, 2, 4, 3, 2, 4];
      expect(panoseDistance(p1, p2)).toBe(0);
    });

    it('heavily penalizes family kind mismatch (e.g. text vs decorative)', () => {
      const latinText = [2, 15, 5, 2, 2, 2, 4, 3, 2, 4];
      const decorative = [4, 15, 5, 2, 2, 2, 4, 3, 2, 4];
      expect(panoseDistance(latinText, decorative)).toBeGreaterThanOrEqual(100_000);
    });

    it('serif style differences have higher penalty than midline/x-height', () => {
      const base = [2, 11, 5, 2, 2, 2, 4, 3, 2, 4]; // Normal Sans
      const diffSerif = [2, 2, 5, 2, 2, 2, 4, 3, 2, 4]; // Cove (Serif)
      const diffMidline = [2, 11, 5, 2, 2, 2, 4, 3, 8, 4]; // Midline only

      const distSerif = panoseDistance(base, diffSerif);
      const distMidline = panoseDistance(base, diffMidline);

      expect(distSerif).toBeGreaterThan(distMidline);
    });
  });

  describe('Substitution Ladder', () => {
    const table = parseFontTableXml(sampleFontTableXml);

    it('Step 1: selects embedded font if present in fontTable', () => {
      const res = substituteFont('CustomEmbedded', table, ['Arial', 'Times New Roman']);
      expect(res.step).toBe('embedded');
      expect(res.resolvedFont).toBe('CustomEmbedded');
    });

    it('Step 2: selects exact match when font is locally available', () => {
      const res = substituteFont('Arial', table, ['Arial', 'Calibri', 'Times New Roman']);
      expect(res.step).toBe('exact');
      expect(res.resolvedFont).toBe('Arial');
    });

    it('Step 2b: selects metric-compatible substitute when original is absent', () => {
      // Arial -> Liberation Sans / Arimo
      const resArial = substituteFont('Arial', table, ['Liberation Sans', 'DejaVu Serif']);
      expect(resArial.step).toBe('metric-compatible');
      expect(resArial.resolvedFont).toBe('Liberation Sans');

      // Calibri -> Carlito
      const resCalibri = substituteFont('Calibri', table, ['Carlito', 'Roboto']);
      expect(resCalibri.step).toBe('metric-compatible');
      expect(resCalibri.resolvedFont).toBe('Carlito');

      // Times New Roman -> Liberation Serif / Tinos
      const resTNR = substituteFont('Times New Roman', table, ['Tinos', 'Ubuntu']);
      expect(resTNR.step).toBe('metric-compatible');
      expect(resTNR.resolvedFont).toBe('Tinos');
    });

    it('Step 3: selects w:altName when exact is absent and altName is available', () => {
      // Times New Roman has w:altName="Times"
      const res = substituteFont('Times New Roman', table, ['Times', 'Helvetica']);
      expect(res.step).toBe('altName');
      expect(res.resolvedFont).toBe('Times');
    });

    it('Step 4: selects PANOSE-nearest available font', () => {
      // Requested font has sans-serif PANOSE
      const customFontXml = `
        <w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:font w:name="MySans">
            <w:panose1 w:val="020B0604020202020204"/>
          </w:font>
        </w:fonts>
      `;
      const customTable = parseFontTableXml(customFontXml);

      const candidates: AvailableFontInfo[] = [
        {
          name: 'SomeSerif',
          panose: '02020603050405020304', // Serif style = 2
        },
        {
          name: 'SomeSans',
          panose: '020B0504020202020204', // Sans style = 11 (very close)
        },
      ];

      const res = substituteFont('MySans', customTable, candidates);
      expect(res.step).toBe('panose');
      expect(res.resolvedFont).toBe('SomeSans');
    });

    it('Step 4 filter: rejects candidate lacking script coverage via w:sig', () => {
      // SimSun has CJK bits in w:sig (usb1 bit 59, csb0 bit 18)
      const candidates: AvailableFontInfo[] = [
        {
          name: 'LatinOnlyFont',
          panose: '02010600030101010101', // Same PANOSE!
          sig: {
            // Only Latin bits
            usb0: '00000001',
            usb1: '00000000',
            usb2: '00000000',
            usb3: '00000000',
            csb0: '00000001',
            csb1: '00000000',
          },
        },
        {
          name: 'CJKCapableFont',
          panose: '02010500030101010101', // Slightly farther PANOSE
          sig: {
            // Includes CJK bit 59 in usb1 (0x08000000) and csb0 bit 18 (0x00040000)
            usb0: '00000001',
            usb1: '08000000',
            usb2: '00000000',
            usb3: '00000000',
            csb0: '00040001',
            csb1: '00000000',
          },
        },
      ];

      const res = substituteFont('SimSun', table, candidates);
      expect(res.step).toBe('panose');
      // LatinOnlyFont was rejected due to lack of CJK coverage despite better PANOSE match!
      expect(res.resolvedFont).toBe('CJKCapableFont');
    });

    it('Step 5: falls back to generic CSS family based on CT_Font family and pitch', () => {
      const res = substituteFont('Courier New', table, []);
      expect(res.step).toBe('generic');
      expect(res.resolvedFont).toBe('monospace'); // pitch=fixed, family=modern
    });
  });

  describe('Generic family resolution', () => {
    it('maps font properties to generic CSS families', () => {
      expect(getGenericFamily('roman', 'variable')).toBe('serif');
      expect(getGenericFamily('swiss', 'variable')).toBe('sans-serif');
      expect(getGenericFamily('modern', 'variable')).toBe('monospace');
      expect(getGenericFamily(undefined, 'fixed')).toBe('monospace');
      expect(getGenericFamily('script', 'variable')).toBe('cursive');
      expect(getGenericFamily('decorative', 'variable')).toBe('fantasy');
    });
  });
});
