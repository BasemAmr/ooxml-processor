/**
 * The XML capability this package needs, as an injected dependency.
 *
 * ## Why injection rather than an import
 *
 * `@ooxml/schema` owns the concrete `XmlCursor`/`XmlSink` implementations. This
 * package could import them directly, and it deliberately does not.
 *
 * The reason is not build-order convenience, it is test isolation. The package
 * layer's job is to decide *which* bytes are a part, *which* part a target
 * resolves to, and *which* limits were breached. None of that should be able to
 * fail because a parser changed how it reports a namespace declaration, and none
 * of the tests here should have to construct parser-accurate fixtures to
 * exercise a path-traversal rule. Taking the parser as a parameter makes the
 * package layer's tests depend on the package layer only.
 *
 * It also means a caller with a different parser — a DOM-backed one in a
 * browser, a structural one in the round-trip differ — can drive OPC without
 * this package having an opinion.
 */

import type { XmlAttr, XmlCursor, XmlSink, XmlStartElement } from '@ooxml/schema';

/** A sink that accumulates into a string, plus the accessor for the result. */
export interface XmlStringSink {
  readonly sink: XmlSink;
  toString(): string;
}

export interface XmlSupport {
  /** Parse a document into a pull cursor. Implementations enforce their own parse limits. */
  createCursor(xml: string): XmlCursor;
  /** A fresh sink that serializes into a string. */
  createStringSink(): XmlStringSink;
}

/* -------------------------------------------------------------------------- */
/* OPC namespaces                                                              */
/* -------------------------------------------------------------------------- */

/**
 * These are the same in ISO/IEC 29500 Strict and in Transitional.
 *
 * Worth stating explicitly because it is the exception: every *markup*
 * namespace has a Strict (`purl.oclc.org/ooxml/…`) twin and the reader has to
 * accept both (ADR-0008). The packaging namespaces do not — the package layer
 * is dialect-neutral, which is why there is no dialect parameter anywhere in
 * this package.
 */
export const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/* -------------------------------------------------------------------------- */
/* Cursor helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Position the cursor on the document's first event.
 *
 * `XmlCursor` does not specify whether a freshly created cursor already sits on
 * the first event or needs one `next()` first, and both are defensible. This
 * normalizes it so the parsers below work against either implementation — which
 * matters because the concrete cursor is written in a different package by
 * different hands.
 */
export function primeCursor(cursor: XmlCursor): void {
  if (cursor.current === undefined) cursor.next();
}

/**
 * Advance to the document's root element, skipping the prolog (processing
 * instructions, comments, whitespace). Returns `undefined` if there is none.
 */
export function readRootElement(cursor: XmlCursor): XmlStartElement | undefined {
  primeCursor(cursor);
  for (let event = cursor.current; event !== undefined; event = cursor.next()) {
    if (event.type === 'startElement') return event;
  }
  return undefined;
}

/**
 * Visit each direct child element of the element the cursor is sitting on,
 * together with its concatenated text content.
 *
 * Text is gathered rather than exposed as events because every element this
 * package parses — `Default`, `Override`, `Relationship` — is a leaf in
 * practice. `CT_Relationship` is nonetheless declared as `simpleContent`
 * extending `xs:string`, so it may legally *carry* text, and dropping it would
 * be a round-trip loss. Nested elements are ignored: none of the three OPC
 * content models admits a child element or an `xs:any` wildcard, so anything
 * nested is already invalid markup.
 *
 * Depth bookkeeping relies on `XmlCursor`'s guarantee that a self-closing
 * element still emits a matching `endElement`.
 */
export function forEachChildElement(
  cursor: XmlCursor,
  visit: (start: XmlStartElement, text: string) => void,
): void {
  let depth = 0;
  let pending: XmlStartElement | undefined;
  let pendingText = '';

  for (let event = cursor.next(); event !== undefined; event = cursor.next()) {
    if (event.type === 'startElement') {
      if (depth === 0) {
        pending = event;
        pendingText = '';
      }
      depth += 1;
      continue;
    }
    if (event.type === 'endElement') {
      if (depth === 0) return; // the end tag of the element we were asked about
      depth -= 1;
      if (depth === 0 && pending !== undefined) {
        visit(pending, pendingText);
        pending = undefined;
      }
      continue;
    }
    if (event.type === 'text' && depth === 1) {
      pendingText += event.value;
    }
  }
}

/** Look up an unqualified attribute — which is every attribute in OPC markup. */
export function attributeValue(start: XmlStartElement, localName: string): string | undefined {
  for (const attr of start.attrs) {
    if (attr.uri === '' && attr.localName === localName) return attr.value;
  }
  return undefined;
}

/**
 * Every attribute that is not one of the names given.
 *
 * Kept for round-trip. Note that none of the OPC schemas declares an
 * `anyAttribute` wildcard, so an unknown attribute here is *invalid* markup —
 * but invalid markup that a real producer wrote is still markup we must not
 * silently delete when we save the file back.
 */
export function otherAttributes(
  start: XmlStartElement,
  known: readonly string[],
): readonly XmlAttr[] {
  return start.attrs.filter((attr) => !(attr.uri === '' && known.includes(attr.localName)));
}

/** Replay preserved unknown attributes onto a sink. */
export function writeAttributes(sink: XmlSink, attrs: readonly XmlAttr[]): void {
  for (const attr of attrs) {
    sink.attr(attr.uri === '' ? null : attr.uri, attr.localName, attr.value);
  }
}
