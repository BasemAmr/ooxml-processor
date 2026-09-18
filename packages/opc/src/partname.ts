/**
 * The OPC part-name grammar — ECMA-376 Part 2 §9.1.1 (ISO/IEC 29500-2 §9.1.1).
 *
 * This module is the security boundary of the package layer. Everything that
 * turns bytes on the wire into something we will later treat as an identity —
 * a ZIP entry name, a relationship `Target`, a `<Override PartName="…">` — funnels
 * through {@link validatePartName} or {@link resolveRelative} first.
 *
 * ## Why this is stricter than the XSDs
 *
 * The vendored OPC schemas do **not** encode this grammar. `CT_Override/@PartName`
 * is plain `xs:anyURI`, which accepts `../../../etc/passwd` and `\\host\share`
 * without complaint. The grammar lives only in the Part 2 prose, as the
 * numbered rules M1.1–M1.12. So the schema gives us nothing here and the
 * validation below is hand-written against the prose:
 *
 * ```
 * part_name  = 1*( "/" segment )
 * segment    = 1*( pchar )                          ; RFC 3986
 * pchar      = unreserved / pct-encoded / sub-delims / ":" / "@"
 * unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
 * sub-delims = "!" / "$" / "&" / "'" / "(" / ")" / "*" / "+" / "," / ";" / "="
 * ```
 *
 * plus: no empty segment (M1.3), no trailing `/` (M1.4), no segment ending in
 * `.` (M1.9 — which is what rules out `.` and `..` as segments), `%` must
 * introduce two hex digits (M1.5), and a segment may not contain a
 * percent-encoded `/` or `\` (M1.6).
 *
 * ## Why Word's leniency is not our leniency
 *
 * Word will happily open packages whose part names break several of these
 * rules. We do not follow it there. The rules that Word relaxes are exactly the
 * ones that make a part name ambiguous — encoded separators, dot segments,
 * backslashes — and an ambiguous identity is a path-traversal bug waiting for a
 * consumer that resolves part names against a filesystem. We reject; a
 * conformance-failing document is a better outcome than a silent escape.
 *
 * ## Why we never percent-decode a part name
 *
 * Part names are compared and stored in their **encoded** form. Decoding would
 * make `/word/media%2Fx.png` and `/word/media/x.png` the same identity, which
 * is precisely the confusion an attacker wants. We only decode transiently, to
 * *detect* encodings that must be rejected — never to produce a name we keep.
 *
 * For the same reason we do **not** Unicode-normalize. Non-ASCII is rejected
 * outright (it must arrive percent-encoded as UTF-8 octets), so NFC-vs-NFD
 * spellings are distinct byte sequences and therefore distinct parts. That is
 * what the spec says, and normalizing would let `cafe\u0301.png` alias
 * `caf\u00e9.png`.
 */

import { OpcPartNameError } from './errors.js';

/* -------------------------------------------------------------------------- */
/* The branded type                                                            */
/* -------------------------------------------------------------------------- */

declare const partNameBrand: unique symbol;

/**
 * A string that has been through {@link validatePartName}.
 *
 * Branded on purpose. Every function downstream of here — relationship
 * resolution, part lookup, ZIP writing — takes `PartName`, so there is no way
 * to reach them with an unvalidated string except by an explicit cast, which is
 * greppable in review. This is the one type in the codebase where the friction
 * of a nominal type is worth it.
 */
export type PartName = string & { readonly [partNameBrand]: 'PartName' };

/**
 * The package itself, as the source of a relationship.
 *
 * The package-level relationships in `/_rels/.rels` do not belong to any part;
 * OPC models their source as the package root. `/` is *not* a valid part name
 * (it has no segments), which is why this is a separate literal type rather
 * than a `PartName`.
 */
export const PACKAGE_ROOT = '/';
export type PackageRoot = typeof PACKAGE_ROOT;

/** Anything a relationship can hang off: a part, or the package itself. */
export type RelationshipSource = PartName | PackageRoot;

export function isPackageRoot(source: RelationshipSource): source is PackageRoot {
  return source === PACKAGE_ROOT;
}

/**
 * Length ceiling for a part name.
 *
 * Not a spec limit — ECMA-376 imposes none, and the ZIP name-length field is
 * 16 bits. It is a policy limit, because an unbounded name is a cheap way to
 * turn every error message, map key and log line in the pipeline into a
 * memory amplifier. 2048 is roughly 20× the longest name any real `.docx`
 * carries.
 */
export const DEFAULT_MAX_PART_NAME_LENGTH = 2048;

/* -------------------------------------------------------------------------- */
/* Character classes                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `pchar` minus `pct-encoded`, as a 128-entry lookup.
 *
 * Built as a table rather than a regex because this runs once per character of
 * every part name in the package and regex engines are not free at that
 * granularity. It also makes the membership auditable at a glance, which a
 * character-class regex full of backslashes is not.
 */
const PCHAR = buildPcharTable();

function buildPcharTable(): Uint8Array {
  const table = new Uint8Array(128);
  const mark = (s: string): void => {
    for (const ch of s) table[ch.charCodeAt(0)] = 1;
  };
  mark('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  mark('abcdefghijklmnopqrstuvwxyz');
  mark('0123456789');
  // unreserved
  mark("-._~");
  // sub-delims
  mark("!$&'()*+,;=");
  // explicitly permitted in a path segment
  mark(':@');
  return table;
}

function isHexDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66)
  );
}

function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  return code - 0x61 + 10;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export interface PartNameOptions {
  /** Defaults to {@link DEFAULT_MAX_PART_NAME_LENGTH}. */
  readonly maxLength?: number;
}

/**
 * Validate a part name, returning it branded. Throws {@link OpcPartNameError}
 * with a specific `code` on the first rule violated.
 *
 * Rule order matters for diagnosis, not for safety: a hostile name usually
 * breaks several rules at once, and we want the message to name the most
 * *characteristic* one. `/../x` reports `segment-ends-with-dot` rather than
 * `invalid-character` because that is the rule a reader can look up.
 */
export function validatePartName(name: string, options?: PartNameOptions): PartName {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_PART_NAME_LENGTH;

  if (name.length > maxLength) {
    throw new OpcPartNameError(
      'too-long',
      name,
      `Part name is ${name.length} characters, limit is ${maxLength}`,
    );
  }
  if (!name.startsWith('/')) {
    throw new OpcPartNameError('not-absolute', name, 'Part name must begin with "/"');
  }
  if (name.length === 1) {
    // "/" alone: zero segments. M1.3 requires at least one.
    throw new OpcPartNameError('empty-segment', name, 'Part name must contain at least one segment');
  }
  if (name.endsWith('/')) {
    throw new OpcPartNameError('trailing-slash', name, 'Part name must not end with "/"');
  }

  const segments = name.slice(1).split('/');
  for (const segment of segments) {
    validateSegment(segment, name);
  }
  validateRelsSegmentPlacement(segments, name);

  return name as PartName;
}

/** Non-throwing form, for callers that are probing rather than enforcing. */
export function isValidPartName(name: string, options?: PartNameOptions): boolean {
  try {
    validatePartName(name, options);
    return true;
  } catch (error) {
    if (error instanceof OpcPartNameError) return false;
    throw error;
  }
}

function validateSegment(segment: string, fullName: string): void {
  if (segment.length === 0) {
    throw new OpcPartNameError('empty-segment', fullName, 'Part name must not contain an empty segment');
  }

  // Decoded form is built alongside so the dot-segment test below sees through
  // `%2E`. It is thrown away afterwards — see the module header on why a
  // decoded part name is never kept.
  let decoded = '';

  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);

    if (code > 0x7f) {
      throw new OpcPartNameError(
        'non-ascii',
        fullName,
        `Part name contains a non-ASCII character U+${code.toString(16).toUpperCase().padStart(4, '0')}; ` +
          'non-ASCII must be percent-encoded UTF-8',
      );
    }

    if (code === 0x25 /* % */) {
      const hi = segment.charCodeAt(i + 1);
      const lo = segment.charCodeAt(i + 2);
      if (!isHexDigit(hi) || !isHexDigit(lo)) {
        throw new OpcPartNameError(
          'bad-percent-encoding',
          fullName,
          'Part name contains "%" not followed by two hexadecimal digits',
        );
      }
      const value = hexValue(hi) * 16 + hexValue(lo);
      if (value === 0x2f || value === 0x5c) {
        // M1.6. An encoded separator is never innocent: it exists only to make
        // one part name look like two, or two look like one.
        throw new OpcPartNameError(
          'encoded-separator',
          fullName,
          `Part name contains a percent-encoded path separator (%${value.toString(16).toUpperCase()})`,
        );
      }
      if (value < 0x20 || value === 0x7f) {
        // Not a spec rule; a policy rule. `%00` truncates C strings, and
        // `%0A` forges log lines. Neither can appear in a legitimate name.
        throw new OpcPartNameError(
          'encoded-control',
          fullName,
          `Part name contains a percent-encoded control character (%${value.toString(16).toUpperCase().padStart(2, '0')})`,
        );
      }
      decoded += String.fromCharCode(value);
      i += 2;
      continue;
    }

    if (PCHAR[code] !== 1) {
      throw new OpcPartNameError(
        'invalid-character',
        fullName,
        `Part name contains ${describeChar(code)}, which is not a pchar`,
      );
    }
    decoded += segment[i];
  }

  // M1.9: a segment shall not end with a dot. Applied to the *decoded* form as
  // well, so `x%2E` is rejected along with `x.` — otherwise the encoding would
  // be a trivial bypass for a rule whose whole purpose is to stop `.` and `..`.
  if (segment.endsWith('.') || decoded.endsWith('.')) {
    if (decoded === '.' || decoded === '..') {
      throw new OpcPartNameError(
        'dot-segment',
        fullName,
        `Part name contains a "${decoded}" segment`,
      );
    }
    throw new OpcPartNameError(
      'segment-ends-with-dot',
      fullName,
      'Part name contains a segment ending with "."',
    );
  }
}

/**
 * M1.30/M1.31: `_rels` is a reserved folder name. It may appear only as the
 * parent of a relationships part, and that part must end in `.rels`.
 *
 * Enforcing this here rather than only in the rels-specific helpers closes a
 * masquerade: without it, a package could ship `/word/_rels/document.xml.rels.xml`
 * as an ordinary part, and any code that derives "is this a rels part?" from
 * the folder name alone would disagree with code that derives it from the
 * suffix.
 */
function validateRelsSegmentPlacement(segments: readonly string[], fullName: string): void {
  for (let i = 0; i < segments.length; i += 1) {
    if (asciiLowerCase(segments[i] ?? '') !== '_rels') continue;
    const isParentOfLast = i === segments.length - 2;
    const lastSegment = segments[segments.length - 1] ?? '';
    if (!isParentOfLast || !asciiLowerCase(lastSegment).endsWith('.rels')) {
      throw new OpcPartNameError(
        'misplaced-rels-segment',
        fullName,
        'A "_rels" segment may only be the parent folder of a ".rels" relationships part',
      );
    }
  }
}

function describeChar(code: number): string {
  if (code < 0x20 || code === 0x7f) {
    return `control character 0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `"${String.fromCharCode(code)}"`;
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ASCII-only lower-casing.
 *
 * `String.prototype.toLowerCase` is Unicode-aware and locale-influenced —
 * `'I'.toLowerCase()` is `'ı'` under a Turkish locale in some engines, and
 * `'İ'.toLowerCase()` is two code points everywhere. A part name is ASCII by
 * construction so neither can occur, but an identity function that *could*
 * change length under a locale has no business being the key derivation for a
 * security-relevant map. Spell it out instead.
 */
export function asciiLowerCase(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 32) : value[i];
  }
  return out;
}

/**
 * The canonical map key for a part name (M1.12: part names compare as
 * case-insensitive ASCII strings).
 *
 * Note what this does *not* do: it does not decode percent-escapes and it does
 * not normalize Unicode. `%41` and `A` are different parts. That is the spec,
 * and it is also the only self-consistent choice — see the module header.
 */
export function canonicalPartName(name: PartName | PackageRoot): string {
  return asciiLowerCase(name);
}

export function partNamesEqual(a: PartName | PackageRoot, b: PartName | PackageRoot): boolean {
  return canonicalPartName(a) === canonicalPartName(b);
}

/* -------------------------------------------------------------------------- */
/* Decomposition                                                               */
/* -------------------------------------------------------------------------- */

/** `/word/media/image1.png` → `/word/media/`. `/x.xml` → `/`. */
export function partNameFolder(source: RelationshipSource): string {
  if (isPackageRoot(source)) return PACKAGE_ROOT;
  const lastSlash = source.lastIndexOf('/');
  return source.slice(0, lastSlash + 1);
}

/** `/word/media/image1.png` → `image1.png`. */
export function partNameLastSegment(name: PartName): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

/**
 * The extension used for `<Default Extension="…">` matching, or `undefined`
 * when the final segment has no dot.
 *
 * Returned verbatim, not lower-cased; use {@link asciiLowerCase} for the lookup
 * key. Note that a leading dot still yields an extension: `/_rels/.rels` has
 * extension `rels`, which is exactly how Word's single
 * `<Default Extension="rels">` manages to type every relationships part in the
 * package.
 */
export function partNameExtension(name: PartName): string | undefined {
  const segment = partNameLastSegment(name);
  const dot = segment.lastIndexOf('.');
  if (dot < 0) return undefined;
  return segment.slice(dot + 1);
}

/* -------------------------------------------------------------------------- */
/* Relative resolution                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a relationship `Target` against its source part, per RFC 3986 §5 as
 * constrained by ECMA-376 Part 2 §9.3.
 *
 * The base is the **source part's folder**, not the `.rels` part's folder. A
 * target of `styles.xml` in `/word/_rels/document.xml.rels` resolves to
 * `/word/styles.xml`, because the relationship's source is `/word/document.xml`.
 * Resolving against the `.rels` file's own folder — an easy and popular
 * mistake — would produce `/word/_rels/styles.xml`.
 *
 * ## Deviation from RFC 3986 that matters
 *
 * RFC 3986's `remove_dot_segments` **clamps**: `..` at the root is silently
 * discarded, so `/a` + `../../../etc/passwd` yields `/etc/passwd` with no
 * indication that anything was thrown away. That is the correct behaviour for a
 * web browser and precisely the wrong behaviour for a container format, where
 * the clamp turns a malformed document into a *plausible* one. We throw
 * `escapes-root` instead. A caller that wants the browser behaviour can catch
 * it; a caller that does not gets a loud failure rather than a quiet
 * substitution.
 *
 * Only ever call this for `TargetMode="Internal"`. External targets are opaque
 * by design — see `relationships.ts`.
 */
export function resolveRelative(
  source: RelationshipSource,
  target: string,
  options?: PartNameOptions,
): PartName {
  if (target.length === 0) {
    // RFC 3986 says an empty reference means "the base itself". For a
    // relationship that is meaningless, and accepting it would create a
    // self-referential edge in the part graph.
    throw new OpcPartNameError('empty-segment', target, 'Relationship target is empty');
  }

  rejectSchemeAndAuthority(target);

  const hash = target.indexOf('#');
  if (hash >= 0) {
    // M1.29: an Internal target has no fragment. A fragment on an internal
    // target is how a `#`-containing hyperlink gets mislabelled as Internal.
    throw new OpcPartNameError(
      'has-fragment',
      target,
      'Internal relationship target must not contain a fragment identifier',
    );
  }
  if (target.includes('?')) {
    throw new OpcPartNameError(
      'has-query',
      target,
      'Internal relationship target must not contain a query component',
    );
  }
  if (target.includes('\\')) {
    // Never valid: `\` is outside pchar, and every path-traversal payload aimed
    // at a Windows host uses it. Caught here so the message says what it is,
    // rather than surfacing later as a generic invalid-character.
    throw new OpcPartNameError(
      'invalid-character',
      target,
      'Relationship target contains a backslash; OPC targets use "/" only',
    );
  }

  const absolute = target.startsWith('/');
  const stack: string[] = absolute ? [] : folderSegments(source);
  const rawSegments = (absolute ? target.slice(1) : target).split('/');

  for (let i = 0; i < rawSegments.length; i += 1) {
    const segment = rawSegments[i] ?? '';
    const isLast = i === rawSegments.length - 1;

    if (segment === '') {
      if (isLast) {
        throw new OpcPartNameError(
          'trailing-slash',
          target,
          'Relationship target resolves to a folder, not a part',
        );
      }
      throw new OpcPartNameError('empty-segment', target, 'Relationship target contains an empty segment');
    }
    if (segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) {
        throw new OpcPartNameError(
          'escapes-root',
          target,
          'Relationship target navigates above the package root',
        );
      }
      stack.pop();
      continue;
    }

    // An encoded dot segment is not a dot segment per RFC 3986 — `%2E%2E` is a
    // literal two-character name — but it is never anything other than an
    // attempt to smuggle one past a validator that decodes later. Reject rather
    // than either navigating or accepting.
    const decoded = percentDecodeAscii(segment);
    if (decoded === '.' || decoded === '..') {
      throw new OpcPartNameError(
        'dot-segment',
        target,
        `Relationship target contains a percent-encoded "${decoded}" segment`,
      );
    }

    stack.push(segment);
  }

  if (stack.length === 0) {
    throw new OpcPartNameError('empty-segment', target, 'Relationship target resolves to the package root');
  }

  return validatePartName(`/${stack.join('/')}`, options);
}

function folderSegments(source: RelationshipSource): string[] {
  if (isPackageRoot(source)) return [];
  const segments = source.slice(1).split('/');
  segments.pop(); // drop the part's own file name; the base is its folder
  return segments;
}

/**
 * Reject anything that is not a path-only reference.
 *
 * Three shapes get caught here, and the distinction in the error code is worth
 * keeping because they arrive from different mistakes:
 *
 * - `http://example.com/x` — an External target that was not labelled
 *   `TargetMode="External"`. Common in hand-built packages.
 * - `C:\Users\…` or `file:///…` — an absolute host path. `C:` parses as a URI
 *   scheme, which is why a naive "does it start with a slash?" check misses it.
 * - `//evil.example/x` — a protocol-relative reference. Resolves to a *network*
 *   location in any URL library, and to a nonsense part name in a naive one.
 */
function rejectSchemeAndAuthority(target: string): void {
  if (target.startsWith('//')) {
    throw new OpcPartNameError(
      'network-path',
      target,
      'Relationship target is a network-path reference ("//host/…")',
    );
  }

  const colon = target.indexOf(':');
  if (colon < 0) return;
  const slash = target.indexOf('/');
  if (slash >= 0 && slash < colon) return; // colon is inside a later segment: legal pchar

  const prefix = target.slice(0, colon);
  if (/^[A-Za-z][A-Za-z0-9+\-.]*$/.test(prefix)) {
    throw new OpcPartNameError(
      'absolute-uri',
      target,
      `Relationship target has a URI scheme ("${prefix}:") and is not an internal part reference`,
    );
  }
  // RFC 3986 §4.2: the first segment of a relative-path reference may not
  // contain a colon at all, precisely because of the ambiguity above.
  throw new OpcPartNameError(
    'invalid-character',
    target,
    'First segment of a relative relationship target must not contain ":"',
  );
}

/**
 * Decode `%XX` escapes to their byte values as characters.
 *
 * Transient only, and byte-wise rather than UTF-8-wise: the sole caller is the
 * dot-segment detector, which needs to see `.` and nothing else. Producing a
 * real string would require UTF-8 decoding and would tempt someone to keep the
 * result.
 */
function percentDecodeAscii(segment: string): string {
  if (!segment.includes('%')) return segment;
  let out = '';
  for (let i = 0; i < segment.length; i += 1) {
    if (segment[i] === '%' && i + 2 < segment.length) {
      const hi = segment.charCodeAt(i + 1);
      const lo = segment.charCodeAt(i + 2);
      if (isHexDigit(hi) && isHexDigit(lo)) {
        out += String.fromCharCode(hexValue(hi) * 16 + hexValue(lo));
        i += 2;
        continue;
      }
    }
    out += segment[i];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The `_rels` convention                                                      */
/* -------------------------------------------------------------------------- */

/** The reserved folder name. Compared case-insensitively, like everything else. */
const RELS_FOLDER = '_rels';
/** The reserved suffix. */
const RELS_SUFFIX = '.rels';

/**
 * `/word/document.xml` → `/word/_rels/document.xml.rels`
 * `/` (the package)    → `/_rels/.rels`
 *
 * The package-level case is not a special rule so much as the general rule
 * applied to a source with an empty name: folder `/`, file name `""`, so the
 * rels name is `/_rels/` + `""` + `.rels`.
 */
export function relsPartNameFor(source: RelationshipSource, options?: PartNameOptions): PartName {
  if (isRelationshipPartName(source)) {
    throw new OpcPartNameError(
      'rels-of-rels',
      source,
      'A relationships part does not itself have a relationships part',
    );
  }
  const folder = partNameFolder(source);
  const fileName = isPackageRoot(source) ? '' : partNameLastSegment(source);
  return validatePartName(`${folder}${RELS_FOLDER}/${fileName}${RELS_SUFFIX}`, options);
}

/**
 * The inverse. `/word/_rels/document.xml.rels` → `/word/document.xml`, and
 * `/_rels/.rels` → the package root.
 *
 * Note the asymmetry the spec creates: a `.rels` file whose stem is empty means
 * "the relationships of the containing *folder*", and OPC defines that only for
 * the package root. `/word/_rels/.rels` therefore has no source and is
 * rejected rather than being invented as "the relationships of /word/".
 */
export function sourceOfRelsPart(relsPartName: PartName): RelationshipSource {
  if (!isRelationshipPartName(relsPartName)) {
    throw new OpcPartNameError(
      'not-a-rels-name',
      relsPartName,
      'Not a relationships part name (expected "…/_rels/….rels")',
    );
  }
  const folder = partNameFolder(relsPartName); // ".../_rels/"
  const parentFolder = folder.slice(0, folder.length - (RELS_FOLDER.length + 1));
  const stem = partNameLastSegment(relsPartName).slice(0, -RELS_SUFFIX.length);

  if (stem === '') {
    if (parentFolder !== PACKAGE_ROOT) {
      throw new OpcPartNameError(
        'not-a-rels-name',
        relsPartName,
        'Only the package root has a folder-level relationships part',
      );
    }
    return PACKAGE_ROOT;
  }
  return validatePartName(`${parentFolder}${stem}`);
}

/**
 * Structural test, independent of whether the part exists.
 *
 * Accepts `RelationshipSource` so callers can ask it of the package root (the
 * answer is `false`) without a narrowing dance.
 */
export function isRelationshipPartName(name: RelationshipSource): boolean {
  if (isPackageRoot(name)) return false;
  const lower = asciiLowerCase(name);
  if (!lower.endsWith(RELS_SUFFIX)) return false;
  const lastSlash = lower.lastIndexOf('/');
  const folder = lower.slice(0, lastSlash);
  return folder.endsWith(`/${RELS_FOLDER}`);
}
