/**
 * The XML event interface that every generated reader is written against.
 *
 * Generated readers never touch `saxes` (or any other parser) directly. They
 * consume this interface. That indirection is the whole reason it exists: there
 * are on the order of 2,800 generated readers, and swapping the parser under
 * them must not mean regenerating or rewriting any of them.
 *
 * See `docs/adr/0006-xml-parsing-strategy.md` for why a streaming parser rather
 * than the browser's native `DOMParser`.
 */

/** A namespace URI, exactly as it appeared in the document. */
export type NamespaceUri = string;

/**
 * An attribute as it appeared on the wire.
 *
 * `uri` is empty for unqualified attributes, which is the overwhelming majority
 * in OOXML — `w:val` is unqualified despite the element being in the `w`
 * namespace. Only `xml:space`, `r:id`, `mc:Ignorable` and a handful of VML
 * attributes carry a namespace.
 */
export interface XmlAttr {
  readonly uri: NamespaceUri;
  readonly localName: string;
  /** Original prefix. Preserved so writers can round-trip the source's spelling. */
  readonly prefix: string;
  readonly value: string;
}

export interface XmlStartElement {
  readonly type: 'startElement';
  readonly uri: NamespaceUri;
  readonly localName: string;
  readonly prefix: string;
  readonly attrs: readonly XmlAttr[];
  /**
   * Namespace declarations introduced *on this element*, prefix → URI. Empty
   * prefix is the default namespace. Needed to round-trip where declarations
   * sit, which Word is inconsistent about and which affects byte-stability.
   */
  readonly nsDeclarations: ReadonlyMap<string, NamespaceUri>;
  /** True for `<foo/>`. A self-closing element still emits a matching endElement. */
  readonly selfClosing: boolean;
}

export interface XmlEndElement {
  readonly type: 'endElement';
  readonly uri: NamespaceUri;
  readonly localName: string;
}

export interface XmlText {
  readonly type: 'text';
  readonly value: string;
  /** True if this came from a CDATA section. Preserved for round-trip. */
  readonly cdata: boolean;
}

export interface XmlProcessingInstruction {
  readonly type: 'processingInstruction';
  readonly target: string;
  readonly data: string;
}

export interface XmlComment {
  readonly type: 'comment';
  readonly value: string;
}

export type XmlEvent =
  XmlStartElement | XmlEndElement | XmlText | XmlProcessingInstruction | XmlComment;

/**
 * A pull-based cursor over a document.
 *
 * Pull rather than push (SAX callbacks) because a recursive-descent reader over
 * a callback API has to be written as an explicit state machine, and 2,800
 * generated state machines is a great deal of generated code to get wrong. With
 * a cursor, each generated reader is an ordinary function that loops until it
 * sees its own end tag.
 */
export interface XmlCursor {
  /** The event at the cursor, or `undefined` once the document is exhausted. */
  readonly current: XmlEvent | undefined;

  /** Advance one event. Returns the new `current`. */
  next(): XmlEvent | undefined;

  /**
   * Byte or character offset of `current` in the source, for diagnostics.
   * Best-effort; parsers are not required to report it precisely.
   */
  readonly position: XmlPosition;

  /**
   * Consume the element at the cursor — which must be a `startElement` — and
   * everything inside it, returning it verbatim.
   *
   * This is how unknown content survives. Anything the generated readers do not
   * recognize is captured here and replayed byte-equivalently on write, which is
   * what makes lossless round-trip possible for Word's extension namespaces
   * (`w14`, `w15`, `wps`, …) that have no schema in the ECMA asset set.
   */
  skipToRaw(): RawNode;

  /**
   * Consume the element at the cursor and everything inside it, discarding it.
   * Used for content we deliberately drop, which should be nothing on the
   * round-trip path.
   */
  skip(): void;
}

export interface XmlPosition {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/**
 * Verbatim captured XML.
 *
 * Retains enough to re-serialize equivalently: namespace declarations in the
 * position they appeared, attribute order, prefix spellings, comments, and
 * whitespace. It is deliberately *not* a general DOM — nothing mutates a
 * `RawNode`; it is carried and replayed.
 */
export interface RawNode {
  readonly uri: NamespaceUri;
  readonly localName: string;
  readonly prefix: string;
  readonly attrs: readonly XmlAttr[];
  readonly nsDeclarations: ReadonlyMap<string, NamespaceUri>;
  readonly children: readonly RawChild[];
}

export type RawChild =
  | RawNode
  | { readonly kind: 'text'; readonly value: string; readonly cdata: boolean }
  | { readonly kind: 'comment'; readonly value: string }
  | { readonly kind: 'pi'; readonly target: string; readonly data: string };

/**
 * The sink every generated writer emits into.
 *
 * Writers never build a string directly. An implementation that produces bytes
 * and one that produces a structural tree (for the round-trip differ, which
 * needs to compare structure rather than text) satisfy the same interface.
 */
export interface XmlSink {
  startElement(uri: NamespaceUri, localName: string): void;
  /** Must be called only between `startElement` and the first child or `endElement`. */
  attr(uri: NamespaceUri | null, localName: string, value: string): void;
  /**
   * Declare a namespace on the element currently being opened. Callers normally
   * let the sink hoist declarations to the root; this is for round-tripping a
   * source that declared mid-document.
   */
  declareNamespace(prefix: string, uri: NamespaceUri): void;
  endElement(): void;
  text(value: string): void;
  cdata(value: string): void;
  comment(value: string): void;
  processingInstruction(target: string, data: string): void;
  /** Replay captured unknown content verbatim, in position. */
  raw(node: RawNode): void;
}

/** Limits enforced while parsing. Defence against hostile packages. */
export interface XmlParseLimits {
  /** Maximum nesting depth. Word documents rarely exceed ~50. */
  readonly maxDepth: number;
  /** Maximum total characters of text content, summed across the document. */
  readonly maxTextLength: number;
  /** Maximum attributes on a single element. */
  readonly maxAttributes: number;
}

export const DEFAULT_PARSE_LIMITS: XmlParseLimits = {
  maxDepth: 256,
  maxTextLength: 512 * 1024 * 1024,
  maxAttributes: 4096,
};

/** Raised when a document is malformed or trips a limit. Never thrown as a bare `Error`. */
export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly position: XmlPosition,
    readonly code:
      | 'malformed'
      | 'depth-exceeded'
      | 'text-length-exceeded'
      | 'attribute-count-exceeded'
      | 'entity-rejected'
      | 'unexpected-eof',
  ) {
    super(`${message} (at line ${position.line}, column ${position.column})`);
    this.name = 'XmlParseError';
  }
}
