/**
 * `@ooxml/opc` — the Open Packaging Conventions layer.
 *
 * ECMA-376 Part 2 / ISO/IEC 29500-2. Everything between "a `Uint8Array` that
 * might be a `.docx`" and "a graph of named, typed parts" lives here: the ZIP
 * container, `[Content_Types].xml`, the `_rels` relationship graph, and the
 * part-name grammar that is the security boundary for all three.
 *
 * Nothing in this package knows what WordprocessingML is. It knows that
 * `/word/document.xml` is a part with a content type and some relationships;
 * what the part *means* is `@ooxml/wml`'s problem. The one concession is
 * `rel-types.ts`, which carries the well-known relationship type URIs so that
 * "find the main document part" does not require a string literal at every call
 * site.
 *
 * The entry points are {@link openPackage} and {@link savePackage}. Both take an
 * injected {@link XmlSupport} rather than importing a parser — see
 * `xml-support.ts` for why.
 */

export {
  OpcError,
  OpcPartNameError,
  OpcZipError,
  OpcLimitError,
  OpcEncryptedPackageError,
  OpcContentTypeError,
  OpcRelationshipError,
  OpcPackageError,
} from './errors.js';
export type {
  OpcErrorKind,
  PartNameErrorCode,
  ZipErrorCode,
  OpcLimitName,
  ContentTypeErrorCode,
  RelationshipErrorCode,
  PackageErrorCode,
} from './errors.js';

export {
  PACKAGE_ROOT,
  DEFAULT_MAX_PART_NAME_LENGTH,
  validatePartName,
  isValidPartName,
  isPackageRoot,
  asciiLowerCase,
  canonicalPartName,
  partNamesEqual,
  partNameFolder,
  partNameLastSegment,
  partNameExtension,
  resolveRelative,
  relsPartNameFor,
  sourceOfRelsPart,
  isRelationshipPartName,
} from './partname.js';
export type { PartName, PackageRoot, RelationshipSource, PartNameOptions } from './partname.js';

export { DEFAULT_OPC_LIMITS, resolveLimits } from './limits.js';
export type { OpcLimits } from './limits.js';

export {
  CONTENT_TYPES_ITEM_NAME,
  METHOD_STORE,
  METHOD_DEFLATE,
  FLAG_UTF8_NAMES,
  readZip,
  writeZip,
  decompressEntry,
  deflateForEntry,
  createBudget,
  crc32,
} from './zip.js';
export type { ZipEntry, ZipArchive, ZipWriteEntry, DecompressionBudget } from './zip.js';

export {
  CONTENT_TYPES_NS,
  RELATIONSHIPS_NS,
  primeCursor,
  readRootElement,
  forEachChildElement,
  attributeValue,
  otherAttributes,
  writeAttributes,
} from './xml-support.js';
export type { XmlSupport, XmlStringSink } from './xml-support.js';

export { ContentTypes } from './content-types.js';
export type {
  ContentTypeDefault,
  ContentTypeOverride,
  ContentTypeDeclaration,
} from './content-types.js';

export { RelationshipSet, RelationshipGraph, isExternal } from './relationships.js';
export type { Relationship, TargetMode } from './relationships.js';

export { RelationshipTypes, MEDIA_RELATIONSHIP_TYPES } from './rel-types.js';
export type { RelationshipTypeName } from './rel-types.js';

export { openPackage, savePackage, decodeXmlText, encodeXmlText } from './package.js';
export type { OpcPackage, OpcPart, WordPartIndex } from './package.js';
