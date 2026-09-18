/**
 * Loader tests.
 *
 * Two layers, deliberately:
 *
 *  1. A hand-written miniature schema set in a temp directory. It is small
 *     enough to read in one screen and exercises every XSD construct the loader
 *     claims to support, so a failure points at one construct rather than at
 *     "something in 2.5 MB of XML changed".
 *  2. A smoke test against the real vendored `assets/schema`. The miniature
 *     cannot catch "the published `wml.xsd` uses a shape we did not anticipate";
 *     only the real files can.
 *
 * The fixtures use the real WordprocessingML namespace URIs rather than
 * `http://example.com/...`, because namespace resolution goes through
 * `NS_BY_URI` and a made-up URI is an error by design — which is itself a test
 * below.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  Diagnostic,
  IrAttribute,
  IrComplexType,
  IrCompositor,
  IrContent,
  IrParticle,
  IrSchemaSet,
  IrSimpleType,
} from './ir.js';
import { UnsupportedXsdFeature } from './ir.js';
import { XsdLoadError, loadSchemaSet, parseXsdDocument } from './loader.js';

// ---------------------------------------------------------------------------
// Fixture plumbing
// ---------------------------------------------------------------------------

const WML_TRANSITIONAL = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WML_STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const SHARED_TRANSITIONAL = 'http://schemas.openxmlformats.org/officeDocument/2006/sharedTypes';

const tempDirs: string[] = [];

interface FixtureFamilies {
  readonly transitional?: Readonly<Record<string, string>>;
  readonly strict?: Readonly<Record<string, string>>;
  readonly opc?: Readonly<Record<string, string>>;
}

/**
 * Materializes a schema set on disk. All three family directories are always
 * created: `loadSchemaSet` reads `opc/` unconditionally because the package
 * layer is dialect-independent, and an absent directory would fail for a reason
 * unrelated to whatever the test is actually about.
 */
async function writeFixture(families: FixtureFamilies): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ooxml-xsd-'));
  tempDirs.push(dir);
  for (const family of ['transitional', 'strict', 'opc'] as const) {
    await mkdir(join(dir, family), { recursive: true });
    for (const [name, xml] of Object.entries(families[family] ?? {})) {
      await writeFile(join(dir, family, name), xml, 'utf8');
    }
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Wraps a schema body in the boilerplate every vendored file shares. */
function schema(targetNs: string, body: string, rootAttrs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
            xmlns:w="${targetNs}"
            xmlns:s="${SHARED_TRANSITIONAL}"
            targetNamespace="${targetNs}"
            elementFormDefault="qualified"
            attributeFormDefault="unqualified"${rootAttrs === '' ? '' : `\n            ${rootAttrs}`}>
${body}
</xsd:schema>
`;
}

/** 1-based line number of the first line whose trimmed text equals `marker`. */
function lineOf(text: string, marker: string): number {
  const index = text.split('\n').findIndex((line) => line.trim() === marker);
  if (index === -1) throw new Error(`fixture has no line "${marker}"`);
  return index + 1;
}

// ---------------------------------------------------------------------------
// Narrowing helpers
//
// `strict` plus `noUncheckedIndexedAccess` means every lookup is possibly
// undefined; these throw with a useful message instead of letting the test fail
// on a downstream `Cannot read properties of undefined`.
// ---------------------------------------------------------------------------

function present<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

function complexType(set: IrSchemaSet, key: string): IrComplexType {
  return present(set.complexTypes.get(key), `complexType ${key}`);
}

function simpleType(set: IrSchemaSet, key: string): IrSimpleType {
  return present(set.simpleTypes.get(key), `simpleType ${key}`);
}

function elementsContent(content: IrContent): Extract<IrContent, { readonly kind: 'elements' }> {
  if (content.kind !== 'elements') throw new Error(`expected element content, got ${content.kind}`);
  return content;
}

function compositor(particle: IrParticle | undefined): IrCompositor {
  const kind = particle?.kind;
  if (particle === undefined || (kind !== 'sequence' && kind !== 'choice' && kind !== 'all')) {
    throw new Error(`expected a compositor, got ${kind ?? 'nothing'}`);
  }
  return particle;
}

function itemAt(parent: IrCompositor, index: number): IrParticle {
  return present(parent.items[index], `${parent.kind} item ${index}`);
}

function attributeNamed(type: IrComplexType, name: string): IrAttribute {
  const found = type.attributes.find(
    (a): a is IrAttribute => a.kind === 'attribute' && a.name === name,
  );
  return present(found, `attribute ${name} on ${type.name.name}`);
}

function codes(diagnostics: readonly Diagnostic[], code: string): readonly Diagnostic[] {
  return diagnostics.filter((d) => d.code === code);
}

// ---------------------------------------------------------------------------
// The miniature schema
// ---------------------------------------------------------------------------

/**
 * Every construct the loader supports, once.
 *
 * Shapes are miniatures of real WordprocessingML: `CT_P`'s group-nested
 * repeating choice, `CT_Text`'s `simpleContent` with `xml:space`, `CT_R`'s
 * `complexContent` extension, `ST_TextRotation`'s union of two inline simple
 * types. A fixture without the real structure cannot reproduce the real
 * failures.
 */
const MINIATURE_BODY = `  <xsd:import namespace="${SHARED_TRANSITIONAL}" schemaLocation="shared-commonSimpleTypes.xsd"/>

  <xsd:annotation>
    <xsd:documentation>A hand-written miniature of WordprocessingML.</xsd:documentation>
  </xsd:annotation>

  <xsd:simpleType name="ST_Jc">
    <xsd:annotation>
      <xsd:documentation>Paragraph alignment.</xsd:documentation>
    </xsd:annotation>
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="start">
        <xsd:annotation>
          <xsd:documentation>Leading edge of the line.</xsd:documentation>
        </xsd:annotation>
      </xsd:enumeration>
      <xsd:enumeration value="center"/>
      <xsd:enumeration value="end"/>
    </xsd:restriction>
  </xsd:simpleType>

  <xsd:simpleType name="ST_OnOff1">
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="on"/>
      <xsd:enumeration value="off"/>
    </xsd:restriction>
  </xsd:simpleType>

  <xsd:simpleType name="ST_TwipsMeasure">
    <xsd:restriction base="xsd:unsignedInt">
      <xsd:minInclusive value="0"/>
      <xsd:maxInclusive value="31680"/>
    </xsd:restriction>
  </xsd:simpleType>

  <xsd:simpleType name="ST_Ratio">
    <xsd:restriction base="xsd:decimal">
      <xsd:minExclusive value="0"/>
      <xsd:maxExclusive value="100"/>
    </xsd:restriction>
  </xsd:simpleType>

  <xsd:simpleType name="ST_HexColor">
    <xsd:restriction base="xsd:string">
      <xsd:pattern value="[0-9A-Fa-f]{6}"/>
      <xsd:length value="6"/>
      <xsd:minLength value="6"/>
      <xsd:maxLength value="6"/>
    </xsd:restriction>
  </xsd:simpleType>

  <xsd:simpleType name="ST_OnOff">
    <xsd:union memberTypes="xsd:boolean w:ST_OnOff1"/>
  </xsd:simpleType>

  <xsd:simpleType name="ST_TextRotation">
    <xsd:union>
      <xsd:simpleType>
        <xsd:restriction base="xsd:int">
          <xsd:minInclusive value="0"/>
        </xsd:restriction>
      </xsd:simpleType>
      <xsd:simpleType>
        <xsd:restriction base="xsd:string">
          <xsd:pattern value="-?[0-9]+"/>
        </xsd:restriction>
      </xsd:simpleType>
    </xsd:union>
  </xsd:simpleType>

  <xsd:simpleType name="ST_JcList">
    <xsd:list itemType="w:ST_Jc"/>
  </xsd:simpleType>

  <xsd:attribute name="id" type="xsd:string"/>

  <xsd:attributeGroup name="AG_Password">
    <xsd:attribute name="algorithmName" type="xsd:string" use="optional"/>
    <xsd:attribute name="spinCount" type="xsd:unsignedInt" use="optional" default="100000"/>
  </xsd:attributeGroup>

  <xsd:group name="EG_PContent">
    <xsd:choice>
      <xsd:element name="r" type="w:CT_R" minOccurs="0" maxOccurs="unbounded"/>
      <xsd:element ref="w:bookmarkStart" minOccurs="0"/>
      <xsd:any namespace="##other" processContents="lax" minOccurs="0" maxOccurs="unbounded"/>
      <xsd:any namespace="${SHARED_TRANSITIONAL}" processContents="skip" minOccurs="0"/>
      <xsd:any namespace="##local" minOccurs="0"/>
    </xsd:choice>
  </xsd:group>

  <xsd:complexType name="CT_Empty">
    <xsd:attribute name="val" type="w:ST_OnOff" use="optional"/>
  </xsd:complexType>

  <xsd:complexType name="CT_Jc">
    <xsd:simpleContent>
      <xsd:extension base="w:ST_Jc">
        <xsd:attribute name="val" type="w:ST_Jc" use="required"/>
      </xsd:extension>
    </xsd:simpleContent>
  </xsd:complexType>

  <xsd:complexType name="CT_Text">
    <xsd:simpleContent>
      <xsd:extension base="xsd:string">
        <xsd:attribute ref="xml:space" use="optional"/>
      </xsd:extension>
    </xsd:simpleContent>
  </xsd:complexType>

  <xsd:complexType name="CT_Base">
    <xsd:sequence/>
  </xsd:complexType>

  <xsd:complexType name="CT_R">
    <xsd:complexContent>
      <xsd:extension base="w:CT_Base">
        <xsd:sequence>
          <xsd:element name="t" type="w:CT_Text" minOccurs="0" maxOccurs="unbounded"/>
        </xsd:sequence>
        <xsd:attribute name="rsidRPr" type="w:ST_HexColor"/>
        <xsd:attributeGroup ref="w:AG_Password"/>
      </xsd:extension>
    </xsd:complexContent>
  </xsd:complexType>

  <xsd:complexType name="CT_PPr">
    <xsd:all>
      <xsd:element name="jc" type="w:CT_Jc" minOccurs="0"/>
      <xsd:element name="ind" minOccurs="0">
        <xsd:complexType>
          <xsd:attribute name="left" type="w:ST_TwipsMeasure"/>
        </xsd:complexType>
      </xsd:element>
    </xsd:all>
  </xsd:complexType>

  <xsd:complexType name="CT_P">
    <xsd:sequence>
      <xsd:element name="pPr" type="w:CT_PPr" minOccurs="0"/>
      <xsd:group ref="w:EG_PContent" minOccurs="0" maxOccurs="unbounded"/>
    </xsd:sequence>
    <xsd:attribute name="rsidR" type="w:ST_HexColor" use="optional"/>
    <xsd:attribute ref="w:id" use="required"/>
    <xsd:attribute name="jc" type="w:ST_Jc" form="qualified" use="optional" default="start"/>
    <xsd:attributeGroup ref="w:AG_Password"/>
  </xsd:complexType>

  <xsd:complexType
      name="CT_MultiLine">
    <xsd:attribute name="val" type="xsd:string"/>
  </xsd:complexType>

  <xsd:element name="bookmarkStart" type="w:CT_Empty"/>
  <xsd:element name="p" type="w:CT_P"/>
  <xsd:element name="document">
    <xsd:complexType>
      <xsd:sequence>
        <xsd:element ref="w:p" minOccurs="0" maxOccurs="unbounded"/>
      </xsd:sequence>
    </xsd:complexType>
  </xsd:element>
`;

const MINIATURE = schema(WML_TRANSITIONAL, MINIATURE_BODY);

// ---------------------------------------------------------------------------
// parseXsdDocument
// ---------------------------------------------------------------------------

describe('parseXsdDocument', () => {
  it('refuses a document with an internal DTD subset', () => {
    const hostile = `<?xml version="1.0"?>
<!DOCTYPE xsd:schema [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
]>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
            targetNamespace="${WML_TRANSITIONAL}"/>
`;
    expect(() => parseXsdDocument(hostile, 'transitional/hostile.xsd')).toThrow(XsdLoadError);
    expect(() => parseXsdDocument(hostile, 'transitional/hostile.xsd')).toThrow(/DOCTYPE/);
    expect(() => parseXsdDocument(hostile, 'transitional/hostile.xsd')).toThrow(/billion laughs/);
  });

  it('refuses an external DOCTYPE with no internal subset', () => {
    const external = `<?xml version="1.0"?>
<!DOCTYPE xsd:schema SYSTEM "http://example.invalid/evil.dtd">
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
            targetNamespace="${WML_TRANSITIONAL}"/>
`;
    expect(() => parseXsdDocument(external, 'transitional/external.xsd')).toThrow(/DOCTYPE/);
  });

  it('refuses a DOCTYPE reached through loadSchemaSet, not just the raw parser', async () => {
    const dir = await writeFixture({
      transitional: {
        'wml.xsd': `<?xml version="1.0"?>
<!DOCTYPE xsd:schema [<!ENTITY a "b">]>
${schema(WML_TRANSITIONAL, '  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>')}`,
      },
    });
    await expect(loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] })).rejects.toThrow(
      /DOCTYPE/,
    );
  });

  it('normalizes CRLF out of captured text and attribute values', () => {
    const crlf = schema(
      WML_TRANSITIONAL,
      `  <xsd:simpleType name="ST_Doc">\r
    <xsd:annotation>\r
      <xsd:documentation>first line\r
second line</xsd:documentation>\r
    </xsd:annotation>\r
    <xsd:restriction base="xsd:string">\r
      <xsd:pattern value="a\r
b"/>\r
    </xsd:restriction>\r
  </xsd:simpleType>\r
`,
    );
    const root = parseXsdDocument(crlf, 'transitional/crlf.xsd');
    const st = present(
      root.children.find((c) => c.attrs.get('name') === 'ST_Doc'),
      'ST_Doc',
    );
    const annotation = present(
      st.children.find((c) => c.local === 'annotation'),
      'annotation',
    );
    const documentation = present(annotation.children[0], 'documentation');
    expect(documentation.text).toBe('first line\nsecond line');
    expect(documentation.text).not.toMatch(/\r/);

    const restriction = present(
      st.children.find((c) => c.local === 'restriction'),
      'restriction',
    );
    const pattern = present(restriction.children[0], 'pattern');
    // Attribute values get XML's own normalization first (XML 1.0 §3.3.3: a line
    // break inside an attribute value becomes a single space), so a CRLF cannot
    // reach the IR by this route either. Asserted rather than assumed, because
    // "the parser already handles it" is exactly the kind of claim that stops
    // being true on a dependency bump.
    expect(pattern.attrs.get('value')).toBe('a b');
    expect(pattern.attrs.get('value')).not.toMatch(/\r/);
  });

  it('records the line of the start tag, not of the closing angle bracket', () => {
    const root = parseXsdDocument(MINIATURE, 'transitional/wml.xsd');
    const multiline = present(
      root.children.find((c) => c.attrs.get('name') === 'CT_MultiLine'),
      'CT_MultiLine',
    );
    expect(multiline.line).toBe(lineOf(MINIATURE, '<xsd:complexType'));
  });
});

// ---------------------------------------------------------------------------
// The miniature, loaded
// ---------------------------------------------------------------------------

describe('loadSchemaSet on a hand-written schema', () => {
  let set: IrSchemaSet;

  beforeAll(async () => {
    const dir = await writeFixture({ transitional: { 'wml.xsd': MINIATURE } });
    set = await loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] });
  });

  it('registers every kind of top-level definition', () => {
    expect([...set.complexTypes.keys()].sort()).toEqual([
      'wml#CT_Base',
      'wml#CT_Empty',
      'wml#CT_Jc',
      'wml#CT_MultiLine',
      'wml#CT_P',
      'wml#CT_PPr',
      'wml#CT_PPr_ind_Anon',
      'wml#CT_R',
      'wml#CT_Text',
      'wml#document_Anon',
    ]);
    expect([...set.groups.keys()]).toEqual(['wml#EG_PContent']);
    expect([...set.attributeGroups.keys()]).toEqual(['wml#AG_Password']);
    expect([...set.globalElements.keys()].sort()).toEqual([
      'wml#bookmarkStart',
      'wml#document',
      'wml#p',
    ]);
  });

  it('marks a single-dialect load with a single-entry dialects array', () => {
    expect(complexType(set, 'wml#CT_P').dialects).toEqual(['transitional']);
    expect(simpleType(set, 'wml#ST_Jc').dialects).toEqual(['transitional']);
  });

  it('records source as a POSIX path relative to assetsDir with a 1-based line', () => {
    const ct = complexType(set, 'wml#CT_P');
    expect(ct.source.file).toBe('transitional/wml.xsd');
    expect(ct.source.line).toBe(lineOf(MINIATURE, '<xsd:complexType name="CT_P">'));
  });

  it('compiles an enumeration into an enum simple type, carrying documentation', () => {
    const jc = simpleType(set, 'wml#ST_Jc');
    if (jc.kind !== 'enum') throw new Error(`expected enum, got ${jc.kind}`);
    expect(jc.base).toEqual({ kind: 'builtin', name: 'xsd:string' });
    expect(jc.values.map((v) => v.value)).toEqual(['start', 'center', 'end']);
    expect(jc.doc).toBe('Paragraph alignment.');
    expect(present(jc.values[0], 'first value').doc).toBe('Leading edge of the line.');
    expect(present(jc.values[1], 'second value').doc).toBeUndefined();
  });

  it('compiles value and length facets', () => {
    const twips = simpleType(set, 'wml#ST_TwipsMeasure');
    if (twips.kind !== 'restriction') throw new Error(`expected restriction, got ${twips.kind}`);
    expect(twips.base).toEqual({ kind: 'builtin', name: 'xsd:unsignedInt' });
    expect(twips.facets).toEqual({ minInclusive: '0', maxInclusive: '31680' });

    const ratio = simpleType(set, 'wml#ST_Ratio');
    if (ratio.kind !== 'restriction') throw new Error(`expected restriction, got ${ratio.kind}`);
    expect(ratio.facets).toEqual({ minExclusive: '0', maxExclusive: '100' });

    const hex = simpleType(set, 'wml#ST_HexColor');
    if (hex.kind !== 'restriction') throw new Error(`expected restriction, got ${hex.kind}`);
    // The pattern is kept in the XSD regex dialect, untranslated: translation is
    // an emit-time concern and doing it here would lose the original.
    expect(hex.facets).toEqual({
      pattern: '[0-9A-Fa-f]{6}',
      length: 6,
      minLength: 6,
      maxLength: 6,
    });
  });

  it('compiles a union from memberTypes', () => {
    const onOff = simpleType(set, 'wml#ST_OnOff');
    if (onOff.kind !== 'union') throw new Error(`expected union, got ${onOff.kind}`);
    expect(onOff.members).toEqual([
      { kind: 'builtin', name: 'xsd:boolean' },
      { kind: 'named', ref: { ns: 'wml', name: 'ST_OnOff1' } },
    ]);
  });

  it('compiles a union of inline simple types and registers them as named definitions', () => {
    const rotation = simpleType(set, 'wml#ST_TextRotation');
    if (rotation.kind !== 'union') throw new Error(`expected union, got ${rotation.kind}`);
    expect(rotation.members).toEqual([
      { kind: 'named', ref: { ns: 'wml', name: 'ST_TextRotation_Anon' } },
      { kind: 'named', ref: { ns: 'wml', name: 'ST_TextRotation_Anon2' } },
    ]);
    expect(set.simpleTypes.has('wml#ST_TextRotation_Anon')).toBe(true);
    expect(set.simpleTypes.has('wml#ST_TextRotation_Anon2')).toBe(true);
  });

  it('compiles a list', () => {
    const list = simpleType(set, 'wml#ST_JcList');
    if (list.kind !== 'list') throw new Error(`expected list, got ${list.kind}`);
    expect(list.item).toEqual({ kind: 'named', ref: { ns: 'wml', name: 'ST_Jc' } });
  });

  it('keeps a group reference unexpanded', () => {
    const p = compositor(elementsContent(complexType(set, 'wml#CT_P').content).particle);
    expect(p.kind).toBe('sequence');
    const groupRef = itemAt(p, 1);
    expect(groupRef).toEqual({
      kind: 'groupRef',
      ref: { ns: 'wml', name: 'EG_PContent' },
      min: 0,
      max: 'unbounded',
      source: { file: 'transitional/wml.xsd', line: expect.any(Number) as unknown as number },
    });
  });

  it('compiles choice, element particles, and every xsd:any namespace form', () => {
    const group = present(set.groups.get('wml#EG_PContent'), 'EG_PContent');
    const choice = compositor(group.particle);
    expect(choice.kind).toBe('choice');
    expect(choice.items).toHaveLength(5);

    const r = itemAt(choice, 0);
    if (r.kind !== 'element') throw new Error('expected an element particle');
    expect(r.name).toBe('r');
    expect(r.ns).toBe('wml');
    expect(r.min).toBe(0);
    expect(r.max).toBe('unbounded');

    const other = itemAt(choice, 2);
    if (other.kind !== 'any') throw new Error('expected a wildcard');
    expect(other.namespaces).toEqual({ kind: 'other', excluding: 'wml' });
    expect(other.processContents).toBe('lax');

    const listed = itemAt(choice, 3);
    if (listed.kind !== 'any') throw new Error('expected a wildcard');
    // The URI is resolved to a logical token, not kept as a URI.
    expect(listed.namespaces).toEqual({ kind: 'list', namespaces: ['shared-types'] });
    expect(listed.processContents).toBe('skip');

    const local = itemAt(choice, 4);
    if (local.kind !== 'any') throw new Error('expected a wildcard');
    expect(local.namespaces).toEqual({ kind: 'local' });
    // Absent processContents defaults to strict, per the XSD spec.
    expect(local.processContents).toBe('strict');
  });

  it('resolves an element ref to the global declaration type', () => {
    const choice = compositor(present(set.groups.get('wml#EG_PContent'), 'group').particle);
    const ref = itemAt(choice, 1);
    if (ref.kind !== 'element') throw new Error('expected an element particle');
    expect(ref.name).toBe('bookmarkStart');
    expect(ref.ns).toBe('wml');
    expect(ref.type).toEqual({ kind: 'named', ref: { ns: 'wml', name: 'CT_Empty' } });
    expect(ref.min).toBe(0);
    expect(ref.max).toBe(1);
  });

  it('resolves an attribute ref to the global declaration type', () => {
    const id = attributeNamed(complexType(set, 'wml#CT_P'), 'id');
    expect(id.use).toBe('required');
    expect(id.type).toEqual({ kind: 'builtin', name: 'xsd:string' });
    // A referenced attribute is global, hence always namespace-qualified.
    expect(id.ns).toBe('wml');
  });

  it('honours form= and attributeFormDefault when deciding attribute qualification', () => {
    const ct = complexType(set, 'wml#CT_P');
    expect(attributeNamed(ct, 'rsidR').ns).toBeNull();
    expect(attributeNamed(ct, 'jc').ns).toBe('wml');
  });

  it('records attribute defaults without applying them', () => {
    const ct = complexType(set, 'wml#CT_P');
    expect(attributeNamed(ct, 'jc').default).toBe('start');
    expect(attributeNamed(ct, 'rsidR').default).toBeUndefined();
  });

  it('keeps attributeGroup references unexpanded', () => {
    const ct = complexType(set, 'wml#CT_P');
    const refs = ct.attributes.filter((a) => a.kind === 'attributeGroupRef');
    expect(refs).toHaveLength(1);
    expect(present(refs[0], 'attributeGroupRef').ref).toEqual({
      ns: 'wml',
      name: 'AG_Password',
    });
    // ...and the group itself is a definition, not inlined into CT_P.
    const group = present(set.attributeGroups.get('wml#AG_Password'), 'AG_Password');
    expect(group.attributes.map((a) => (a.kind === 'attribute' ? a.name : a.kind))).toEqual([
      'algorithmName',
      'spinCount',
    ]);
  });

  it('keeps a complexContent extension base as an unresolved QName', () => {
    const r = complexType(set, 'wml#CT_R');
    const content = elementsContent(r.content);
    expect(content.extends).toEqual({ ns: 'wml', name: 'CT_Base' });
    // The base's (empty) particle is NOT merged in — that is normalize.ts's job.
    const seq = compositor(content.particle);
    expect(seq.items).toHaveLength(1);
    expect(attributeNamed(r, 'rsidRPr').type).toEqual({
      kind: 'named',
      ref: { ns: 'wml', name: 'ST_HexColor' },
    });
  });

  it('compiles simpleContent extension, including a builtin base', () => {
    const jc = complexType(set, 'wml#CT_Jc');
    expect(jc.content).toEqual({
      kind: 'simpleContent',
      base: { kind: 'named', ref: { ns: 'wml', name: 'ST_Jc' } },
    });
    expect(complexType(set, 'wml#CT_Text').content).toEqual({
      kind: 'simpleContent',
      base: { kind: 'builtin', name: 'xsd:string' },
    });
  });

  it('compiles an attributes-only complex type as empty content', () => {
    expect(complexType(set, 'wml#CT_Empty').content).toEqual({ kind: 'empty' });
  });

  it('compiles xsd:all as its own compositor kind', () => {
    const all = compositor(elementsContent(complexType(set, 'wml#CT_PPr').content).particle);
    expect(all.kind).toBe('all');
    expect(all.items).toHaveLength(2);
  });

  it('names inline anonymous types after the path that reaches them', () => {
    const all = compositor(elementsContent(complexType(set, 'wml#CT_PPr').content).particle);
    const ind = itemAt(all, 1);
    if (ind.kind !== 'element') throw new Error('expected an element particle');
    expect(ind.type).toEqual({ kind: 'named', ref: { ns: 'wml', name: 'CT_PPr_ind_Anon' } });

    const anon = complexType(set, 'wml#CT_PPr_ind_Anon');
    expect(attributeNamed(anon, 'left').type).toEqual({
      kind: 'named',
      ref: { ns: 'wml', name: 'ST_TwipsMeasure' },
    });

    const document = present(set.globalElements.get('wml#document'), 'document');
    expect(document.type).toEqual({ kind: 'named', ref: { ns: 'wml', name: 'document_Anon' } });
  });

  it('reports an unresolvable ref rather than inventing a type', () => {
    // No `xml` namespace schema is vendored, so `xml:space` cannot be typed.
    const warnings = codes(set.diagnostics, 'unresolved-attribute-ref');
    expect(warnings).toHaveLength(1);
    expect(present(warnings[0], 'warning').severity).toBe('warning');
    expect(present(warnings[0], 'warning').message).toContain('xml#space');
  });

  it('produces no error-severity diagnostics', () => {
    expect(set.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('anonymous type naming', () => {
  it('is deterministic across repeated loads', async () => {
    const dir = await writeFixture({ transitional: { 'wml.xsd': MINIATURE } });
    const first = await loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] });
    const second = await loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] });
    // Insertion order, not sorted: a difference in ordering would also make
    // generated output flap, and CI gates on a byte-identical diff.
    expect([...second.complexTypes.keys()]).toEqual([...first.complexTypes.keys()]);
    expect([...second.simpleTypes.keys()]).toEqual([...first.simpleTypes.keys()]);
  });

  it('disambiguates siblings with a stable counter rather than a global one', async () => {
    const body = `  <xsd:simpleType name="ST_A">
    <xsd:union>
      <xsd:simpleType><xsd:restriction base="xsd:int"/></xsd:simpleType>
      <xsd:simpleType><xsd:restriction base="xsd:string"/></xsd:simpleType>
      <xsd:simpleType><xsd:restriction base="xsd:boolean"/></xsd:simpleType>
    </xsd:union>
  </xsd:simpleType>
  <xsd:simpleType name="ST_B">
    <xsd:union>
      <xsd:simpleType><xsd:restriction base="xsd:int"/></xsd:simpleType>
    </xsd:union>
  </xsd:simpleType>
`;
    const dir = await writeFixture({ transitional: { 'wml.xsd': schema(WML_TRANSITIONAL, body) } });
    const set = await loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] });
    expect([...set.simpleTypes.keys()]).toEqual([
      'wml#ST_A_Anon',
      'wml#ST_A_Anon2',
      'wml#ST_A_Anon3',
      'wml#ST_A',
      'wml#ST_B_Anon',
      'wml#ST_B',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe('unsupported XSD features', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['xsd:include', 'xsd:include', '  <xsd:include schemaLocation="other.xsd"/>'],
    ['xsd:redefine', 'xsd:redefine', '  <xsd:redefine schemaLocation="other.xsd"/>'],
    [
      'substitutionGroup',
      'substitutionGroup',
      `  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>
  <xsd:element name="head" type="w:CT_X"/>
  <xsd:element name="member" type="w:CT_X" substitutionGroup="w:head"/>`,
    ],
    [
      'nillable',
      'nillable',
      `  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>
  <xsd:element name="x" type="w:CT_X" nillable="true"/>`,
    ],
    [
      'abstract',
      'abstract="true"',
      '  <xsd:complexType name="CT_X" abstract="true"><xsd:sequence/></xsd:complexType>',
    ],
    [
      'complexContent restriction',
      'xsd:complexContent/xsd:restriction',
      `  <xsd:complexType name="CT_Base"><xsd:sequence/></xsd:complexType>
  <xsd:complexType name="CT_X">
    <xsd:complexContent>
      <xsd:restriction base="w:CT_Base"><xsd:sequence/></xsd:restriction>
    </xsd:complexContent>
  </xsd:complexType>`,
    ],
    [
      'simpleContent restriction',
      'xsd:simpleContent/xsd:restriction',
      `  <xsd:complexType name="CT_X">
    <xsd:simpleContent>
      <xsd:restriction base="xsd:string"/>
    </xsd:simpleContent>
  </xsd:complexType>`,
    ],
    [
      'anyAttribute',
      'xsd:anyAttribute',
      `  <xsd:complexType name="CT_X">
    <xsd:sequence/>
    <xsd:anyAttribute processContents="lax"/>
  </xsd:complexType>`,
    ],
  ];

  for (const [label, feature, body] of cases) {
    it(`throws UnsupportedXsdFeature for ${label}`, async () => {
      const dir = await writeFixture({
        transitional: { 'wml.xsd': schema(WML_TRANSITIONAL, body) },
      });
      const load = loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] });
      await expect(load).rejects.toBeInstanceOf(UnsupportedXsdFeature);
      // The message has to name the construct and the site, because the whole
      // point is that a human goes and reads the schema.
      await expect(load).rejects.toThrow(new RegExp(feature.replace(/[/"]/g, '.')));
      await expect(load).rejects.toThrow(/transitional\/wml\.xsd:\d+/);
    });
  }
});

describe('namespace resolution', () => {
  it('refuses a targetNamespace that is not in the namespace table', async () => {
    const body = '  <xsd:complexType name="CT_X"><xsd:sequence/></xsd:complexType>';
    const unknown = `<?xml version="1.0"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
            targetNamespace="http://example.invalid/made-up"
            elementFormDefault="qualified">
${body}
</xsd:schema>
`;
    const dir = await writeFixture({ transitional: { 'unknown.xsd': unknown } });
    const load = loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] });
    await expect(load).rejects.toThrow(XsdLoadError);
    await expect(load).rejects.toThrow(/http:\/\/example\.invalid\/made-up/);
    await expect(load).rejects.toThrow(/transitional\/unknown\.xsd/);
    await expect(load).rejects.toThrow(/namespaces\.ts/);
  });

  it('refuses an unknown XSD built-in rather than degrading it to a string', async () => {
    const body = `  <xsd:complexType name="CT_X">
    <xsd:attribute name="v" type="xsd:gYearMonth"/>
  </xsd:complexType>`;
    const dir = await writeFixture({
      transitional: { 'wml.xsd': schema(WML_TRANSITIONAL, body) },
    });
    await expect(loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] })).rejects.toThrow(
      /xsd:gYearMonth/,
    );
  });

  it('resolves prefixes through the document, not through a fixed table', async () => {
    // Same schema, unconventional prefixes. Resolution must still land on the
    // logical tokens, because prefixes are not normative in XML.
    const odd = `<?xml version="1.0"?>
<X:schema xmlns:X="http://www.w3.org/2001/XMLSchema"
          xmlns:ZZZ="${WML_TRANSITIONAL}"
          targetNamespace="${WML_TRANSITIONAL}"
          elementFormDefault="qualified">
  <X:simpleType name="ST_X"><X:restriction base="X:string"/></X:simpleType>
  <X:complexType name="CT_X">
    <X:attribute name="v" type="ZZZ:ST_X"/>
  </X:complexType>
</X:schema>
`;
    const dir = await writeFixture({ transitional: { 'wml.xsd': odd } });
    const set = await loadSchemaSet({ assetsDir: dir, dialects: ['transitional'] });
    expect(attributeNamed(complexType(set, 'wml#CT_X'), 'v').type).toEqual({
      kind: 'named',
      ref: { ns: 'wml', name: 'ST_X' },
    });
  });
});

// ---------------------------------------------------------------------------
// Dialect unification
// ---------------------------------------------------------------------------

describe('dialect unification', () => {
  const SHARED_BODY = `  <xsd:simpleType name="ST_Jc">
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="start"/>
      <xsd:enumeration value="end"/>
    </xsd:restriction>
  </xsd:simpleType>
  <xsd:complexType name="CT_Jc">
    <xsd:sequence>
      <xsd:element name="jc" type="w:ST_Jc" minOccurs="0"/>
    </xsd:sequence>
    <xsd:attribute name="val" type="w:ST_Jc" use="required"/>
  </xsd:complexType>
`;

  it('merges structurally identical definitions into one node with both dialects', async () => {
    const dir = await writeFixture({
      transitional: { 'wml.xsd': schema(WML_TRANSITIONAL, SHARED_BODY) },
      strict: { 'wml.xsd': schema(WML_STRICT, SHARED_BODY) },
    });
    const set = await loadSchemaSet({ assetsDir: dir });
    expect(set.complexTypes.size).toBe(1);
    expect(complexType(set, 'wml#CT_Jc').dialects).toEqual(['transitional', 'strict']);
    expect(simpleType(set, 'wml#ST_Jc').dialects).toEqual(['transitional', 'strict']);
    expect(codes(set.diagnostics, 'dialect-divergence')).toEqual([]);
    // Documentation and source differ between the two files by construction in
    // the real set; equivalence deliberately ignores both.
    expect(complexType(set, 'wml#CT_Jc').source.file).toBe('transitional/wml.xsd');
  });

  it('ignores source and doc when comparing, but not structure', async () => {
    const documented = `  <xsd:simpleType name="ST_Jc">
    <xsd:annotation><xsd:documentation>Only Strict documents this.</xsd:documentation></xsd:annotation>
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="start"/>
      <xsd:enumeration value="end"/>
    </xsd:restriction>
  </xsd:simpleType>
  <xsd:complexType name="CT_Jc">
    <xsd:sequence>
      <xsd:element name="jc" type="w:ST_Jc" minOccurs="0"/>
    </xsd:sequence>
    <xsd:attribute name="val" type="w:ST_Jc" use="required"/>
  </xsd:complexType>
`;
    const dir = await writeFixture({
      transitional: { 'wml.xsd': schema(WML_TRANSITIONAL, SHARED_BODY) },
      // A leading blank line shifts every line number in the Strict file.
      strict: { 'wml.xsd': schema(WML_STRICT, `\n${documented}`) },
    });
    const set = await loadSchemaSet({ assetsDir: dir });
    expect(codes(set.diagnostics, 'dialect-divergence')).toEqual([]);
  });

  it('reports a divergence naming exactly what differs, and keeps Transitional', async () => {
    const strictBody = `  <xsd:simpleType name="ST_Jc">
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="start"/>
      <xsd:enumeration value="end"/>
    </xsd:restriction>
  </xsd:simpleType>
  <xsd:complexType name="CT_Jc">
    <xsd:sequence>
      <xsd:element name="jc" type="w:ST_Jc" minOccurs="1"/>
    </xsd:sequence>
    <xsd:attribute name="val" type="w:ST_Jc" use="optional"/>
  </xsd:complexType>
`;
    const dir = await writeFixture({
      transitional: { 'wml.xsd': schema(WML_TRANSITIONAL, SHARED_BODY) },
      strict: { 'wml.xsd': schema(WML_STRICT, strictBody) },
    });
    const set = await loadSchemaSet({ assetsDir: dir });

    const divergences = codes(set.diagnostics, 'dialect-divergence');
    expect(divergences).toHaveLength(1);
    const diagnostic = present(divergences[0], 'divergence');
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.message).toContain('wml#CT_Jc');
    expect(diagnostic.message).toContain('transitional/wml.xsd');
    expect(diagnostic.message).toContain('strict/wml.xsd');
    expect(diagnostic.message).toContain('content.particle.items[0].min: transitional=0 strict=1');
    expect(diagnostic.message).toContain(
      'attributes[0].use: transitional="required" strict="optional"',
    );
    expect(diagnostic.message).toContain('Keeping the Transitional definition');

    // Divergence is a warning, not a failure: the merged node is the
    // Transitional one and still claims both dialects, which is the strategy
    // docs/adr/0008-dialect-handling.md commits to.
    const merged = complexType(set, 'wml#CT_Jc');
    expect(merged.dialects).toEqual(['transitional', 'strict']);
    expect(merged.source.file).toBe('transitional/wml.xsd');
    const seq = compositor(elementsContent(merged.content).particle);
    expect(itemAt(seq, 0).min).toBe(0);
  });

  it('detects an enum value present in only one dialect', async () => {
    const strictBody = `  <xsd:simpleType name="ST_Jc">
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="start"/>
    </xsd:restriction>
  </xsd:simpleType>
`;
    const dir = await writeFixture({
      transitional: {
        'wml.xsd': schema(
          WML_TRANSITIONAL,
          `  <xsd:simpleType name="ST_Jc">
    <xsd:restriction base="xsd:string">
      <xsd:enumeration value="start"/>
      <xsd:enumeration value="end"/>
    </xsd:restriction>
  </xsd:simpleType>
`,
        ),
      },
      strict: { 'wml.xsd': schema(WML_STRICT, strictBody) },
    });
    const set = await loadSchemaSet({ assetsDir: dir });
    const message = present(codes(set.diagnostics, 'dialect-divergence')[0], 'divergence').message;
    expect(message).toContain('values: transitional has 2, strict has 1');
    expect(message).toContain('transitional-only "end"');
  });

  it('gives a definition present in only one dialect a single-entry dialects array', async () => {
    const dir = await writeFixture({
      transitional: {
        'wml.xsd': schema(
          WML_TRANSITIONAL,
          `${SHARED_BODY}  <xsd:complexType name="CT_LegacyOnly">
    <xsd:sequence/>
  </xsd:complexType>
`,
        ),
      },
      strict: { 'wml.xsd': schema(WML_STRICT, SHARED_BODY) },
    });
    const set = await loadSchemaSet({ assetsDir: dir });
    expect(complexType(set, 'wml#CT_LegacyOnly').dialects).toEqual(['transitional']);
    expect(complexType(set, 'wml#CT_Jc').dialects).toEqual(['transitional', 'strict']);
    const only = codes(set.diagnostics, 'dialect-only');
    expect(only.map((d) => d.message)).toContain(
      'complexType wml#CT_LegacyOnly exists only in transitional',
    );
  });

  it('resolves a ref within its own dialect, never across dialects', async () => {
    // Both dialects declare `bookmarkStart`, with different types. If resolution
    // leaked across dialects the Strict particle would pick up CT_T.
    const body = (typeName: string): string => `  <xsd:complexType name="${typeName}">
    <xsd:sequence/>
  </xsd:complexType>
  <xsd:element name="bookmarkStart" type="w:${typeName}"/>
  <xsd:group name="EG_X">
    <xsd:choice>
      <xsd:element ref="w:bookmarkStart"/>
    </xsd:choice>
  </xsd:group>
`;
    const dir = await writeFixture({
      transitional: { 'wml.xsd': schema(WML_TRANSITIONAL, body('CT_T')) },
      strict: { 'wml.xsd': schema(WML_STRICT, body('CT_S')) },
    });
    const set = await loadSchemaSet({ assetsDir: dir });
    const divergences = codes(set.diagnostics, 'dialect-divergence');
    // The group's element particle carries the resolved type, so a leak across
    // dialects would show up here as agreement rather than as divergence.
    const group = present(
      divergences.find((d) => d.message.includes('wml#EG_X')),
      'EG_X divergence',
    );
    expect(group.message).toContain('wml#CT_T');
    expect(group.message).toContain('wml#CT_S');
    // Same for the global declaration the ref points at.
    const element = present(
      divergences.find((d) => d.message.includes('wml#bookmarkStart')),
      'bookmarkStart divergence',
    );
    expect(element.message).toContain('type: transitional="wml#CT_T" strict="wml#CT_S"');
  });
});

// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

const ASSETS_DIR = fileURLToPath(new URL('../../../assets/schema/', import.meta.url));

describe('the vendored ECMA-376 schemas', () => {
  let set: IrSchemaSet;

  beforeAll(async () => {
    set = await loadSchemaSet({ assetsDir: ASSETS_DIR });
  });

  it('loads wml.xsd and defines the core WordprocessingML types', () => {
    for (const name of ['CT_P', 'CT_R', 'CT_Tbl', 'CT_SectPr']) {
      const ct = complexType(set, `wml#${name}`);
      expect(ct.dialects).toEqual(['transitional', 'strict']);
      expect(ct.source.file).toBe('transitional/wml.xsd');
      expect(ct.source.line).toBeGreaterThan(0);
    }
  });

  it('models w:t as simple content, which is what makes text round-trip', () => {
    expect(complexType(set, 'wml#CT_Text').content).toEqual({
      kind: 'simpleContent',
      base: { kind: 'named', ref: { ns: 'shared-types', name: 'ST_String' } },
    });
  });

  it('keeps CT_P referring to EG_PContent rather than expanding it', () => {
    const seq = compositor(elementsContent(complexType(set, 'wml#CT_P').content).particle);
    const kinds = seq.items.map((i) => i.kind);
    expect(kinds).toContain('groupRef');
    expect(set.groups.has('wml#EG_PContent')).toBe(true);
  });

  it('loads every definition the schemas declare at top level', () => {
    // These are the counts of top-level declarations across
    // transitional/ + opc/, plus the 2 synthesized anonymous simple types in
    // sml.xsd's ST_TextRotation. They are exact on purpose: a drop here means
    // definitions are being silently lost.
    expect(set.complexTypes.size).toBe(1442);
    expect(set.simpleTypes.size).toBe(602);
    expect(set.globalElements.size).toBe(183);
    expect(set.groups.size).toBe(77);
    expect(set.attributeGroups.size).toBe(29);
  });

  it('synthesizes exactly the anonymous types the schemas require', () => {
    const anonymous = [...set.simpleTypes.keys(), ...set.complexTypes.keys()]
      .filter((k) => k.includes('_Anon'))
      .sort();
    expect(anonymous).toEqual(['sml#ST_TextRotation_Anon', 'sml#ST_TextRotation_Anon2']);
  });

  it('produces no error-severity diagnostics', () => {
    expect(set.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('reports dialect divergence as warnings a human can act on', () => {
    const divergences = codes(set.diagnostics, 'dialect-divergence');
    // ADR 0008 names this report as the falsification test for unifying the two
    // dialects into one symbol table. A silent zero would mean the comparison
    // is broken, not that the dialects agree.
    expect(divergences.length).toBeGreaterThan(0);
    for (const d of divergences) {
      expect(d.severity).toBe('warning');
      expect(d.message).toMatch(/differs between Transitional \(.+\) and Strict \(.+\)/);
    }
    const jc = present(
      divergences.find((d) => d.message.includes('wml#ST_Jc ')),
      'ST_Jc divergence',
    );
    // The best-known divergence: Strict drops the visually-ordered `left`/`right`
    // in favour of the logically-ordered `start`/`end`.
    expect(jc.message).toContain('transitional-only "left", "right"');
  });

  it('resolves only the references it can, and says so for the rest', () => {
    const unresolved = [
      ...codes(set.diagnostics, 'unresolved-element-ref'),
      ...codes(set.diagnostics, 'unresolved-attribute-ref'),
    ];
    // Dublin Core and the XML namespace have no vendored schema; nothing else
    // should be missing.
    for (const d of unresolved) {
      expect(d.message).toMatch(/"(dc|dcterms|xml)#/);
    }
  });
});
