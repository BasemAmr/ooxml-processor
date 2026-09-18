import { describe, expect, it } from 'vitest';
import { createCursor } from './cursor.js';
import { MC_NAMESPACE, XML_NAMESPACE } from './namespaces.js';
import {
  createRawSink,
  createStringSink,
  escapeAttributeValue,
  escapeText,
  XmlSinkError,
} from './sink.js';
import type { NamespaceUri, RawChild, RawNode, XmlSink } from './xml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function write(build: (sink: XmlSink) => void, options?: Parameters<typeof createStringSink>[0]) {
  const { sink, toString } = createStringSink(options ?? {});
  build(sink);
  return toString();
}

/**
 * Control characters and lone surrogates, constructed rather than written.
 * A literal one in a source file makes the file unreadable to half the
 * toolchain — which is very nearly the reason XML refuses them too.
 */
const NUL = String.fromCharCode(0x00);
const SOH = String.fromCharCode(0x01);
const US = String.fromCharCode(0x1f);
const LONE_SURROGATE = String.fromCharCode(0xd800);

describe('escaping', () => {
  it('escapes exactly the three characters text requires', () => {
    expect(escapeText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('does not over-escape', () => {
    // Apostrophes and quotes are legal raw in text; escaping them would make
    // every diff against Word's output noisy for no benefit.
    expect(escapeText(`it's "quoted"`)).toBe(`it's "quoted"`);
    expect(escapeText('naïve — 日本語 🙂')).toBe('naïve — 日本語 🙂');
  });

  it('preserves a literal tab in text', () => {
    // w:t content carries real tab characters; a tab is not a markup character
    // and XML 1.0 does not normalize it inside element content.
    expect(escapeText('before\tafter')).toBe('before\tafter');
    expect(write((s) => {
      s.startElement(W, 't');
      s.attr(XML_NAMESPACE, 'space', 'preserve');
      s.text('  a\tb  ');
      s.endElement();
    })).toContain('>  a\tb  <');
  });

  it('escapes a carriage return in text', () => {
    // XML 1.0 §2.11: a literal CR in content is normalized to LF on parse, so
    // the only way to round-trip one is as a character reference.
    expect(escapeText('a\rb')).toBe('a&#xD;b');
    expect(escapeText('a\nb')).toBe('a\nb');
  });

  it('escapes exactly what an attribute value requires', () => {
    expect(escapeAttributeValue('a & b < c > d "q" \'s\'')).toBe(
      'a &amp; b &lt; c &gt; d &quot;q&quot; \'s\'',
    );
  });

  it('escapes tab, newline and carriage return in attribute values', () => {
    // XML 1.0 §3.3.3 attribute-value normalization turns literal whitespace into
    // spaces on parse. Character references survive it.
    expect(escapeAttributeValue('a\tb\nc\rd')).toBe('a&#x9;b&#xA;c&#xD;d');
  });

  it('refuses characters XML 1.0 cannot represent at all', () => {
    expect(() => escapeText('a' + NUL + 'b')).toThrow(XmlSinkError);
    expect(() => escapeText('a' + SOH + 'b')).toThrow(/U\+0001/);
    expect(() => escapeAttributeValue(US)).toThrow(XmlSinkError);
    // \t, \n, \r are the three control characters XML does allow.
    expect(() => escapeText('\t\n\r')).not.toThrow();
  });

  it('refuses an unpaired surrogate', () => {
    expect(() => escapeText('a' + LONE_SURROGATE + 'b')).toThrow(/unpaired surrogate/);
    expect(() => escapeText('a🙂b')).not.toThrow();
  });
});

describe('element output', () => {
  it('writes a childless element self-closed, as Word does', () => {
    expect(write((s) => {
      s.startElement(W, 'b');
      s.endElement();
    })).toBe(`<w:b xmlns:w="${W}"/>`);
  });

  it('writes attributes in the order they are added', () => {
    expect(write((s) => {
      s.startElement(W, 'p');
      s.attr(W, 'rsidR', '00A1');
      s.attr(null, 'plain', 'x');
      s.endElement();
    })).toBe(`<w:p xmlns:w="${W}" w:rsidR="00A1" plain="x"/>`);
  });

  it('writes an XML declaration on request, with Word CRLF', () => {
    const out = write(
      (s) => {
        s.startElement(W, 'document');
        s.endElement();
      },
      { xmlDeclaration: true },
    );
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n')).toBe(true);
  });

  it('is idempotent', () => {
    const { sink, toString } = createStringSink();
    sink.startElement(W, 'p');
    expect(toString()).toBe(toString());
    sink.endElement();
    expect(toString()).toBe(toString());
  });

  it('can be read part-way through', () => {
    const { sink, toString } = createStringSink();
    sink.startElement(W, 'p');
    sink.startElement(W, 'r');
    expect(toString()).toContain('<w:r');
    sink.endElement();
    sink.endElement();
  });
});

describe('namespace handling', () => {
  it('assigns the conventional prefix from the namespace table', () => {
    // Not cosmetic: ns1:/ns2: prefixes make every save a whole-file diff.
    const out = write((s) => {
      s.startElement(W, 'p');
      s.attr(R, 'id', 'rId1');
      s.endElement();
    });
    expect(out).toBe(`<w:p xmlns:w="${W}" xmlns:r="${R}" r:id="rId1"/>`);
  });

  it('hoists declarations to the root element by default', () => {
    const out = write((s) => {
      s.startElement(W, 'body');
      s.startElement(W, 'p');
      s.startElement(MC_NAMESPACE, 'AlternateContent');
      s.endElement();
      s.endElement();
      s.endElement();
    });
    expect(out).toBe(
      `<w:body xmlns:w="${W}" xmlns:mc="${MC_NAMESPACE}"><w:p><mc:AlternateContent/></w:p></w:body>`,
    );
  });

  it('declares locally when hoisting is off', () => {
    const out = write(
      (s) => {
        s.startElement(W, 'body');
        s.startElement('urn:late', 'x');
        s.endElement();
        s.endElement();
      },
      { hoistNamespaces: false },
    );
    expect(out).toBe(`<w:body xmlns:w="${W}"><ns:x xmlns:ns="urn:late"/></w:body>`);
  });

  it('honours caller-supplied prefix overrides', () => {
    const out = write(
      (s) => {
        s.startElement(W, 'p');
        s.endElement();
      },
      { prefixes: { [W]: 'wordml' } },
    );
    expect(out).toBe(`<wordml:p xmlns:wordml="${W}"/>`);
  });

  it('suffixes a digit when the conventional prefix is taken', () => {
    const out = write((s) => {
      s.startElement('urn:one', 'a');
      s.declareNamespace('ns', 'urn:one');
      s.startElement('urn:two', 'b');
      s.endElement();
      s.endElement();
    });
    expect(out).toContain('xmlns:ns1="urn:two"');
  });

  it('reuses a prefix already in scope rather than declaring another', () => {
    const out = write((s) => {
      s.startElement(W, 'p');
      s.startElement(W, 'r');
      s.endElement();
      s.endElement();
    });
    expect(out.match(/xmlns:w=/g)).toHaveLength(1);
  });

  it('forces a declaration on the current element via declareNamespace', () => {
    const out = write((s) => {
      s.startElement(W, 'body');
      s.startElement(W, 'p');
      s.declareNamespace('x', 'urn:x');
      s.endElement();
      s.endElement();
    });
    expect(out).toBe(`<w:body xmlns:w="${W}"><w:p xmlns:x="urn:x"/></w:body>`);
  });

  it('never gives a namespaced attribute an unprefixed name', () => {
    // An unprefixed attribute is in no namespace (Namespaces in XML §6.2), so
    // the default namespace is never usable for one.
    const out = write((s) => {
      s.startElement(W, 'p');
      s.declareNamespace('', W);
      s.attr(W, 'val', '1');
      s.endElement();
    });
    expect(out).toMatch(/\sw\d*:val="1"/);
  });

  it('uses the implicit xml prefix without declaring it', () => {
    const out = write((s) => {
      s.startElement(W, 't');
      s.attr(XML_NAMESPACE, 'space', 'preserve');
      s.text(' ');
      s.endElement();
    });
    expect(out).toContain('xml:space="preserve"');
    expect(out).not.toContain('xmlns:xml');
  });

  it('refuses to rebind a reserved prefix', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.declareNamespace('xml', 'urn:nope');
      }),
    ).toThrow(/reserved/);
  });

  it('undeclares the default namespace with xmlns="" rather than hoisting it', () => {
    // Hoisting xmlns="" to the root would undeclare the default for the whole
    // document, which is the opposite of what the local element asked for.
    const out = write((s) => {
      s.startElement('urn:d', 'root');
      s.declareNamespace('', 'urn:d');
      s.startElement('', 'bare');
      s.endElement();
      s.endElement();
    });
    expect(out).toBe('<root xmlns="urn:d"><bare xmlns=""/></root>');
  });

  it('rejects namespace declarations smuggled through attr()', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.attr('http://www.w3.org/2000/xmlns/', 'w', W);
      }),
    ).toThrow(/declareNamespace/);
  });
});

describe('ordering and well-formedness guards', () => {
  it('rejects attr() after a child element', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.startElement(W, 'r');
        s.endElement();
        s.attr(null, 'late', '1');
      }),
    ).toThrow(/after a child was emitted/);
  });

  it('rejects attr() after text', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 't');
        s.text('hello');
        s.attr(null, 'late', '1');
      }),
    ).toThrow(XmlSinkError);
  });

  it('rejects attr() with no element open', () => {
    expect(() => write((s) => s.attr(null, 'a', '1'))).toThrow(/no element open/);
  });

  it('rejects a duplicate attribute', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.attr(W, 'val', '1');
        s.attr(W, 'val', '2');
      }),
    ).toThrow(/duplicate attribute/);
  });

  it('rejects endElement with nothing open', () => {
    expect(() => write((s) => s.endElement())).toThrow(/no open element/);
  });

  it('rejects a second root element', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 'a');
        s.endElement();
        s.startElement(W, 'b');
      }),
    ).toThrow(/second root element/);
  });

  it('rejects text outside the root', () => {
    expect(() => write((s) => s.text('stray'))).toThrow(/outside the root/);
    expect(() => write((s) => s.text('  \n'))).not.toThrow();
  });

  it('rejects a name that is not an NCName', () => {
    expect(() => write((s) => s.startElement(W, '1bad'))).toThrow(/element name/);
    expect(() => write((s) => s.startElement(W, 'w:p'))).toThrow(/element name/);
  });

  it('rejects comments XML cannot express', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.comment('a -- b');
      }),
    ).toThrow(/--/);
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.comment('trailing-');
      }),
    ).toThrow(XmlSinkError);
  });

  it('rejects a reserved or malformed processing instruction', () => {
    expect(() => write((s) => s.processingInstruction('xml', 'version="1.0"'))).toThrow(/reserved/);
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.processingInstruction('t', 'a ?> b');
      }),
    ).toThrow(/\?>/);
  });
});

describe('CDATA', () => {
  it('writes a CDATA section', () => {
    expect(write((s) => {
      s.startElement(W, 't');
      s.cdata('<not markup>');
      s.endElement();
    })).toContain('<![CDATA[<not markup>]]>');
  });

  it('splits a section that contains the terminator', () => {
    const out = write((s) => {
      s.startElement(W, 't');
      s.cdata('a]]>b');
      s.endElement();
    });
    expect(out).toContain(']]]]><![CDATA[>');
    // The point of the split is that the content survives a reparse.
    const cursor = createCursor(out);
    cursor.next();
    let text = '';
    for (let ev = cursor.current; ev !== undefined; ev = cursor.next()) {
      if (ev.type === 'text') text += ev.value;
    }
    expect(text).toBe('a]]>b');
  });

  it('rejects CDATA outside the root', () => {
    expect(() => write((s) => s.cdata('x'))).toThrow(/outside the root/);
  });
});

describe('createRawSink', () => {
  it('builds a RawNode tree', () => {
    const { sink, toNode } = createRawSink();
    sink.startElement(W, 'p');
    sink.attr(W, 'rsidR', '00A1');
    sink.startElement(W, 'r');
    sink.text('hi');
    sink.endElement();
    sink.endElement();
    expect(toNode()).toEqual({
      uri: W,
      localName: 'p',
      prefix: 'w',
      attrs: [{ uri: W, localName: 'rsidR', prefix: 'w', value: '00A1' }],
      nsDeclarations: new Map([['w', W]]),
      children: [
        {
          uri: W,
          localName: 'r',
          prefix: 'w',
          attrs: [],
          nsDeclarations: new Map(),
          children: [{ kind: 'text', value: 'hi', cdata: false }],
        },
      ],
    });
  });

  it('coalesces adjacent plain text but not CDATA', () => {
    const { sink, toNode } = createRawSink();
    sink.startElement(W, 't');
    sink.text('a');
    sink.text('b');
    sink.cdata('c');
    sink.text('d');
    sink.endElement();
    expect(toNode()?.children).toEqual([
      { kind: 'text', value: 'ab', cdata: false },
      { kind: 'text', value: 'c', cdata: true },
      { kind: 'text', value: 'd', cdata: false },
    ]);
  });

  it('is empty before anything is written', () => {
    expect(createRawSink().toNode()).toBeUndefined();
  });
});

describe('raw() replay', () => {
  it('reproduces a captured subtree exactly', () => {
    const source = `<w:tbl xmlns:w="${W}" w:id="7" plain="1"><!--c--><w:tr/></w:tbl>`;
    const node = createCursor(source).skipToRaw();
    expect(write((s) => s.raw(node))).toBe(source);
  });

  it('preserves attribute order and prefixes even when unconventional', () => {
    const source = `<zz:p xmlns:zz="${W}" zz:b="2" zz:a="1"/>`;
    const node = createCursor(source).skipToRaw();
    expect(write((s) => s.raw(node))).toBe(source);
  });

  it('adds a repair declaration when a subtree is lifted out of its document', () => {
    // The capture relied on xmlns:x declared on an ancestor that is not here.
    const outer = createCursor(`<r xmlns:x="urn:x"><x:child x:k="1"/></r>`);
    outer.next();
    const node = outer.skipToRaw();
    const out = write((s) => s.raw(node));
    expect(out).toBe('<x:child xmlns:x="urn:x" x:k="1"/>');
  });

  it('does not re-declare what is already correctly bound', () => {
    const inner = createCursor(`<w:p xmlns:w="${W}"/>`).skipToRaw();
    const out = write((s) => {
      s.startElement(W, 'body');
      s.raw(inner);
      s.endElement();
    });
    // The capture's own declaration is kept (it was there in the source); no
    // extra repair is added on top of it.
    expect(out.match(/xmlns:w=/g)).toHaveLength(2);
    expect(out).toBe(`<w:body xmlns:w="${W}"><w:p xmlns:w="${W}"/></w:body>`);
  });

  it('closes the parent start tag before replaying', () => {
    expect(() =>
      write((s) => {
        s.startElement(W, 'p');
        s.raw(createCursor('<x/>').skipToRaw());
        s.attr(null, 'late', '1');
      }),
    ).toThrow(/after a child was emitted/);
  });
});

/* ------------------------------------------------------------------------- */
/* The round-trip property                                                    */
/* ------------------------------------------------------------------------- */

/**
 * A structural view of a `RawNode`, for comparison.
 *
 * Maps and the `RawChild` union do not compare well by eye in a failure
 * message, and comparing them directly would also let a difference in
 * *declaration order* pass unnoticed. This flattens to plain arrays and objects
 * so that order is part of what is asserted.
 */
type Structure =
  | { el: string; prefix: string; ns: [string, NamespaceUri][]; attrs: string[]; kids: Structure[] }
  | { text: string; cdata: boolean }
  | { comment: string }
  | { pi: string; data: string };

function structure(child: RawChild): Structure {
  if ('kind' in child) {
    switch (child.kind) {
      case 'text':
        return { text: child.value, cdata: child.cdata };
      case 'comment':
        return { comment: child.value };
      case 'pi':
        return { pi: child.target, data: child.data };
    }
  }
  return {
    el: `{${child.uri}}${child.localName}`,
    prefix: child.prefix,
    ns: [...child.nsDeclarations],
    attrs: child.attrs.map((a) => `${a.prefix}|{${a.uri}}${a.localName}=${a.value}`),
    kids: child.children.map(structure),
  };
}

function capture(xml: string): RawNode {
  return createCursor(xml).skipToRaw();
}

describe('parse → capture → replay → reparse is structurally lossless', () => {
  // Everything the brief calls out, in one fragment: mid-document namespace
  // declarations, CDATA, comments, self-closing elements, and an
  // xml:space="preserve" text node with leading/trailing whitespace and a tab.
  const FRAGMENT =
    `<w:body xmlns:w="${W}" xmlns:mc="${MC_NAMESPACE}" mc:Ignorable="w14">` +
    `<w:p w:rsidR="00A1" plain="yes">` +
    `<w:pPr/>` +
    `<!-- a comment between children -->` +
    `<w:r><w:t xml:space="preserve">  lead\tand trail  </w:t></w:r>` +
    `<mc:AlternateContent xmlns:wps="urn:wps">` +
    `<mc:Choice Requires="wps"><wps:shape id="1"/></mc:Choice>` +
    `<mc:Fallback><w:pict/></mc:Fallback>` +
    `</mc:AlternateContent>` +
    `<w:ext xmlns:x="urn:x" x:k="v"><![CDATA[<literal> & markup]]>tail text</w:ext>` +
    `<?custom-pi some data?>` +
    `</w:p>` +
    `</w:body>`;

  it('survives one round trip', () => {
    const before = capture(FRAGMENT);
    const replayed = write((s) => s.raw(before));
    const after = capture(replayed);
    expect(structure(after)).toEqual(structure(before));
  });

  it('reaches a fixed point after the first round trip', () => {
    // Not the same claim as the one above: this says the serializer's output is
    // stable, so a document that is opened and saved repeatedly stops changing.
    const first = write((s) => s.raw(capture(FRAGMENT)));
    const second = write((s) => s.raw(capture(first)));
    expect(second).toBe(first);
  });

  it('reproduces the original text exactly for this fragment', () => {
    // Stronger than structural equality, and true here because nothing in the
    // fragment has more than one legal spelling.
    expect(write((s) => s.raw(capture(FRAGMENT)))).toBe(FRAGMENT);
  });

  it('keeps the significant whitespace and the tab', () => {
    const replayed = write((s) => s.raw(capture(FRAGMENT)));
    expect(replayed).toContain('>  lead\tand trail  <');
    expect(replayed).toContain('xml:space="preserve"');
  });

  it('keeps the mid-document namespace declarations where they were', () => {
    const after = capture(write((s) => s.raw(capture(FRAGMENT))));
    const p = after.children[0];
    if (p === undefined || 'kind' in p) throw new Error('unreachable');
    const ac = p.children.find((c) => !('kind' in c) && c.localName === 'AlternateContent');
    if (ac === undefined || 'kind' in ac) throw new Error('unreachable');
    expect([...ac.nsDeclarations]).toEqual([['wps', 'urn:wps']]);
    // ...and did not leak up to the root.
    expect([...after.nsDeclarations].map(([p2]) => p2)).toEqual(['w', 'mc']);
  });

  it('keeps both branches of the mc:AlternateContent', () => {
    const replayed = write((s) => s.raw(capture(FRAGMENT)));
    expect(replayed).toContain('<mc:Choice Requires="wps">');
    expect(replayed).toContain('<mc:Fallback>');
    expect(replayed).toContain('<wps:shape id="1"/>');
  });

  it('agrees between the string sink and the raw sink', () => {
    const before = capture(FRAGMENT);
    const { sink, toNode } = createRawSink();
    sink.raw(before);
    const viaTree = toNode();
    const viaString = capture(write((s) => s.raw(before)));
    expect(viaTree).toBeDefined();
    expect(structure(viaTree as RawNode)).toEqual(structure(viaString));
  });

  it.each([
    ['empty element', '<a/>'],
    ['nested empties', '<a><b/><c><d/></c></a>'],
    ['entities in text', '<a>&lt;&amp;&gt;</a>'],
    ['entities in attributes', '<a v="&lt;&amp;&quot;"/>'],
    ['CDATA next to text', '<a>x<![CDATA[y]]>z</a>'],
    ['adjacent CDATA', '<a><![CDATA[x]]><![CDATA[y]]></a>'],
    ['comment only', '<a><!--c--></a>'],
    ['processing instruction', '<a><?t d?></a>'],
    ['PI with no data', '<a><?t?></a>'],
    ['default namespace', '<a xmlns="urn:d"><b/></a>'],
    ['undeclared default inside a default', '<a xmlns="urn:d"><b xmlns=""/></a>'],
    ['shadowed prefix', '<a xmlns:p="urn:1"><b xmlns:p="urn:2"><p:c/></b></a>'],
    ['prefix reused for the same URI', '<a xmlns:p="urn:1"><p:b xmlns:p="urn:1"/></a>'],
    ['xml:lang', '<a xml:lang="en-GB"/>'],
    ['tab and newline in an attribute', '<a v="x&#x9;y&#xA;z"/>'],
    ['carriage return in text', '<a>x&#xD;y</a>'],
    ['astral plane', '<a>\u{1F642}</a>'],
    ['attribute in no namespace next to a prefixed one', `<w:a xmlns:w="${W}" w:x="1" x="2"/>`],
  ])('round-trips: %s', (_name, xml) => {
    const before = capture(xml);
    const after = capture(write((s) => s.raw(before)));
    expect(structure(after)).toEqual(structure(before));
  });
});
