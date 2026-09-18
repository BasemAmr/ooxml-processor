import { describe, expect, it } from 'vitest';

import { OpcContentTypeError } from './errors.js';
import { assertPackageIdempotent, diagnosePackageDiff } from './idempotence.js';
import { openPackage } from './package.js';
import { RelationshipTypes } from './rel-types.js';
import { fakeXmlSupport } from './testing/fake-xml.js';
import { buildPackage, type PackageItem } from './testing/zip-fixtures.js';
import { readZip } from './zip.js';

/* -------------------------------------------------------------------------- */
/* Common XML templates                                                        */
/* -------------------------------------------------------------------------- */

const CONTENT_TYPES_HEADER =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
const RELS_HEADER =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

function minimalPackageItems(): PackageItem[] {
  return [
    {
      name: '[Content_Types].xml',
      data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${RELS_HEADER}
  <Relationship Id="rId1" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Minimal document</w:t></w:r></w:p></w:body></w:document>',
    },
  ];
}

function buildUnknownPartsFixture(): {
  items: PackageItem[];
  binarySheetData: Uint8Array;
  vendorToolData: Uint8Array;
  customXmlData: string;
  customXmlRelsData: string;
  glossaryDocData: string;
} {
  const binarySheetData = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0x11, 0x22,
    0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0x00,
  ]);
  const vendorToolData = new Uint8Array([
    0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04, 0xca, 0xfe, 0xba, 0xbe, 0x05, 0x06, 0x07, 0x08,
  ]);
  const customXmlData =
    '<customXmlRoot xmlns="http://example.com/custom"><item id="1"/><payload>custom-xml-data</payload></customXmlRoot>';
  const customXmlRelsData = `${RELS_HEADER}
  <Relationship Id="rIdItemRel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/>
</Relationships>`;
  const glossaryDocData =
    '<w:glossaryDocument xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docParts><w:docPart><w:p><w:r><w:t>Glossary Text</w:t></w:r></w:p></w:docPart></w:docParts></w:glossaryDocument>';
  const mainDocData =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Main Document Content</w:t></w:r></w:p></w:body></w:document>';

  const items: PackageItem[] = [
    {
      name: '[Content_Types].xml',
      data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>
  <Default Extension="dat" ContentType="application/octet-stream"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/>
  <Override PartName="/customXml/item1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rIdCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="customXml/item1.xml"/>
</Relationships>`,
    },
    {
      name: 'customXml/item1.xml',
      data: customXmlData,
    },
    {
      name: 'customXml/_rels/item1.xml.rels',
      data: customXmlRelsData,
    },
    {
      name: 'word/document.xml',
      data: mainDocData,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `${RELS_HEADER}
  <Relationship Id="rIdGlossary" Type="${RelationshipTypes.glossaryDocument[0]}" Target="glossary/document.xml"/>
  <Relationship Id="rIdSheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="embeddings/sheet.xlsx"/>
  <Relationship Id="rIdVendor" Type="http://example.com/vendor-tool" Target="vendor/custom-tool.dat"/>
</Relationships>`,
    },
    {
      name: 'word/glossary/document.xml',
      data: glossaryDocData,
    },
    {
      name: 'word/embeddings/sheet.xlsx',
      data: binarySheetData,
      store: true,
    },
    {
      name: 'word/vendor/custom-tool.dat',
      data: vendorToolData,
      store: true,
    },
  ];

  return {
    items,
    binarySheetData,
    vendorToolData,
    customXmlData,
    customXmlRelsData,
    glossaryDocData,
  };
}

function buildComplexDocumentFixture(): PackageItem[] {
  const imagePngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);

  return [
    {
      name: '[Content_Types].xml',
      data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="${RelationshipTypes.coreProperties[0]}" Target="docProps/core.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Complex document</w:t></w:r></w:p></w:body></w:document>',
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `${RELS_HEADER}
  <Relationship Id="rIdHeader" Type="${RelationshipTypes.header[0]}" Target="header1.xml"/>
  <Relationship Id="rIdFooter" Type="${RelationshipTypes.footer[0]}" Target="footer1.xml"/>
  <Relationship Id="rIdStyles" Type="${RelationshipTypes.styles[0]}" Target="styles.xml"/>
  <Relationship Id="rIdImageInternal" Type="${RelationshipTypes.image[0]}" Target="media/image1.png"/>
  <Relationship Id="rIdImageExternal" Type="${RelationshipTypes.image[0]}" Target="https://example.com/logo.png" TargetMode="External"/>
  <Relationship Id="rIdHyperlink" Type="${RelationshipTypes.hyperlink[0]}" Target="https://deepmind.google" TargetMode="External"/>
</Relationships>`,
    },
    {
      name: 'word/header1.xml',
      data: '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header 1</w:t></w:r></w:p></w:hdr>',
    },
    {
      name: 'word/footer1.xml',
      data: '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer 1</w:t></w:r></w:p></w:ftr>',
    },
    {
      name: 'word/styles.xml',
      data: '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    },
    {
      name: 'word/media/image1.png',
      data: imagePngBytes,
      store: true,
    },
    {
      name: 'docProps/core.xml',
      data: '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Complex Document</dc:title></cp:coreProperties>',
    },
  ];
}

function buildStrictDocumentFixture(): PackageItem[] {
  return [
    {
      name: '[Content_Types].xml',
      data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[1]}" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body><w:p><w:r><w:t>Strict dialect document</w:t></w:r></w:p></w:body></w:document>',
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `${RELS_HEADER}
  <Relationship Id="rIdStyles" Type="${RelationshipTypes.styles[1]}" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'word/styles.xml',
      data: '<w:styles xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"/>',
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Test suites                                                                */
/* -------------------------------------------------------------------------- */

describe('Wave 4: Tickets P2-10 & P2-11', () => {
  describe('P2-10: Unknown-part passthrough', () => {
    it('carries customXml, glossary, embeddings, and vendor parts byte-for-byte identical', async () => {
      const fixture = buildUnknownPartsFixture();
      const initialBytes = buildPackage(fixture.items);

      // Open initial package (gen 1)
      const p1 = await openPackage(initialBytes, fakeXmlSupport);

      // Verify parts are accessible and match original data
      expect(p1.requirePart('/customXml/item1.xml').text()).toBe(fixture.customXmlData);
      expect(p1.requirePart('/customXml/_rels/item1.xml.rels').text()).toBe(
        fixture.customXmlRelsData,
      );
      expect(p1.requirePart('/word/glossary/document.xml').text()).toBe(fixture.glossaryDocData);
      expect(p1.requirePart('/word/embeddings/sheet.xlsx').bytes()).toEqual(
        fixture.binarySheetData,
      );
      expect(p1.requirePart('/word/vendor/custom-tool.dat').bytes()).toEqual(
        fixture.vendorToolData,
      );

      // Save to gen 2 without modification
      const gen2 = await p1.save();

      // Open gen 2 package
      const p2 = await openPackage(gen2, fakeXmlSupport);

      // Verify all four unknown parts survive byte-for-byte identical
      expect(p2.requirePart('/customXml/item1.xml').bytes()).toEqual(
        p1.requirePart('/customXml/item1.xml').bytes(),
      );
      expect(p2.requirePart('/customXml/_rels/item1.xml.rels').bytes()).toEqual(
        p1.requirePart('/customXml/_rels/item1.xml.rels').bytes(),
      );
      expect(p2.requirePart('/word/glossary/document.xml').bytes()).toEqual(
        p1.requirePart('/word/glossary/document.xml').bytes(),
      );
      expect(p2.requirePart('/word/embeddings/sheet.xlsx').bytes()).toEqual(
        p1.requirePart('/word/embeddings/sheet.xlsx').bytes(),
      );
      expect(p2.requirePart('/word/vendor/custom-tool.dat').bytes()).toEqual(
        p1.requirePart('/word/vendor/custom-tool.dat').bytes(),
      );

      // Also verify uncompressed data matches original payload exactly
      expect(p2.requirePart('/word/embeddings/sheet.xlsx').bytes()).toEqual(
        fixture.binarySheetData,
      );
      expect(p2.requirePart('/word/vendor/custom-tool.dat').bytes()).toEqual(
        fixture.vendorToolData,
      );
    });

    it('maintains exact original archive positions and order for all entries', async () => {
      const fixture = buildUnknownPartsFixture();
      const initialBytes = buildPackage(fixture.items);

      const p1 = await openPackage(initialBytes, fakeXmlSupport);
      const gen2 = await p1.save();
      const p2 = await openPackage(gen2, fakeXmlSupport);
      const gen3 = await p2.save();

      const expectedOrder = fixture.items.map((i) => i.name);
      const gen2Entries = readZip(gen2, p1.limits).entries.map((e) => e.name);
      const gen3Entries = readZip(gen3, p2.limits).entries.map((e) => e.name);

      expect(gen2Entries).toEqual(expectedOrder);
      expect(gen3Entries).toEqual(expectedOrder);

      // Verify specific unknown part indices match original positions
      const customXmlIdx = expectedOrder.indexOf('customXml/item1.xml');
      const customXmlRelsIdx = expectedOrder.indexOf('customXml/_rels/item1.xml.rels');
      const glossaryIdx = expectedOrder.indexOf('word/glossary/document.xml');
      const sheetIdx = expectedOrder.indexOf('word/embeddings/sheet.xlsx');
      const vendorIdx = expectedOrder.indexOf('word/vendor/custom-tool.dat');

      expect(gen2Entries[customXmlIdx]).toBe('customXml/item1.xml');
      expect(gen2Entries[customXmlRelsIdx]).toBe('customXml/_rels/item1.xml.rels');
      expect(gen2Entries[glossaryIdx]).toBe('word/glossary/document.xml');
      expect(gen2Entries[sheetIdx]).toBe('word/embeddings/sheet.xlsx');
      expect(gen2Entries[vendorIdx]).toBe('word/vendor/custom-tool.dat');

      // Verify untouched entries were passed through with identical compressed data and CRC32
      const origZip = readZip(initialBytes, p1.limits);
      const gen2Zip = readZip(gen2, p1.limits);

      for (let i = 0; i < origZip.entries.length; i++) {
        const origEntry = origZip.entries[i]!;
        const gen2Entry = gen2Zip.entries[i]!;
        expect(gen2Entry.crc32).toBe(origEntry.crc32);
        expect(gen2Entry.method).toBe(origEntry.method);
        expect(gen2Entry.compressedData).toEqual(origEntry.compressedData);
      }
    });

    it('verifies gen2 === gen3 (Invariant A2) for package with unknown parts', async () => {
      const fixture = buildUnknownPartsFixture();
      const initialBytes = buildPackage(fixture.items);

      const { gen2, gen3 } = await assertPackageIdempotent(initialBytes, fakeXmlSupport);

      expect(gen2.length).toBe(gen3.length);
      expect(gen2).toEqual(gen3);
    });

    it('raises typed OpcContentTypeError (no-content-type-for-part) when an unknown part is untyped', async () => {
      const fixture = buildUnknownPartsFixture();
      // Remove the Default extension="dat" and do not provide an Override for the .dat part
      const itemsWithoutDatType = fixture.items.map((item) => {
        if (item.name === '[Content_Types].xml') {
          return {
            name: item.name,
            data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/>
  <Override PartName="/customXml/item1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
</Types>`,
          };
        }
        return item;
      });

      const untypedPackageBytes = buildPackage(itemsWithoutDatType);

      await expect(openPackage(untypedPackageBytes, fakeXmlSupport)).rejects.toThrow(
        OpcContentTypeError,
      );

      try {
        await openPackage(untypedPackageBytes, fakeXmlSupport);
        expect.unreachable('Should have thrown OpcContentTypeError');
      } catch (error) {
        expect(error).toBeInstanceOf(OpcContentTypeError);
        const ctError = error as OpcContentTypeError;
        expect(ctError.kind).toBe('content-type');
        expect(ctError.code).toBe('no-content-type-for-part');
        expect(ctError.subject).toBe('/word/vendor/custom-tool.dat');
      }
    });
  });

  describe('P2-11: Package round-trip idempotence harness', () => {
    it('verifies idempotence on minimal Word document', async () => {
      const bytes = buildPackage(minimalPackageItems());
      const { gen2, gen3 } = await assertPackageIdempotent(bytes, fakeXmlSupport);
      expect(gen2.length).toBe(gen3.length);
      expect(gen2).toEqual(gen3);
    });

    it('verifies idempotence on document with complex relationships (headers, footers, images, hyperlinks)', async () => {
      const bytes = buildPackage(buildComplexDocumentFixture());
      const { gen2, gen3 } = await assertPackageIdempotent(bytes, fakeXmlSupport);
      expect(gen2.length).toBe(gen3.length);
      expect(gen2).toEqual(gen3);
    });

    it('verifies idempotence on document with unknown parts (P2-10 fixture)', async () => {
      const bytes = buildPackage(buildUnknownPartsFixture().items);
      const { gen2, gen3 } = await assertPackageIdempotent(bytes, fakeXmlSupport);
      expect(gen2.length).toBe(gen3.length);
      expect(gen2).toEqual(gen3);
    });

    it('verifies idempotence on Strict-dialect document', async () => {
      const bytes = buildPackage(buildStrictDocumentFixture());
      const { gen2, gen3 } = await assertPackageIdempotent(bytes, fakeXmlSupport);
      expect(gen2.length).toBe(gen3.length);
      expect(gen2).toEqual(gen3);
    });

    it('reports exact part name and byte offset when uncompressed bytes differ', async () => {
      const bytes = buildPackage(minimalPackageItems());

      // Deliberately perturb byte offset 42 in /word/document.xml on p2
      const pkg = await openPackage(bytes, fakeXmlSupport);
      const originalBytes = pkg.mainDocument.bytes();
      const perturbOffset = 42;
      const expectedByte = originalBytes[perturbOffset]!;
      const perturbedBytes = new Uint8Array(originalBytes);
      const actualByte = expectedByte ^ 0x02;
      perturbedBytes[perturbOffset] = actualByte;

      const expHex = `0x${expectedByte.toString(16)}`;
      const actHex = `0x${actualByte.toString(16)}`;

      await expect(
        assertPackageIdempotent(bytes, fakeXmlSupport, {
          onP2: (p2) => {
            p2.requirePart('/word/document.xml').replaceBytes(perturbedBytes);
          },
        }),
      ).rejects.toThrowError(
        `Part "/word/document.xml" differs at byte offset ${perturbOffset} (expected ${expHex}, actual ${actHex})`,
      );
    });

    it('reports exact part name and byte offset when an unknown binary part differs', async () => {
      const fixture = buildUnknownPartsFixture();
      const bytes = buildPackage(fixture.items);

      const pkg = await openPackage(bytes, fakeXmlSupport);
      const toolPart = pkg.requirePart('/word/vendor/custom-tool.dat');
      const originalData = toolPart.bytes();
      const perturbOffset = 7;
      const expectedByte = originalData[perturbOffset]!;
      const perturbed = new Uint8Array(originalData);
      const actualByte = expectedByte ^ 0x55;
      perturbed[perturbOffset] = actualByte;

      const expHex = `0x${expectedByte.toString(16)}`;
      const actHex = `0x${actualByte.toString(16)}`;

      await expect(
        assertPackageIdempotent(bytes, fakeXmlSupport, {
          onP2: (p2) => {
            p2.requirePart('/word/vendor/custom-tool.dat').replaceBytes(perturbed);
          },
        }),
      ).rejects.toThrowError(
        `Part "/word/vendor/custom-tool.dat" differs at byte offset ${perturbOffset} (expected ${expHex}, actual ${actHex})`,
      );
    });

    it('diagnosePackageDiff detects entry count and method differences', async () => {
      const bytes1 = buildPackage(minimalPackageItems());
      // Create package with an extra entry
      const itemsExtra: PackageItem[] = [
        ...minimalPackageItems(),
        { name: 'extra.dat', data: new Uint8Array([1, 2, 3]) },
      ];
      // Type the extra entry so it builds
      (itemsExtra[0] as { data: string }).data = `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="dat" ContentType="application/octet-stream"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
      const bytesExtra = buildPackage(itemsExtra);

      expect(() => diagnosePackageDiff(bytes1, bytesExtra)).toThrowError(
        /Archive entry count differs: gen2 has 3 entries, gen3 has 4 entries/,
      );

      // Check compression method difference
      const itemsStored = minimalPackageItems();
      (itemsStored[2] as { store?: boolean }).store = true;
      const bytesStored = buildPackage(itemsStored);
      expect(() => diagnosePackageDiff(bytes1, bytesStored)).toThrowError(
        'Part "/word/document.xml" compression method differs (expected 8, actual 0)',
      );
    });
  });
});
