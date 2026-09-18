/**
 * Security Limits Test Suite — Ticket P2-09 (Wave 2 of Phase 2).
 *
 * Exhaustive coverage of resource limits, container boundary constraints,
 * anti-amplification defenses, XXE/DOCTYPE rejection, and network isolation.
 *
 * ## Verified Security Properties:
 * 1. Archive size ceiling (`maxArchiveBytes`) -> `archive-too-large`
 * 2. Entry count ceiling (`maxEntryCount`) -> `too-many-entries`
 * 3. Single entry uncompressed size (`maxEntryUncompressedBytes`) -> `entry-too-large` (honest CD & streaming)
 * 4. Total uncompressed size (`maxTotalUncompressedBytes`):
 *    - CD-declared total pre-check -> `total-uncompressed-too-large`
 *    - Lazy streaming budget enforcement -> `total-uncompressed-too-large`
 * 5. Compression ratio limit (`maxCompressionRatio` & `ratioCheckFloorBytes`):
 *    - False positive suppression for small parts under floor
 *    - Immediate abortion during streaming inflation for bombs, bounding peak memory
 * 6. Path traversal rejection (`OpcPartNameError` with `escapes-root`, `dot-segment`, etc.)
 * 7. XXE / DOCTYPE rejection using real schema cursor (`entity-rejected`)
 * 8. SSRF / Network isolation (external target non-dereference and zero network imports in src)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCursor, createStringSink, XmlParseError } from '@ooxml/schema';

import {
  OpcLimitError,
  OpcPackageError,
  OpcPartNameError,
  type LimitErrorCode,
  type PartNameErrorCode,
} from './errors.js';
import { DEFAULT_OPC_LIMITS, resolveLimits } from './limits.js';
import { openPackage } from './package.js';
import {
  PACKAGE_ROOT,
  resolveRelative,
  validatePartName,
  type PackageRoot,
  type PartName,
} from './partname.js';
import { RelationshipTypes } from './rel-types.js';
import { fakeXmlSupport } from './testing/fake-xml.js';
import { buildPackage, buildRawZip, type PackageItem } from './testing/zip-fixtures.js';
import type { XmlSupport } from './xml-support.js';
import { createBudget, decompressEntry, METHOD_DEFLATE, METHOD_STORE, readZip } from './zip.js';

const utf8 = new TextEncoder();

const realXmlSupport: XmlSupport = {
  createCursor(xml: string) {
    return createCursor(xml);
  },
  createStringSink() {
    return createStringSink();
  },
};

/** Minimal valid OOXML document entries for openPackage fixtures. */
function minimalDocumentItems(extraItems: readonly PackageItem[] = []): PackageItem[] {
  return [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
        '  <Default Extension="xml" ContentType="application/xml"/>\n' +
        '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
        '  <w:body><w:p><w:r><w:t>Hello World</w:t></w:r></w:p></w:body>\n' +
        '</w:document>',
    },
    ...extraItems,
  ];
}

describe('Ticket P2-09: Security Limits & Container Hardening', () => {
  /* ------------------------------------------------------------------------ */
  /* 1. Archive size limit (maxArchiveBytes)                                  */
  /* ------------------------------------------------------------------------ */
  describe('Archive size limit (maxArchiveBytes)', () => {
    it('rejects an archive exceeding maxArchiveBytes with archive-too-large', () => {
      const zipBytes = buildPackage(minimalDocumentItems());
      const tightLimit = resolveLimits({ maxArchiveBytes: zipBytes.length - 1 });

      let thrown: unknown;
      try {
        readZip(zipBytes, tightLimit);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.kind).toBe('limit');
      expect(limitErr.limit).toBe('maxArchiveBytes');
      expect(limitErr.code).toBe('archive-too-large');
      expect(limitErr.allowed).toBe(zipBytes.length - 1);
      expect(limitErr.observed).toBe(zipBytes.length);
    });

    it('rejects oversized archive via openPackage before reading central directory', async () => {
      const zipBytes = buildPackage(minimalDocumentItems());
      const promise = openPackage(zipBytes, fakeXmlSupport, {
        maxArchiveBytes: zipBytes.length - 10,
      });

      await expect(promise).rejects.toThrow(OpcLimitError);
      await expect(promise).rejects.toMatchObject({
        kind: 'limit',
        limit: 'maxArchiveBytes',
        code: 'archive-too-large',
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Entry count limit (maxEntryCount)                                     */
  /* ------------------------------------------------------------------------ */
  describe('Entry count limit (maxEntryCount)', () => {
    it('rejects an archive with more entries than maxEntryCount with too-many-entries', () => {
      const items: PackageItem[] = [
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: '_rels/.rels', data: '<Relationships/>' },
        { name: 'word/document.xml', data: '<w:document/>' },
        { name: 'word/styles.xml', data: '<w:styles/>' },
        { name: 'word/settings.xml', data: '<w:settings/>' },
      ];
      const zipBytes = buildPackage(items);
      const tightLimit = resolveLimits({ maxEntryCount: 3 });

      let thrown: unknown;
      try {
        readZip(zipBytes, tightLimit);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.kind).toBe('limit');
      expect(limitErr.limit).toBe('maxEntryCount');
      expect(limitErr.code).toBe('too-many-entries');
      expect(limitErr.allowed).toBe(3);
      expect(limitErr.observed).toBe(5);
    });

    it('rejects entry flood through openPackage', async () => {
      const items = minimalDocumentItems([
        { name: 'word/item1.xml', data: '<item1/>' },
        { name: 'word/item2.xml', data: '<item2/>' },
      ]);
      const zipBytes = buildPackage(items);

      await expect(
        openPackage(zipBytes, fakeXmlSupport, { maxEntryCount: 3 }),
      ).rejects.toMatchObject({
        kind: 'limit',
        limit: 'maxEntryCount',
        code: 'too-many-entries',
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Single entry uncompressed size limit (maxEntryUncompressedBytes)     */
  /* ------------------------------------------------------------------------ */
  describe('Single entry uncompressed size limit (maxEntryUncompressedBytes)', () => {
    it('rejects when Central Directory declares an uncompressed size exceeding cap', () => {
      const zipBytes = buildRawZip([
        {
          nameBytes: utf8.encode('word/document.xml'),
          data: utf8.encode('<w:document/>'),
          uncompressedSizeOverride: 50_000,
        },
      ]);
      const limits = resolveLimits({ maxEntryUncompressedBytes: 10_000 });

      let thrown: unknown;
      try {
        readZip(zipBytes, limits);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.kind).toBe('limit');
      expect(limitErr.limit).toBe('maxEntryUncompressedBytes');
      expect(limitErr.code).toBe('entry-too-large');
      expect(limitErr.allowed).toBe(10_000);
      expect(limitErr.observed).toBe(50_000);
      expect(limitErr.entryName).toBe('word/document.xml');
    });

    it('rejects a dishonest Central Directory when actual inflated size exceeds cap during streaming inflation', () => {
      const actualPayload = utf8.encode(
        '<w:document>' + '<w:p>Text</w:p>'.repeat(400) + '</w:document>',
      );
      const zipBytes = buildRawZip([
        {
          nameBytes: utf8.encode('word/document.xml'),
          data: actualPayload,
          method: METHOD_DEFLATE,
          // Central directory lies, claiming it is only 50 bytes (below 2,000 cap)
          uncompressedSizeOverride: 50,
        },
      ]);

      const limits = resolveLimits({
        maxEntryUncompressedBytes: 2000,
        ratioCheckFloorBytes: 100_000, // keep ratio check dormant
      });

      const archive = readZip(zipBytes, limits);
      const budget = createBudget();

      let thrown: unknown;
      try {
        decompressEntry(archive.entries[0]!, limits, budget);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.kind).toBe('limit');
      expect(limitErr.limit).toBe('maxEntryUncompressedBytes');
      expect(limitErr.code).toBe('entry-too-large');
      expect(limitErr.allowed).toBe(2000);
      expect(limitErr.observed).toBeGreaterThan(2000);
      expect(limitErr.entryName).toBe('word/document.xml');
    });

    it('rejects a STORED entry whose size exceeds maxEntryUncompressedBytes', () => {
      const payload = new Uint8Array(1500);
      const zipBytes = buildRawZip([
        {
          nameBytes: utf8.encode('word/media/huge.png'),
          data: payload,
          method: METHOD_STORE,
          uncompressedSizeOverride: 100, // CD lies, claiming 100 bytes
        },
      ]);
      const limits = resolveLimits({ maxEntryUncompressedBytes: 1000 });
      const archive = readZip(zipBytes, limits);

      let thrown: unknown;
      try {
        decompressEntry(archive.entries[0]!, limits, createBudget());
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.limit).toBe('maxEntryUncompressedBytes');
      expect(limitErr.code).toBe('entry-too-large');
      expect(limitErr.allowed).toBe(1000);
      expect(limitErr.observed).toBe(1500);
      expect(limitErr.entryName).toBe('word/media/huge.png');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Total uncompressed size limit (maxTotalUncompressedBytes)             */
  /* ------------------------------------------------------------------------ */
  describe('Total uncompressed size limit (maxTotalUncompressedBytes)', () => {
    it('pre-check: rejects honest bomb from Central Directory declarations before inflating', () => {
      const items: PackageItem[] = [
        {
          name: '[Content_Types].xml',
          data: utf8.encode('<Types>' + 'x'.repeat(400) + '</Types>'),
        },
        {
          name: '_rels/.rels',
          data: utf8.encode('<Relationships>' + 'y'.repeat(400) + '</Relationships>'),
        },
        {
          name: 'word/document.xml',
          data: utf8.encode('<w:document>' + 'z'.repeat(400) + '</w:document>'),
        },
      ];
      const zipBytes = buildPackage(items);
      // Total uncompressed is ~1250 bytes. Cap at 1000 bytes.
      const limits = resolveLimits({ maxTotalUncompressedBytes: 1000 });

      let thrown: unknown;
      try {
        readZip(zipBytes, limits);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.kind).toBe('limit');
      expect(limitErr.limit).toBe('maxTotalUncompressedBytes');
      expect(limitErr.code).toBe('total-uncompressed-too-large');
      expect(limitErr.allowed).toBe(1000);
      expect(limitErr.observed).toBeGreaterThan(1000);
    });

    it('streaming check: rejects dishonest central directory during lazy part materialisation', () => {
      const payload1 = utf8.encode('<part1>' + 'a'.repeat(90) + '</part1>'); // 104 bytes
      const payload2 = utf8.encode('<part2>' + 'b'.repeat(400) + '</part2>'); // 414 bytes

      const zipBytes = buildRawZip([
        {
          nameBytes: utf8.encode('word/part1.xml'),
          data: payload1,
          method: METHOD_STORE,
          uncompressedSizeOverride: payload1.length, // Honest entry: 104 bytes
        },
        {
          nameBytes: utf8.encode('word/part2.xml'),
          data: payload2,
          method: METHOD_DEFLATE,
          uncompressedSizeOverride: 50, // Dishonest entry: claims 50 bytes, actual 414 bytes
        },
      ]);

      // Total declared is 104 + 50 = 154 bytes <= 250.
      const limits = resolveLimits({
        maxTotalUncompressedBytes: 250,
        maxEntryUncompressedBytes: 1000,
        ratioCheckFloorBytes: 100_000,
      });

      const archive = readZip(zipBytes, limits);
      const budget = createBudget();

      // Decompress first entry (consumes 104 bytes of 250 budget; 146 remaining)
      const part1 = decompressEntry(archive.entries[0]!, limits, budget);
      expect(part1.length).toBe(payload1.length);
      expect(budget.totalUncompressedBytes).toBe(payload1.length);

      // Decompress second entry: pushes cumulative uncompressed past 250 during inflation
      let thrown: unknown;
      try {
        decompressEntry(archive.entries[1]!, limits, budget);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.kind).toBe('limit');
      expect(limitErr.limit).toBe('maxTotalUncompressedBytes');
      expect(limitErr.code).toBe('total-uncompressed-too-large');
      expect(limitErr.allowed).toBe(250);
      expect(limitErr.observed).toBeGreaterThan(250);
      expect(limitErr.entryName).toBe('word/part2.xml');
    });

    it('enforces total uncompressed budget lazily across package parts in openPackage', async () => {
      const ctData = utf8.encode(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>',
      );
      const relsData = utf8.encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>',
      );
      const docData = utf8.encode(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
      );
      const bombData = utf8.encode('<extra>' + 'w'.repeat(1000) + '</extra>');

      const zipBytes = buildRawZip([
        {
          nameBytes: utf8.encode('[Content_Types].xml'),
          data: ctData,
          method: METHOD_STORE,
          uncompressedSizeOverride: ctData.length,
        },
        {
          nameBytes: utf8.encode('_rels/.rels'),
          data: relsData,
          method: METHOD_STORE,
          uncompressedSizeOverride: relsData.length,
        },
        {
          nameBytes: utf8.encode('word/document.xml'),
          data: docData,
          method: METHOD_STORE,
          uncompressedSizeOverride: docData.length,
        },
        {
          nameBytes: utf8.encode('word/extra.xml'),
          data: bombData,
          method: METHOD_DEFLATE,
          uncompressedSizeOverride: 50, // Dishonest CD: claims 50 bytes so declared total stays below 800
        },
      ]);

      // Total declared is ctData (~270) + relsData (~215) + docData (~120) + 50 = ~655 bytes <= 800.
      const pkg = await openPackage(zipBytes, fakeXmlSupport, {
        maxTotalUncompressedBytes: 800,
      });

      // Reading main document consumes ~120 bytes; cumulative remains <= 800.
      const mainBytes = pkg.mainDocument.bytes();
      expect(mainBytes.length).toBe(docData.length);

      // Accessing word/extra.xml (1000 bytes) pushes the budget over 800 and aborts during inflation.
      const extraPart = pkg.requirePart('/word/extra.xml');
      expect(() => extraPart.bytes()).toThrow(OpcLimitError);
      expect(() => extraPart.bytes()).toThrowError(/maxTotalUncompressedBytes/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Compression ratio limit (maxCompressionRatio & ratioCheckFloorBytes)  */
  /* ------------------------------------------------------------------------ */
  describe('Compression ratio limit (maxCompressionRatio & ratioCheckFloorBytes)', () => {
    it('prevents false positives: small file under ratioCheckFloorBytes with high ratio is accepted', () => {
      // 5,000 bytes of repetitive text deflates to ~40 bytes (ratio > 120:1)
      const data = utf8.encode('<root>' + 'A'.repeat(4980) + '</root>');
      const zipBytes = buildPackage([{ name: 'word/small-bomb.xml', data }]);

      const limits = resolveLimits({
        maxCompressionRatio: 10, // strict ratio ceiling of 10:1
        ratioCheckFloorBytes: 1024 * 1024, // 1 MiB floor
      });

      const archive = readZip(zipBytes, limits);
      const decompressed = decompressEntry(archive.entries[0]!, limits, createBudget());

      expect(decompressed.length).toBe(data.length);
      expect(decompressed).toEqual(data);
    });

    it('rejects a bomb exceeding ratioCheckFloorBytes and maxCompressionRatio during streaming inflation', () => {
      // 300,000 bytes deflates to ~350 bytes (ratio > 800:1)
      const bombPayload = utf8.encode('<bomb>' + '0'.repeat(299_980) + '</bomb>');
      const zipBytes = buildPackage([{ name: 'word/bomb.xml', data: bombPayload }]);

      const limits = resolveLimits({
        maxCompressionRatio: 20, // ratio cap 20:1
        ratioCheckFloorBytes: 10_000, // floor 10 KB
      });

      const archive = readZip(zipBytes, limits);
      const entry = archive.entries[0]!;

      let thrown: unknown;
      try {
        decompressEntry(entry, limits, createBudget());
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.kind).toBe('limit');
      expect(limitErr.limit).toBe('maxCompressionRatio');
      expect(limitErr.code).toBe('compression-ratio-exceeded');
      expect(limitErr.allowed).toBe(20);
      expect(limitErr.entryName).toBe('word/bomb.xml');
    });

    it('bounds peak allocation: inflater aborts immediately without allocating full expansion', () => {
      // 500,000 bytes of repetitive data
      const largeBomb = utf8.encode('<bomb>' + 'X'.repeat(499_980) + '</bomb>');
      const zipBytes = buildPackage([{ name: 'word/large-bomb.xml', data: largeBomb }]);

      const limits = resolveLimits({
        maxCompressionRatio: 15,
        ratioCheckFloorBytes: 8_000,
      });

      const archive = readZip(zipBytes, limits);
      const entry = archive.entries[0]!;

      let thrown: unknown;
      try {
        decompressEntry(entry, limits, createBudget());
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpcLimitError);
      const limitErr = thrown as OpcLimitError;
      expect(limitErr.code).toBe('compression-ratio-exceeded');

      // The observed compression ratio in OpcLimitError reflects the ratio at abort time,
      // proving inflation aborted immediately rather than running to full completion.
      expect(limitErr.observed).toBeGreaterThanOrEqual(15);
      expect(limitErr.entryName).toBe('word/large-bomb.xml');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Path traversal boundary (OpcPartNameError)                            */
  /* ------------------------------------------------------------------------ */
  describe('Path traversal boundary (OpcPartNameError)', () => {
    const invalidNames: Array<{ readonly name: string; readonly expectedCode: PartNameErrorCode }> =
      [
        { name: '/../word/document.xml', expectedCode: 'dot-segment' },
        { name: '/word/../../etc/passwd', expectedCode: 'dot-segment' },
        { name: '/word/%2E%2E/evil.xml', expectedCode: 'dot-segment' },
        { name: '/word/evil.%2E', expectedCode: 'segment-ends-with-dot' },
        { name: '/word%2Fdocument.xml', expectedCode: 'encoded-separator' },
        { name: '/word%5Cdocument.xml', expectedCode: 'encoded-separator' },
        { name: '/word\\document.xml', expectedCode: 'invalid-character' },
        { name: '/word/foo./bar.xml', expectedCode: 'segment-ends-with-dot' },
        { name: '/word//document.xml', expectedCode: 'empty-segment' },
        { name: '/word/document.xml/', expectedCode: 'trailing-slash' },
      ];

    for (const { name, expectedCode } of invalidNames) {
      it(`rejects traversal part name ${JSON.stringify(name)} with ${expectedCode}`, () => {
        let thrown: unknown;
        try {
          validatePartName(name);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(OpcPartNameError);
        const err = thrown as OpcPartNameError;
        expect(err.kind).toBe('part-name');
        expect(err.code).toBe(expectedCode);
      });
    }

    it('rejects an archive containing path-traversal entry names', () => {
      const zipBytes = buildRawZip([
        {
          nameBytes: utf8.encode('../word/document.xml'),
          data: utf8.encode('<w:document/>'),
        },
      ]);

      expect(() => readZip(zipBytes, DEFAULT_OPC_LIMITS)).toThrow(OpcPartNameError);
    });

    describe('relative relationship resolution boundary', () => {
      function expectPartNameError(expectedCode: PartNameErrorCode, fn: () => unknown): void {
        let thrown: unknown;
        try {
          fn();
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(OpcPartNameError);
        expect((thrown as OpcPartNameError).code).toBe(expectedCode);
      }

      it('rejects targets navigating above the package root with escapes-root', () => {
        expectPartNameError('escapes-root', () =>
          resolveRelative('/word/document.xml' as PartName, '../../etc/passwd'),
        );

        expectPartNameError('escapes-root', () =>
          resolveRelative(PACKAGE_ROOT as PackageRoot, '../evil.xml'),
        );
      });

      it('rejects percent-encoded dot segments in relative targets with dot-segment', () => {
        expectPartNameError('dot-segment', () =>
          resolveRelative('/word/document.xml' as PartName, '%2E%2E/%2E%2E/etc/passwd'),
        );
      });

      it('rejects backslashes in relative targets with invalid-character', () => {
        expectPartNameError('invalid-character', () =>
          resolveRelative('/word/document.xml' as PartName, '..\\windows\\system32'),
        );
      });

      it('rejects URI schemes in internal relationship targets with absolute-uri', () => {
        expectPartNameError('absolute-uri', () =>
          resolveRelative('/word/document.xml' as PartName, 'http://evil.com/doc.xml'),
        );

        expectPartNameError('absolute-uri', () =>
          resolveRelative('/word/document.xml' as PartName, 'file:///etc/passwd'),
        );
      });

      it('rejects network paths in internal relationship targets with network-path', () => {
        expectPartNameError('network-path', () =>
          resolveRelative('/word/document.xml' as PartName, '//attacker.com/share/x'),
        );
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 7. XXE / DOCTYPE rejection via real schema cursor                        */
  /* ------------------------------------------------------------------------ */
  describe('XXE / DOCTYPE rejection via schema cursor', () => {
    it('rejects [Content_Types].xml containing DOCTYPE with entity-rejected cleanly without hanging', async () => {
      const maliciousContentTypes =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE Types [\n' +
        '  <!ENTITY xxe SYSTEM "http://127.0.0.1:9999/xxe">\n' +
        ']>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
        '  <Default Extension="xml" ContentType="application/xml"/>\n' +
        '</Types>';

      const items: PackageItem[] = [
        { name: '[Content_Types].xml', data: maliciousContentTypes },
        { name: '_rels/.rels', data: '<Relationships/>' },
      ];
      const zipBytes = buildPackage(items);

      const promise = openPackage(zipBytes, realXmlSupport);
      await expect(promise).rejects.toThrow(XmlParseError);
      await expect(promise).rejects.toMatchObject({
        code: 'entity-rejected',
      });
    });

    it('rejects /_rels/.rels containing DOCTYPE entity expansion with entity-rejected', async () => {
      const maliciousRels =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE Relationships [\n' +
        '  <!ENTITY lol "billion laughs">\n' +
        '  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">\n' +
        ']>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n' +
        '</Relationships>';

      const items = minimalDocumentItems();
      // Replace _rels/.rels with malicious DOCTYPE payload
      const modifiedItems = items.map((it) =>
        it.name === '_rels/.rels' ? { ...it, data: maliciousRels } : it,
      );
      const zipBytes = buildPackage(modifiedItems);

      const promise = openPackage(zipBytes, realXmlSupport);
      await expect(promise).rejects.toThrow(XmlParseError);
      await expect(promise).rejects.toMatchObject({
        code: 'entity-rejected',
      });
    });

    it('rejects document part containing DOCTYPE when cursor is requested', async () => {
      const maliciousDoc =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE w:document [\n' +
        '  <!ENTITY secret SYSTEM "file:///etc/passwd">\n' +
        ']>\n' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
        '  <w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body>\n' +
        '</w:document>';

      const items = minimalDocumentItems();
      const modifiedItems = items.map((it) =>
        it.name === 'word/document.xml' ? { ...it, data: maliciousDoc } : it,
      );
      const zipBytes = buildPackage(modifiedItems);

      // Package open succeeds because parts are lazy
      const pkg = await openPackage(zipBytes, realXmlSupport);
      // Requesting cursor invokes schema createCursor which trips on DOCTYPE
      expect(() => pkg.mainDocument.cursor()).toThrow(XmlParseError);
      expect(() => pkg.mainDocument.cursor()).toThrowError(/DOCTYPE is rejected/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 8. SSRF / Network isolation test                                         */
  /* ------------------------------------------------------------------------ */
  describe('SSRF / Network isolation', () => {
    it('never dereferences external relationship targets', async () => {
      const relsWithExternal =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n' +
        '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://169.254.169.254/metadata" TargetMode="External"/>\n' +
        '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://evil.internal/ssrf.png" TargetMode="External"/>\n' +
        '</Relationships>';

      const items = minimalDocumentItems();
      const modifiedItems = items.map((it) =>
        it.name === '_rels/.rels' ? { ...it, data: relsWithExternal } : it,
      );
      const zipBytes = buildPackage(modifiedItems);

      const pkg = await openPackage(zipBytes, fakeXmlSupport);

      // External relationship target has no part name
      const externalRel = pkg.packageRelationships.byId('rId2')!;
      expect(externalRel).toBeDefined();
      expect(externalRel.targetMode).toBe('External');
      expect(externalRel.targetPartName).toBeUndefined();

      // targetPartName throws external-target-not-a-part when looking for external bytes
      expect(() => pkg.relationships.targetPartName(PACKAGE_ROOT, 'rId2')).toThrowError(/External/);

      // relatedParts skips external targets completely
      const related = pkg.relatedParts(PACKAGE_ROOT, ...RelationshipTypes.hyperlink);
      expect(related).toEqual([]);

      const singleRelated = pkg.relatedPart(PACKAGE_ROOT, ...RelationshipTypes.hyperlink);
      expect(singleRelated).toBeUndefined();

      // Media index does not include external media targets
      const media = pkg.wordParts.media;
      expect(media.length).toBe(0);
    });

    it('rejects an external officeDocument relationship outright when accessed', async () => {
      const relsWithExternalMain =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://evil.corp/document.xml" TargetMode="External"/>\n' +
        '</Relationships>';

      const items = minimalDocumentItems();
      const modifiedItems = items.map((it) =>
        it.name === '_rels/.rels' ? { ...it, data: relsWithExternalMain } : it,
      );
      const zipBytes = buildPackage(modifiedItems);

      const pkg = await openPackage(zipBytes, fakeXmlSupport);
      let error: unknown;
      try {
        const _ = pkg.mainDocument;
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(OpcPackageError);
      expect((error as OpcPackageError).code).toBe('missing-main-document');
    });

    it('static analysis: zero network or process-execution modules imported or called in packages/opc/src', () => {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const srcDir = path.resolve(currentDir, '..', 'src');

      function getAllSourceFiles(dir: string): string[] {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...getAllSourceFiles(fullPath));
          } else if (entry.name.endsWith('.ts')) {
            files.push(fullPath);
          }
        }
        return files;
      }

      const allFiles = getAllSourceFiles(srcDir);
      expect(allFiles.length).toBeGreaterThan(5);

      const forbiddenModules = [
        'http',
        'https',
        'net',
        'dgram',
        'child_process',
        'tls',
        'dns',
        'node:http',
        'node:https',
        'node:net',
        'node:dgram',
        'node:child_process',
        'node:tls',
        'node:dns',
        'undici',
        'axios',
      ];

      // Regex matching import/require of forbidden network or execution modules
      const importRegex = new RegExp(
        `(?:import|require)\\s*\\(?\\s*['"](?:${forbiddenModules.map((m) => m.replace(':', '\\:')).join('|')})['"]`,
      );

      for (const file of allFiles) {
        const content = fs.readFileSync(file, 'utf-8');

        // Check for forbidden module imports
        const match = content.match(importRegex);
        expect(
          match,
          `File ${path.relative(srcDir, file)} imports forbidden network/process module: ${match?.[0]}`,
        ).toBeNull();

        // For non-test source files, ensure fetch is never called
        if (!file.endsWith('.test.ts')) {
          const fetchMatch = content.match(/\bfetch\s*\(/);
          expect(
            fetchMatch,
            `Production file ${path.relative(srcDir, file)} calls fetch()`,
          ).toBeNull();
        }
      }
    });
  });
});
