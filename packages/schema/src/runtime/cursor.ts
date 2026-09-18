/**
 * `XmlCursor` over `saxes`.
 *
 * ## The impedance mismatch
 *
 * `saxes` is push-based: you register handlers and it calls them as it consumes
 * a chunk. `XmlCursor` is pull-based, because a recursive-descent reader over a
 * callback API has to be written as an explicit state machine, and we have ~2,800
 * generated readers (see `xml.ts`). Bridging push → pull in JavaScript without
 * coroutines means one of three things:
 *
 * 1. Parse eagerly into an event array, then walk it. Simple, obviously correct.
 * 2. Feed the parser in chunks and buffer events until the consumer has one.
 *    Genuinely incremental; more moving parts.
 * 3. Generators, with the parser driven from inside `next()`. `saxes` cannot be
 *    driven that way — `write()` runs to completion of the chunk.
 *
 * **This implementation is (1).** It is correct today and it is the thing to get
 * right first. The cost is honest and worth stating: peak memory is the source
 * string *plus* one event object per token. For a 40 MB `document.xml` that is
 * roughly 1.5–2 M events; at a conservative ~100 bytes of object overhead each
 * that is ~150–200 MB held while parsing, on top of the 80 MB the JS string
 * itself costs. That is survivable for the documents we target now and it is not
 * survivable for the largest ones, which is exactly what ADR-0006 flags as the
 * reason not to build a DOM.
 *
 * The replacement path is deliberately left open. Every access this file makes
 * to the event sequence goes through {@link EventFeed}, which is forward-only:
 * `peek()` and `advance()`, nothing else — no random access, no length, no
 * rewind. An incremental feed that writes chunks into `saxes` on demand and
 * buffers only the events not yet consumed satisfies the same two methods, and
 * no caller (and no generated reader) changes. That is the whole reason the
 * indirection exists; do not add an index-based accessor to it.
 *
 * ## DOCTYPE
 *
 * Rejected outright, with `code: 'entity-rejected'`. This is a security
 * boundary, not a strictness preference: a DTD internal subset is how you get
 * XXE (external entity → local file read / SSRF) and the billion-laughs
 * expansion bomb. No legitimate OOXML part has a DOCTYPE — ECMA-376 Part 2
 * forbids DTDs in package parts outright — so nothing is lost by refusing.
 * `saxes` itself does not resolve external entities and ignores internal-subset
 * entity declarations, so this is defence in depth rather than the only guard,
 * but it is the guard that produces a diagnosable error instead of silently
 * dropping markup.
 */

import { SaxesParser } from 'saxes';
import {
  DEFAULT_PARSE_LIMITS,
  XmlParseError,
  type NamespaceUri,
  type RawChild,
  type RawNode,
  type XmlAttr,
  type XmlCursor,
  type XmlEvent,
  type XmlParseLimits,
  type XmlPosition,
} from './xml.js';

/** An event paired with where it was found. */
interface PositionedEvent {
  readonly event: XmlEvent;
  readonly position: XmlPosition;
}

/**
 * The only way this file reads the event sequence: forward-only, one event of
 * lookahead. See the file header — an incremental parser implements exactly
 * this and nothing about the cursor changes.
 */
interface EventFeed {
  /** The event at the cursor, without consuming it. */
  peek(): PositionedEvent | undefined;
  /** Consume the event at the cursor. No-op at end of input. */
  advance(): void;
  /** Position to report once the feed is exhausted. */
  readonly endPosition: XmlPosition;
}

const ORIGIN: XmlPosition = { line: 1, column: 0, offset: 0 };

class ArrayFeed implements EventFeed {
  #index = 0;

  constructor(private readonly events: readonly PositionedEvent[]) {}

  peek(): PositionedEvent | undefined {
    return this.events[this.#index];
  }

  advance(): void {
    if (this.#index < this.events.length) this.#index += 1;
  }

  get endPosition(): XmlPosition {
    return this.events[this.events.length - 1]?.position ?? ORIGIN;
  }
}

/**
 * Mutable shape used while building a `RawNode`. `RawNode` is readonly by
 * contract — nothing mutates one once it is handed out — so the builder exists
 * only inside `skipToRaw`.
 */
interface RawNodeBuilder {
  uri: NamespaceUri;
  localName: string;
  prefix: string;
  attrs: XmlAttr[];
  nsDeclarations: Map<string, NamespaceUri>;
  children: RawChild[];
}

class FeedCursor implements XmlCursor {
  constructor(private readonly feed: EventFeed) {}

  get current(): XmlEvent | undefined {
    return this.feed.peek()?.event;
  }

  next(): XmlEvent | undefined {
    this.feed.advance();
    return this.current;
  }

  get position(): XmlPosition {
    return this.feed.peek()?.position ?? this.feed.endPosition;
  }

  /**
   * Capture the element at the cursor and everything under it.
   *
   * On return the cursor sits on the event *after* the element's `endElement` —
   * the subtree is fully consumed, so a reader's child loop can call this and
   * then continue looping without an extra `next()`.
   */
  skipToRaw(): RawNode {
    const start = this.requireStart('skipToRaw');

    const root: RawNodeBuilder = {
      uri: start.uri,
      localName: start.localName,
      prefix: start.prefix,
      attrs: [...start.attrs],
      nsDeclarations: new Map(start.nsDeclarations),
      children: [],
    };
    this.feed.advance();

    const stack: RawNodeBuilder[] = [root];
    for (;;) {
      const entry = this.feed.peek();
      if (entry === undefined) {
        throw new XmlParseError(
          `unterminated element <${start.localName}> while capturing raw content`,
          this.position,
          'unexpected-eof',
        );
      }
      const top = stack[stack.length - 1];
      // Unreachable: the loop returns when the stack empties.
      /* c8 ignore next */
      if (top === undefined) throw new Error('raw capture stack underflow');

      const ev = entry.event;
      switch (ev.type) {
        case 'startElement': {
          const child: RawNodeBuilder = {
            uri: ev.uri,
            localName: ev.localName,
            prefix: ev.prefix,
            attrs: [...ev.attrs],
            nsDeclarations: new Map(ev.nsDeclarations),
            children: [],
          };
          top.children.push(child as RawNode);
          stack.push(child);
          break;
        }
        case 'endElement': {
          stack.pop();
          this.feed.advance();
          if (stack.length === 0) return root as RawNode;
          continue;
        }
        case 'text':
          top.children.push({ kind: 'text', value: ev.value, cdata: ev.cdata });
          break;
        case 'comment':
          top.children.push({ kind: 'comment', value: ev.value });
          break;
        case 'processingInstruction':
          top.children.push({ kind: 'pi', target: ev.target, data: ev.data });
          break;
      }
      this.feed.advance();
    }
  }

  /** As `skipToRaw`, but discards. Same cursor position on return. */
  skip(): void {
    this.requireStart('skip');
    this.feed.advance();

    let depth = 1;
    while (depth > 0) {
      const entry = this.feed.peek();
      if (entry === undefined) {
        throw new XmlParseError(
          'unterminated element while skipping',
          this.position,
          'unexpected-eof',
        );
      }
      if (entry.event.type === 'startElement') depth += 1;
      else if (entry.event.type === 'endElement') depth -= 1;
      this.feed.advance();
    }
  }

  private requireStart(caller: string): XmlEvent & { type: 'startElement' } {
    const ev = this.current;
    if (ev === undefined) {
      throw new XmlParseError(`${caller}() called at end of document`, this.position, 'unexpected-eof');
    }
    if (ev.type !== 'startElement') {
      // A caller bug, not a document problem: the reader asked to consume a
      // subtree while standing on something that is not an element start.
      throw new XmlParseError(
        `${caller}() requires the cursor to be on a startElement, found ${ev.type}`,
        this.position,
        'malformed',
      );
    }
    return ev;
  }
}

/**
 * Parse `xml` and return a cursor over it.
 *
 * Parsing happens eagerly, here — a malformed document or a tripped limit throws
 * from this call, not from the first `next()`. That is deliberate: a reader
 * should not get half a document before finding out the tail is corrupt.
 */
export function createCursor(xml: string, limits: XmlParseLimits = DEFAULT_PARSE_LIMITS): XmlCursor {
  return new FeedCursor(new ArrayFeed(parseAll(xml, limits)));
}

/**
 * A cursor over already-captured content.
 *
 * Used by the Markup Compatibility layer: `mc:AlternateContent` is captured
 * whole (so the unselected branches survive to be written back), and then the
 * *selected* branch's children are replayed through this so ordinary generated
 * readers can consume them. Positions are synthetic — the source offsets are
 * long gone by then — so diagnostics raised against this cursor report the
 * origin, and say so.
 */
export function createCursorOverRaw(content: RawNode | readonly RawChild[]): XmlCursor {
  const children: readonly RawChild[] = Array.isArray(content)
    ? (content as readonly RawChild[])
    : [content as RawNode];
  const events: PositionedEvent[] = [];
  for (const child of children) emitRaw(child, events);
  return new FeedCursor(new ArrayFeed(events));
}

function emitRaw(child: RawChild, out: PositionedEvent[]): void {
  if ('kind' in child) {
    switch (child.kind) {
      case 'text':
        out.push({
          event: { type: 'text', value: child.value, cdata: child.cdata },
          position: ORIGIN,
        });
        return;
      case 'comment':
        out.push({ event: { type: 'comment', value: child.value }, position: ORIGIN });
        return;
      case 'pi':
        out.push({
          event: { type: 'processingInstruction', target: child.target, data: child.data },
          position: ORIGIN,
        });
        return;
    }
  }
  const node = child;
  out.push({
    event: {
      type: 'startElement',
      uri: node.uri,
      localName: node.localName,
      prefix: node.prefix,
      attrs: node.attrs,
      nsDeclarations: node.nsDeclarations,
      selfClosing: node.children.length === 0,
    },
    position: ORIGIN,
  });
  for (const grandchild of node.children) emitRaw(grandchild, out);
  out.push({
    event: { type: 'endElement', uri: node.uri, localName: node.localName },
    position: ORIGIN,
  });
}

/* ------------------------------------------------------------------------- */
/* The eager parse                                                            */
/* ------------------------------------------------------------------------- */

function parseAll(xml: string, limits: XmlParseLimits): PositionedEvent[] {
  const events: PositionedEvent[] = [];
  const parser = new SaxesParser<{ xmlns: true; position: true }>({ xmlns: true, position: true });

  let depth = 0;
  let textTotal = 0;
  // Position of the `<` of the tag currently being read. `saxes` reports the
  // position of the *next* character, so by the time `opentag` fires we are
  // already past `>`; for a depth-limit or attribute-limit error the useful
  // place to point at is the tag name.
  let tagStart: XmlPosition = ORIGIN;

  const here = (): XmlPosition => ({
    line: parser.line,
    column: parser.column,
    offset: parser.position,
  });

  parser.on('doctype', () => {
    throw new XmlParseError(
      'DOCTYPE is rejected: DTDs enable entity expansion and external entity attacks, ' +
        'and no conformant OOXML part contains one',
      here(),
      'entity-rejected',
    );
  });

  parser.on('opentagstart', () => {
    tagStart = here();
  });

  parser.on('opentag', (tag) => {
    depth += 1;
    if (depth > limits.maxDepth) {
      throw new XmlParseError(
        `nesting depth ${depth} exceeds the limit of ${limits.maxDepth}`,
        tagStart,
        'depth-exceeded',
      );
    }

    // `saxes` keys `attributes` by the source qualified name and fills it by
    // iterating the attribute list in document order, so `Object.values` is
    // document order. That ordering is load-bearing for round-trip.
    const all = Object.values(tag.attributes);
    if (all.length > limits.maxAttributes) {
      throw new XmlParseError(
        `element <${tag.name}> has ${all.length} attributes, exceeding the limit of ${limits.maxAttributes}`,
        tagStart,
        'attribute-count-exceeded',
      );
    }

    const attrs: XmlAttr[] = [];
    for (const a of all) {
      // Namespace declarations are lifted out of the attribute list and reported
      // as `nsDeclarations`; leaving them in `attrs` would make every writer
      // emit them twice.
      if (a.name === 'xmlns' || a.prefix === 'xmlns') continue;
      attrs.push({ uri: a.uri, localName: a.local, prefix: a.prefix, value: a.value });
    }

    events.push({
      event: {
        type: 'startElement',
        uri: tag.uri,
        localName: tag.local,
        prefix: tag.prefix,
        attrs,
        // `tag.ns` holds the declarations made *on this element only*, which is
        // exactly the contract of `XmlStartElement.nsDeclarations`.
        nsDeclarations: new Map(Object.entries(tag.ns)),
        selfClosing: tag.isSelfClosing,
      },
      position: tagStart,
    });
  });

  parser.on('closetag', (tag) => {
    depth -= 1;
    events.push({
      event: { type: 'endElement', uri: tag.uri, localName: tag.local },
      position: here(),
    });
  });

  parser.on('text', (value) => {
    textTotal += value.length;
    if (textTotal > limits.maxTextLength) {
      throw new XmlParseError(
        `total text content exceeds the limit of ${limits.maxTextLength} characters`,
        here(),
        'text-length-exceeded',
      );
    }
    // Coalesce adjacent plain text. `saxes` splits a text node at entity and
    // chunk boundaries, so `a&amp;b` can arrive as several events; a reader that
    // sees `w:t` content in pieces would have to reassemble it itself, and
    // every one of 2,800 readers getting that right is not a bet worth taking.
    const prev = events[events.length - 1];
    if (prev !== undefined && prev.event.type === 'text' && !prev.event.cdata) {
      events[events.length - 1] = {
        event: { type: 'text', value: prev.event.value + value, cdata: false },
        position: prev.position,
      };
      return;
    }
    events.push({ event: { type: 'text', value, cdata: false }, position: here() });
  });

  parser.on('cdata', (value) => {
    textTotal += value.length;
    if (textTotal > limits.maxTextLength) {
      throw new XmlParseError(
        `total text content exceeds the limit of ${limits.maxTextLength} characters`,
        here(),
        'text-length-exceeded',
      );
    }
    // Never merged with adjacent plain text, and not merged with an adjacent
    // CDATA section either. `<![CDATA[a]]><![CDATA[b]]>` and `<![CDATA[ab]]>`
    // have identical infosets but different bytes, and the round-trip differ
    // compares what we can reproduce, not what a validator would accept.
    events.push({ event: { type: 'text', value, cdata: true }, position: here() });
  });

  parser.on('comment', (value) => {
    events.push({ event: { type: 'comment', value }, position: here() });
  });

  parser.on('processinginstruction', (pi) => {
    events.push({
      event: { type: 'processingInstruction', target: pi.target, data: pi.body },
      position: here(),
    });
  });

  try {
    parser.write(xml).close();
  } catch (err) {
    if (err instanceof XmlParseError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new XmlParseError(message, here(), classifyFailure(message));
  }

  return events;
}

/**
 * `saxes` reports every well-formedness failure as a plain `Error` with a
 * message. The distinction we care about downstream is "the document stopped in
 * the middle" (a truncated part, usually a damaged ZIP entry) versus "the
 * document is wrong" — the first is worth a different message to the user.
 */
function classifyFailure(message: string): 'malformed' | 'unexpected-eof' {
  return /unclosed tag|unexpected end|must contain a root element/i.test(message)
    ? 'unexpected-eof'
    : 'malformed';
}
