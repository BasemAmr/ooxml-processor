import { crc32, encodeXmlText, writeZip, type ZipWriteEntry } from '@ooxml/opc';

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const PACKAGE_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body><w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>' +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
  '</w:body></w:document>';

function entry(name: string, text: string): ZipWriteEntry {
  const bytes = encodeXmlText(text);
  const nameBytes = new TextEncoder().encode(name);
  return {
    nameBytes,
    method: 0,
    flags: 0,
    versionMadeBy: 20,
    versionNeeded: 20,
    dosTime: 0,
    dosDate: 0,
    crc32: crc32(bytes),
    uncompressedSize: bytes.length,
    compressedData: bytes,
    localExtra: new Uint8Array(),
    centralExtra: new Uint8Array(),
    comment: new Uint8Array(),
    internalAttributes: 0,
    externalAttributes: 0,
  };
}

/**
 * Builds a minimal, ordinary OPC package. The package layer has no package
 * builder, so this uses its public ZIP writer rather than inventing an
 * unexported ContentTypes/package constructor.
 */
export function createBlankDocument(): Uint8Array {
  return writeZip([
    entry('[Content_Types].xml', CONTENT_TYPES_XML),
    entry('_rels/.rels', PACKAGE_RELS_XML),
    entry('word/document.xml', DOCUMENT_XML),
  ]);
}

export const blankDocumentBytes = createBlankDocument;
