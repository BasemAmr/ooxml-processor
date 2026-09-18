/**
 * A small, self-contained XML parser and serializer used **only by this
 * package's tests**.
 *
 * ## Why a fake at all
 *
 * `openPackage` takes its XML capability as a parameter (see `xml-support.ts`).
 * These tests supply this implementation rather than `@ooxml/schema`'s real
 * parser, and that is a deliberate design property rather than a scheduling
 * accident: the package layer's tests are about part names, limits, relationship
 * resolution and byte-stability, and none of those should be able to go red
 * because a parser changed how it reports a namespace declaration.
 *
 * ## What it is not
 *
 * Not a conformant XML processor and not a security boundary. It does not
 * handle DTDs, entity declarations, or anything else that a hostile document
 * would use — the real parser's job. It handles exactly the subset the OPC
 * streams use: an XML declaration, comments, elements, attributes, namespace
 * declarations, character data, the five predefined entities, numeric character
 * references and CDATA sections.
 *
 * It lives under `src/` rather than in a `test/` folder so that `tsc --build`
 * type-checks it against the real `XmlCursor`/`XmlSink` interfaces. A fake that
 * has drifted out of shape with the interface it fakes is worse than no fake.
 */

import type {
  NamespaceUri,
  RawChild,
  RawNode,
  XmlAttr,
  XmlCursor,
  XmlEvent,
  XmlPosition,
  XmlSink,
  XmlStartElement,
} from '@ooxml/schema';

import type { XmlStringSink, XmlSupport } from '../xml-support.js';

export const fakeXmlSupport: XmlSupport = {
  createCursor(xml: string): XmlCursor {
    return new FakeCursor(parseEvents(xml));
  },
  createStringSink(): XmlStringSink {
    const sink = new FakeStringSink();
    return { sink, toString: () => sink.result() };
  },
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

class FakeXmlError extends Error {}

interface PositionedEvent {
  readonly event: XmlEvent;
  readonly offset: number;
}

/**
 * Eager tokenization into a flat event array.
 *
 * A real cursor is incremental; this one is not, because a test fixture is a few
 * hundred bytes and the laziness would only be an opportunity for the fake to
 * behave differently from the real thing in a way the tests then encode.
 */
function parseEvents(xml: string): PositionedEvent[] {
  const events: PositionedEvent[] = [];
  const scopes: Array<Map<string, NamespaceUri>> = [new Map()];
  const openNames: Array<{ uri: NamespaceUri; localName: string }> = [];
  let i = 0;

  const push = (event: XmlEvent, offset: number): void => {
    events.push({ event, offset });
  };

  while (i < xml.length) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i);
      const end = next < 0 ? xml.length : next;
      const raw = xml.slice(i, end);
      if (raw.length > 0) {
        push({ type: 'text', value: decodeEntities(raw), cdata: false }, i);
      }
      i = end;
      continue;
    }

    if (xml.startsWith('<?', i)) {
      const end = mustFind(xml, '?>', i, 'processing instruction');
      const body = xml.slice(i + 2, end);
      const space = body.search(/\s/);
      const target = space < 0 ? body : body.slice(0, space);
      const data = space < 0 ? '' : body.slice(space + 1);
      push({ type: 'processingInstruction', target, data }, i);
      i = end + 2;
      continue;
    }

    if (xml.startsWith('<!--', i)) {
      const end = mustFind(xml, '-->', i, 'comment');
      push({ type: 'comment', value: xml.slice(i + 4, end) }, i);
      i = end + 3;
      continue;
    }

    if (xml.startsWith('<![CDATA[', i)) {
      const end = mustFind(xml, ']]>', i, 'CDATA section');
      push({ type: 'text', value: xml.slice(i + 9, end), cdata: true }, i);
      i = end + 3;
      continue;
    }

    if (xml.startsWith('<!', i)) {
      // A DOCTYPE or similar declaration. Skipped wholesale; the fake has no
      // business interpreting one, and the real parser rejects them.
      const end = mustFind(xml, '>', i, 'declaration');
      i = end + 1;
      continue;
    }

    if (xml.startsWith('</', i)) {
      const end = mustFind(xml, '>', i, 'end tag');
      const open = openNames.pop();
      if (open === undefined) throw new FakeXmlError('End tag with no matching start tag');
      scopes.pop();
      push({ type: 'endElement', uri: open.uri, localName: open.localName }, i);
      i = end + 1;
      continue;
    }

    // A start tag. The `>` cannot appear inside an attribute value in any
    // fixture we write, so a plain scan is enough here.
    const end = mustFind(xml, '>', i, 'start tag');
    let body = xml.slice(i + 1, end);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);

    const parsed = parseStartTag(body, scopes[scopes.length - 1] as Map<string, NamespaceUri>);
    scopes.push(parsed.scope);
    push(parsed.start, i);
    if (selfClosing) {
      // The interface guarantees a matching endElement even for `<foo/>`, and
      // `forEachChildElement` depends on it.
      scopes.pop();
      push({ type: 'endElement', uri: parsed.start.uri, localName: parsed.start.localName }, i);
    } else {
      openNames.push({ uri: parsed.start.uri, localName: parsed.start.localName });
    }
    i = end + 1;
  }

  if (openNames.length > 0) throw new FakeXmlError('Unclosed element at end of document');
  return events;
}

function parseStartTag(
  body: string,
  inherited: Map<string, NamespaceUri>,
): { readonly start: XmlStartElement; readonly scope: Map<string, NamespaceUri> } {
  const match = /^\s*([^\s/>]+)\s*/.exec(body);
  if (match === null) throw new FakeXmlError('Malformed start tag');
  const qname = match[1] as string;

  const rawAttrs: Array<{ qname: string; value: string }> = [];
  const attrPattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  attrPattern.lastIndex = match[0].length;
  for (let m = attrPattern.exec(body); m !== null; m = attrPattern.exec(body)) {
    rawAttrs.push({ qname: m[1] as string, value: decodeEntities((m[3] ?? m[4]) as string) });
  }

  const scope = new Map(inherited);
  const nsDeclarations = new Map<string, NamespaceUri>();
  for (const attr of rawAttrs) {
    if (attr.qname === 'xmlns') {
      scope.set('', attr.value);
      nsDeclarations.set('', attr.value);
    } else if (attr.qname.startsWith('xmlns:')) {
      const prefix = attr.qname.slice(6);
      scope.set(prefix, attr.value);
      nsDeclarations.set(prefix, attr.value);
    }
  }

  const attrs: XmlAttr[] = [];
  for (const attr of rawAttrs) {
    if (attr.qname === 'xmlns' || attr.qname.startsWith('xmlns:')) continue;
    const split = splitQName(attr.qname);
    // An unprefixed attribute is *not* in the default namespace — XML Namespaces
    // §6.2. Getting this backwards is the classic bug, and `attributeValue()`
    // looks for `uri === ''`, so it would make every OPC attribute invisible.
    const uri = split.prefix === '' ? '' : (scope.get(split.prefix) ?? '');
    attrs.push({ uri, localName: split.localName, prefix: split.prefix, value: attr.value });
  }

  const split = splitQName(qname);
  const uri = scope.get(split.prefix) ?? '';
  return {
    start: {
      type: 'startElement',
      uri,
      localName: split.localName,
      prefix: split.prefix,
      attrs,
      nsDeclarations,
      selfClosing: false,
    },
    scope,
  };
}

function splitQName(qname: string): { readonly prefix: string; readonly localName: string } {
  const colon = qname.indexOf(':');
  if (colon < 0) return { prefix: '', localName: qname };
  return { prefix: qname.slice(0, colon), localName: qname.slice(colon + 1) };
}

function mustFind(xml: string, needle: string, from: number, what: string): number {
  const index = xml.indexOf(needle, from);
  if (index < 0) throw new FakeXmlError(`Unterminated ${what}`);
  return index;
}

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    switch (body) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return whole;
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Cursor                                                                      */
/* -------------------------------------------------------------------------- */

class FakeCursor implements XmlCursor {
  #index = 0;

  constructor(private readonly events: readonly PositionedEvent[]) {}

  get current(): XmlEvent | undefined {
    return this.events[this.#index]?.event;
  }

  next(): XmlEvent | undefined {
    this.#index += 1;
    return this.current;
  }

  get position(): XmlPosition {
    return { offset: this.events[this.#index]?.offset ?? 0, line: 1, column: 1 };
  }

  skipToRaw(): RawNode {
    const start = this.current;
    if (start === undefined || start.type !== 'startElement') {
      throw new FakeXmlError('skipToRaw() requires the cursor to sit on a start element');
    }
    const children: RawChild[] = [];
    const stack: Array<{ node: RawNode; children: RawChild[] }> = [];
    const root: RawNode = {
      uri: start.uri,
      localName: start.localName,
      prefix: start.prefix,
      attrs: start.attrs,
      nsDeclarations: start.nsDeclarations,
      children,
    };
    let sink = children;

    for (let event = this.next(); event !== undefined; event = this.next()) {
      if (event.type === 'startElement') {
        const nested: RawChild[] = [];
        const node: RawNode = {
          uri: event.uri,
          localName: event.localName,
          prefix: event.prefix,
          attrs: event.attrs,
          nsDeclarations: event.nsDeclarations,
          children: nested,
        };
        sink.push(node);
        stack.push({ node, children: sink });
        sink = nested;
        continue;
      }
      if (event.type === 'endElement') {
        const parent = stack.pop();
        if (parent === undefined) {
          this.next();
          return root;
        }
        sink = parent.children;
        continue;
      }
      if (event.type === 'text')
        sink.push({ kind: 'text', value: event.value, cdata: event.cdata });
      else if (event.type === 'comment') sink.push({ kind: 'comment', value: event.value });
      else sink.push({ kind: 'pi', target: event.target, data: event.data });
    }
    return root;
  }

  skip(): void {
    this.skipToRaw();
  }
}

/* -------------------------------------------------------------------------- */
/* Sink                                                                        */
/* -------------------------------------------------------------------------- */

interface OpenElement {
  readonly uri: NamespaceUri;
  readonly localName: string;
  readonly attrs: Array<{ uri: NamespaceUri | null; localName: string; value: string }>;
  readonly nsDeclarations: Array<{ prefix: string; uri: NamespaceUri }>;
  readonly scope: Map<string, NamespaceUri>;
  /** Filled in when the tag is flushed; needed to write the matching end tag. */
  qname: string;
}

/**
 * A serializing sink.
 *
 * The one interesting decision: a start tag is not written until something
 * forces it out. `declareNamespace` is specified to be called *after*
 * `startElement` for the element it applies to, so the element's own prefix
 * cannot be chosen until the declarations are in. Writing eagerly and patching
 * afterwards would be the alternative, and it is worse.
 *
 * Elements are always closed with an explicit end tag rather than `/>`. The fake
 * is never asked to reproduce bytes — parts that were not modified are written
 * back from their original compressed bytes and never pass through here.
 */
class FakeStringSink implements XmlSink {
  #out = '';
  #pending: OpenElement | undefined;
  #stack: OpenElement[] = [];
  #autoPrefix = 0;

  result(): string {
    this.#flush();
    return this.#out;
  }

  startElement(uri: NamespaceUri, localName: string): void {
    this.#flush();
    const inherited = this.#stack[this.#stack.length - 1]?.scope ?? new Map<string, NamespaceUri>();
    this.#pending = {
      uri,
      localName,
      attrs: [],
      nsDeclarations: [],
      scope: new Map(inherited),
      qname: localName,
    };
  }

  attr(uri: NamespaceUri | null, localName: string, value: string): void {
    this.#require('attr').attrs.push({ uri, localName, value });
  }

  declareNamespace(prefix: string, uri: NamespaceUri): void {
    const open = this.#require('declareNamespace');
    open.nsDeclarations.push({ prefix, uri });
    open.scope.set(prefix, uri);
  }

  endElement(): void {
    if (this.#pending !== undefined) {
      this.#flush();
    }
    const open = this.#stack.pop();
    if (open === undefined) throw new FakeXmlError('endElement() with no open element');
    this.#out += `</${open.qname}>`;
  }

  text(value: string): void {
    this.#flush();
    this.#out += escapeText(value);
  }

  cdata(value: string): void {
    this.#flush();
    this.#out += `<![CDATA[${value}]]>`;
  }

  comment(value: string): void {
    this.#flush();
    this.#out += `<!--${value}-->`;
  }

  processingInstruction(target: string, data: string): void {
    this.#flush();
    this.#out += `<?${target}${data === '' ? '' : ` ${data}`}?>`;
  }

  raw(node: RawNode): void {
    this.#writeRaw(node);
  }

  #writeRaw(node: RawNode): void {
    this.startElement(node.uri, node.localName);
    for (const [prefix, uri] of node.nsDeclarations) this.declareNamespace(prefix, uri);
    for (const attr of node.attrs)
      this.attr(attr.uri === '' ? null : attr.uri, attr.localName, attr.value);
    for (const child of node.children) {
      // `RawChild` discriminates on the *presence* of `kind`: a nested element is
      // a bare `RawNode` with no tag of its own.
      if (!('kind' in child)) this.#writeRaw(child);
      else if (child.kind === 'text') {
        if (child.cdata) this.cdata(child.value);
        else this.text(child.value);
      } else if (child.kind === 'comment') this.comment(child.value);
      else this.processingInstruction(child.target, child.data);
    }
    this.endElement();
  }

  #require(what: string): OpenElement {
    if (this.#pending === undefined) {
      throw new FakeXmlError(`${what}() must be called while a start tag is open`);
    }
    return this.#pending;
  }

  #flush(): void {
    const open = this.#pending;
    if (open === undefined) return;
    this.#pending = undefined;

    const prefix = this.#prefixFor(open, open.uri);
    open.qname = prefix === '' ? open.localName : `${prefix}:${open.localName}`;

    this.#out += `<${open.qname}`;
    for (const declaration of open.nsDeclarations) {
      this.#out +=
        declaration.prefix === ''
          ? ` xmlns="${escapeAttr(declaration.uri)}"`
          : ` xmlns:${declaration.prefix}="${escapeAttr(declaration.uri)}"`;
    }
    for (const attr of open.attrs) {
      const attrPrefix =
        attr.uri === null || attr.uri === '' ? '' : this.#prefixFor(open, attr.uri, true);
      const name = attrPrefix === '' ? attr.localName : `${attrPrefix}:${attr.localName}`;
      this.#out += ` ${name}="${escapeAttr(attr.value)}"`;
    }
    this.#out += '>';
    this.#stack.push(open);
  }

  /**
   * Find a prefix bound to `uri`, inventing and declaring one if there is none.
   *
   * `requirePrefix` is set for attributes, which — unlike elements — are never
   * in the default namespace, so binding one to the empty prefix would change
   * their meaning.
   */
  #prefixFor(open: OpenElement, uri: NamespaceUri, requirePrefix = false): string {
    if (uri === '') return '';
    for (const [prefix, bound] of open.scope) {
      if (bound === uri && (!requirePrefix || prefix !== '')) return prefix;
    }
    const invented = `ns${this.#autoPrefix++}`;
    open.nsDeclarations.push({ prefix: invented, uri });
    open.scope.set(invented, uri);
    return invented;
  }
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#xD;')
    .replace(/\n/g, '&#xA;')
    .replace(/\t/g, '&#x9;');
}
