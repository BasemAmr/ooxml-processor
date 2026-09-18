/**
 * Serialization-time namespace facts: conventional prefixes, and the two W3C
 * built-ins that the XML specification binds implicitly.
 *
 * This is deliberately *not* the dialect table. The authoritative
 * logical-namespace ↔ dialect ↔ URI mapping lives in `packages/codegen`
 * (`src/namespaces.ts`) and is build-time only; `packages/codegen` is never
 * shipped to the browser, so the runtime cannot import it. What the runtime
 * needs at write time is much smaller: given a URI, what prefix would Word have
 * written? That is all this file answers.
 *
 * Why it matters at all: any prefix binding is legal XML, so `ns1:p` and `w:p`
 * are the same element. But a document full of `ns1:`/`ns2:` prefixes diffs
 * badly against the original, is unreadable when someone unzips the package to
 * inspect it, and — the practical reason — makes it much harder to tell a real
 * round-trip regression from cosmetic churn. Writing back the prefixes Word
 * writes keeps the diff to the bytes that actually changed.
 *
 * If codegen later emits a generated namespace table into
 * `packages/schema/src/generated/`, this table becomes its fallback for URIs the
 * generator has no binding for (the Microsoft extension namespaces, chiefly).
 */

import type { NamespaceUri } from './xml.js';

/**
 * The XML namespace. Bound to the `xml` prefix implicitly by the Namespaces in
 * XML specification: it must never be declared and must never be rebound.
 * `xml:space="preserve"` on `w:t` is the load-bearing use in WordprocessingML —
 * without it, a run whose text is a single space loses the space on reparse.
 */
export const XML_NAMESPACE: NamespaceUri = 'http://www.w3.org/XML/1998/namespace';

/**
 * The namespace of namespace declarations themselves. `xmlns:w="…"` is an
 * attribute in this namespace. The cursor lifts those out of the attribute list
 * into `XmlStartElement.nsDeclarations`, so this URI should never appear on an
 * `XmlAttr` — it is exported so the sink can assert that.
 */
export const XMLNS_NAMESPACE: NamespaceUri = 'http://www.w3.org/2000/xmlns/';

/** Markup Compatibility (ECMA-376 Part 3). Identical in both dialects. */
export const MC_NAMESPACE: NamespaceUri =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';

/**
 * URI → the prefix Word conventionally uses for it.
 *
 * Both dialects are listed where both exist, mapping to the same prefix: a
 * Strict package written by Word uses the same `w:`/`a:`/`r:` prefixes against
 * the `purl.oclc.org` URIs.
 *
 * Collisions are real and deliberate — `x` is both VML-Excel and SpreadsheetML,
 * `cp` is both OPC core properties and the doc-props custom part. They never
 * co-occur in a `.docx` part, but the sink does not rely on that: it suffixes a
 * digit if a wanted prefix is already bound to a different URI in scope.
 */
export const CONVENTIONAL_PREFIXES: ReadonlyMap<NamespaceUri, string> = new Map([
  // --- WordprocessingML ---
  ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w'],
  ['http://purl.oclc.org/ooxml/wordprocessingml/main', 'w'],

  // --- DrawingML ---
  ['http://schemas.openxmlformats.org/drawingml/2006/main', 'a'],
  ['http://purl.oclc.org/ooxml/drawingml/main', 'a'],
  ['http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'wp'],
  ['http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing', 'wp'],
  ['http://schemas.openxmlformats.org/drawingml/2006/picture', 'pic'],
  ['http://purl.oclc.org/ooxml/drawingml/picture', 'pic'],
  ['http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas', 'lc'],
  ['http://purl.oclc.org/ooxml/drawingml/lockedCanvas', 'lc'],
  ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'c'],
  ['http://purl.oclc.org/ooxml/drawingml/chart', 'c'],
  ['http://schemas.openxmlformats.org/drawingml/2006/chartDrawing', 'cdr'],
  ['http://purl.oclc.org/ooxml/drawingml/chartDrawing', 'cdr'],
  ['http://schemas.openxmlformats.org/drawingml/2006/diagram', 'dgm'],
  ['http://purl.oclc.org/ooxml/drawingml/diagram', 'dgm'],
  ['http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', 'xdr'],
  ['http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing', 'xdr'],

  // --- Shared / officeDocument ---
  ['http://schemas.openxmlformats.org/officeDocument/2006/sharedTypes', 's'],
  ['http://purl.oclc.org/ooxml/officeDocument/sharedTypes', 's'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r'],
  ['http://purl.oclc.org/ooxml/officeDocument/relationships', 'r'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/math', 'm'],
  ['http://purl.oclc.org/ooxml/officeDocument/math', 'm'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/bibliography', 'b'],
  ['http://purl.oclc.org/ooxml/officeDocument/bibliography', 'b'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/characteristics', 'ac'],
  ['http://purl.oclc.org/ooxml/officeDocument/characteristics', 'ac'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/customXml', 'ds'],
  ['http://purl.oclc.org/ooxml/officeDocument/customXml', 'ds'],
  ['http://schemas.openxmlformats.org/schemaLibrary/2006/main', 'sl'],
  ['http://purl.oclc.org/ooxml/schemaLibrary/main', 'sl'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/custom-properties', 'cp'],
  ['http://purl.oclc.org/ooxml/officeDocument/customProperties', 'cp'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/extended-properties', 'ep'],
  ['http://purl.oclc.org/ooxml/officeDocument/extendedProperties', 'ep'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes', 'vt'],
  ['http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes', 'vt'],

  // --- VML. Transitional only; Strict drops it entirely. ---
  ['urn:schemas-microsoft-com:vml', 'v'],
  ['urn:schemas-microsoft-com:office:office', 'o'],
  ['urn:schemas-microsoft-com:office:word', 'w10'],
  ['urn:schemas-microsoft-com:office:excel', 'x'],
  ['urn:schemas-microsoft-com:office:powerpoint', 'pp'],

  // --- OPC. Dialect-independent. ---
  ['http://schemas.openxmlformats.org/package/2006/content-types', 'ct'],
  ['http://schemas.openxmlformats.org/package/2006/relationships', 'pr'],
  ['http://schemas.openxmlformats.org/package/2006/metadata/core-properties', 'cp'],
  ['http://schemas.openxmlformats.org/package/2006/digital-signature', 'dsig'],

  // --- Markup Compatibility and W3C built-ins ---
  [MC_NAMESPACE, 'mc'],
  [XML_NAMESPACE, 'xml'],
  ['http://www.w3.org/2001/XMLSchema-instance', 'xsi'],
  ['http://purl.org/dc/elements/1.1/', 'dc'],
  ['http://purl.org/dc/terms/', 'dcterms'],

  // --- Microsoft Word extension namespaces. Not in ECMA-376 at all. ---
  // No generated types exist for these; their content is captured as RawNode
  // and replayed verbatim, which is precisely why their prefixes matter here.
  ['http://schemas.microsoft.com/office/word/2010/wordml', 'w14'],
  ['http://schemas.microsoft.com/office/word/2012/wordml', 'w15'],
  ['http://schemas.microsoft.com/office/word/2018/wordml', 'w16'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'wps'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingGroup', 'wpg'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas', 'wpc'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing', 'wp14'],
]);

/** The conventional prefix for a URI, or `undefined` if we have no opinion. */
export function conventionalPrefix(uri: NamespaceUri): string | undefined {
  return CONVENTIONAL_PREFIXES.get(uri);
}
