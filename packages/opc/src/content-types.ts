/**
 * `[Content_Types].xml` — the part-to-media-type mapping.
 *
 * Schema: `assets/schema/opc/opc-contentTypes.xsd`.
 *
 * ## What the schema actually says, versus what everyone assumes
 *
 * `CT_Types` is
 *
 * ```xml
 * <xs:choice minOccurs="0" maxOccurs="unbounded">
 *   <xs:element ref="Default"/>
 *   <xs:element ref="Override"/>
 * </xs:choice>
 * ```
 *
 * — a *repeated choice*, not a sequence. `Default` and `Override` may therefore
 * be interleaved in any order. Word happens to write all the Defaults first,
 * and a great deal of code assumes that shape and models the file as two
 * separate lists. That model cannot round-trip an interleaved file. This one
 * keeps a single ordered list of declarations and derives the two lookup
 * indexes from it, so declaration order survives a save untouched.
 *
 * Also note what `CT_Types` does *not* have: no `xs:any`, no `anyAttribute`. The
 * content model is closed. Unknown children are invalid markup, and we do not
 * attempt to preserve them; unknown *attributes* on a `Default`/`Override` are
 * equally invalid but are cheap to keep, so we keep them.
 *
 * ## Resolution
 *
 * Override beats Default (§10.1.2.3). Extension matching is case-insensitive,
 * as is part-name matching for Overrides. A part that matches neither is an
 * error — OPC has no default-default, and a part with no content type cannot be
 * interpreted by anybody.
 */

import { OpcContentTypeError } from './errors.js';
import {
  asciiLowerCase,
  canonicalPartName,
  partNameExtension,
  validatePartName,
  type PartName,
} from './partname.js';
import {
  attributeValue,
  CONTENT_TYPES_NS,
  forEachChildElement,
  otherAttributes,
  readRootElement,
  writeAttributes,
  type XmlSupport,
} from './xml-support.js';
import type { XmlAttr } from '@ooxml/schema';

/* -------------------------------------------------------------------------- */
/* Lexical validation, straight from the XSD                                   */
/* -------------------------------------------------------------------------- */

/**
 * `ST_Extension`, transcribed from the schema:
 *
 * ```
 * ([!$&'\(\)\*\+,:=]|(%[0-9a-fA-F][0-9a-fA-F])|[:@]|[a-zA-Z0-9\-_~])+
 * ```
 *
 * Worth noticing what is missing relative to RFC 3986 `pchar`, which is what
 * the rest of a part name is built from: **`.` and `;` are not permitted in an
 * extension**. The dot exclusion is obvious in hindsight (the dot is the
 * delimiter, so an extension containing one would be ambiguous), but the
 * semicolon exclusion is a genuine asymmetry — `;` is a `sub-delim` and is
 * legal in a part-name segment, just not in the extension of one.
 */
const ST_EXTENSION = /^(?:[!$&'()*+,:=@]|%[0-9a-fA-F]{2}|[a-zA-Z0-9\-_~])+$/;

/**
 * `ST_ContentType`, which is RFC 2616's `media-type` production.
 *
 * The XSD spells it with XML Schema character-class subtraction
 * (`[\p{IsBasicLatin}-[\p{Cc}...]]`), which JavaScript's regex engine has no
 * equivalent for. Transcribed here as the equivalent explicit sets: the
 * `token` character class is ASCII printable minus the RFC 2616 separators, and
 * the quoted-string form allows escaped ASCII.
 */
const TOKEN = "[!#$%&'*+\\-.0-9A-Za-z^_`|~]+";
const QUOTED_STRING = '"(?:[^"\\r\\n\\\\]|\\\\[\\x00-\\x7f])*"';
const ST_CONTENT_TYPE = new RegExp(
  `^${TOKEN}/${TOKEN}(?:\\s*;\\s*${TOKEN}=(?:${TOKEN}|${QUOTED_STRING}))*$`,
);

/* -------------------------------------------------------------------------- */
/* Model                                                                       */
/* -------------------------------------------------------------------------- */

export interface ContentTypeDefault {
  readonly kind: 'default';
  /** Verbatim, in the case the file used. Matching is done on the folded form. */
  readonly extension: string;
  readonly contentType: string;
  /** Attributes the schema does not declare, kept so a save does not drop them. */
  readonly unknownAttributes: readonly XmlAttr[];
}

export interface ContentTypeOverride {
  readonly kind: 'override';
  readonly partName: PartName;
  readonly contentType: string;
  readonly unknownAttributes: readonly XmlAttr[];
}

export type ContentTypeDeclaration = ContentTypeDefault | ContentTypeOverride;

/**
 * The parsed content-types stream.
 *
 * Mutable, but only through the `set*` methods, which maintain the indexes and
 * the declaration order together. `dirty` tells `savePackage` whether it has to
 * re-serialize — an untouched stream is written back as its original bytes,
 * which is most of why an untouched package round-trips byte-for-byte.
 */
export class ContentTypes {
  #declarations: ContentTypeDeclaration[];
  /** Folded extension → index into `#declarations`. */
  #defaults = new Map<string, number>();
  /** Canonical part name → index into `#declarations`. */
  #overrides = new Map<string, number>();
  #dirty = false;

  private constructor(declarations: ContentTypeDeclaration[]) {
    this.#declarations = declarations;
    this.#reindex();
  }

  static parse(xml: string, support: XmlSupport): ContentTypes {
    const cursor = support.createCursor(xml);
    const root = readRootElement(cursor);
    if (root === undefined || root.localName !== 'Types' || root.uri !== CONTENT_TYPES_NS) {
      throw new OpcContentTypeError(
        'malformed',
        `[Content_Types].xml root must be <Types> in ${CONTENT_TYPES_NS}`,
        root === undefined ? undefined : `{${root.uri}}${root.localName}`,
      );
    }

    const declarations: ContentTypeDeclaration[] = [];
    forEachChildElement(cursor, (start) => {
      if (start.uri !== CONTENT_TYPES_NS) {
        throw new OpcContentTypeError(
          'malformed',
          'Unexpected element in [Content_Types].xml',
          `{${start.uri}}${start.localName}`,
        );
      }
      if (start.localName === 'Default') {
        const extension = required(start.localName, 'Extension', attributeValue(start, 'Extension'));
        const contentType = required(start.localName, 'ContentType', attributeValue(start, 'ContentType'));
        declarations.push({
          kind: 'default',
          extension: checkExtension(extension),
          contentType: checkContentType(contentType, extension),
          unknownAttributes: otherAttributes(start, ['Extension', 'ContentType']),
        });
        return;
      }
      if (start.localName === 'Override') {
        const partName = required(start.localName, 'PartName', attributeValue(start, 'PartName'));
        const contentType = required(start.localName, 'ContentType', attributeValue(start, 'ContentType'));
        declarations.push({
          kind: 'override',
          // `CT_Override/@PartName` is declared `xs:anyURI`, which validates
          // nothing. The part-name grammar is prose-only, so this call is the
          // only thing standing between a hostile `[Content_Types].xml` and a
          // part name nobody checked.
          partName: validatePartName(partName),
          contentType: checkContentType(contentType, partName),
          unknownAttributes: otherAttributes(start, ['PartName', 'ContentType']),
        });
        return;
      }
      throw new OpcContentTypeError(
        'malformed',
        'Unexpected element in [Content_Types].xml',
        start.localName,
      );
    });

    return new ContentTypes(declarations);
  }

  /** An empty table, for building a package from nothing. */
  static empty(): ContentTypes {
    const table = new ContentTypes([]);
    table.#dirty = true;
    return table;
  }

  get declarations(): readonly ContentTypeDeclaration[] {
    return this.#declarations;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  /**
   * Resolve a part's content type. Throws if nothing matches.
   *
   * The part name is in the message because "some part has no content type" is
   * useless and "`/word/media/image7.emf` has no content type" is immediately
   * actionable — it means the package forgot `<Default Extension="emf">`.
   */
  contentTypeFor(partName: PartName): string {
    const found = this.tryContentTypeFor(partName);
    if (found === undefined) {
      const extension = partNameExtension(partName);
      throw new OpcContentTypeError(
        'no-content-type-for-part',
        extension === undefined
          ? 'No Override declares a content type for this part, and it has no extension to match a Default'
          : `No Override and no Default (Extension="${extension}") declares a content type for this part`,
        partName,
      );
    }
    return found;
  }

  tryContentTypeFor(partName: PartName): string | undefined {
    const overrideIndex = this.#overrides.get(canonicalPartName(partName));
    if (overrideIndex !== undefined) {
      return (this.#declarations[overrideIndex] as ContentTypeOverride).contentType;
    }
    const extension = partNameExtension(partName);
    if (extension === undefined) return undefined;
    const defaultIndex = this.#defaults.get(asciiLowerCase(extension));
    if (defaultIndex === undefined) return undefined;
    return (this.#declarations[defaultIndex] as ContentTypeDefault).contentType;
  }

  /** Add or replace a Default, keeping its position if it already existed. */
  setDefault(extension: string, contentType: string): void {
    const declaration: ContentTypeDefault = {
      kind: 'default',
      extension: checkExtension(extension),
      contentType: checkContentType(contentType, extension),
      unknownAttributes: [],
    };
    const existing = this.#defaults.get(asciiLowerCase(extension));
    if (existing !== undefined) this.#declarations[existing] = declaration;
    else this.#declarations.push(declaration);
    this.#dirty = true;
    this.#reindex();
  }

  /** Add or replace an Override, keeping its position if it already existed. */
  setOverride(partName: PartName, contentType: string): void {
    const declaration: ContentTypeOverride = {
      kind: 'override',
      partName,
      contentType: checkContentType(contentType, partName),
      unknownAttributes: [],
    };
    const existing = this.#overrides.get(canonicalPartName(partName));
    if (existing !== undefined) this.#declarations[existing] = declaration;
    else this.#declarations.push(declaration);
    this.#dirty = true;
    this.#reindex();
  }

  /**
   * Serialize in declaration order.
   *
   * Only called when `dirty`. An unmodified stream is written back from its
   * original compressed bytes, because no serializer reproduces another
   * serializer's whitespace and attribute spelling and we are not going to
   * pretend otherwise.
   */
  serialize(support: XmlSupport): string {
    const { sink, toString } = support.createStringSink();
    sink.startElement(CONTENT_TYPES_NS, 'Types');
    sink.declareNamespace('', CONTENT_TYPES_NS);
    for (const declaration of this.#declarations) {
      if (declaration.kind === 'default') {
        sink.startElement(CONTENT_TYPES_NS, 'Default');
        sink.attr(null, 'Extension', declaration.extension);
        sink.attr(null, 'ContentType', declaration.contentType);
      } else {
        sink.startElement(CONTENT_TYPES_NS, 'Override');
        sink.attr(null, 'PartName', declaration.partName);
        sink.attr(null, 'ContentType', declaration.contentType);
      }
      writeAttributes(sink, declaration.unknownAttributes);
      sink.endElement();
    }
    sink.endElement();
    return toString();
  }

  #reindex(): void {
    this.#defaults.clear();
    this.#overrides.clear();
    for (let i = 0; i < this.#declarations.length; i += 1) {
      const declaration = this.#declarations[i] as ContentTypeDeclaration;
      if (declaration.kind === 'default') {
        const key = asciiLowerCase(declaration.extension);
        if (this.#defaults.has(key)) {
          throw new OpcContentTypeError(
            'duplicate-default',
            'Two <Default> elements declare the same extension (extensions compare case-insensitively)',
            declaration.extension,
          );
        }
        this.#defaults.set(key, i);
      } else {
        const key = canonicalPartName(declaration.partName);
        if (this.#overrides.has(key)) {
          throw new OpcContentTypeError(
            'duplicate-override',
            'Two <Override> elements declare the same part name (part names compare case-insensitively)',
            declaration.partName,
          );
        }
        this.#overrides.set(key, i);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */

function required(element: string, attribute: string, value: string | undefined): string {
  if (value === undefined) {
    throw new OpcContentTypeError(
      'missing-attribute',
      `<${element}> is missing its required ${attribute} attribute`,
    );
  }
  return value;
}

function checkExtension(extension: string): string {
  if (!ST_EXTENSION.test(extension)) {
    throw new OpcContentTypeError(
      'invalid-extension',
      'Extension does not match ST_Extension',
      extension,
    );
  }
  return extension;
}

/**
 * Validate against `ST_ContentType` but store the value verbatim.
 *
 * The trim is the one concession to reality: producers occasionally emit
 * `ContentType=" image/png"`, and XML attribute-value normalization does not
 * strip it. Rejecting such a file helps nobody, and storing the trimmed form
 * would change the bytes on save. So: validate the trimmed value, keep the
 * original.
 */
function checkContentType(contentType: string, subject: string): string {
  if (!ST_CONTENT_TYPE.test(contentType.trim())) {
    throw new OpcContentTypeError(
      'invalid-content-type',
      `ContentType ${JSON.stringify(contentType)} is not a valid media type`,
      subject,
    );
  }
  return contentType;
}
