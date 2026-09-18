import { describe, it, expect } from 'vitest';
import type { ThemeDiagnostic } from './theme.js';
import {
  parseThemeXml,
  resolveThemeFont,
  resolveSchemeColor,
  FALLBACK_FONT_SCHEME,
  FALLBACK_COLOR_SCHEME,
} from './theme.js';

describe('P3-10 Theme Resolution', () => {
  const sampleThemeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1>
        <a:sysClr val="windowText" lastClr="112233"/>
      </a:dk1>
      <a:lt1>
        <a:sysClr val="window" lastClr="FFFFFF"/>
      </a:lt1>
      <a:dk2>
        <a:srgbClr val="2F4F4F"/>
      </a:dk2>
      <a:lt2>
        <a:srgbClr val="F5F5DC"/>
      </a:lt2>
      <a:accent1>
        <a:srgbClr val="4E79A7"/>
      </a:accent1>
      <a:accent2>
        <a:srgbClr val="F28E2B"/>
      </a:accent2>
      <a:accent3>
        <a:srgbClr val="E15759"/>
      </a:accent3>
      <a:accent4>
        <a:srgbClr val="76B7B2"/>
      </a:accent4>
      <a:accent5>
        <a:srgbClr val="59A14F"/>
      </a:accent5>
      <a:accent6>
        <a:srgbClr val="EDC948"/>
      </a:accent6>
      <a:hlink>
        <a:srgbClr val="0000FF"/>
      </a:hlink>
      <a:folHlink>
        <a:srgbClr val="800080"/>
      </a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Aptos Display"/>
        <a:ea typeface="DengXian Light"/>
        <a:cs typeface="Aptos Display"/>
        <a:font script="Jpan" typeface="Yu Gothic Light"/>
        <a:font script="Arab" typeface="Dubai Light"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Aptos"/>
        <a:ea typeface="DengXian"/>
        <a:cs typeface="Aptos"/>
        <a:font script="Jpan" typeface="Yu Gothic"/>
        <a:font script="Arab" typeface="Dubai"/>
      </a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

  it('parses theme1.xml into normalized Theme object', () => {
    const theme = parseThemeXml(sampleThemeXml);

    expect(theme.name).toBe('Office Theme');
    expect(theme.colorScheme.name).toBe('Office');
    expect(theme.colorScheme.dk1).toBe('112233');
    expect(theme.colorScheme.lt1).toBe('FFFFFF');
    expect(theme.colorScheme.accent1).toBe('4E79A7');
    expect(theme.colorScheme.accent2).toBe('F28E2B');

    expect(theme.fontScheme.major.latin).toBe('Aptos Display');
    expect(theme.fontScheme.minor.latin).toBe('Aptos');
    expect(theme.fontScheme.major.fonts.get('Jpan')).toBe('Yu Gothic Light');
    expect(theme.fontScheme.minor.fonts.get('Arab')).toBe('Dubai');
  });

  it('resolves all six theme-font bindings', () => {
    const theme = parseThemeXml(sampleThemeXml);
    const fonts = theme.fontScheme;

    expect(resolveThemeFont('majorAscii', fonts)).toBe('Aptos Display');
    expect(resolveThemeFont('majorHAnsi', fonts)).toBe('Aptos Display');
    expect(resolveThemeFont('majorEastAsia', fonts)).toBe('DengXian Light');
    expect(resolveThemeFont('majorBidi', fonts)).toBe('Aptos Display');

    expect(resolveThemeFont('minorAscii', fonts)).toBe('Aptos');
    expect(resolveThemeFont('minorHAnsi', fonts)).toBe('Aptos');
    expect(resolveThemeFont('minorEastAsia', fonts)).toBe('DengXian');
    expect(resolveThemeFont('minorBidi', fonts)).toBe('Aptos');
  });

  it('consults script-specific a:font entries for CJK / complex script', () => {
    const theme = parseThemeXml(sampleThemeXml);
    const fonts = theme.fontScheme;

    // Japanese script tag override
    expect(resolveThemeFont('majorEastAsia', fonts, 'Jpan')).toBe('Yu Gothic Light');
    expect(resolveThemeFont('minorEastAsia', fonts, 'Jpan')).toBe('Yu Gothic');

    // Arabic script tag override
    expect(resolveThemeFont('minorBidi', fonts, 'Arab')).toBe('Dubai');
  });

  it('falls through on empty @typeface to script-specific tags then fallback', () => {
    const themeWithEmptyLatin = {
      name: 'Custom',
      major: {
        latin: '', // empty typeface!
        ea: 'MS Mincho',
        cs: 'Arial',
        fonts: new Map([['Arab', 'Amiri']]),
      },
      minor: {
        latin: '   ', // whitespace only
        ea: '',
        cs: '',
        fonts: new Map(),
      },
    };

    // Major Latin empty with Arab script -> Amiri
    expect(resolveThemeFont('majorAscii', themeWithEmptyLatin, 'Arab')).toBe('Amiri');

    // Major Latin empty with unknown script -> fallback Calibri Light
    expect(resolveThemeFont('majorAscii', themeWithEmptyLatin, 'Latin')).toBe(
      FALLBACK_FONT_SCHEME.major.latin,
    );

    // Minor EastAsia empty -> fallback SimSun
    expect(resolveThemeFont('minorEastAsia', themeWithEmptyLatin)).toBe(
      FALLBACK_FONT_SCHEME.minor.ea,
    );
  });

  it('resolves theme references in themeless documents with diagnostic', () => {
    const diagnostics: ThemeDiagnostic[] = [];
    const font = resolveThemeFont('minorAscii', undefined, undefined, (d) => diagnostics.push(d));

    expect(font).toBe(FALLBACK_FONT_SCHEME.minor.latin);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.code).toBe('THEME_MISSING');
  });

  it('resolves scheme colors directly and through clrMap indirection', () => {
    const theme = parseThemeXml(sampleThemeXml);
    const clrScheme = theme.colorScheme;

    // Direct tokens
    expect(resolveSchemeColor('accent1', clrScheme)).toBe('4E79A7');
    expect(resolveSchemeColor('dk2', clrScheme)).toBe('2F4F4F');

    // DrawingML references mapped through clrMap
    const clrMap = {
      bg1: 'lt1',
      tx1: 'dk1',
      bg2: 'lt2',
      tx2: 'dk2',
    };

    expect(resolveSchemeColor('bg1', clrScheme, clrMap)).toBe('FFFFFF');
    expect(resolveSchemeColor('tx1', clrScheme, clrMap)).toBe('112233');
    expect(resolveSchemeColor('bg2', clrScheme, clrMap)).toBe('F5F5DC');
    expect(resolveSchemeColor('tx2', clrScheme, clrMap)).toBe('2F4F4F');

    // Normalized aliases: dark1 -> dk1, hyperlink -> hlink
    expect(resolveSchemeColor('dark1', clrScheme)).toBe('112233');
    expect(resolveSchemeColor('hyperlink', clrScheme)).toBe('0000FF');
  });

  it('resolves scheme color in themeless documents with diagnostic', () => {
    const diagnostics: ThemeDiagnostic[] = [];
    const color = resolveSchemeColor('accent1', undefined, undefined, (d) => diagnostics.push(d));

    expect(color).toBe(FALLBACK_COLOR_SCHEME.accent1);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.code).toBe('THEME_MISSING');
  });
});
