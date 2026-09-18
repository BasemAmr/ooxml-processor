import { describe, expect, it } from 'vitest';
import { MC_NAMES, MC_NAMESPACE, McContext, McError, McResolver } from './mce.js';
import type { RawNode, XmlAttr, XmlStartElement } from './xml.js';

const W14 = 'urn:test:w14';
const W15 = 'urn:test:w15';
const attr = (localName: string, value: string, uri = MC_NAMESPACE, prefix = 'mc'): XmlAttr => ({
  uri,
  localName,
  prefix,
  value,
});
const start = (
  localName: string,
  attrs: readonly XmlAttr[] = [],
  uri = W14,
  nsDeclarations: ReadonlyMap<string, string> = new Map([
    ['mc', MC_NAMESPACE],
    ['w14', W14],
    ['w15', W15],
  ]),
): XmlStartElement => ({
  type: 'startElement',
  uri,
  localName,
  prefix: uri === MC_NAMESPACE ? 'mc' : 'w14',
  attrs,
  nsDeclarations,
  selfClosing: false,
});
const raw = (localName: string, uri = W14, children: readonly RawNode[] = []): RawNode => ({
  uri,
  localName,
  prefix: 'w14',
  attrs: [],
  nsDeclarations: new Map(),
  children,
});

function alternateContent(): RawNode {
  const choice = {
    ...raw(MC_NAMES.choice, MC_NAMESPACE, [raw('modern', W15)]),
    attrs: [attr(MC_NAMES.requires, 'w15', '', '')],
    nsDeclarations: new Map([
      ['mc', MC_NAMESPACE],
      ['w14', W14],
      ['w15', W15],
    ]),
  };
  const fallback = raw(MC_NAMES.fallback, MC_NAMESPACE, [raw('legacy', W14)]);
  return raw(MC_NAMES.alternateContent, MC_NAMESPACE, [choice, fallback]);
}

describe('MCE resolver', () => {
  it('handles mc:Ignorable by preserving but ignoring an unknown subtree', () => {
    const resolver = new McResolver(new McContext());
    const decision = resolver.enter(start('modern', [attr(MC_NAMES.ignorable, 'w14')], W14));
    expect(decision.action).toBe('ignoreSubtree');
    expect(decision.understood).toBe(false);
    resolver.exit();
  });

  it('handles mc:ProcessContent by processing children of an ignored wrapper', () => {
    const resolver = new McResolver(new McContext());
    const decision = resolver.enter(
      start('child', [attr(MC_NAMES.ignorable, 'w14'), attr(MC_NAMES.processContent, 'w14:child')]),
    );
    expect(decision.action).toBe('processContent');
    expect(resolver.shouldPreserveElement(W14, 'child')).toBe(false);
    resolver.exit();
  });

  it('throws for mc:MustUnderstand when the namespace is unsupported', () => {
    const resolver = new McResolver(new McContext());
    expect(() =>
      resolver.enter(start('modern', [attr(MC_NAMES.mustUnderstand, 'w15')])),
    ).toThrowError(expect.objectContaining<Partial<McError>>({ code: 'must-understand' }));
  });

  it('handles mc:PreserveElements as a scoped QName set', () => {
    const resolver = new McResolver(new McContext());
    const decision = resolver.enter(
      start('modern', [attr(MC_NAMES.preserveElements, 'w14:modern')]),
    );
    expect(decision.preserve).toBe(true);
    expect(resolver.shouldPreserveElement(W14, 'modern')).toBe(true);
    resolver.exit();
  });

  it('handles mc:PreserveAttributes by retaining matching unknown attributes', () => {
    const resolver = new McResolver(new McContext());
    const preserved = attr('textId', '7', W14, 'w14');
    const removed = attr('other', '8', W14, 'w14');
    const decision = resolver.enter(
      start('wrapper', [
        attr(MC_NAMES.ignorable, 'w14'),
        attr(MC_NAMES.preserveAttributes, 'w14:textId'),
        preserved,
        removed,
      ]),
    );
    expect(resolver.shouldPreserveAttribute(W14, 'textId')).toBe(true);
    expect(decision.attrs).not.toContain(preserved);
    expect(decision.attrs).not.toContain(removed);
    resolver.exit();
  });

  it('selects the first satisfied mc:Choice and exposes its content cursor', () => {
    const resolver = new McResolver(new McContext([W15]));
    const selection = resolver.selectAlternateContent(alternateContent());
    expect(selection.kind).toBe('choice');
    expect(selection.choiceIndex).toBe(0);
    expect(selection.content[0]).toMatchObject({ localName: 'modern', uri: W15 });
    expect(selection.cursor().current).toMatchObject({ localName: 'modern', uri: W15 });
  });

  it('selects mc:Fallback when no Choice requirement is understood', () => {
    const resolver = new McResolver(new McContext());
    const selection = resolver.selectAlternateContent(alternateContent());
    expect(selection.kind).toBe('fallback');
    expect(selection.content[0]).toMatchObject({ localName: 'legacy', uri: W14 });
  });
});
