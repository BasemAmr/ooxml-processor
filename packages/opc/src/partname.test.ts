/**
 * The part-name grammar is the security boundary of the package layer, so this
 * suite is deliberately adversarial: most of it is payloads, not happy paths.
 *
 * Every rejection asserts the specific `code`, not merely that something threw.
 * A test that only checks for an exception would pass if `../../../etc/passwd`
 * were rejected for being too long rather than for escaping the package root,
 * and the day someone loosens the length limit is the day that matters.
 */

import { describe, expect, it } from 'vitest';

import { OpcPartNameError, type PartNameErrorCode } from './errors.js';
import {
  canonicalPartName,
  isRelationshipPartName,
  isValidPartName,
  PACKAGE_ROOT,
  partNameExtension,
  partNameFolder,
  partNamesEqual,
  relsPartNameFor,
  resolveRelative,
  sourceOfRelsPart,
  validatePartName,
  type PartName,
} from './partname.js';

/** Assert that a thunk throws an `OpcPartNameError` with exactly this code. */
function expectCode(code: PartNameErrorCode, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(OpcPartNameError);
    expect((error as OpcPartNameError).code).toBe(code);
    expect((error as OpcPartNameError).name).toBe('OpcPartNameError');
    return;
  }
  throw new Error(`expected an OpcPartNameError with code ${code}, but nothing threw`);
}

const part = (name: string): PartName => validatePartName(name);

describe('validatePartName: names a real package contains', () => {
  it.each([
    '/word/document.xml',
    '/word/styles.xml',
    '/word/_rels/document.xml.rels',
    '/_rels/.rels',
    '/docProps/core.xml',
    '/word/media/image1.png',
    '/customXml/item1.xml',
    '/word/embeddings/oleObject1.bin',
    // Every `pchar` that looks alarming but is legal in a segment.
    "/word/a!$&'()*+,;=:@-._~.xml",
    // Percent-encoded UTF-8 is how non-ASCII is spelled.
    '/word/caf%C3%A9.xml',
    // A dot-prefixed name is fine; only a *trailing* dot is forbidden.
    '/word/.hidden',
  ])('accepts %s', (name) => {
    expect(validatePartName(name)).toBe(name);
    expect(isValidPartName(name)).toBe(true);
  });
});

describe('validatePartName: structural rules', () => {
  it('requires a leading slash', () => {
    expectCode('not-absolute', () => part('word/document.xml'));
    expectCode('not-absolute', () => part(''));
    expectCode('not-absolute', () => part('document.xml'));
  });

  it('rejects the package root, which has no segments', () => {
    expectCode('empty-segment', () => part('/'));
  });

  it('rejects empty segments wherever they appear', () => {
    expectCode('empty-segment', () => part('//word/document.xml'));
    expectCode('empty-segment', () => part('/word//document.xml'));
  });

  it('rejects a trailing slash: a part name never names a folder', () => {
    expectCode('trailing-slash', () => part('/word/'));
    expectCode('trailing-slash', () => part('/word/media/'));
  });

  it('rejects any segment ending in a dot (M1.9)', () => {
    expectCode('segment-ends-with-dot', () => part('/word/document.'));
    expectCode('segment-ends-with-dot', () => part('/word./document.xml'));
    // The encoded form is rejected too, or M1.9 would have a trivial bypass.
    expectCode('segment-ends-with-dot', () => part('/word/document%2E'));
  });

  it('rejects dot segments, literal and encoded', () => {
    expectCode('dot-segment', () => part('/word/./document.xml'));
    expectCode('dot-segment', () => part('/word/../document.xml'));
    expectCode('dot-segment', () => part('/%2E%2E/document.xml'));
    expectCode('dot-segment', () => part('/%2e/document.xml'));
  });
});

describe('validatePartName: character rules', () => {
  it('rejects non-pchar ASCII', () => {
    expectCode('invalid-character', () => part('/word/doc ument.xml'));
    expectCode('invalid-character', () => part('/word/[Content_Types].xml'));
    expectCode('invalid-character', () => part('/word/doc"ument.xml'));
    expectCode('invalid-character', () => part('/word/doc<ument>.xml'));
    expectCode('invalid-character', () => part('/word/doc|ument.xml'));
  });

  it('rejects a literal backslash, however it is positioned', () => {
    expectCode('invalid-character', () => part('/word\\document.xml'));
    expectCode('invalid-character', () => part('\\word\\document.xml'.replace('\\', '/')));
  });

  it('rejects a literal NUL and other control characters', () => {
    expectCode('invalid-character', () => part('/word/document.xml\u0000.png'));
    expectCode('invalid-character', () => part('/word/doc\u0007ument.xml'));
    expectCode('invalid-character', () => part('/word/doc\nument.xml'));
  });

  it('rejects unencoded non-ASCII', () => {
    expectCode('non-ascii', () => part('/word/caf\u00e9.xml'));
    // Decomposed spelling of the same word: also rejected, and note that it is
    // rejected as its own distinct string — nothing here normalizes.
    expectCode('non-ascii', () => part('/word/cafe\u0301.xml'));
    expectCode('non-ascii', () => part('/word/\u202edocument.xml')); // RTL override
    expectCode('non-ascii', () => part('/word/doc\ufeffument.xml')); // zero-width BOM
  });

  it('rejects a query or fragment delimiter in a part name', () => {
    expectCode('invalid-character', () => part('/word/document.xml?x=1'));
    expectCode('invalid-character', () => part('/word/document.xml#frag'));
  });
});

describe('validatePartName: percent-encoding rules', () => {
  it('requires two hex digits after %', () => {
    expectCode('bad-percent-encoding', () => part('/word/%zz.xml'));
    expectCode('bad-percent-encoding', () => part('/word/%2.xml'));
    expectCode('bad-percent-encoding', () => part('/word/100%.xml'));
    expectCode('bad-percent-encoding', () => part('/word/%%41.xml'));
  });

  it('rejects encoded path separators (M1.6), in either case', () => {
    expectCode('encoded-separator', () => part('/word%2Fdocument.xml'));
    expectCode('encoded-separator', () => part('/word%2fdocument.xml'));
    expectCode('encoded-separator', () => part('/word%5Cdocument.xml'));
    expectCode('encoded-separator', () => part('/word%5cdocument.xml'));
  });

  it('rejects encoded control characters', () => {
    expectCode('encoded-control', () => part('/word/document%00.xml'));
    expectCode('encoded-control', () => part('/word/document%0A.xml'));
    expectCode('encoded-control', () => part('/word/document%0d%0a.xml'));
    expectCode('encoded-control', () => part('/word/document%7F.xml'));
  });

  it('treats double encoding as a literal name, not as an escape', () => {
    // `%252E` decodes once to `%2E`, which is not a dot. It is a strange but
    // legal part name; accepting it is correct precisely *because* nothing
    // downstream decodes it again.
    expect(part('/word/%252E%252E/document.xml')).toBe('/word/%252E%252E/document.xml');
  });
});

describe('validatePartName: length', () => {
  it('rejects an absurdly long name', () => {
    expectCode('too-long', () => part(`/word/${'a'.repeat(4000)}.xml`));
  });

  it('honours a caller-supplied ceiling', () => {
    expect(() => validatePartName('/word/document.xml', { maxLength: 18 })).not.toThrow();
    expectCode('too-long', () => validatePartName('/word/document.xml', { maxLength: 17 }));
  });

  it('checks length before anything else, so a huge hostile name is cheap to reject', () => {
    // A 1 MB name that also breaks three other rules still reports `too-long`,
    // which is the point: we never build a 1 MB error message out of it.
    expectCode('too-long', () => part(`/word/${'../'.repeat(350_000)}x`));
  });
});

describe('validatePartName: the reserved _rels folder', () => {
  it('accepts _rels as the parent of a .rels part', () => {
    expect(part('/word/_rels/document.xml.rels')).toBe('/word/_rels/document.xml.rels');
    expect(part('/_rels/.rels')).toBe('/_rels/.rels');
  });

  it('rejects a non-.rels part inside _rels', () => {
    expectCode('misplaced-rels-segment', () => part('/word/_rels/document.xml'));
    expectCode('misplaced-rels-segment', () => part('/word/_rels/document.xml.rels.xml'));
  });

  it('rejects _rels used as an ordinary folder', () => {
    expectCode('misplaced-rels-segment', () => part('/_rels/media/image1.png'));
    expectCode('misplaced-rels-segment', () => part('/word/_rels/sub/document.xml.rels'));
  });

  it('applies the rule case-insensitively, like every other part-name comparison', () => {
    expectCode('misplaced-rels-segment', () => part('/word/_RELS/document.xml'));
    expect(part('/word/_RELS/document.xml.RELS')).toBe('/word/_RELS/document.xml.RELS');
  });
});

describe('canonical form and comparison', () => {
  it('compares case-insensitively (M1.12)', () => {
    expect(partNamesEqual(part('/Word/Document.XML'), part('/word/document.xml'))).toBe(true);
    expect(canonicalPartName(part('/Word/Document.XML'))).toBe('/word/document.xml');
  });

  it('does not decode percent-escapes when comparing', () => {
    // `%41` is "A" once decoded. If canonicalisation decoded, these would alias,
    // and a package could smuggle a second part past a duplicate check.
    expect(partNamesEqual(part('/word/%41.xml'), part('/word/A.xml'))).toBe(false);
  });

  it('does not Unicode-normalize: NFC and NFD encodings are distinct parts', () => {
    const nfc = part('/word/caf%C3%A9.xml');
    const nfd = part('/word/cafe%CC%81.xml');
    expect(partNamesEqual(nfc, nfd)).toBe(false);
  });

  it('folds only ASCII, never a locale-sensitive mapping', () => {
    // The Turkish dotless-i problem cannot reach us (non-ASCII is rejected), but
    // the folding is spelled out rather than delegated so that it could not.
    expect(canonicalPartName(part('/WORD/DOCUMENT.XML'))).toBe('/word/document.xml');
  });
});

describe('decomposition', () => {
  it('reports the folder', () => {
    expect(partNameFolder(part('/word/media/image1.png'))).toBe('/word/media/');
    expect(partNameFolder(part('/document.xml'))).toBe('/');
    expect(partNameFolder(PACKAGE_ROOT)).toBe('/');
  });

  it('reports the extension, including for a dot-prefixed name', () => {
    expect(partNameExtension(part('/word/document.xml'))).toBe('xml');
    expect(partNameExtension(part('/word/media/image1.PNG'))).toBe('PNG');
    // This is how one `<Default Extension="rels">` types every .rels part.
    expect(partNameExtension(part('/_rels/.rels'))).toBe('rels');
    expect(partNameExtension(part('/word/embeddings/noextension'))).toBeUndefined();
  });
});

describe('resolveRelative: the normal cases', () => {
  const document = part('/word/document.xml');

  it('resolves against the source part folder, not the .rels folder', () => {
    // The relationship lives in /word/_rels/document.xml.rels. If the base were
    // that file's folder, this would come out as /word/_rels/styles.xml.
    expect(resolveRelative(document, 'styles.xml')).toBe('/word/styles.xml');
    expect(resolveRelative(document, 'media/image1.png')).toBe('/word/media/image1.png');
    expect(resolveRelative(document, './styles.xml')).toBe('/word/styles.xml');
  });

  it('resolves a root-relative target', () => {
    expect(resolveRelative(document, '/word/styles.xml')).toBe('/word/styles.xml');
    expect(resolveRelative(document, '/docProps/core.xml')).toBe('/docProps/core.xml');
  });

  it('resolves one level up', () => {
    expect(resolveRelative(document, '../docProps/core.xml')).toBe('/docProps/core.xml');
    expect(resolveRelative(part('/word/header1.xml'), '../word/media/img.png')).toBe(
      '/word/media/img.png',
    );
  });

  it('resolves package-level relationships against the root', () => {
    expect(resolveRelative(PACKAGE_ROOT, 'word/document.xml')).toBe('/word/document.xml');
    expect(resolveRelative(PACKAGE_ROOT, '/word/document.xml')).toBe('/word/document.xml');
    expect(resolveRelative(PACKAGE_ROOT, 'docProps/app.xml')).toBe('/docProps/app.xml');
  });
});

describe('resolveRelative: traversal, rejected rather than clamped', () => {
  const document = part('/word/document.xml');

  it('rejects the canonical payload instead of producing /etc/passwd', () => {
    // RFC 3986 remove_dot_segments would yield "/etc/passwd" here. That is the
    // behaviour we refuse: a silent clamp turns a malformed document into a
    // plausible one.
    expectCode('escapes-root', () => resolveRelative(document, '../../../etc/passwd'));
    expectCode('escapes-root', () => resolveRelative(document, '../../etc/passwd'));
    expectCode('escapes-root', () => resolveRelative(PACKAGE_ROOT, '../etc/passwd'));
  });

  it('rejects traversal hidden behind legitimate-looking segments', () => {
    expectCode('escapes-root', () => resolveRelative(document, 'media/../../../etc/passwd'));
    expectCode('escapes-root', () =>
      resolveRelative(part('/word/media/image1.png'), '../../../../x.xml'),
    );
  });

  it('rejects a single-encoded traversal as a dot segment', () => {
    expectCode('dot-segment', () => resolveRelative(document, '%2e%2e/%2e%2e/etc/passwd'));
    expectCode('dot-segment', () => resolveRelative(document, '%2E%2E/x.xml'));
    expectCode('dot-segment', () => resolveRelative(document, '.%2e/x.xml'));
    expectCode('dot-segment', () => resolveRelative(document, '%2e/x.xml'));
  });

  it('treats a double-encoded traversal as a literal segment that cannot escape', () => {
    expect(resolveRelative(document, '%252e%252e/x.xml')).toBe('/word/%252e%252e/x.xml');
  });

  it('rejects backslash traversal aimed at a Windows host', () => {
    expectCode('invalid-character', () => resolveRelative(document, '..\\..\\..\\etc\\passwd'));
    expectCode('invalid-character', () => resolveRelative(document, 'media\\image1.png'));
  });

  it('rejects an absolute Windows path', () => {
    expectCode('absolute-uri', () => resolveRelative(document, 'C:\\Windows\\System32\\x.dll'));
    expectCode('absolute-uri', () => resolveRelative(document, 'C:/Windows/System32/x.dll'));
    expectCode('absolute-uri', () => resolveRelative(document, 'file:///etc/passwd'));
  });

  it('rejects a UNC path', () => {
    expectCode('invalid-character', () => resolveRelative(document, '\\\\server\\share\\x.xml'));
  });

  it('rejects a network-path reference', () => {
    expectCode('network-path', () => resolveRelative(document, '//evil.example/x.xml'));
    expectCode('network-path', () => resolveRelative(document, '//evil.example'));
  });

  it('rejects an absolute URI: an unlabelled External target is not an Internal one', () => {
    expectCode('absolute-uri', () => resolveRelative(document, 'http://evil.example/x'));
    expectCode('absolute-uri', () => resolveRelative(document, 'HTTPS://evil.example/x'));
    expectCode('absolute-uri', () => resolveRelative(document, 'mailto:a@b.example'));
    expectCode('absolute-uri', () => resolveRelative(document, 'javascript:alert(1)'));
    expectCode('absolute-uri', () => resolveRelative(document, 'data:text/xml,%3Cx/%3E'));
  });

  it('rejects a colon in the first segment of a relative reference (RFC 3986 §4.2)', () => {
    expectCode('invalid-character', () => resolveRelative(document, '1:2/x.xml'));
  });

  it('allows a colon in a later segment, where it is an unambiguous pchar', () => {
    expect(resolveRelative(document, 'media/a:b.png')).toBe('/word/media/a:b.png');
  });

  it('rejects query and fragment components', () => {
    expectCode('has-query', () => resolveRelative(document, 'styles.xml?x=1'));
    expectCode('has-fragment', () => resolveRelative(document, 'styles.xml#frag'));
    expectCode('has-fragment', () => resolveRelative(document, '#frag'));
  });

  it('rejects an empty or folder-shaped target', () => {
    expectCode('empty-segment', () => resolveRelative(document, ''));
    expectCode('trailing-slash', () => resolveRelative(document, 'media/'));
    expectCode('empty-segment', () => resolveRelative(document, 'media//image1.png'));
  });

  it('rejects a target that resolves to the package root itself', () => {
    expectCode('empty-segment', () => resolveRelative(document, '..'));
    // "/" is a folder reference, and reports as one.
    expectCode('trailing-slash', () => resolveRelative(document, '/'));
  });

  it('rejects an embedded NUL however it is spelled', () => {
    expectCode('encoded-control', () => resolveRelative(document, 'styles%00.xml'));
    expectCode('invalid-character', () => resolveRelative(document, 'styles\u0000.xml'));
  });

  it('applies the length limit to the resolved name', () => {
    expectCode('too-long', () => resolveRelative(document, `${'a'.repeat(4000)}.xml`));
  });
});

describe('the _rels naming convention', () => {
  it('derives a part relationships name', () => {
    expect(relsPartNameFor(part('/word/document.xml'))).toBe('/word/_rels/document.xml.rels');
    expect(relsPartNameFor(part('/word/header1.xml'))).toBe('/word/_rels/header1.xml.rels');
    expect(relsPartNameFor(part('/docProps/core.xml'))).toBe('/docProps/_rels/core.xml.rels');
  });

  it('derives the package relationships name from the root', () => {
    expect(relsPartNameFor(PACKAGE_ROOT)).toBe('/_rels/.rels');
  });

  it('refuses the relationships part of a relationships part', () => {
    expectCode('rels-of-rels', () => relsPartNameFor(part('/word/_rels/document.xml.rels')));
    expectCode('rels-of-rels', () => relsPartNameFor(part('/_rels/.rels')));
  });

  it('inverts', () => {
    expect(sourceOfRelsPart(part('/word/_rels/document.xml.rels'))).toBe('/word/document.xml');
    expect(sourceOfRelsPart(part('/_rels/.rels'))).toBe(PACKAGE_ROOT);
    expect(sourceOfRelsPart(part('/docProps/_rels/core.xml.rels'))).toBe('/docProps/core.xml');
  });

  it('round-trips every source through both directions', () => {
    for (const name of ['/word/document.xml', '/docProps/core.xml', '/a/b/c/d.xml']) {
      expect(sourceOfRelsPart(relsPartNameFor(part(name)))).toBe(name);
    }
    expect(sourceOfRelsPart(relsPartNameFor(PACKAGE_ROOT))).toBe(PACKAGE_ROOT);
  });

  it('refuses a folder-level rels part anywhere but the package root', () => {
    // OPC defines no "relationships of /word/", so inventing a source for this
    // would be making something up.
    expectCode('not-a-rels-name', () => sourceOfRelsPart(part('/word/_rels/.rels')));
  });

  it('refuses to invert a name that is not a rels name', () => {
    expectCode('not-a-rels-name', () => sourceOfRelsPart(part('/word/document.xml')));
  });

  it('recognises rels part names structurally', () => {
    expect(isRelationshipPartName(part('/word/_rels/document.xml.rels'))).toBe(true);
    expect(isRelationshipPartName(part('/_rels/.rels'))).toBe(true);
    expect(isRelationshipPartName(part('/word/document.xml'))).toBe(false);
    expect(isRelationshipPartName(PACKAGE_ROOT)).toBe(false);
    // A `.rels` file outside a `_rels` folder is an ordinary part.
    expect(isRelationshipPartName(part('/word/document.xml.rels'))).toBe(false);
  });
});

describe('isValidPartName', () => {
  it('reports false rather than throwing for a bad name', () => {
    expect(isValidPartName('/../etc/passwd')).toBe(false);
    expect(isValidPartName('/word/document.xml')).toBe(true);
  });
});
