/**
 * The namespace binding table: logical token ↔ per-dialect URI ↔ conventional prefix.
 *
 * Hand-authored from the `targetNamespace` of all 51 vendored schemas, plus the
 * few namespaces that have no schema in the ECMA asset set (`mc`, `xml`, `xsi`,
 * the `w14`/`w15` Word extension namespaces).
 *
 * This table is the single place a namespace URI appears in the whole project.
 * Everything downstream — generated readers and writers, layout, paint, editor —
 * speaks in tokens. See `docs/adr/0008-dialect-handling.md`.
 *
 * Prefixes are the conventional ones Word emits. They are not normative (any
 * prefix binding is legal), but writing back what Word writes keeps diffs small
 * and keeps the output familiar to anyone inspecting it by hand.
 */

import type { LogicalNs, NamespaceBinding } from './ir.js';

/**
 * VML and the `o:`/`w10:` companion namespaces have no Strict counterpart —
 * Strict drops VML entirely. Types defined only in these namespaces carry
 * `dialects: ['transitional']` and the writer refuses to emit them into a
 * Strict package.
 */
export const NAMESPACES: readonly NamespaceBinding[] = [
  // --- WordprocessingML ---
  {
    token: 'wml',
    prefix: 'w',
    transitional: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    strict: 'http://purl.oclc.org/ooxml/wordprocessingml/main',
  },

  // --- DrawingML ---
  {
    token: 'dml-main',
    prefix: 'a',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    strict: 'http://purl.oclc.org/ooxml/drawingml/main',
  },
  {
    token: 'dml-wordprocessingDrawing',
    prefix: 'wp',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    strict: 'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing',
  },
  {
    token: 'dml-picture',
    prefix: 'pic',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    strict: 'http://purl.oclc.org/ooxml/drawingml/picture',
  },
  {
    token: 'dml-lockedCanvas',
    prefix: 'lc',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas',
    strict: 'http://purl.oclc.org/ooxml/drawingml/lockedCanvas',
  },
  {
    token: 'dml-chart',
    prefix: 'c',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    strict: 'http://purl.oclc.org/ooxml/drawingml/chart',
  },
  {
    token: 'dml-chartDrawing',
    prefix: 'cdr',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/chartDrawing',
    strict: 'http://purl.oclc.org/ooxml/drawingml/chartDrawing',
  },
  {
    token: 'dml-diagram',
    prefix: 'dgm',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
    strict: 'http://purl.oclc.org/ooxml/drawingml/diagram',
  },
  {
    token: 'dml-spreadsheetDrawing',
    prefix: 'xdr',
    transitional: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
    strict: 'http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing',
  },

  // --- Shared ---
  {
    token: 'shared-types',
    prefix: 's',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/sharedTypes',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/sharedTypes',
  },
  {
    token: 'relationships',
    prefix: 'r',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/relationships',
  },
  {
    token: 'math',
    prefix: 'm',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/math',
  },
  {
    token: 'bibliography',
    prefix: 'b',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/bibliography',
  },
  {
    token: 'characteristics',
    prefix: 'ac',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/characteristics',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/characteristics',
  },
  {
    token: 'custom-xml',
    prefix: 'ds',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/customXml',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/customXml',
  },
  {
    token: 'schema-library',
    prefix: 'sl',
    transitional: 'http://schemas.openxmlformats.org/schemaLibrary/2006/main',
    strict: 'http://purl.oclc.org/ooxml/schemaLibrary/main',
  },
  {
    token: 'doc-props-custom',
    prefix: 'cp',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/customProperties',
  },
  {
    token: 'doc-props-extended',
    prefix: 'ep',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/extendedProperties',
  },
  {
    token: 'doc-props-vt',
    prefix: 'vt',
    transitional: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
    strict: 'http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes',
  },

  // --- VML: Transitional only. Strict has no counterpart. ---
  { token: 'vml', prefix: 'v', transitional: 'urn:schemas-microsoft-com:vml' },
  { token: 'vml-office', prefix: 'o', transitional: 'urn:schemas-microsoft-com:office:office' },
  { token: 'vml-word', prefix: 'w10', transitional: 'urn:schemas-microsoft-com:office:word' },
  { token: 'vml-excel', prefix: 'x', transitional: 'urn:schemas-microsoft-com:office:excel' },
  {
    token: 'vml-powerpoint',
    prefix: 'pp',
    transitional: 'urn:schemas-microsoft-com:office:powerpoint',
  },

  // --- Out of scope for .docx, but present in the schema set ---
  {
    token: 'sml',
    prefix: 'x',
    transitional: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    strict: 'http://purl.oclc.org/ooxml/spreadsheetml/main',
  },
  {
    token: 'pml',
    prefix: 'p',
    transitional: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    strict: 'http://purl.oclc.org/ooxml/presentationml/main',
  },

  // --- OPC. Dialect-independent: the package layer is the same in both. ---
  {
    token: 'opc-content-types',
    prefix: 'ct',
    transitional: 'http://schemas.openxmlformats.org/package/2006/content-types',
    strict: 'http://schemas.openxmlformats.org/package/2006/content-types',
  },
  {
    token: 'opc-relationships',
    prefix: 'pr',
    transitional: 'http://schemas.openxmlformats.org/package/2006/relationships',
    strict: 'http://schemas.openxmlformats.org/package/2006/relationships',
  },
  {
    token: 'opc-core-properties',
    prefix: 'cp',
    transitional: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
    strict: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  },
  {
    token: 'opc-digital-signature',
    prefix: 'dsig',
    transitional: 'http://schemas.openxmlformats.org/package/2006/digital-signature',
    strict: 'http://schemas.openxmlformats.org/package/2006/digital-signature',
  },

  // --- No schema in the ECMA asset set ---
  //
  // Markup Compatibility is ECMA-376 Part 3, which is not in this distribution.
  // Hand-implemented in packages/schema/src/runtime/mce.ts. Real .docx files use
  // it pervasively; a reader that ignores it drops content.
  {
    token: 'mce',
    prefix: 'mc',
    transitional: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    strict: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  },
  // W3C built-ins. `xml:space="preserve"` on `w:t` is load-bearing for text fidelity.
  {
    token: 'xml',
    prefix: 'xml',
    transitional: 'http://www.w3.org/XML/1998/namespace',
    strict: 'http://www.w3.org/XML/1998/namespace',
  },
  {
    token: 'xsi',
    prefix: 'xsi',
    transitional: 'http://www.w3.org/2001/XMLSchema-instance',
    strict: 'http://www.w3.org/2001/XMLSchema-instance',
  },
  {
    token: 'dc',
    prefix: 'dc',
    transitional: 'http://purl.org/dc/elements/1.1/',
    strict: 'http://purl.org/dc/elements/1.1/',
  },
  {
    token: 'dcterms',
    prefix: 'dcterms',
    transitional: 'http://purl.org/dc/terms/',
    strict: 'http://purl.org/dc/terms/',
  },

  // Microsoft Word extension namespaces. Not in ECMA-376 at all, but Word emits
  // them and wraps them in mc:AlternateContent / mc:Ignorable. We never generate
  // types for these; content in them is captured as RawNode and replayed
  // verbatim so that round-trip stays lossless.
  {
    token: 'w14',
    prefix: 'w14',
    transitional: 'http://schemas.microsoft.com/office/word/2010/wordml',
  },
  {
    token: 'w15',
    prefix: 'w15',
    transitional: 'http://schemas.microsoft.com/office/word/2012/wordml',
  },
  {
    token: 'w16',
    prefix: 'w16',
    transitional: 'http://schemas.microsoft.com/office/word/2018/wordml',
  },
  {
    token: 'wps',
    prefix: 'wps',
    transitional: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  },
  {
    token: 'wpg',
    prefix: 'wpg',
    transitional: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  },
  {
    token: 'wpc',
    prefix: 'wpc',
    transitional: 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  },
  {
    token: 'wp14',
    prefix: 'wp14',
    transitional: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
  },
] as const;

/** Token → binding. */
export const NS_BY_TOKEN: ReadonlyMap<LogicalNs, NamespaceBinding> = new Map(
  NAMESPACES.map((n) => [n.token, n]),
);

/**
 * URI → token, covering both dialects.
 *
 * Note the deliberate many-to-one: Transitional and Strict URIs for the same
 * logical namespace both map to one token, which is the whole point of the
 * dialect-unification strategy.
 */
export const NS_BY_URI: ReadonlyMap<string, LogicalNs> = (() => {
  const m = new Map<string, LogicalNs>();
  for (const n of NAMESPACES) {
    if (n.transitional) m.set(n.transitional, n.token);
    if (n.strict) m.set(n.strict, n.token);
  }
  return m;
})();

/** Namespaces with no Strict URI — content here cannot appear in a Strict package. */
export const TRANSITIONAL_ONLY: ReadonlySet<LogicalNs> = new Set(
  NAMESPACES.filter((n) => !n.strict).map((n) => n.token),
);

/**
 * Namespaces on the `.docx` path. Used to scope the coverage manifest: a
 * SpreadsheetML type left unimplemented is not a conformance gap for us, and
 * counting it as one would make the manifest meaningless.
 */
export const DOCX_NAMESPACES: ReadonlySet<LogicalNs> = new Set<LogicalNs>([
  'wml',
  'dml-main',
  'dml-wordprocessingDrawing',
  'dml-picture',
  'dml-lockedCanvas',
  'dml-chart',
  'dml-chartDrawing',
  'dml-diagram',
  'shared-types',
  'relationships',
  'math',
  'bibliography',
  'characteristics',
  'custom-xml',
  'schema-library',
  'doc-props-custom',
  'doc-props-extended',
  'doc-props-vt',
  'vml',
  'vml-office',
  'vml-word',
  'opc-content-types',
  'opc-relationships',
  'opc-core-properties',
  'opc-digital-signature',
  'mce',
  'xml',
]);
