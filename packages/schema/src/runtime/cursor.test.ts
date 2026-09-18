import { describe, expect, it } from 'vitest';
import { createCursor, createCursorOverRaw } from './cursor.js';
import { XmlParseError, type RawNode, type XmlEvent } from './xml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Drain a cursor into a plain array, for whole-sequence assertions. */
function drain(xml: string): XmlEvent[] {
  const cursor = createCursor(xml);
  const events: XmlEvent[] = [];
  for (let ev = cursor.current; ev !== undefined; ev = cursor.next()) events.push(ev);
  return events;
}

function kinds(xml: string): string[] {
  return drain(xml).map((ev) => {
    switch (ev.type) {
      case 'startElement':
        return `<${ev.localName}`;
      case 'endElement':
        return `${ev.localName}>`;
      case 'text':
        return `${ev.cdata ? 'cdata' : 'text'}:${JSON.stringify(ev.value)}`;
      case 'comment':
        return `comment:${ev.value}`;
      case 'processingInstruction':
        return `pi:${ev.target}`;
    }
  });
}

describe('event sequence', () => {
  it('reports elements, attributes and namespaces', () => {
    const cursor = createCursor(`<w:p xmlns:w="${W}" w:rsidR="00A1"><w:r/></w:p>`);
    const start = cursor.current;
    expect(start?.type).toBe('startElement');
    if (start?.type !== 'startElement') throw new Error('unreachable');
    expect(start.uri).toBe(W);
    expect(start.localName).toBe('p');
    expect(start.prefix).toBe('w');
    expect(start.selfClosing).toBe(false);
    expect(start.attrs).toEqual([{ uri: W, localName: 'rsidR', prefix: 'w', value: '00A1' }]);
    expect([...start.nsDeclarations]).toEqual([['w', W]]);
  });

  it('lifts namespace declarations out of the attribute list', () => {
    // Leaving them in attrs would make every writer emit them twice.
    const cursor = createCursor(`<a xmlns="urn:d" xmlns:w="${W}" id="1"/>`);
    const start = cursor.current;
    if (start?.type !== 'startElement') throw new Error('unreachable');
    expect(start.attrs.map((a) => a.localName)).toEqual(['id']);
    expect([...start.nsDeclarations]).toEqual([
      ['', 'urn:d'],
      ['w', W],
    ]);
  });

  it('reports only the declarations made on each element, not the inherited ones', () => {
    const events = drain(`<r xmlns:a="urn:a"><c xmlns:b="urn:b"/></r>`);
    const [root, child] = events;
    if (root?.type !== 'startElement' || child?.type !== 'startElement') {
      throw new Error('unreachable');
    }
    expect([...root.nsDeclarations]).toEqual([['a', 'urn:a']]);
    expect([...child.nsDeclarations]).toEqual([['b', 'urn:b']]);
  });

  it('emits an endElement for a self-closing element', () => {
    // Every generated reader ends its child loop on endElement; without this a
    // self-closing element would swallow the rest of its parent.
    expect(kinds('<r><a/><b></b></r>')).toEqual(['<r', '<a', 'a>', '<b', 'b>', 'r>']);
  });

  it('flags self-closing so a writer can reproduce the shape', () => {
    const events = drain('<r><a/><b></b></r>');
    const [, a, , b] = events;
    if (a?.type !== 'startElement' || b?.type !== 'startElement') throw new Error('unreachable');
    expect(a.selfClosing).toBe(true);
    expect(b.selfClosing).toBe(false);
  });

  it('preserves attribute order', () => {
    const cursor = createCursor('<a z="1" m="2" a="3"/>');
    const start = cursor.current;
    if (start?.type !== 'startElement') throw new Error('unreachable');
    expect(start.attrs.map((a) => a.localName)).toEqual(['z', 'm', 'a']);
  });

  it('puts unprefixed attributes in no namespace', () => {
    // Namespaces in XML §6.2: the default namespace never applies to attributes.
    const cursor = createCursor('<a xmlns="urn:d" id="1"/>');
    const start = cursor.current;
    if (start?.type !== 'startElement') throw new Error('unreachable');
    expect(start.uri).toBe('urn:d');
    expect(start.attrs[0]?.uri).toBe('');
  });

  it('reads comments and processing instructions', () => {
    expect(kinds('<?pi-target data?><r><!-- note --></r>')).toEqual([
      'pi:pi-target',
      '<r',
      'comment: note ',
      'r>',
    ]);
  });
});

describe('text handling', () => {
  it('coalesces text split at an entity boundary', () => {
    // saxes reports "a", "&", "b" separately; a reader must never see that.
    expect(kinds('<t>a&amp;b</t>')).toEqual(['<t', 'text:"a&b"', 't>']);
  });

  it('coalesces text split around a character reference', () => {
    expect(kinds('<t>x&#65;y&#x42;z</t>')).toEqual(['<t', 'text:"xAyBz"', 't>']);
  });

  it('keeps CDATA separate from adjacent plain text', () => {
    // Same infoset, different bytes. The round-trip differ compares what we can
    // reproduce, so the distinction has to survive.
    expect(kinds('<t>a<![CDATA[b]]>c</t>')).toEqual([
      '<t',
      'text:"a"',
      'cdata:"b"',
      'text:"c"',
      't>',
    ]);
  });

  it('does not merge adjacent CDATA sections with each other', () => {
    expect(kinds('<t><![CDATA[a]]><![CDATA[b]]></t>')).toEqual([
      '<t',
      'cdata:"a"',
      'cdata:"b"',
      't>',
    ]);
  });

  it('preserves significant whitespace verbatim', () => {
    const events = drain('<t xml:space="preserve">  lead\tand trail  </t>');
    const text = events[1];
    if (text?.type !== 'text') throw new Error('unreachable');
    expect(text.value).toBe('  lead\tand trail  ');
  });

  it('exposes xml:space in the XML namespace without a declaration', () => {
    const cursor = createCursor('<t xml:space="preserve"/>');
    const start = cursor.current;
    if (start?.type !== 'startElement') throw new Error('unreachable');
    expect(start.attrs[0]).toEqual({
      uri: 'http://www.w3.org/XML/1998/namespace',
      localName: 'space',
      prefix: 'xml',
      value: 'preserve',
    });
  });
});

describe('DOCTYPE is a security boundary', () => {
  it('rejects a DOCTYPE outright', () => {
    const doc = '<!DOCTYPE r><r/>';
    expect(() => createCursor(doc)).toThrow(XmlParseError);
    try {
      createCursor(doc);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(XmlParseError);
      expect((err as XmlParseError).code).toBe('entity-rejected');
    }
  });

  it('rejects an internal subset before any entity can be declared', () => {
    // The billion-laughs shape. We never get as far as expanding anything.
    const bomb =
      '<!DOCTYPE lolz [<!ENTITY lol "lol">' +
      '<!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>' +
      '<lolz>&lol1;</lolz>';
    try {
      createCursor(bomb);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('entity-rejected');
    }
  });

  it('rejects an external DTD reference', () => {
    const xxe = '<!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>';
    try {
      createCursor(xxe);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('entity-rejected');
    }
  });

  it('reports a position for the rejection', () => {
    try {
      createCursor('\n<!DOCTYPE r><r/>');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).position.line).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('parse limits', () => {
  const limits = { maxDepth: 4, maxTextLength: 16, maxAttributes: 3 };

  it('enforces maxDepth', () => {
    expect(() => createCursor('<a><b><c><d/></c></b></a>', limits)).not.toThrow();
    try {
      createCursor('<a><b><c><d><e/></d></c></b></a>', limits);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('depth-exceeded');
      expect((err as XmlParseError).message).toContain('5');
    }
  });

  it('enforces maxTextLength across the whole document, not per node', () => {
    expect(() => createCursor('<a>0123456789</a>', limits)).not.toThrow();
    try {
      // Two nodes of ten characters: neither is over the limit on its own.
      createCursor('<a><b>0123456789</b><c>0123456789</c></a>', limits);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('text-length-exceeded');
    }
  });

  it('counts CDATA towards maxTextLength', () => {
    try {
      createCursor('<a><![CDATA[0123456789ABCDEFGH]]></a>', limits);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('text-length-exceeded');
    }
  });

  it('enforces maxAttributes', () => {
    expect(() => createCursor('<a p="1" q="2" r="3"/>', limits)).not.toThrow();
    try {
      createCursor('<a p="1" q="2" r="3" s="4"/>', limits);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('attribute-count-exceeded');
    }
  });

  it('does not count namespace declarations against the attribute limit', () => {
    // They are not attributes as far as the cursor's consumers are concerned,
    // and Word declares fifteen of them on w:document.
    expect(() => createCursor(`<a xmlns:w="${W}" xmlns:x="urn:x" p="1"/>`, limits)).not.toThrow();
  });

  it('defaults to limits generous enough for a real part', () => {
    const deep = '<a>'.repeat(100) + '</a>'.repeat(100);
    expect(() => createCursor(deep)).not.toThrow();
  });
});

describe('well-formedness failures', () => {
  it('classifies a truncated document as unexpected-eof', () => {
    try {
      createCursor('<a><b></b>');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(XmlParseError);
      expect((err as XmlParseError).code).toBe('unexpected-eof');
    }
  });

  it('classifies an empty document as unexpected-eof', () => {
    try {
      createCursor('');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('unexpected-eof');
    }
  });

  it('classifies a mismatched tag as malformed', () => {
    try {
      createCursor('<a></b>');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('malformed');
    }
  });

  it('fails eagerly, at createCursor, not at the first next()', () => {
    // A reader should not get half a document before learning the tail is bad.
    expect(() => createCursor('<a><b></a>')).toThrow(XmlParseError);
  });
});

describe('position', () => {
  it('points at the start of the tag', () => {
    const cursor = createCursor('<r>\n  <w/>\n</r>');
    cursor.next();
    cursor.next();
    const at = cursor.position;
    expect(at.line).toBe(2);
    expect(cursor.current?.type).toBe('startElement');
    expect(at.offset).toBeGreaterThan(0);
  });

  it('reports a position at end of input', () => {
    const cursor = createCursor('<r/>');
    while (cursor.current !== undefined) cursor.next();
    expect(cursor.position.line).toBeGreaterThanOrEqual(1);
  });
});

describe('skipToRaw', () => {
  const doc =
    `<w:body xmlns:w="${W}">` +
    `<w:p/>` +
    `<w:tbl w:id="7" a="1" xmlns:x="urn:x">` +
    `<!-- c --><x:ext v="&amp;"><![CDATA[<raw>]]>tail</x:ext><?target body?>` +
    `</w:tbl>` +
    `<w:sectPr/>` +
    `</w:body>`;

  function tbl(): RawNode {
    const cursor = createCursor(doc);
    cursor.next(); // w:p start
    cursor.next(); // w:p end
    cursor.next(); // w:tbl start
    return cursor.skipToRaw();
  }

  it('captures the element itself verbatim', () => {
    const node = tbl();
    expect(node.uri).toBe(W);
    expect(node.localName).toBe('tbl');
    expect(node.prefix).toBe('w');
    expect(node.attrs).toEqual([
      { uri: W, localName: 'id', prefix: 'w', value: '7' },
      { uri: '', localName: 'a', prefix: '', value: '1' },
    ]);
    expect([...node.nsDeclarations]).toEqual([['x', 'urn:x']]);
  });

  it('captures every kind of child in order', () => {
    const node = tbl();
    expect(node.children).toEqual([
      { kind: 'comment', value: ' c ' },
      {
        uri: 'urn:x',
        localName: 'ext',
        prefix: 'x',
        attrs: [{ uri: '', localName: 'v', prefix: '', value: '&' }],
        nsDeclarations: new Map(),
        children: [
          { kind: 'text', value: '<raw>', cdata: true },
          { kind: 'text', value: 'tail', cdata: false },
        ],
      },
      { kind: 'pi', target: 'target', data: 'body' },
    ]);
  });

  it('leaves the cursor on the event after the matching endElement', () => {
    const cursor = createCursor(doc);
    cursor.next();
    cursor.next();
    cursor.next();
    cursor.skipToRaw();
    const after = cursor.current;
    expect(after?.type).toBe('startElement');
    if (after?.type !== 'startElement') throw new Error('unreachable');
    expect(after.localName).toBe('sectPr');
  });

  it('captures a self-closing element as an empty node', () => {
    const cursor = createCursor('<r><a x="1"/><b/></r>');
    cursor.next();
    const node = cursor.skipToRaw();
    expect(node.localName).toBe('a');
    expect(node.children).toEqual([]);
    expect(cursor.current?.type).toBe('startElement');
  });

  it('captures nested elements of the same name without stopping early', () => {
    const cursor = createCursor('<a><a><a/></a></a><!--x-->');
    const node = cursor.skipToRaw();
    expect(node.localName).toBe('a');
    expect(node.children).toHaveLength(1);
    expect(cursor.current).toEqual({ type: 'comment', value: 'x' });
  });

  it('refuses to run when the cursor is not on a start element', () => {
    const cursor = createCursor('<r>text</r>');
    cursor.next();
    expect(() => cursor.skipToRaw()).toThrow(/startElement/);
  });

  it('refuses to run at end of document', () => {
    const cursor = createCursor('<r/>');
    cursor.next();
    cursor.next();
    try {
      cursor.skipToRaw();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as XmlParseError).code).toBe('unexpected-eof');
    }
  });
});

describe('skip', () => {
  it('consumes a subtree and lands after it', () => {
    const cursor = createCursor('<r><a><b/><c/></a><d/></r>');
    cursor.next();
    cursor.skip();
    const after = cursor.current;
    if (after?.type !== 'startElement') throw new Error('unreachable');
    expect(after.localName).toBe('d');
  });

  it('lands in the same place as skipToRaw', () => {
    const xml = '<r><a><b/></a><d/></r>';
    const skipped = createCursor(xml);
    skipped.next();
    skipped.skip();
    const captured = createCursor(xml);
    captured.next();
    captured.skipToRaw();
    expect(skipped.current).toEqual(captured.current);
  });
});

describe('createCursorOverRaw', () => {
  it('replays a captured subtree as events', () => {
    const source = createCursor('<r xmlns:w="urn:w"><w:a k="1">t<!--c--></w:a></r>');
    source.next();
    const node = source.skipToRaw();

    const replayed = createCursorOverRaw(node);
    const events: XmlEvent[] = [];
    for (let ev = replayed.current; ev !== undefined; ev = replayed.next()) events.push(ev);

    expect(events.map((e) => e.type)).toEqual([
      'startElement',
      'text',
      'comment',
      'endElement',
    ]);
    const start = events[0];
    if (start?.type !== 'startElement') throw new Error('unreachable');
    expect(start.uri).toBe('urn:w');
    expect(start.localName).toBe('a');
  });

  it('replays a list of children, which is what a selected MCE branch is', () => {
    const source = createCursor('<r><x/><y/></r>');
    const node = source.skipToRaw();
    const replayed = createCursorOverRaw(node.children);
    const names: string[] = [];
    for (let ev = replayed.current; ev !== undefined; ev = replayed.next()) {
      if (ev.type === 'startElement') names.push(ev.localName);
    }
    expect(names).toEqual(['x', 'y']);
  });

  it('produces a cursor that skipToRaw can consume again', () => {
    const source = createCursor('<r><a><b/></a></r>');
    const node = source.skipToRaw();
    const replayed = createCursorOverRaw(node.children);
    const again = replayed.skipToRaw();
    expect(again.localName).toBe('a');
    expect(again.children).toHaveLength(1);
  });

  it('is empty for empty content', () => {
    expect(createCursorOverRaw([]).current).toBeUndefined();
  });
});
