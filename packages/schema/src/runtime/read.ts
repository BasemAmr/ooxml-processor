/**
 * The context every generated reader threads through, and its diagnostics.
 *
 * ## Readers do not throw on document content
 *
 * The only exceptions that escape a generated reader come from the cursor
 * (malformed XML, a tripped parse limit) or from calling one at the wrong
 * position, which is a programming error. Everything a *document* can do wrong —
 * an unexpected element, an undeclared attribute, a value outside its type's
 * lexical space, a missing required attribute — produces a diagnostic and a
 * preserved value.
 *
 * That is not leniency for its own sake. An editor that refuses to open a file
 * because one attribute in one paragraph is malformed is useless, and a file
 * that half-opens and silently discards the rest is worse than useless. So:
 * report everything, discard nothing, and let the caller decide whether the
 * diagnostics are severe enough to refuse.
 *
 * ## Diagnostics are capped
 *
 * A file crafted with a million bad attributes should not be able to make us
 * allocate a million diagnostic objects. Past {@link DIAGNOSTIC_CAP} the context
 * counts rather than records, and `suppressed` reports how many were dropped.
 */

import type { NamespaceUri, XmlAttr, XmlCursor, XmlPosition } from './xml.js';

export type Dialect = 'transitional' | 'strict';

export type ReadDiagnosticCode =
  /** An element the content model does not allow here. Captured verbatim. */
  | 'unexpected-element'
  /** An attribute the type does not declare. Captured verbatim. */
  | 'unexpected-attribute'
  /**
   * Lexically outside its declared type. Attribute values are preserved as
   * unknown attributes; simple-typed element text is preserved as the raw
   * string (typed as the declared type, unvalidated).
   */
  | 'invalid-value'
  /** `use="required"` and absent. */
  | 'missing-required'
  /** Non-whitespace text where the content model allows only elements. */
  | 'unexpected-text'
  /** The part ended inside an element. */
  | 'unexpected-eof'
  /** The part's root element is not the one this reader expects. */
  | 'wrong-root';

export interface ReadDiagnostic {
  readonly severity: 'warning' | 'error';
  readonly code: ReadDiagnosticCode;
  readonly message: string;
  readonly position: XmlPosition;
  /** The complex type being read when this was raised, e.g. `CT_PPr`. */
  readonly inType?: string;
}

/** Beyond this many recorded diagnostics the context only counts. */
export const DIAGNOSTIC_CAP = 1000;

/** Namespace token → URI, resolved for one document's dialect. */
export type NsUris = Readonly<Record<string, NamespaceUri>>;

export interface ReadContext {
  /** Which dialect this part is written in. Decides every namespace URI. */
  readonly dialect: Dialect;

  /**
   * Namespace URIs for {@link dialect}. Generated readers hoist the one or two
   * entries they need into locals, so this is read once per element, not once
   * per child.
   */
  readonly uris: NsUris;

  readonly diagnostics: readonly ReadDiagnostic[];

  /** Diagnostics dropped after the cap. Zero on any well-formed document. */
  readonly suppressed: number;

  report(d: ReadDiagnostic): void;

  // -- shorthands the generated code calls, kept terse because they appear
  //    thousands of times in the emitted source ---------------------------

  unexpectedElement(inType: string, localName: string, uri: string, cur: XmlCursor): void;
  unexpectedAttribute(inType: string, attr: XmlAttr, cur: XmlCursor): void;
  invalidValue(inType: string, attr: XmlAttr, expected: string, cur: XmlCursor): void;
  /** Simple-typed element text outside its lexical space. Text preserved raw. */
  invalidElementValue(inType: string, localName: string, expected: string, value: string, cur: XmlCursor): void;
  missingRequired(inType: string, attrName: string, cur: XmlCursor): void;
  unexpectedText(inType: string, cur: XmlCursor): void;
  unexpectedEof(inType: string, cur: XmlCursor): void;
}

class Context implements ReadContext {
  readonly diagnostics: ReadDiagnostic[] = [];
  suppressed = 0;

  constructor(
    readonly dialect: Dialect,
    readonly uris: NsUris,
  ) {}

  report(d: ReadDiagnostic): void {
    if (this.diagnostics.length >= DIAGNOSTIC_CAP) {
      this.suppressed += 1;
      return;
    }
    this.diagnostics.push(d);
  }

  unexpectedElement(inType: string, localName: string, uri: string, cur: XmlCursor): void {
    this.report({
      severity: 'warning',
      code: 'unexpected-element',
      message: `<${localName}> (${uri || 'no namespace'}) is not part of ${inType}; preserved verbatim`,
      position: cur.position,
      inType,
    });
  }

  unexpectedAttribute(inType: string, attr: XmlAttr, cur: XmlCursor): void {
    this.report({
      severity: 'warning',
      code: 'unexpected-attribute',
      message: `${qualify(attr)} is not declared on ${inType}; preserved verbatim`,
      position: cur.position,
      inType,
    });
  }

  invalidValue(inType: string, attr: XmlAttr, expected: string, cur: XmlCursor): void {
    this.report({
      severity: 'error',
      code: 'invalid-value',
      message:
        `${qualify(attr)}="${attr.value}" on ${inType} is not a valid ${expected}; ` +
        `the attribute is preserved verbatim but not interpreted`,
      position: cur.position,
      inType,
    });
  }

  invalidElementValue(inType: string, localName: string, expected: string, value: string, cur: XmlCursor): void {
    this.report({
      severity: 'error',
      code: 'invalid-value',
      message:
        `<${localName}> text "${value}" in ${inType} is not a valid ${expected}; ` +
        `the text is preserved verbatim but not interpreted`,
      position: cur.position,
      inType,
    });
  }

  missingRequired(inType: string, attrName: string, cur: XmlCursor): void {
    this.report({
      severity: 'error',
      code: 'missing-required',
      message: `${inType} requires the ${attrName} attribute`,
      position: cur.position,
      inType,
    });
  }

  unexpectedText(inType: string, cur: XmlCursor): void {
    this.report({
      severity: 'warning',
      code: 'unexpected-text',
      message: `${inType} has element-only content; text here is discarded`,
      position: cur.position,
      inType,
    });
  }

  unexpectedEof(inType: string, cur: XmlCursor): void {
    this.report({
      severity: 'error',
      code: 'unexpected-eof',
      message: `the part ended inside ${inType}`,
      position: cur.position,
      inType,
    });
  }
}

function qualify(attr: XmlAttr): string {
  return attr.prefix ? `${attr.prefix}:${attr.localName}` : attr.localName;
}

export function createReadContext(dialect: Dialect, uris: NsUris): ReadContext {
  return new Context(dialect, uris);
}

/**
 * Assert that the cursor is on a `startElement` and return it.
 *
 * Every generated reader opens with this. A failure here is a caller bug — a
 * reader invoked on a text node or past the end — not a document problem, which
 * is why it throws where everything else in this file reports.
 */
export function requireStart(
  cur: XmlCursor,
  inType: string,
): Extract<NonNullable<XmlCursor['current']>, { type: 'startElement' }> {
  const ev = cur.current;
  if (ev === undefined) {
    throw new Error(`read${inType} called at end of document`);
  }
  if (ev.type !== 'startElement') {
    throw new Error(`read${inType} requires the cursor on a startElement, found ${ev.type}`);
  }
  return ev;
}

/** Whether a text run is insignificant whitespace between elements. */
export function isIgnorableWhitespace(value: string): boolean {
  return !/[^\t\n\r ]/.test(value);
}
