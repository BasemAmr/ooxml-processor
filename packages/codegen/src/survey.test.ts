/**
 * Survey tests.
 *
 * The survey's job is to keep `docs/xsd-feature-survey.md` honest, so the
 * headline test is that it still reproduces the numbers published there. Those
 * numbers are load-bearing: "complexContent restriction: 0" is the entire
 * justification for `IrContent` having no restriction variant, and if a schema
 * revision changes it, the build must fail rather than the generator quietly
 * emitting a reader that drops content.
 *
 * The fixture tests cover the mechanism — that a retired construct anywhere in
 * the tree is found and turned into an `UnsupportedXsdFeature`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnsupportedXsdFeature } from './ir.js';
import type { FeatureCounts, SchemaFamily, SurveyResult } from './survey.js';
import { assertNoUnsupportedFeatures, formatSurvey, surveySchemas } from './survey.js';

const WML_TRANSITIONAL = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const tempDirs: string[] = [];

async function writeFixture(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ooxml-survey-'));
  tempDirs.push(dir);
  for (const family of ['transitional', 'strict', 'opc'] as const) {
    await mkdir(join(dir, family), { recursive: true });
  }
  for (const [name, xml] of Object.entries(files)) {
    await writeFile(join(dir, 'transitional', name), xml, 'utf8');
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function schema(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
            xmlns:w="${WML_TRANSITIONAL}"
            targetNamespace="${WML_TRANSITIONAL}"
            elementFormDefault="qualified">
${body}
</xsd:schema>
`;
}

function present<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

function counts(survey: SurveyResult, family: SchemaFamily): FeatureCounts {
  return present(survey.counts.get(family), `${family} counts`);
}

// ---------------------------------------------------------------------------
// Mechanism
// ---------------------------------------------------------------------------

describe('surveySchemas on a hand-written schema', () => {
  it('counts constructs, not unique names', async () => {
    const dir = await writeFixture({
      'wml.xsd': schema(`  <xsd:simpleType name="ST_Jc">
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="start"/>
      <xsd:enumeration value="end"/>
    </xsd:restriction>
  </xsd:simpleType>
  <xsd:group name="EG_X">
    <xsd:choice>
      <xsd:any namespace="##other" processContents="lax"/>
    </xsd:choice>
  </xsd:group>
  <xsd:complexType name="CT_X">
    <xsd:sequence>
      <xsd:group ref="w:EG_X"/>
      <xsd:element name="inline" minOccurs="0">
        <xsd:complexType>
          <xsd:attribute name="v" type="xsd:string" default="1"/>
        </xsd:complexType>
      </xsd:element>
    </xsd:sequence>
    <xsd:attribute name="jc" type="w:ST_Jc" form="qualified"/>
  </xsd:complexType>
`),
    });
    const survey = await surveySchemas(dir);
    const t = counts(survey, 'transitional');

    expect(t.files).toBe(1);
    // Two `xsd:group` tags: one definition and one ref. Conflating the two is
    // how "we handle all 269 groups" turns into "we handle 77 of them".
    expect(t.groups).toBe(2);
    expect(t.namedGroups).toBe(1);
    expect(t.complexTypes).toBe(2);
    expect(t.namedComplexTypes).toBe(1);
    expect(t.elements).toBe(1);
    expect(t.enumerations).toBe(2);
    expect(t.attributes).toBe(2);
    expect(t.attributeDefaults).toBe(1);
    expect(t.formQualified).toBe(1);
    expect(t.refs).toBe(1);
    expect(t.any).toBe(1);
    // element + complexType + simpleType + group + attributeGroup, named only.
    expect(t.namedDefinitions).toBe(4);
    expect(present(t.namedByFile.get('transitional/wml.xsd'), 'per-file count')).toBe(4);

    expect(survey.retired).toEqual([]);
    expect(survey.wildcards).toHaveLength(1);
    expect(present(survey.wildcards[0], 'wildcard').namespace).toBe('##other');
    expect(present(survey.wildcards[0], 'wildcard').processContents).toBe('lax');
    // wml is on the .docx path, so the wildcard is in scope for the manifest.
    expect(present(survey.wildcards[0], 'wildcard').docxPath).toBe(true);
  });

  it('reports mixed content without throwing, because it genuinely occurs', async () => {
    const dir = await writeFixture({
      'wml.xsd': schema(
        '  <xsd:complexType name="CT_X" mixed="true"><xsd:sequence/></xsd:complexType>',
      ),
    });
    const survey = await surveySchemas(dir);
    expect(survey.retired).toEqual([]);
    expect(survey.mixed).toHaveLength(1);
    expect(present(survey.mixed[0], 'mixed site').context).toBe('CT_X');
    expect(() => assertNoUnsupportedFeatures(survey)).not.toThrow();
  });

  const retiredCases: ReadonlyArray<readonly [string, string]> = [
    ['xsd:include', '  <xsd:include schemaLocation="other.xsd"/>'],
    ['xsd:redefine', '  <xsd:redefine schemaLocation="other.xsd"/>'],
    [
      'substitutionGroup',
      `  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>
  <xsd:element name="head" type="w:CT_X"/>
  <xsd:element name="member" type="w:CT_X" substitutionGroup="w:head"/>`,
    ],
    [
      'nillable',
      `  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>
  <xsd:element name="x" type="w:CT_X" nillable="true"/>`,
    ],
    [
      'abstract="true"',
      '  <xsd:complexType name="CT_X" abstract="true"><xsd:sequence/></xsd:complexType>',
    ],
    [
      'block',
      `  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>
  <xsd:element name="x" type="w:CT_X" block="extension"/>`,
    ],
    [
      'xsd:complexContent/xsd:restriction',
      `  <xsd:complexType name="CT_Base"><xsd:sequence/></xsd:complexType>
  <xsd:complexType name="CT_X">
    <xsd:complexContent>
      <xsd:restriction base="w:CT_Base"><xsd:sequence/></xsd:restriction>
    </xsd:complexContent>
  </xsd:complexType>`,
    ],
    [
      'xsd:simpleContent/xsd:restriction',
      `  <xsd:complexType name="CT_X">
    <xsd:simpleContent><xsd:restriction base="xsd:string"/></xsd:simpleContent>
  </xsd:complexType>`,
    ],
    [
      'xsd:anyAttribute',
      `  <xsd:complexType name="CT_X">
    <xsd:sequence/>
    <xsd:anyAttribute processContents="lax"/>
  </xsd:complexType>`,
    ],
  ];

  for (const [feature, body] of retiredCases) {
    it(`fails the build on ${feature}`, async () => {
      const dir = await writeFixture({ 'wml.xsd': schema(body) });
      const survey = await surveySchemas(dir);
      const site = present(
        survey.retired.find((s) => s.feature === feature),
        `a retired site for ${feature}`,
      );
      expect(site.source.file).toBe('transitional/wml.xsd');
      expect(site.source.line).toBeGreaterThan(0);
      expect(() => assertNoUnsupportedFeatures(survey)).toThrow(UnsupportedXsdFeature);
      expect(() => assertNoUnsupportedFeatures(survey)).toThrow(feature);
    });
  }

  it("inherits the loader's DOCTYPE refusal", async () => {
    const dir = await writeFixture({
      'wml.xsd': `<?xml version="1.0"?>
<!DOCTYPE xsd:schema [<!ENTITY lol "lol">]>
${schema('  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>')}`,
    });
    await expect(surveySchemas(dir)).rejects.toThrow(/DOCTYPE/);
  });
});

// ---------------------------------------------------------------------------
// The published numbers
// ---------------------------------------------------------------------------

const ASSETS_DIR = fileURLToPath(new URL('../../../assets/schema/', import.meta.url));

describe('the vendored ECMA-376 schemas', () => {
  let survey: SurveyResult;

  beforeAll(async () => {
    survey = await surveySchemas(ASSETS_DIR);
  });

  it('finds no retired construct anywhere in the set', () => {
    expect(survey.retired).toEqual([]);
    expect(() => assertNoUnsupportedFeatures(survey)).not.toThrow();
  });

  it('reproduces the scale table in docs/xsd-feature-survey.md', () => {
    const t = counts(survey, 'transitional');
    const s = counts(survey, 'strict');

    expect([t.elements, s.elements]).toEqual([3588, 3307]);
    expect([t.attributes, s.attributes]).toEqual([3374, 2906]);
    expect([t.complexTypes, s.complexTypes]).toEqual([1431, 1369]);
    expect([t.simpleTypes, s.simpleTypes]).toEqual([597, 525]);
    expect([t.enumerations, s.enumerations]).toEqual([3263, 3010]);
    expect([t.groups, s.groups]).toEqual([269, 256]);
    expect([t.attributeGroups, s.attributeGroups]).toEqual([133, 46]);

    // The document says 5,536 / 5,159. A real parser finds one more in each:
    // `transitional/pml.xsd` declares `<xsd:element minOccurs="1" maxOccurs="1"
    // name="snd" .../>` with `name=` third, which the grep that produced the
    // published figure could not see. The parser is right; the document is off
    // by one.
    expect([t.namedDefinitions, s.namedDefinitions]).toEqual([5537, 5160]);
  });

  it('reproduces the special-cases table', () => {
    const t = counts(survey, 'transitional');
    const s = counts(survey, 'strict');

    expect([t.any, s.any]).toEqual([16, 7]);
    expect([t.all, s.all]).toEqual([4, 2]);
    expect([t.unions, s.unions]).toEqual([42, 42]);
    expect([t.lists, s.lists]).toEqual([7, 7]);
    expect([t.attributeDefaults, s.attributeDefaults]).toEqual([1236, 1217]);
    expect([t.formQualified, s.formQualified]).toEqual([6, 0]);
    expect([t.refs, s.refs]).toEqual([622, 407]);

    // The restriction finding, restated as a test: every complex-content
    // derivation in the set is an extension, which is why the IR has no
    // restriction variant and normalize.ts has no subtraction pass.
    expect([t.complexContent, s.complexContent]).toEqual([41, 40]);
    expect([t.extensions, s.extensions]).toEqual([47, 46]);
  });

  it('records no element-level default anywhere', () => {
    // If this ever becomes non-zero, `IrElementParticle.default` starts mattering
    // and the round-trip rules need revisiting.
    expect(counts(survey, 'transitional').elementDefaults).toBe(0);
    expect(counts(survey, 'strict').elementDefaults).toBe(0);
  });

  it('finds mixed content in three places, one of them on the .docx path', () => {
    // The document records only the SpreadsheetML occurrence. OPC's CT_Keywords
    // is real, is on the `.docx` path, and the IR cannot represent it — the
    // loader raises a `mixed-content` warning for it.
    expect(survey.mixed.map((m) => `${m.context} ${m.source.file}`).sort()).toEqual([
      'CT_Keywords opc/opc-coreProperties.xsd',
      'CT_Schema strict/sml.xsd',
      'CT_Schema transitional/sml.xsd',
    ]);
    expect(survey.mixed.filter((m) => m.docxPath).map((m) => m.context)).toEqual(['CT_Keywords']);
  });

  it('enumerates every wildcard on the .docx path', () => {
    const docx = survey.wildcards.filter((w) => w.docxPath);
    // The document's table lists 8 rows, but it collapses the paired
    // vml + office wildcards in wml.xsd into one row each and omits dml-chart's
    // CT_Extension. These are the actual sites.
    expect(
      docx.filter((w) => w.source.file.startsWith('transitional/')).map((w) => w.context),
    ).toEqual([
      'CT_Extension',
      'CT_OfficeArtExtension',
      'CT_GraphicalObjectData',
      'CT_Textbox',
      'CT_EquationXml',
      'CT_Background',
      'CT_Background',
      'CT_Object',
      'CT_Object',
      'CT_Picture',
      'CT_Picture',
      'CT_ShapeDefaults',
    ]);
    // The DrawingML extensibility point, where charts, diagrams and pictures
    // plug in. Its `strict` is the reason the survey calls it out.
    const graphic = present(
      docx.find((w) => w.context === 'CT_GraphicalObjectData'),
      'CT_GraphicalObjectData wildcard',
    );
    expect(graphic.processContents).toBe('strict');
    expect(graphic.namespace).toBe('##any');
  });

  it('renders a report naming all three families', () => {
    const text = formatSurvey(survey);
    expect(text).toContain('Transitional');
    expect(text).toContain('Strict');
    expect(text).toContain('OPC');
    expect(text).toContain('retired features found: 0');
  });
});
