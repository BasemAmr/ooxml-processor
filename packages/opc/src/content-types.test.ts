import { describe, expect, it } from 'vitest';

import { ContentTypes } from './content-types.js';
import { OpcContentTypeError, OpcPackageError, type ContentTypeErrorCode } from './errors.js';
import { DEFAULT_OPC_LIMITS } from './limits.js';
import { openPackage } from './package.js';
import { validatePartName, type PartName } from './partname.js';
import { fakeXmlSupport } from './testing/fake-xml.js';
import { buildPackage } from './testing/zip-fixtures.js';

const part = (name: string): PartName => validatePartName(name);

function expectContentTypeCode(code: ContentTypeErrorCode, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(OpcContentTypeError);
    expect((error as OpcContentTypeError).code).toBe(code);
    return;
  }
  throw new Error(`expected an OpcContentTypeError with code ${code}, but nothing threw`);
}

describe('[Content_Types].xml resolution', () => {
  describe('ECMA-376 §10.1.2.3: Override ALWAYS beats Default regardless of appearance order', () => {
    it('prefers Override when Default appears before Override', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);

      expect(ct.contentTypeFor(part('/word/document.xml'))).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
      expect(ct.contentTypeFor(part('/word/settings.xml'))).toBe('application/xml');
    });

    it('prefers Override when Override appears before Default', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);

      expect(ct.contentTypeFor(part('/word/document.xml'))).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
      expect(ct.contentTypeFor(part('/word/settings.xml'))).toBe('application/xml');
    });
  });

  describe('case-insensitive extension matching', () => {
    it('matches uppercase or mixed-case extension to lowercase Default extension', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);

      expect(ct.contentTypeFor(part('/word/media/image1.png'))).toBe('image/png');
      expect(ct.contentTypeFor(part('/word/media/image2.PNG'))).toBe('image/png');
      expect(ct.contentTypeFor(part('/word/media/image3.PnG'))).toBe('image/png');
      expect(ct.contentTypeFor(part('/_rels/.RELS'))).toBe(
        'application/vnd.openxmlformats-package.relationships+xml',
      );
    });

    it('matches lowercase extension when Default was declared in uppercase', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="PNG" ContentType="image/png"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);

      expect(ct.contentTypeFor(part('/word/media/image.png'))).toBe('image/png');
    });
  });

  describe('case-insensitive part-name matching for Override', () => {
    it('matches part name regardless of segment casing', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);

      expect(ct.contentTypeFor(part('/word/document.xml'))).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
      expect(ct.contentTypeFor(part('/WORD/DOCUMENT.XML'))).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
      expect(ct.contentTypeFor(part('/Word/Document.xml'))).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
    });
  });

  describe('unmatched part error handling', () => {
    it('raises typed OpcContentTypeError naming the part when no Default or Override applies', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);

      const targetPart = part('/word/media/image1.emf');
      try {
        ct.contentTypeFor(targetPart);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpcContentTypeError);
        const ctErr = err as OpcContentTypeError;
        expect(ctErr.code).toBe('no-content-type-for-part');
        expect(ctErr.kind).toBe('content-type');
        expect(ctErr.subject).toBe(targetPart);
        expect(ctErr.message).toContain('/word/media/image1.emf');
      }
    });

    it('raises typed OpcContentTypeError for a part without extension and no Override', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);

      const targetPart = part('/word/noextension');
      try {
        ct.contentTypeFor(targetPart);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpcContentTypeError);
        const ctErr = err as OpcContentTypeError;
        expect(ctErr.code).toBe('no-content-type-for-part');
        expect(ctErr.subject).toBe(targetPart);
      }
    });
  });

  describe('syntax and schema validation', () => {
    it('rejects duplicate Default for the same extension case-insensitively', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="PNG" ContentType="image/x-png"/>
</Types>`;
      expectContentTypeCode('duplicate-default', () => ContentTypes.parse(xml, fakeXmlSupport));
    });

    it('rejects duplicate Override for the same part name case-insensitively', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/xml"/>
  <Override PartName="/WORD/DOCUMENT.XML" ContentType="application/xml"/>
</Types>`;
      expectContentTypeCode('duplicate-override', () => ContentTypes.parse(xml, fakeXmlSupport));
    });

    it('rejects missing required attributes', () => {
      const missingExt = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default ContentType="image/png"/>
</Types>`;
      expectContentTypeCode('missing-attribute', () =>
        ContentTypes.parse(missingExt, fakeXmlSupport),
      );

      const missingCt = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml"/>
</Types>`;
      expectContentTypeCode('missing-attribute', () =>
        ContentTypes.parse(missingCt, fakeXmlSupport),
      );
    });

    it('rejects invalid Extension (e.g. leading dot or invalid characters)', () => {
      const leadingDot = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".png" ContentType="image/png"/>
</Types>`;
      expectContentTypeCode('invalid-extension', () =>
        ContentTypes.parse(leadingDot, fakeXmlSupport),
      );
    });

    it('rejects invalid ContentType format', () => {
      const badCt = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="png" ContentType="not-a-media-type"/>
</Types>`;
      expectContentTypeCode('invalid-content-type', () =>
        ContentTypes.parse(badCt, fakeXmlSupport),
      );
    });

    it('accepts ContentType with leading/trailing whitespace by trimming for check but preserving verbatim', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="png" ContentType=" image/png "/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);
      expect(ct.contentTypeFor(part('/media/test.png'))).toBe(' image/png ');
    });

    it('rejects invalid root element or namespace', () => {
      const badRoot = `<WrongRoot xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
      expectContentTypeCode('malformed', () => ContentTypes.parse(badRoot, fakeXmlSupport));

      const badNs = `<Types xmlns="http://schemas.openxmlformats.org/wrong/namespace"/>`;
      expectContentTypeCode('malformed', () => ContentTypes.parse(badNs, fakeXmlSupport));
    });

    it('rejects unknown child elements', () => {
      const badChild = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <UnknownChild/>
</Types>`;
      expectContentTypeCode('malformed', () => ContentTypes.parse(badChild, fakeXmlSupport));
    });
  });

  describe('mutation, preservation and serialization', () => {
    it('preserves unknown attributes and declaration order across serialize', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="png" ContentType="image/png" customAttr="customVal"/>
  <Override PartName="/word/document.xml" ContentType="application/xml"/>
</Types>`;
      const ct = ContentTypes.parse(xml, fakeXmlSupport);
      expect(ct.dirty).toBe(false);

      // Add a new default
      ct.setDefault('jpeg', 'image/jpeg');
      expect(ct.dirty).toBe(true);

      const serialized = ct.serialize(fakeXmlSupport);
      expect(serialized).toContain('customAttr="customVal"');
      expect(serialized).toContain('Extension="jpeg"');
    });
  });

  describe('absent or malformed [Content_Types].xml in openPackage', () => {
    it('throws typed OpcPackageError when [Content_Types].xml is absent from package', async () => {
      const zipBytes = buildPackage([{ name: 'word/document.xml', data: '<w:document/>' }]);

      try {
        await openPackage(zipBytes, fakeXmlSupport, DEFAULT_OPC_LIMITS);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpcPackageError);
        expect((err as OpcPackageError).code).toBe('missing-content-types');
      }
    });

    it('throws typed OpcContentTypeError before other operations when [Content_Types].xml is malformed', async () => {
      const zipBytes = buildPackage([
        { name: '[Content_Types].xml', data: '<InvalidRoot/>' },
        { name: 'word/document.xml', data: '<w:document/>' },
      ]);

      try {
        await openPackage(zipBytes, fakeXmlSupport, DEFAULT_OPC_LIMITS);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpcContentTypeError);
        expect((err as OpcContentTypeError).code).toBe('malformed');
      }
    });
  });
});
