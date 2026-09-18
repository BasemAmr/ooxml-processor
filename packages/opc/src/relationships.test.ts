import { describe, expect, it } from 'vitest';

import { OpcPartNameError, OpcRelationshipError, type RelationshipErrorCode } from './errors.js';
import { PACKAGE_ROOT, resolveRelative, validatePartName, type PartName } from './partname.js';
import { isExternal, RelationshipGraph, RelationshipSet } from './relationships.js';
import { fakeXmlSupport } from './testing/fake-xml.js';

const part = (name: string): PartName => validatePartName(name);

function expectRelCode(code: RelationshipErrorCode, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(OpcRelationshipError);
    expect((error as OpcRelationshipError).code).toBe(code);
    return;
  }
  throw new Error(`expected an OpcRelationshipError with code ${code}, but nothing threw`);
}

describe('Relationship parsing and resolution', () => {
  describe('package-level vs part-level relationships', () => {
    it('resolves package-level relationships from PACKAGE_ROOT', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
      const relSet = RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport, '/_rels/.rels');

      const rel1 = relSet.requireById('rId1');
      expect(rel1.targetPartName).toBe('/word/document.xml');
      expect(rel1.source).toBe(PACKAGE_ROOT);

      const rel2 = relSet.requireById('rId2');
      expect(rel2.targetPartName).toBe('/docProps/core.xml');
    });

    it('resolves part-level relative targets against the owning part folder, not package root or _rels folder', () => {
      // For /word/_rels/document.xml.rels, the source is /word/document.xml (ECMA-376 Part 2 §9.2)
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
      const sourcePart = part('/word/document.xml');
      const relSet = RelationshipSet.parse(
        xml,
        sourcePart,
        fakeXmlSupport,
        '/word/_rels/document.xml.rels',
      );

      // media/image1.png resolves to /word/media/image1.png (NOT /media/image1.png)
      const rel1 = relSet.requireById('rId1');
      expect(rel1.targetPartName).toBe('/word/media/image1.png');

      // styles.xml resolves to /word/styles.xml
      const rel2 = relSet.requireById('rId2');
      expect(rel2.targetPartName).toBe('/word/styles.xml');
    });
  });

  describe('relative and absolute target resolution', () => {
    it('resolves ../ parent directory references and normalizes path', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="../docProps/core.xml"/>
</Relationships>`;
      const sourcePart = part('/word/document.xml');
      const relSet = RelationshipSet.parse(xml, sourcePart, fakeXmlSupport);

      expect(relSet.requireById('rId1').targetPartName).toBe('/customXml/item1.xml');
      expect(relSet.requireById('rId2').targetPartName).toBe('/docProps/core.xml');
    });

    it('resolves absolute targets starting with /', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="/word/styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/word/media/image1.png"/>
</Relationships>`;
      const sourcePart = part('/customXml/item1.xml');
      const relSet = RelationshipSet.parse(xml, sourcePart, fakeXmlSupport);

      expect(relSet.requireById('rId1').targetPartName).toBe('/word/styles.xml');
      expect(relSet.requireById('rId2').targetPartName).toBe('/word/media/image1.png');
    });

    it('rejects targets escaping the package root with unresolvable-target and OpcPartNameError cause', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="../../outside.xml"/>
</Relationships>`;
      const sourcePart = part('/word/document.xml');

      try {
        RelationshipSet.parse(xml, sourcePart, fakeXmlSupport, '/word/_rels/document.xml.rels');
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpcRelationshipError);
        const relErr = err as OpcRelationshipError;
        expect(relErr.code).toBe('unresolvable-target');
        expect(relErr.relationshipId).toBe('rId1');
        expect(relErr.cause).toBeInstanceOf(OpcPartNameError);
        expect((relErr.cause as OpcPartNameError).code).toBe('escapes-root');
      }
    });

    it('rejects target escaping root at primitive level via resolveRelative', () => {
      expect(() => resolveRelative(part('/word/document.xml'), '../../outside.xml')).toThrow(
        OpcPartNameError,
      );
    });
  });

  describe('Id attribute validation', () => {
    it('raises duplicate-id when two relationships share the same Id', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.com/type1" Target="doc1.xml"/>
  <Relationship Id="rId1" Type="http://example.com/type2" Target="doc2.xml"/>
</Relationships>`;
      expectRelCode('duplicate-id', () =>
        RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport, '/_rels/.rels'),
      );
    });

    it('raises missing-attribute when Id, Type, or Target is absent', () => {
      const missingId = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://example.com/type" Target="doc.xml"/>
</Relationships>`;
      expectRelCode('missing-attribute', () =>
        RelationshipSet.parse(missingId, PACKAGE_ROOT, fakeXmlSupport),
      );

      const missingType = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="doc.xml"/>
</Relationships>`;
      expectRelCode('missing-attribute', () =>
        RelationshipSet.parse(missingType, PACKAGE_ROOT, fakeXmlSupport),
      );

      const missingTarget = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.com/type"/>
</Relationships>`;
      expectRelCode('missing-attribute', () =>
        RelationshipSet.parse(missingTarget, PACKAGE_ROOT, fakeXmlSupport),
      );
    });

    it('raises invalid-id when Id is not a valid NCName', () => {
      // Starts with a digit
      const digitStart = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="1rId" Type="http://example.com/type" Target="doc.xml"/>
</Relationships>`;
      expectRelCode('invalid-id', () =>
        RelationshipSet.parse(digitStart, PACKAGE_ROOT, fakeXmlSupport),
      );

      // Contains colon
      const colonId = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="prefix:rId" Type="http://example.com/type" Target="doc.xml"/>
</Relationships>`;
      expectRelCode('invalid-id', () =>
        RelationshipSet.parse(colonId, PACKAGE_ROOT, fakeXmlSupport),
      );
    });
  });

  describe('TargetMode="External" security and behavior', () => {
    it('retains External targets verbatim and never resolves them as part names', () => {
      const targets = [
        'http://example.com/image.png',
        'https://sub.domain.org/path?query=val#fragment',
        'file:///C:/secret/passwords.txt',
        '\\\\evil-server\\share\\danger.exe',
        'mailto:support@example.com',
      ];

      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${targets
    .map(
      (t, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://example.com/rel" Target="${t}" TargetMode="External"/>`,
    )
    .join('\n  ')}
</Relationships>`;

      const relSet = RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport);

      for (let i = 0; i < targets.length; i += 1) {
        const rel = relSet.requireById(`rId${i + 1}`);
        expect(rel.targetMode).toBe('External');
        expect(isExternal(rel)).toBe(true);
        expect(rel.target).toBe(targets[i]);
        expect(rel.targetPartName).toBeUndefined();
      }
    });

    it('fails with external-target-not-a-part when asking RelationshipGraph for part of an External target', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdExt" Type="http://example.com/ext" Target="http://127.0.0.1:9999/ssrf" TargetMode="External"/>
</Relationships>`;
      const relSet = RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport);
      const graph = new RelationshipGraph();
      graph.add(relSet);

      try {
        graph.targetPartName(PACKAGE_ROOT, 'rIdExt');
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpcRelationshipError);
        const relErr = err as OpcRelationshipError;
        expect(relErr.code).toBe('external-target-not-a-part');
        expect(relErr.relationshipId).toBe('rIdExt');
      }
    });

    it('does not execute any network or filesystem calls during parse, traversal, or serialize', () => {
      const externalUri = 'http://invalid-nonexistent-domain-12345678.com/test.png';
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${externalUri}" TargetMode="External"/>
</Relationships>`;

      const relSet = RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport);
      const rel = relSet.requireById('rId1');
      expect(rel.target).toBe(externalUri);

      // Serializing back produces exact attribute
      const serialized = relSet.serialize(fakeXmlSupport);
      expect(serialized).toContain(`Target="${externalUri}"`);
      expect(serialized).toContain('TargetMode="External"');
    });

    it('rejects invalid TargetMode values', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.com/rel" Target="doc.xml" TargetMode="InvalidMode"/>
</Relationships>`;
      expectRelCode('invalid-target-mode', () =>
        RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport),
      );
    });
  });

  describe('querying, mutation and round-trip preservation', () => {
    it('supports singleByType and byType queries', () => {
      const typeA = 'http://example.com/typeA';
      const typeB = 'http://example.com/typeB';
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${typeA}" Target="doc1.xml"/>
  <Relationship Id="rId2" Type="${typeA}" Target="doc2.xml"/>
  <Relationship Id="rId3" Type="${typeB}" Target="doc3.xml"/>
</Relationships>`;
      const relSet = RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport);

      expect(relSet.byType(typeA).length).toBe(2);
      expect(relSet.byType(typeB).length).toBe(1);
      expect(relSet.singleByType(typeB)?.id).toBe('rId3');

      // singleByType throws malformed if multiple
      expectRelCode('malformed', () => relSet.singleByType(typeA));
    });

    it('preserves unknown attributes and simpleContent text during serialize', () => {
      const xml = `
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.com/type" Target="doc.xml" customAttr="customVal">Inner text content</Relationship>
</Relationships>`;
      const relSet = RelationshipSet.parse(xml, PACKAGE_ROOT, fakeXmlSupport);
      const rel = relSet.requireById('rId1');
      expect(rel.text).toBe('Inner text content');

      const serialized = relSet.serialize(fakeXmlSupport);
      expect(serialized).toContain('customAttr="customVal"');
      expect(serialized).toContain('Inner text content');
    });

    it('supports add and remove operations', () => {
      const relSet = RelationshipSet.empty(PACKAGE_ROOT);
      expect(relSet.dirty).toBe(false);

      relSet.add({
        id: 'rId1',
        type: 'http://example.com/type',
        target: 'word/document.xml',
        targetMode: 'Internal',
        targetModeExplicit: false,
        targetPartName: part('/word/document.xml'),
        unknownAttributes: [],
        text: '',
      });
      expect(relSet.dirty).toBe(true);
      expect(relSet.requireById('rId1').id).toBe('rId1');

      // Adding duplicate throws duplicate-id
      expectRelCode('duplicate-id', () =>
        relSet.add({
          id: 'rId1',
          type: 'http://example.com/other',
          target: 'other.xml',
          targetMode: 'Internal',
          targetModeExplicit: false,
          targetPartName: part('/other.xml'),
          unknownAttributes: [],
          text: '',
        }),
      );

      expect(relSet.remove('rId1')).toBe(true);
      expect(relSet.remove('nonexistent')).toBe(false);
      expect(relSet.byId('rId1')).toBeUndefined();
    });
  });
});
