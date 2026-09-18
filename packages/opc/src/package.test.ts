import { describe, expect, it } from 'vitest';

import { openPackage, savePackage, type OpcSaveWarning } from './package.js';
import { RelationshipTypes } from './rel-types.js';
import { fakeXmlSupport } from './testing/fake-xml.js';
import { buildPackage, type PackageItem } from './testing/zip-fixtures.js';

/* -------------------------------------------------------------------------- */
/* Common XML templates                                                        */
/* -------------------------------------------------------------------------- */

const CONTENT_TYPES_HEADER =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
const RELS_HEADER =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

function minimalPackageItems(overrides?: {
  documentName?: string;
  relsContent?: string;
  documentContent?: string;
}): PackageItem[] {
  const docName = overrides?.documentName ?? 'word/document.xml';
  const relsContent =
    overrides?.relsContent ??
    `${RELS_HEADER}
  <Relationship Id="rId1" Type="${RelationshipTypes.officeDocument[0]}" Target="${docName}"/>
</Relationships>`;

  return [
    {
      name: '[Content_Types].xml',
      data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/${docName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: relsContent,
    },
    {
      name: docName,
      data:
        overrides?.documentContent ??
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
    },
  ];
}

describe('Package layer (Wave 3)', () => {
  describe('P2-06: Word part discovery', () => {
    it('discovers main document via officeDocument relationship regardless of non-conventional filename (/word/document2.xml)', async () => {
      const items = minimalPackageItems({
        documentName: 'word/document2.xml',
        relsContent: `${RELS_HEADER}
  <Relationship Id="rId1" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document2.xml"/>
</Relationships>`,
      });

      const pkg = await openPackage(buildPackage(items), fakeXmlSupport);
      expect(pkg.mainDocument.name).toBe('/word/document2.xml');
      expect(pkg.wordParts.mainDocument.name).toBe('/word/document2.xml');
    });

    it('indexes all standard word parts identically under Transitional and Strict URIs', async () => {
      // Build package with Transitional URIs
      const transitionalItems: PackageItem[] = [
        {
          name: '[Content_Types].xml',
          data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`,
        },
        {
          name: '_rels/.rels',
          data: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="${RelationshipTypes.coreProperties[0]}" Target="docProps/core.xml"/>
  <Relationship Id="rIdExt" Type="${RelationshipTypes.extendedProperties[0]}" Target="docProps/app.xml"/>
  <Relationship Id="rIdCust" Type="${RelationshipTypes.customProperties[0]}" Target="docProps/custom.xml"/>
</Relationships>`,
        },
        {
          name: 'word/document.xml',
          data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
        },
        {
          name: 'word/_rels/document.xml.rels',
          data: `${RELS_HEADER}
  <Relationship Id="r1" Type="${RelationshipTypes.styles[0]}" Target="styles.xml"/>
  <Relationship Id="r2" Type="${RelationshipTypes.numbering[0]}" Target="numbering.xml"/>
  <Relationship Id="r3" Type="${RelationshipTypes.settings[0]}" Target="settings.xml"/>
  <Relationship Id="r4" Type="${RelationshipTypes.webSettings[0]}" Target="webSettings.xml"/>
  <Relationship Id="r5" Type="${RelationshipTypes.fontTable[0]}" Target="fontTable.xml"/>
  <Relationship Id="r6" Type="${RelationshipTypes.theme[0]}" Target="theme/theme1.xml"/>
  <Relationship Id="r7" Type="${RelationshipTypes.footnotes[0]}" Target="footnotes.xml"/>
  <Relationship Id="r8" Type="${RelationshipTypes.endnotes[0]}" Target="endnotes.xml"/>
  <Relationship Id="r9" Type="${RelationshipTypes.comments[0]}" Target="comments.xml"/>
  <Relationship Id="r10" Type="${RelationshipTypes.glossaryDocument[0]}" Target="glossary/document.xml"/>
  <Relationship Id="r11" Type="${RelationshipTypes.header[0]}" Target="header1.xml"/>
  <Relationship Id="r12" Type="${RelationshipTypes.footer[0]}" Target="footer1.xml"/>
</Relationships>`,
        },
        { name: 'word/styles.xml', data: '<w:styles/>' },
        { name: 'word/numbering.xml', data: '<w:numbering/>' },
        { name: 'word/settings.xml', data: '<w:settings/>' },
        { name: 'word/webSettings.xml', data: '<w:webSettings/>' },
        { name: 'word/fontTable.xml', data: '<w:fontTable/>' },
        { name: 'word/theme/theme1.xml', data: '<a:theme/>' },
        { name: 'word/footnotes.xml', data: '<w:footnotes/>' },
        { name: 'word/endnotes.xml', data: '<w:endnotes/>' },
        { name: 'word/comments.xml', data: '<w:comments/>' },
        { name: 'word/glossary/document.xml', data: '<w:glossaryDocument/>' },
        { name: 'word/header1.xml', data: '<w:hdr/>' },
        { name: 'word/footer1.xml', data: '<w:ftr/>' },
        { name: 'docProps/core.xml', data: '<cp:coreProperties/>' },
        { name: 'docProps/app.xml', data: '<Properties/>' },
        { name: 'docProps/custom.xml', data: '<Properties/>' },
      ];

      const transPkg = await openPackage(buildPackage(transitionalItems), fakeXmlSupport);
      expect(transPkg.wordParts.styles?.name).toBe('/word/styles.xml');
      expect(transPkg.wordParts.numbering?.name).toBe('/word/numbering.xml');
      expect(transPkg.wordParts.settings?.name).toBe('/word/settings.xml');
      expect(transPkg.wordParts.webSettings?.name).toBe('/word/webSettings.xml');
      expect(transPkg.wordParts.fontTable?.name).toBe('/word/fontTable.xml');
      expect(transPkg.wordParts.theme?.name).toBe('/word/theme/theme1.xml');
      expect(transPkg.wordParts.footnotes?.name).toBe('/word/footnotes.xml');
      expect(transPkg.wordParts.endnotes?.name).toBe('/word/endnotes.xml');
      expect(transPkg.wordParts.comments?.name).toBe('/word/comments.xml');
      expect(transPkg.wordParts.glossaryDocument?.name).toBe('/word/glossary/document.xml');
      expect(transPkg.wordParts.headers.map((p) => p.name)).toEqual(['/word/header1.xml']);
      expect(transPkg.wordParts.footers.map((p) => p.name)).toEqual(['/word/footer1.xml']);
      expect(transPkg.wordParts.extendedProperties?.name).toBe('/docProps/app.xml');
      expect(transPkg.wordParts.customProperties?.name).toBe('/docProps/custom.xml');

      // Build package with Strict URIs (using index 1 of dual-dialect tuples)
      const strictItems: PackageItem[] = [
        ...transitionalItems.filter(
          (item) => item.name !== '_rels/.rels' && item.name !== 'word/_rels/document.xml.rels',
        ),
        {
          name: '_rels/.rels',
          data: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[1]}" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="${RelationshipTypes.coreProperties[0]}" Target="docProps/core.xml"/>
  <Relationship Id="rIdExt" Type="${RelationshipTypes.extendedProperties[1]}" Target="docProps/app.xml"/>
  <Relationship Id="rIdCust" Type="${RelationshipTypes.customProperties[1]}" Target="docProps/custom.xml"/>
</Relationships>`,
        },
        {
          name: 'word/_rels/document.xml.rels',
          data: `${RELS_HEADER}
  <Relationship Id="r1" Type="${RelationshipTypes.styles[1]}" Target="styles.xml"/>
  <Relationship Id="r2" Type="${RelationshipTypes.numbering[1]}" Target="numbering.xml"/>
  <Relationship Id="r3" Type="${RelationshipTypes.settings[1]}" Target="settings.xml"/>
  <Relationship Id="r4" Type="${RelationshipTypes.webSettings[1]}" Target="webSettings.xml"/>
  <Relationship Id="r5" Type="${RelationshipTypes.fontTable[1]}" Target="fontTable.xml"/>
  <Relationship Id="r6" Type="${RelationshipTypes.theme[1]}" Target="theme/theme1.xml"/>
  <Relationship Id="r7" Type="${RelationshipTypes.footnotes[1]}" Target="footnotes.xml"/>
  <Relationship Id="r8" Type="${RelationshipTypes.endnotes[1]}" Target="endnotes.xml"/>
  <Relationship Id="r9" Type="${RelationshipTypes.comments[1]}" Target="comments.xml"/>
  <Relationship Id="r10" Type="${RelationshipTypes.glossaryDocument[1]}" Target="glossary/document.xml"/>
  <Relationship Id="r11" Type="${RelationshipTypes.header[1]}" Target="header1.xml"/>
  <Relationship Id="r12" Type="${RelationshipTypes.footer[1]}" Target="footer1.xml"/>
</Relationships>`,
        },
      ];

      const strictPkg = await openPackage(buildPackage(strictItems), fakeXmlSupport);
      expect(strictPkg.wordParts.styles?.name).toBe('/word/styles.xml');
      expect(strictPkg.wordParts.numbering?.name).toBe('/word/numbering.xml');
      expect(strictPkg.wordParts.settings?.name).toBe('/word/settings.xml');
      expect(strictPkg.wordParts.webSettings?.name).toBe('/word/webSettings.xml');
      expect(strictPkg.wordParts.fontTable?.name).toBe('/word/fontTable.xml');
      expect(strictPkg.wordParts.theme?.name).toBe('/word/theme/theme1.xml');
      expect(strictPkg.wordParts.footnotes?.name).toBe('/word/footnotes.xml');
      expect(strictPkg.wordParts.endnotes?.name).toBe('/word/endnotes.xml');
      expect(strictPkg.wordParts.comments?.name).toBe('/word/comments.xml');
      expect(strictPkg.wordParts.glossaryDocument?.name).toBe('/word/glossary/document.xml');
      expect(strictPkg.wordParts.headers.map((p) => p.name)).toEqual(['/word/header1.xml']);
      expect(strictPkg.wordParts.footers.map((p) => p.name)).toEqual(['/word/footer1.xml']);
      expect(strictPkg.wordParts.extendedProperties?.name).toBe('/docProps/app.xml');
      expect(strictPkg.wordParts.customProperties?.name).toBe('/docProps/custom.xml');
    });

    it('discovers commentsExtended and people parts from main document', async () => {
      const items: PackageItem[] = [
        ...minimalPackageItems(),
        {
          name: 'word/_rels/document.xml.rels',
          data: `${RELS_HEADER}
  <Relationship Id="rExt" Type="${RelationshipTypes.commentsExtended[0]}" Target="commentsExtended.xml"/>
  <Relationship Id="rPeople" Type="${RelationshipTypes.people[0]}" Target="people.xml"/>
</Relationships>`,
        },
        {
          name: 'word/commentsExtended.xml',
          data: '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>',
        },
        {
          name: 'word/people.xml',
          data: '<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>',
        },
      ];

      const pkg = await openPackage(buildPackage(items), fakeXmlSupport);
      expect(pkg.wordParts.commentsExtended?.name).toBe('/word/commentsExtended.xml');
      expect(pkg.wordParts.people?.name).toBe('/word/people.xml');
    });

    it('discovers digitalSignatureOrigin and digitalSignatures from package root and origin', async () => {
      const items: PackageItem[] = [
        {
          name: '[Content_Types].xml',
          data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="sigs" ContentType="application/vnd.openxmlformats-package.digital-signature-origin"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
        },
        {
          name: '_rels/.rels',
          data: `${RELS_HEADER}
  <Relationship Id="rId1" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rOrigin" Type="${RelationshipTypes.digitalSignatureOrigin[0]}" Target="_xmlsignatures/origin.sigs"/>
  <Relationship Id="rSigRoot" Type="${RelationshipTypes.digitalSignature[0]}" Target="_xmlsignatures/sig2.xml"/>
</Relationships>`,
        },
        {
          name: 'word/document.xml',
          data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
        },
        {
          name: '_xmlsignatures/origin.sigs',
          data: 'origin',
        },
        {
          name: '_xmlsignatures/_rels/origin.sigs.rels',
          data: `${RELS_HEADER}
  <Relationship Id="rSig1" Type="${RelationshipTypes.digitalSignature[0]}" Target="sig1.xml"/>
</Relationships>`,
        },
        {
          name: '_xmlsignatures/sig1.xml',
          data: '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>AAA</SignatureValue></Signature>',
        },
        {
          name: '_xmlsignatures/sig2.xml',
          data: '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>BBB</SignatureValue></Signature>',
        },
      ];

      const pkg = await openPackage(buildPackage(items), fakeXmlSupport);
      expect(pkg.wordParts.signatureOrigin?.name).toBe('/_xmlsignatures/origin.sigs');
      const sigNames = pkg.wordParts.signatures.map((s) => s.name);
      expect(sigNames).toContain('/_xmlsignatures/sig1.xml');
      expect(sigNames).toContain('/_xmlsignatures/sig2.xml');
      expect(sigNames.length).toBe(2);
    });
  });

  describe('P2-07: Core, app, and custom properties', () => {
    it('returns undefined when property parts are absent', async () => {
      const pkg = await openPackage(buildPackage(minimalPackageItems()), fakeXmlSupport);
      expect(pkg.coreProperties()).toBeUndefined();
      expect(pkg.extendedProperties()).toBeUndefined();
      expect(pkg.appProperties()).toBeUndefined();
      expect(pkg.customProperties()).toBeUndefined();
    });

    it('reads Dublin Core and OpenXML core properties with typed dates', async () => {
      const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Test Document Title</dc:title>
  <dc:subject>Test Subject</dc:subject>
  <dc:creator>Alice Developer</dc:creator>
  <dc:description>A comprehensive description</dc:description>
  <cp:keywords>keyword1, keyword2</cp:keywords>
  <cp:lastModifiedBy>Bob Engineer</cp:lastModifiedBy>
  <cp:revision>4</cp:revision>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-09-18T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-18T07:00:00Z</dcterms:modified>
</cp:coreProperties>`;

      const items: PackageItem[] = [
        ...minimalPackageItems({
          relsContent: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="${RelationshipTypes.coreProperties[0]}" Target="docProps/core.xml"/>
</Relationships>`,
        }),
        { name: 'docProps/core.xml', data: coreXml },
      ];

      const pkg = await openPackage(buildPackage(items), fakeXmlSupport);
      const core = pkg.coreProperties();
      expect(core).toBeDefined();
      expect(core?.title).toBe('Test Document Title');
      expect(core?.subject).toBe('Test Subject');
      expect(core?.creator).toBe('Alice Developer');
      expect(core?.description).toBe('A comprehensive description');
      expect(core?.keywords).toBe('keyword1, keyword2');
      expect(core?.lastModifiedBy).toBe('Bob Engineer');
      expect(core?.revision).toBe('4');
      expect(core?.created).toEqual(new Date('2026-09-18T00:00:00Z'));
      expect(core?.modified).toEqual(new Date('2026-09-18T07:00:00Z'));
    });

    it('reads extended (app) properties with typed numbers and booleans', async () => {
      const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Template>Normal.dotm</Template>
  <TotalTime>120</TotalTime>
  <Pages>15</Pages>
  <Words>4500</Words>
  <Characters>25000</Characters>
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <Lines>350</Lines>
  <Paragraphs>180</Paragraphs>
  <ScaleCrop>false</ScaleCrop>
  <Company>DeepMind</Company>
  <LinksUpToDate>true</LinksUpToDate>
  <CharactersWithSpaces>29500</CharactersWithSpaces>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>`;

      const items: PackageItem[] = [
        ...minimalPackageItems({
          relsContent: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rIdApp" Type="${RelationshipTypes.extendedProperties[0]}" Target="docProps/app.xml"/>
</Relationships>`,
        }),
        { name: 'docProps/app.xml', data: appXml },
      ];

      const pkg = await openPackage(buildPackage(items), fakeXmlSupport);
      const app = pkg.extendedProperties();
      expect(app).toBeDefined();
      expect(pkg.appProperties()).toEqual(app);
      expect(app?.application).toBe('Microsoft Office Word');
      expect(app?.appVersion).toBe('16.0000');
      expect(app?.company).toBe('DeepMind');
      expect(app?.pages).toBe(15);
      expect(app?.words).toBe(4500);
      expect(app?.characters).toBe(25000);
      expect(app?.charactersWithSpaces).toBe(29500);
      expect(app?.lines).toBe(350);
      expect(app?.paragraphs).toBe(180);
      expect(app?.totalTime).toBe(120);
      expect(app?.scaleCrop).toBe(false);
      expect(app?.linksUpToDate).toBe(true);
    });

    it('reads custom properties with typed boolean, number, string, and Date values', async () => {
      const customXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="IsConfidential">
    <vt:bool>true</vt:bool>
  </property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="DocumentVersion">
    <vt:i4>42</vt:i4>
  </property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="4" name="ProjectName">
    <vt:lpwstr>Project Antigravity</vt:lpwstr>
  </property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="5" name="ReviewDate">
    <vt:filetime>2026-09-18T10:30:00Z</vt:filetime>
  </property>
</Properties>`;

      const items: PackageItem[] = [
        ...minimalPackageItems({
          relsContent: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rIdCustom" Type="${RelationshipTypes.customProperties[0]}" Target="docProps/custom.xml"/>
</Relationships>`,
        }),
        { name: 'docProps/custom.xml', data: customXml },
      ];

      const pkg = await openPackage(buildPackage(items), fakeXmlSupport);
      const custom = pkg.customProperties();
      expect(custom).toBeDefined();
      expect(custom?.length).toBe(4);

      const propBool = custom?.find((p) => p.name === 'IsConfidential');
      expect(propBool?.fmtid).toBe('{D5CDD505-2E9C-101B-9397-08002B2CF9AE}');
      expect(propBool?.pid).toBe(2);
      expect(propBool?.value).toBe(true);

      const propNum = custom?.find((p) => p.name === 'DocumentVersion');
      expect(propNum?.fmtid).toBe('{D5CDD505-2E9C-101B-9397-08002B2CF9AE}');
      expect(propNum?.pid).toBe(3);
      expect(propNum?.value).toBe(42);

      const propStr = custom?.find((p) => p.name === 'ProjectName');
      expect(propStr?.fmtid).toBe('{D5CDD505-2E9C-101B-9397-08002B2CF9AE}');
      expect(propStr?.pid).toBe(4);
      expect(propStr?.value).toBe('Project Antigravity');

      const propDate = custom?.find((p) => p.name === 'ReviewDate');
      expect(propDate?.fmtid).toBe('{D5CDD505-2E9C-101B-9397-08002B2CF9AE}');
      expect(propDate?.pid).toBe(5);
      expect(propDate?.value).toEqual(new Date('2026-09-18T10:30:00Z'));
    });

    it('verifies unedited round-trip leaves property bytes byte-identical', async () => {
      const coreXml = `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Preserved Title</dc:title>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-18T07:00:00Z</dcterms:modified>
</cp:coreProperties>`;

      const items: PackageItem[] = [
        ...minimalPackageItems({
          relsContent: `${RELS_HEADER}
  <Relationship Id="rIdDoc" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="${RelationshipTypes.coreProperties[0]}" Target="docProps/core.xml"/>
</Relationships>`,
        }),
        { name: 'docProps/core.xml', data: coreXml },
      ];

      const initialZip = buildPackage(items);
      const pkg = await openPackage(initialZip, fakeXmlSupport);

      // Access property accessors (read-only)
      expect(pkg.coreProperties()?.title).toBe('Preserved Title');
      expect(pkg.wordParts.coreProperties?.text()).toBe(coreXml);

      // Save without editing
      const savedBytes = await pkg.save();

      // Open saved package and verify byte-for-byte equality of core.xml
      const reloaded = await openPackage(savedBytes, fakeXmlSupport);
      const originalPart = pkg.requirePart('/docProps/core.xml');
      const reloadedPart = reloaded.requirePart('/docProps/core.xml');

      expect(reloadedPart.bytes()).toEqual(originalPart.bytes());
      expect(reloadedPart.text()).toBe(coreXml);
      expect(reloadedPart.text()).toContain('xsi:type="dcterms:W3CDTF"');
      expect(reloadedPart.text()).toContain('<dcterms:modified');

      // The whole archive bytes are also identical
      expect(savedBytes).toEqual(initialZip);
    });
  });

  describe('P2-08: Digital signature parts & Policy B', () => {
    function signedPackageItems(): PackageItem[] {
      return [
        {
          name: '[Content_Types].xml',
          data: `${CONTENT_TYPES_HEADER}
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="sigs" ContentType="application/vnd.openxmlformats-package.digital-signature-origin"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/_xmlsignatures/origin.sigs" ContentType="application/vnd.openxmlformats-package.digital-signature-origin"/>
  <Override PartName="/_xmlsignatures/sig1.xml" ContentType="application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"/>
</Types>`,
        },
        {
          name: '_rels/.rels',
          data: `${RELS_HEADER}
  <Relationship Id="rId1" Type="${RelationshipTypes.officeDocument[0]}" Target="word/document.xml"/>
  <Relationship Id="rOrigin" Type="${RelationshipTypes.digitalSignatureOrigin[0]}" Target="_xmlsignatures/origin.sigs"/>
</Relationships>`,
        },
        {
          name: 'word/document.xml',
          data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Signed text</w:t></w:r></w:p></w:body></w:document>',
        },
        {
          name: '_xmlsignatures/origin.sigs',
          data: 'origin-data',
        },
        {
          name: '_xmlsignatures/_rels/origin.sigs.rels',
          data: `${RELS_HEADER}
  <Relationship Id="rSig1" Type="${RelationshipTypes.digitalSignature[0]}" Target="sig1.xml"/>
</Relationships>`,
        },
        {
          name: '_xmlsignatures/sig1.xml',
          data: '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>12345</SignatureValue></Signature>',
        },
      ];
    }

    it('unedited save preserves signature parts byte-for-byte in original order', async () => {
      const items = signedPackageItems();
      const initialZip = buildPackage(items);

      const pkg = await openPackage(initialZip, fakeXmlSupport);
      expect(pkg.wordParts.signatureOrigin).toBeDefined();
      expect(pkg.wordParts.signatures.length).toBe(1);

      // Save without modifications
      const savedZip = await pkg.save();

      // Byte-for-byte exact equality of the whole archive
      expect(savedZip).toEqual(initialZip);

      const reloaded = await openPackage(savedZip, fakeXmlSupport);
      expect(reloaded.wordParts.signatureOrigin?.name).toBe('/_xmlsignatures/origin.sigs');
      expect(reloaded.wordParts.signatures.map((s) => s.name)).toEqual([
        '/_xmlsignatures/sig1.xml',
      ]);
      expect(reloaded.requirePart('/_xmlsignatures/sig1.xml').text()).toContain('12345');
    });

    it('edited save strips signature parts and relationships when a part was modified, emitting OpcSaveWarning', async () => {
      const items = signedPackageItems();
      const initialZip = buildPackage(items);

      const pkg = await openPackage(initialZip, fakeXmlSupport);
      expect(pkg.wordParts.signatures.length).toBe(1);

      // Modify the main document part
      const newDocText =
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Edited text</w:t></w:r></w:p></w:body></w:document>';
      pkg.mainDocument.replaceBytes(new TextEncoder().encode(newDocText));

      const warnings: OpcSaveWarning[] = [];
      const savedZip = await pkg.save({
        onWarning: (w) => warnings.push(w),
      });

      // Verify warning emitted
      expect(warnings.length).toBe(1);
      const warn = warnings[0];
      expect(warn?.code).toBe('digital-signatures-stripped');
      expect(warn?.strippedSignatures).toContain('/_xmlsignatures/sig1.xml');
      expect(pkg.lastSaveWarnings).toEqual(warnings);

      // Reload saved archive and assert signature parts and relationships are gone
      const reloaded = await openPackage(savedZip, fakeXmlSupport);
      expect(reloaded.wordParts.signatureOrigin).toBeUndefined();
      expect(reloaded.wordParts.signatures).toEqual([]);
      expect(reloaded.getPart('/_xmlsignatures/origin.sigs')).toBeUndefined();
      expect(reloaded.getPart('/_xmlsignatures/sig1.xml')).toBeUndefined();
      expect(reloaded.getPart('/_xmlsignatures/_rels/origin.sigs.rels')).toBeUndefined();

      // Package-level relationships no longer contain digital signature origin or signature
      const sigRels = [
        ...reloaded.packageRelationships.byType(...RelationshipTypes.digitalSignatureOrigin),
        ...reloaded.packageRelationships.byType(...RelationshipTypes.digitalSignature),
      ];
      expect(sigRels).toEqual([]);

      // Edited content is preserved
      expect(reloaded.mainDocument.text()).toBe(newDocText);
    });

    it('edited save strips signatures when package relationships are modified', async () => {
      const items = signedPackageItems();
      const initialZip = buildPackage(items);

      const pkg = await openPackage(initialZip, fakeXmlSupport);

      // Add a relationship to package root
      pkg.packageRelationships.add({
        id: 'rIdNew',
        type: 'http://example.com/custom-rel',
        target: 'custom.xml',
        targetMode: 'Internal',
        targetModeExplicit: false,
        targetPartName: undefined,
        unknownAttributes: [],
        text: '',
      });

      const warnings: OpcSaveWarning[] = [];
      const savedZip = await pkg.save({
        onWarning: (w) => warnings.push(w),
      });

      expect(warnings.length).toBe(1);
      expect(warnings[0]?.code).toBe('digital-signatures-stripped');

      const reloaded = await openPackage(savedZip, fakeXmlSupport);
      expect(reloaded.wordParts.signatureOrigin).toBeUndefined();
      expect(reloaded.wordParts.signatures).toEqual([]);
      expect(reloaded.getPart('/_xmlsignatures/sig1.xml')).toBeUndefined();
    });

    it('edited save on an unsigned package emits no warnings and strips nothing', async () => {
      const items = minimalPackageItems();
      const pkg = await openPackage(buildPackage(items), fakeXmlSupport);

      pkg.mainDocument.replaceBytes(
        new TextEncoder().encode(
          '<w:document><w:body><w:p><w:t>Hello</w:t></w:p></w:body></w:document>',
        ),
      );

      const warnings: OpcSaveWarning[] = [];
      const savedZip = await pkg.save({
        onWarning: (w) => warnings.push(w),
      });

      expect(warnings).toEqual([]);
      expect(pkg.lastSaveWarnings).toEqual([]);

      const reloaded = await openPackage(savedZip, fakeXmlSupport);
      expect(reloaded.mainDocument.text()).toContain('Hello');
    });
  });
});
