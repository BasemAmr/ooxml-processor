/**
 * `@ooxml/schema` — generated OOXML types plus the hand-authored runtime they
 * depend on.
 *
 * Almost everything in this package is machine-generated from the vendored XSDs
 * by `@ooxml/codegen`. The exceptions live in `./runtime/` and are hand-authored
 * because no schema exists for them (Markup Compatibility is ECMA-376 Part 3,
 * which is not in the asset set) or because they encode a spec quirk that would
 * be error-prone to generate (`ST_OnOff`'s absent-means-true rule).
 *
 * The runtime is exported twice on purpose. `runtime` is the namespace form,
 * which is what generated code and application code should use — `runtime.twip`
 * and `runtime.parseOnOff` read unambiguously and cannot collide with the ~2,800
 * generated type names that share this module. The handful of named re-exports
 * below are the XML contract itself, which is referenced so often in signatures
 * that qualifying it adds noise without adding clarity.
 */

export * as runtime from './runtime/index.js';

export type {
  NamespaceUri,
  XmlAttr,
  XmlStartElement,
  XmlEndElement,
  XmlText,
  XmlProcessingInstruction,
  XmlComment,
  XmlEvent,
  XmlCursor,
  XmlPosition,
  XmlSink,
  XmlParseLimits,
  RawNode,
  RawChild,
} from './runtime/xml.js';

export { DEFAULT_PARSE_LIMITS, XmlParseError } from './runtime/xml.js';

export { createCursor, createCursorOverRaw } from './runtime/cursor.js';
export { createRawSink, createStringSink, XmlSinkError } from './runtime/sink.js';
