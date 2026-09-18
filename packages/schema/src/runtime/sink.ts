/**
 * `XmlSink` implementations: one that produces XML text, one that produces a
 * `RawNode` tree.
 *
 * Two implementations behind one interface is the point of the interface. The
 * string sink writes the bytes that go into the package. The raw sink builds the
 * structure the round-trip differ compares, because comparing *text* would flag
 * every cosmetic difference — a reordered namespace declaration, a self-closing
 * tag written long-form — as a round-trip failure, and then the signal is lost
 * in the noise. Both share all the namespace, escaping and validation logic
 * below, so a bug found by the differ is a bug that was really in the writer.
 *
 * ## Escaping: minimal, but not *less* than minimal
 *
 * Word escapes sparingly. Gratuitous escaping is not wrong XML but it produces a
 * diff on every save, which is the thing this project is built to avoid. So:
 *
 * - **Text**: `&`, `<`, `>` — and `\r`. See below.
 * - **Attribute values**: `&`, `<`, `"` — and `\t`, `\n`, `\r`. See below.
 * - Everything else stays literal, notably **tab (U+0009)**, which `w:t` content
 *   legitimately contains and which must survive verbatim.
 *
 * The carriage-return and tab-in-attribute cases are not optional and are the
 * one place where "minimal" escaping is wrong. XML 1.0 §2.11 requires every
 * parser to normalize a literal CR (and CRLF) in content to a single LF, and
 * §3.3.3 requires attribute-value normalization to replace literal TAB, LF and
 * CR in an attribute value with a space *before the application ever sees it*.
 * Writing those characters literally is therefore silent, unrecoverable data
 * loss on the next read — the round-trip breaks and no diff of the two XML files
 * explains why. Writing `&#xD;`, `&#x9;`, `&#xA;` survives, and is exactly what
 * .NET's `XmlWriter` (and therefore Word) does.
 *
 * `>` in text is escaped because `]]>` is forbidden in content and because Word
 * escapes it; that keeps us byte-identical with Word rather than merely valid.
 *
 * ## Namespaces
 *
 * A prefix→URI scope stack, with declarations hoisted to the root element by
 * default because that is what Word emits: `document.xml` opens with a `w:document`
 * carrying a dozen `xmlns:` declarations and never declares another. Hoisting is
 * possible in a streaming writer only because the root element's declarations are
 * rendered last, into a reserved slot — see `StringBackend`.
 *
 * `declareNamespace()` overrides that and pins a declaration to the element being
 * opened, which is how a `RawNode` captured from a source that declared
 * mid-document is replayed in the same shape.
 */

import { conventionalPrefix, XML_NAMESPACE, XMLNS_NAMESPACE } from './namespaces.js';
import type { NamespaceUri, RawChild, RawNode, XmlAttr, XmlSink } from './xml.js';

/**
 * Raised when a writer misuses the sink or asks for something that cannot be
 * serialized as well-formed XML.
 *
 * Every case is a caller bug, never a document problem — which is why it is not
 * an `XmlParseError`. Producing the output anyway would mean writing a `.docx`
 * that Word opens with a repair prompt, and a repair prompt destroys exactly the
 * content we were trying to preserve. Failing here is the cheaper failure.
 */
export class XmlSinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlSinkError';
  }
}

/* ------------------------------------------------------------------------- */
/* Character validation and escaping                                          */
/* ------------------------------------------------------------------------- */

/**
 * Characters XML 1.0 cannot represent at all — not literally, and not as a
 * character reference either (§4.1 forbids a reference to a non-`Char`).
 * U+0009, U+000A and U+000D are legal and deliberately absent from this set.
 */
const INVALID_XML_CHAR = new RegExp(`[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]`);

/** Any surrogate code unit; only used to gate the more expensive pairing check. */
const ANY_SURROGATE = /[\uD800-\uDFFF]/;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const NAME_START =
  'A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
const NAME_REST = `${NAME_START}0-9\\-.\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
/**
 * XML NCName, i.e. a `Name` with no colon. Element and attribute local names
 * and prefixes must match this. Astral-plane name characters (U+10000–U+EFFFF)
 * are permitted via the surrogate range already inside `NAME_START`.
 */
const NCNAME = new RegExp(`^[${NAME_START}][${NAME_REST}]*$`);

function requireNCName(name: string, what: string): void {
  if (!NCNAME.test(name)) {
    throw new XmlSinkError(`${what} ${JSON.stringify(name)} is not a legal XML NCName`);
  }
}

function requireSerializableChars(value: string, what: string): void {
  const bad = INVALID_XML_CHAR.exec(value);
  if (bad !== null) {
    const code = bad[0].codePointAt(0) ?? 0;
    throw new XmlSinkError(
      `${what} contains U+${code.toString(16).toUpperCase().padStart(4, '0')}, which XML 1.0 ` +
        'cannot represent in any form (not even as a character reference)',
    );
  }
  if (ANY_SURROGATE.test(value) && UNPAIRED_SURROGATE.test(value)) {
    throw new XmlSinkError(`${what} contains an unpaired surrogate`);
  }
}

const TEXT_ESCAPES = /[&<>\r]/g;
const TEXT_REPLACEMENTS: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\r': '&#xD;',
};

export function escapeText(value: string): string {
  requireSerializableChars(value, 'text content');
  return value.replace(TEXT_ESCAPES, (c) => TEXT_REPLACEMENTS[c] ?? c);
}

const ATTR_ESCAPES = /[&<>"\t\n\r]/g;
const ATTR_REPLACEMENTS: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\t': '&#x9;',
  '\n': '&#xA;',
  '\r': '&#xD;',
};

export function escapeAttributeValue(value: string): string {
  requireSerializableChars(value, 'attribute value');
  return value.replace(ATTR_ESCAPES, (c) => ATTR_REPLACEMENTS[c] ?? c);
}

/**
 * A CDATA section, split as many times as needed.
 *
 * `]]>` cannot appear inside a section, so a value containing it is emitted as
 * several adjacent sections. Reparsing merges them back into one text value, so
 * the content round-trips even though the byte shape does not.
 */
function cdataSection(value: string): string {
  requireSerializableChars(value, 'CDATA content');
  return `<![CDATA[${value.split(']]>').join(']]]]><![CDATA[>')}]]>`;
}

function qname(prefix: string, localName: string): string {
  return prefix === '' ? localName : `${prefix}:${localName}`;
}

/* ------------------------------------------------------------------------- */
/* Backends                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * The bytes-or-tree half of a sink. All namespace resolution, validation and
 * escaping happen above this line, in `BaseSink`, so the two backends cannot
 * disagree about them.
 */
interface SinkBackend {
  openElement(prefix: string, localName: string, uri: NamespaceUri): void;
  /** A declaration pinned to the element currently being opened. */
  namespaceDeclaration(prefix: string, uri: NamespaceUri): void;
  /** A declaration that belongs on the root element, wherever that ends up. */
  hoistedDeclaration(prefix: string, uri: NamespaceUri): void;
  attribute(prefix: string, localName: string, uri: NamespaceUri, value: string): void;
  closeElement(prefix: string, localName: string): void;
  characters(value: string, cdata: boolean): void;
  comment(value: string): void;
  processingInstruction(target: string, data: string): void;
}

export interface StringSinkOptions {
  /**
   * Emit an XML declaration before the root element. Word writes one on every
   * part, so the package writer turns this on; it defaults to off because the
   * sink is also used for fragments.
   */
  readonly xmlDeclaration?: boolean;
  /** `standalone` pseudo-attribute. Word writes `yes`. */
  readonly standalone?: 'yes' | 'no';
  /**
   * What follows the declaration. Word writes CRLF here and nowhere else in the
   * part, and the ZIP entry is byte-compared by some tools, so it is the default.
   */
  readonly declarationEol?: string;
  /**
   * Hoist namespace declarations to the root element (default). Turning this off
   * declares each namespace on the outermost element that needs it, which
   * produces smaller fragments but does not look like Word's output.
   */
  readonly hoistNamespaces?: boolean;
  /** URI → prefix overrides, consulted before the conventional-prefix table. */
  readonly prefixes?: Readonly<Record<NamespaceUri, string>>;
}

class StringBackend implements SinkBackend {
  private readonly parts: string[] = [];
  /** Index into `parts` of the namespace-declaration slot of each open element. */
  private readonly slots: number[] = [];
  private rootSlot = -1;
  private readonly hoisted = new Map<string, NamespaceUri>();
  private startTagOpen = false;

  constructor(private readonly options: StringSinkOptions) {}

  openElement(prefix: string, localName: string): void {
    this.closeStartTag();
    this.parts.push(`<${qname(prefix, localName)}`);
    // Reserve a slot *before* the attributes so that declarations render ahead
    // of them however late they are discovered. Word writes them first too.
    const slot = this.parts.length;
    this.parts.push('');
    this.slots.push(slot);
    if (this.rootSlot < 0) this.rootSlot = slot;
    this.startTagOpen = true;
  }

  namespaceDeclaration(prefix: string, uri: NamespaceUri): void {
    const slot = this.slots[this.slots.length - 1];
    /* c8 ignore next */
    if (slot === undefined) throw new XmlSinkError('namespace declaration with no open element');
    this.parts[slot] = `${this.parts[slot] ?? ''}${renderDeclaration(prefix, uri)}`;
  }

  hoistedDeclaration(prefix: string, uri: NamespaceUri): void {
    this.hoisted.set(prefix, uri);
  }

  attribute(prefix: string, localName: string, _uri: NamespaceUri, value: string): void {
    this.parts.push(` ${qname(prefix, localName)}="${escapeAttributeValue(value)}"`);
  }

  closeElement(prefix: string, localName: string): void {
    this.slots.pop();
    if (this.startTagOpen) {
      // An element with no children is written `<w:b/>`, which is what Word
      // writes and what the great majority of WML elements are.
      this.parts.push('/>');
      this.startTagOpen = false;
    } else {
      this.parts.push(`</${qname(prefix, localName)}>`);
    }
  }

  characters(value: string, cdata: boolean): void {
    this.closeStartTag();
    this.parts.push(cdata ? cdataSection(value) : escapeText(value));
  }

  comment(value: string): void {
    this.closeStartTag();
    this.parts.push(`<!--${value}-->`);
  }

  processingInstruction(target: string, data: string): void {
    this.closeStartTag();
    this.parts.push(data === '' ? `<?${target}?>` : `<?${target} ${data}?>`);
  }

  private closeStartTag(): void {
    if (this.startTagOpen) {
      this.parts.push('>');
      this.startTagOpen = false;
    }
  }

  /** Idempotent: `toString()` does not consume or mutate the buffered output. */
  render(): string {
    const parts = this.parts.slice();
    if (this.rootSlot >= 0 && this.hoisted.size > 0) {
      let decls = '';
      for (const [prefix, uri] of this.hoisted) decls += renderDeclaration(prefix, uri);
      parts[this.rootSlot] = `${decls}${parts[this.rootSlot] ?? ''}`;
    }
    const body = parts.join('') + (this.startTagOpen ? '>' : '');
    if (this.options.xmlDeclaration !== true) return body;
    const standalone = this.options.standalone ?? 'yes';
    const eol = this.options.declarationEol ?? '\r\n';
    return `<?xml version="1.0" encoding="UTF-8" standalone="${standalone}"?>${eol}${body}`;
  }
}

function renderDeclaration(prefix: string, uri: NamespaceUri): string {
  return prefix === ''
    ? ` xmlns="${escapeAttributeValue(uri)}"`
    : ` xmlns:${prefix}="${escapeAttributeValue(uri)}"`;
}

interface MutableRawNode {
  uri: NamespaceUri;
  localName: string;
  prefix: string;
  attrs: XmlAttr[];
  nsDeclarations: Map<string, NamespaceUri>;
  children: RawChild[];
}

class TreeBackend implements SinkBackend {
  private root: MutableRawNode | undefined;
  private readonly stack: MutableRawNode[] = [];
  private readonly hoisted = new Map<string, NamespaceUri>();

  openElement(prefix: string, localName: string, uri: NamespaceUri): void {
    const node: MutableRawNode = {
      uri,
      localName,
      prefix,
      attrs: [],
      nsDeclarations: new Map(),
      children: [],
    };
    const parent = this.stack[this.stack.length - 1];
    if (parent === undefined) this.root = node;
    else parent.children.push(node as RawNode);
    this.stack.push(node);
  }

  namespaceDeclaration(prefix: string, uri: NamespaceUri): void {
    this.top('namespace declaration').nsDeclarations.set(prefix, uri);
  }

  hoistedDeclaration(prefix: string, uri: NamespaceUri): void {
    this.hoisted.set(prefix, uri);
  }

  attribute(prefix: string, localName: string, uri: NamespaceUri, value: string): void {
    this.top('attribute').attrs.push({ uri, localName, prefix, value });
  }

  closeElement(): void {
    this.stack.pop();
  }

  characters(value: string, cdata: boolean): void {
    const node = this.stack[this.stack.length - 1];
    // Outside the root there is nowhere to put text; a `RawNode` has no
    // prolog. The sink rejects non-whitespace there before we get here.
    if (node === undefined) return;
    const last = node.children[node.children.length - 1];
    // Match the cursor, which coalesces adjacent plain text but never merges
    // text with CDATA — otherwise a structural comparison of "written then
    // reparsed" against "parsed" would differ purely on chunking.
    if (!cdata && last !== undefined && 'kind' in last && last.kind === 'text' && !last.cdata) {
      node.children[node.children.length - 1] = {
        kind: 'text',
        value: last.value + value,
        cdata: false,
      };
      return;
    }
    node.children.push({ kind: 'text', value, cdata });
  }

  comment(value: string): void {
    this.stack[this.stack.length - 1]?.children.push({ kind: 'comment', value });
  }

  processingInstruction(target: string, data: string): void {
    this.stack[this.stack.length - 1]?.children.push({ kind: 'pi', target, data });
  }

  result(): RawNode | undefined {
    const root = this.root;
    if (root === undefined) return undefined;
    if (this.hoisted.size > 0) {
      // Hoisted declarations render first, as they do in the string backend, so
      // the two sinks produce the same declaration order.
      const merged = new Map<string, NamespaceUri>();
      for (const [p, u] of this.hoisted) merged.set(p, u);
      for (const [p, u] of root.nsDeclarations) merged.set(p, u);
      root.nsDeclarations = merged;
    }
    return root as RawNode;
  }

  private top(what: string): MutableRawNode {
    const node = this.stack[this.stack.length - 1];
    /* c8 ignore next */
    if (node === undefined) throw new XmlSinkError(`${what} with no open element`);
    return node;
  }
}

/* ------------------------------------------------------------------------- */
/* The shared sink                                                            */
/* ------------------------------------------------------------------------- */

interface Frame {
  prefix: string;
  readonly localName: string;
  /** Prefix → URI declared on this element. */
  readonly declarations: Map<string, NamespaceUri>;
  /** `{uri}local` of attributes already written, to catch duplicates. */
  attrKeys: string[] | undefined;
  startTagOpen: boolean;
}

/** Bindings the XML specification makes without anyone declaring them. */
const IMPLICIT_BINDINGS: ReadonlyMap<string, NamespaceUri> = new Map([
  ['xml', XML_NAMESPACE],
  ['xmlns', XMLNS_NAMESPACE],
]);

class BaseSink implements XmlSink {
  private readonly stack: Frame[] = [];
  private readonly hoisted = new Map<string, NamespaceUri>();
  /**
   * Declarations allocated while resolving a prefix, waiting to be written onto
   * the element whose start tag is open. Only used when hoisting is off.
   */
  private readonly pending: Array<[string, NamespaceUri]> = [];
  private rootClosed = false;

  constructor(
    private readonly backend: SinkBackend,
    private readonly hoist: boolean,
    private readonly prefixHints: Readonly<Record<NamespaceUri, string>> | undefined,
  ) {}

  startElement(uri: NamespaceUri, localName: string): void {
    requireNCName(localName, 'element name');
    if (this.stack.length === 0 && this.rootClosed) {
      throw new XmlSinkError(
        `cannot start a second root element <${localName}>: an XML document has exactly one`,
      );
    }
    // The parent's start tag is over the moment a child begins.
    this.closeStartTag();
    const frame: Frame = {
      prefix: '',
      localName,
      declarations: new Map(),
      attrKeys: undefined,
      startTagOpen: true,
    };
    this.stack.push(frame);
    // The prefix is decided after the frame is pushed so that a declaration
    // made for it lands in this element's own scope when hoisting is off.
    frame.prefix = this.bindElementPrefix(uri);
    this.backend.openElement(frame.prefix, localName, uri);
    this.flushPendingDeclarations(frame);
  }

  attr(uri: NamespaceUri | null, localName: string, value: string): void {
    const frame = this.requireOpenTag('attr');
    requireNCName(localName, 'attribute name');
    const ns = uri ?? '';
    if (ns === XMLNS_NAMESPACE) {
      throw new XmlSinkError(
        'namespace declarations must go through declareNamespace(), not attr()',
      );
    }
    const prefix = ns === '' ? '' : this.bindAttributePrefix(ns);
    const key = `{${ns}}${localName}`;
    if (frame.attrKeys === undefined) frame.attrKeys = [key];
    else if (frame.attrKeys.includes(key)) {
      throw new XmlSinkError(
        `duplicate attribute ${qname(prefix, localName)} on <${qname(frame.prefix, frame.localName)}>`,
      );
    } else frame.attrKeys.push(key);
    this.flushPendingDeclarations(frame);
    this.backend.attribute(prefix, localName, ns, value);
  }

  declareNamespace(prefix: string, uri: NamespaceUri): void {
    const frame = this.requireOpenTag('declareNamespace');
    if (prefix !== '') requireNCName(prefix, 'namespace prefix');
    if (IMPLICIT_BINDINGS.has(prefix) && IMPLICIT_BINDINGS.get(prefix) !== uri) {
      throw new XmlSinkError(
        `the prefix ${JSON.stringify(prefix)} is reserved and cannot be rebound`,
      );
    }
    const existing = frame.declarations.get(prefix);
    if (existing === uri) return;
    if (existing !== undefined) {
      throw new XmlSinkError(
        `prefix ${JSON.stringify(prefix)} is already declared on this element as ` +
          `${JSON.stringify(existing)}; it cannot also be ${JSON.stringify(uri)}`,
      );
    }
    // A hoisted declaration is written on the root element. Declaring the same
    // prefix locally *on the root* would emit the attribute twice.
    if (this.isRootFrame(frame) && this.hoisted.has(prefix)) {
      if (this.hoisted.get(prefix) === uri) return;
      throw new XmlSinkError(
        `prefix ${JSON.stringify(prefix)} was already hoisted to the root element for ` +
          `${JSON.stringify(this.hoisted.get(prefix))}; declare a different prefix, or ` +
          'construct the sink with hoistNamespaces: false',
      );
    }
    frame.declarations.set(prefix, uri);
    this.backend.namespaceDeclaration(prefix, uri);
  }

  endElement(): void {
    const frame = this.stack.pop();
    if (frame === undefined) throw new XmlSinkError('endElement() with no open element');
    this.backend.closeElement(frame.prefix, frame.localName);
    frame.startTagOpen = false;
    if (this.stack.length === 0) this.rootClosed = true;
  }

  text(value: string): void {
    if (this.stack.length === 0 && value.trim() !== '') {
      throw new XmlSinkError('text outside the root element is not well-formed XML');
    }
    this.closeStartTag();
    if (value === '') return;
    this.backend.characters(value, false);
  }

  cdata(value: string): void {
    if (this.stack.length === 0) {
      throw new XmlSinkError('a CDATA section outside the root element is not well-formed XML');
    }
    this.closeStartTag();
    this.backend.characters(value, true);
  }

  comment(value: string): void {
    // `--` may not appear inside a comment and a comment may not end with `-`
    // (XML 1.0 §2.5). There is no escape, so the only options are to refuse or
    // to silently mangle.
    if (value.includes('--') || value.endsWith('-')) {
      throw new XmlSinkError(
        'a comment may not contain "--" or end with "-", and XML provides no way to escape them',
      );
    }
    requireSerializableChars(value, 'comment');
    this.closeStartTag();
    this.backend.comment(value);
  }

  processingInstruction(target: string, data: string): void {
    requireNCName(target, 'processing-instruction target');
    if (target.toLowerCase() === 'xml') {
      throw new XmlSinkError('the processing-instruction target "xml" is reserved');
    }
    if (data.includes('?>')) {
      throw new XmlSinkError('processing-instruction data may not contain "?>"');
    }
    requireSerializableChars(data, 'processing-instruction data');
    this.closeStartTag();
    this.backend.processingInstruction(target, data);
  }

  /**
   * Replay captured content.
   *
   * Prefixes, attribute order and the position of namespace declarations are
   * reproduced exactly as captured. Where the capture relied on a declaration
   * from an ancestor that is not in scope here — which happens whenever a
   * subtree is lifted out of its original document — a repair declaration is
   * added on the element itself. The result is still a faithful replay: same
   * namespace URIs, same prefixes, same order; it just carries the declarations
   * it needs to stand alone.
   */
  raw(node: RawNode): void {
    this.closeStartTag();
    this.replay(node);
  }

  private replay(node: RawNode): void {
    const frame: Frame = {
      prefix: node.prefix,
      localName: node.localName,
      declarations: new Map(node.nsDeclarations),
      attrKeys: undefined,
      startTagOpen: true,
    };
    if (this.stack.length === 0 && this.rootClosed) {
      throw new XmlSinkError(`cannot replay <${node.localName}> as a second root element`);
    }
    this.stack.push(frame);

    // Repairs must be computed before the start tag is opened, because they are
    // written as part of it.
    const repairs: Array<[string, NamespaceUri]> = [];
    if (this.lookupPrefix(node.prefix) !== node.uri) {
      if (node.prefix === '' && node.uri === '') {
        // The element is in no namespace but a default namespace is in scope;
        // `xmlns=""` is the only way to say that.
        repairs.push(['', '']);
      } else {
        repairs.push([node.prefix, node.uri]);
      }
    }
    for (const attr of node.attrs) {
      if (attr.uri === '' || attr.prefix === 'xml') continue;
      if (this.lookupPrefix(attr.prefix, repairs) === attr.uri) continue;
      repairs.push([attr.prefix, attr.uri]);
    }
    for (const [p, u] of repairs) frame.declarations.set(p, u);

    this.backend.openElement(node.prefix, node.localName, node.uri);
    for (const [p, u] of frame.declarations) this.backend.namespaceDeclaration(p, u);
    for (const attr of node.attrs) {
      this.backend.attribute(attr.prefix, attr.localName, attr.uri, attr.value);
    }
    for (const child of node.children) {
      if ('kind' in child) {
        switch (child.kind) {
          case 'text':
            frame.startTagOpen = false;
            this.backend.characters(child.value, child.cdata);
            break;
          case 'comment':
            frame.startTagOpen = false;
            this.backend.comment(child.value);
            break;
          case 'pi':
            frame.startTagOpen = false;
            this.backend.processingInstruction(child.target, child.data);
            break;
        }
      } else {
        frame.startTagOpen = false;
        this.replay(child);
      }
    }
    this.stack.pop();
    this.backend.closeElement(node.prefix, node.localName);
    if (this.stack.length === 0) this.rootClosed = true;
  }

  /* --- namespace plumbing ------------------------------------------------ */

  /**
   * The URI bound to `prefix` right now, honouring shadowing: the innermost
   * declaration of a prefix wins, and a prefix declared to a different URI
   * nearer the cursor hides an outer binding of the same prefix.
   */
  private lookupPrefix(
    prefix: string,
    extra?: ReadonlyArray<[string, NamespaceUri]>,
  ): NamespaceUri | undefined {
    if (extra !== undefined) {
      for (let i = extra.length - 1; i >= 0; i--) {
        const entry = extra[i];
        if (entry !== undefined && entry[0] === prefix) return entry[1];
      }
    }
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const found = this.stack[i]?.declarations.get(prefix);
      if (found !== undefined) return found;
    }
    const hoisted = this.hoisted.get(prefix);
    if (hoisted !== undefined) return hoisted;
    const implicit = IMPLICIT_BINDINGS.get(prefix);
    if (implicit !== undefined) return implicit;
    // An undeclared default prefix means "no namespace", which is a real
    // binding, not an absent one.
    return prefix === '' ? '' : undefined;
  }

  /** An in-scope prefix bound to `uri`, or `undefined`. */
  private findPrefix(uri: NamespaceUri, allowDefault: boolean): string | undefined {
    const shadowed = new Set<string>();
    const consider = (p: string, u: NamespaceUri): string | undefined => {
      if (shadowed.has(p)) return undefined;
      shadowed.add(p);
      if (u === uri && (allowDefault || p !== '')) return p;
      return undefined;
    };
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame === undefined) continue;
      for (const [p, u] of frame.declarations) {
        const hit = consider(p, u);
        if (hit !== undefined) return hit;
      }
    }
    for (const [p, u] of this.hoisted) {
      const hit = consider(p, u);
      if (hit !== undefined) return hit;
    }
    for (const [p, u] of IMPLICIT_BINDINGS) {
      const hit = consider(p, u);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  /**
   * Pick a prefix for a namespace nothing has declared yet.
   *
   * The conventional prefix from the namespace table is tried first — that is
   * what keeps output looking like Word's. A digit is appended only when that
   * prefix is already bound to something else, which in a `.docx` happens only
   * for the handful of genuinely colliding conventions (`x` is both VML-Excel
   * and SpreadsheetML).
   */
  private allocatePrefix(uri: NamespaceUri): string {
    const wanted = this.prefixHints?.[uri] ?? conventionalPrefix(uri) ?? 'ns';
    let candidate = wanted;
    let n = 1;
    while (candidate === '' || this.lookupPrefix(candidate) !== undefined) {
      candidate = `${wanted === '' ? 'ns' : wanted}${n}`;
      n += 1;
    }
    return candidate;
  }

  /** Pending declarations are written by the caller right after `openElement`. */
  private bindElementPrefix(uri: NamespaceUri): string {
    if (uri === '') {
      // No namespace. If a default namespace is in scope it has to be
      // undeclared, or the element silently lands in it. `xmlns=""` is scoped to
      // the element that carries it, so this one is never hoisted — hoisting it
      // to the root would undeclare the default for the whole document.
      if (this.lookupPrefix('') !== '') {
        this.pending.push(['', '']);
      }
      return '';
    }
    const existing = this.findPrefix(uri, true);
    if (existing !== undefined) return existing;

    // For an otherwise-unbound root namespace with no conventional prefix,
    // prefer the default namespace. This preserves the caller's natural
    // `declareNamespace('', uri)` spelling and avoids inventing `ns:` on the
    // document root.
    const prefix =
      this.stack.length === 1 &&
      this.prefixHints?.[uri] === undefined &&
      conventionalPrefix(uri) === undefined
        ? ''
        : this.allocatePrefix(uri);
    this.declarePending(prefix, uri);
    return prefix;
  }

  private bindAttributePrefix(uri: NamespaceUri): string {
    // An unprefixed attribute is in *no* namespace, never in the default
    // namespace (Namespaces in XML §6.2). A namespaced attribute therefore
    // always needs a real prefix, even when the default namespace already
    // points at the right URI.
    if (uri === XML_NAMESPACE) return 'xml';
    const existing = this.findPrefix(uri, false);
    if (existing !== undefined) return existing;
    const prefix = this.allocatePrefix(uri);
    this.declarePending(prefix, uri);
    return prefix;
  }

  private declarePending(prefix: string, uri: NamespaceUri): void {
    if (this.hoist) {
      this.hoisted.set(prefix, uri);
      this.backend.hoistedDeclaration(prefix, uri);
      return;
    }
    this.pending.push([prefix, uri]);
  }

  private flushPendingDeclarations(frame: Frame): void {
    if (this.pending.length === 0) return;
    for (const [prefix, uri] of this.pending.splice(0)) {
      frame.declarations.set(prefix, uri);
      this.backend.namespaceDeclaration(prefix, uri);
    }
  }

  /* --- state checks ------------------------------------------------------ */

  private requireOpenTag(method: string): Frame {
    const frame = this.stack[this.stack.length - 1];
    if (frame === undefined) {
      throw new XmlSinkError(`${method}() called with no element open`);
    }
    if (!frame.startTagOpen) {
      // Silently reordering would move the attribute onto some other element,
      // or drop it. Both corrupt the document in ways that survive validation.
      throw new XmlSinkError(
        `${method}() called on <${qname(frame.prefix, frame.localName)}> after a child was ` +
          'emitted; attributes and namespace declarations must precede all content',
      );
    }
    return frame;
  }

  private closeStartTag(): void {
    const frame = this.stack[this.stack.length - 1];
    if (frame !== undefined) frame.startTagOpen = false;
  }

  private isRootFrame(frame: Frame): boolean {
    return this.stack.length > 0 && this.stack[0] === frame;
  }
}

/* ------------------------------------------------------------------------- */
/* Factories                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * A sink that produces XML text.
 *
 * `toString()` is idempotent and may be called on a partially written document,
 * which is what makes it usable from a test that wants to see what has been
 * written so far.
 */
export function createStringSink(options: StringSinkOptions = {}): {
  sink: XmlSink;
  toString(): string;
} {
  const backend = new StringBackend(options);
  const sink = new BaseSink(backend, options.hoistNamespaces ?? true, options.prefixes);
  return { sink, toString: () => backend.render() };
}

/**
 * A sink that produces a `RawNode` tree.
 *
 * This is what the round-trip differ compares, and it is also how a subtree is
 * captured from the typed model to be carried around as opaque content. Content
 * outside the root element — prolog comments, processing instructions — is
 * dropped, because `RawNode` has nowhere to put it; the string sink keeps it.
 */
export function createRawSink(): { sink: XmlSink; toNode(): RawNode | undefined } {
  const backend = new TreeBackend();
  const sink = new BaseSink(backend, true, undefined);
  return { sink, toNode: () => backend.result() };
}
