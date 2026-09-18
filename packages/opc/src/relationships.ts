/**
 * The `_rels` relationship graph.
 *
 * Schema: `assets/schema/opc/opc-relationships.xsd`.
 *
 * ## External targets are a security boundary, not a convenience
 *
 * A relationship with `TargetMode="External"` names something outside the
 * package: `http://…`, `file://…`, `\\server\share\…`, `mailto:…`. This module
 * **never resolves and never dereferences** one. An external target is kept as
 * the raw attribute string and nothing else; {@link Relationship.targetPartName}
 * is `undefined` for it, and asking for the part behind it throws.
 *
 * The reason is SSRF. A `.docx` is an untrusted document that arrives by email.
 * If any layer of this stack fetched an external relationship target — to
 * resolve a linked image, to follow a hyperlink, to check whether a target
 * exists — then opening a document would let its author make requests from our
 * process, to our network, with our credentials. There is no version of that
 * which is safe by default, so the capability does not exist here at all.
 * Rendering code that wants to show a linked image must be handed the URL by an
 * application that made an explicit policy decision about it.
 *
 * The corollary is that external targets are *not validated* either. We do not
 * check that `http://…` parses, because parsing a URL is the first step of
 * fetching one and we want no part of that gradient. It is an opaque string.
 *
 * ## What the schema says about `Id`
 *
 * `CT_Relationship/@Id` is `xsd:ID`. Two consequences that are easy to miss:
 *
 * 1. `xsd:ID` values are **document-unique**, so duplicate ids within one
 *    `.rels` part are a schema violation, not merely bad style. We reject them:
 *    a duplicate id makes `r:id="rId4"` ambiguous, and "whichever one the
 *    parser happened to keep" is not a defensible answer.
 * 2. `xsd:ID` is an `NCName`, so an id may not start with a digit and may not
 *    contain a colon. Word writes `rId1`, `rId2`, … which satisfies this
 *    comfortably.
 *
 * ## What the schema says that is odd
 *
 * `CT_Relationship` is declared as `simpleContent` extending `xsd:string`,
 * which means a `<Relationship>` element may legally carry **text content**.
 * Nothing uses it and it is almost certainly an artefact of how the schema was
 * written, but it is normative, so the text is preserved for round-trip.
 *
 * Conversely, `CT_Relationships` has no `xs:any` and no `anyAttribute`: the
 * content model is closed. Unknown attributes are therefore invalid markup —
 * which does not stop producers from writing them, so we keep them rather than
 * silently deleting a user's data on save.
 */

import { OpcRelationshipError } from './errors.js';
import {
  canonicalPartName,
  isPackageRoot,
  PACKAGE_ROOT,
  resolveRelative,
  type PartName,
  type RelationshipSource,
} from './partname.js';
import {
  attributeValue,
  forEachChildElement,
  otherAttributes,
  readRootElement,
  RELATIONSHIPS_NS,
  writeAttributes,
  type XmlSupport,
} from './xml-support.js';
import type { XmlAttr } from '@ooxml/schema';

/** `ST_TargetMode`. The attribute is optional; `Internal` is the default. */
export type TargetMode = 'Internal' | 'External';

/**
 * `NCName` membership, per XML 1.0 5th edition, minus the astral plane.
 *
 * Written as code-point range tests rather than as a regex character class for
 * two reasons. The class would have to contain literal combining marks and
 * zero-width joiners, which nobody can proofread in a diff and which any tool
 * between here and CI can silently re-encode; and the ranges as written here can
 * be checked line by line against the XML production, which is the only review
 * that would ever catch an error in them.
 *
 * Astral `NameStartChar`s (`[#x10000-#xEFFFF]`) are not accepted. No producer
 * emits them in a relationship id, and supporting them would mean surrogate-pair
 * handling for no benefit; one that turns up is rejected with a clear
 * `invalid-id`, which beats a subtly wrong match.
 */
function isNameStartChar(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    code === 0x5f || // _
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x00c0 && code <= 0x00d6) ||
    (code >= 0x00d8 && code <= 0x00f6) ||
    (code >= 0x00f8 && code <= 0x02ff) ||
    (code >= 0x0370 && code <= 0x037d) ||
    (code >= 0x037f && code <= 0x1fff) ||
    (code >= 0x200c && code <= 0x200d) ||
    (code >= 0x2070 && code <= 0x218f) ||
    (code >= 0x2c00 && code <= 0x2fef) ||
    (code >= 0x3001 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfdcf) ||
    (code >= 0xfdf0 && code <= 0xfffd)
  );
  // Deliberately excludes ":" (0x3a): NCName is Name without a colon, which is
  // what makes an xsd:ID distinguishable from a QName.
}

function isNameChar(code: number): boolean {
  return (
    isNameStartChar(code) ||
    code === 0x2d || // -
    code === 0x2e || // .
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x00b7 ||
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x203f && code <= 0x2040)
  );
}

function isNcName(value: string): boolean {
  if (value.length === 0) return false;
  if (!isNameStartChar(value.charCodeAt(0))) return false;
  for (let i = 1; i < value.length; i += 1) {
    if (!isNameChar(value.charCodeAt(i))) return false;
  }
  return true;
}

export interface Relationship {
  readonly id: string;
  /** The relationship type URI, verbatim. See `rel-types.ts` for the well-known set. */
  readonly type: string;
  /** The `Target` attribute exactly as written. Never normalized; round-trip depends on it. */
  readonly target: string;
  readonly targetMode: TargetMode;
  /**
   * Whether the source markup spelled `TargetMode` out.
   *
   * Word omits it for Internal and writes it for External. Preserving the
   * distinction is what lets an unmodified `.rels` part serialize back to the
   * same attribute list it arrived with.
   */
  readonly targetModeExplicit: boolean;
  /**
   * The resolved part name, for Internal targets only.
   *
   * `undefined` for External — by design, see the module header.
   *
   * Note this says nothing about whether the part *exists*. A dangling internal
   * relationship is a damaged document, not a hostile one, and Word opens such
   * files; refusing to open them would make us less useful without making us
   * safer. Existence is checked at lookup time, not at parse time.
   */
  readonly targetPartName: PartName | undefined;
  /** The part (or the package) these relationships belong to. */
  readonly source: RelationshipSource;
  readonly unknownAttributes: readonly XmlAttr[];
  /** `CT_Relationship` is `simpleContent`; text is legal and therefore preserved. */
  readonly text: string;
}

export function isExternal(relationship: Relationship): boolean {
  return relationship.targetMode === 'External';
}

/* -------------------------------------------------------------------------- */
/* One `.rels` part                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The relationships declared by a single `.rels` part.
 *
 * Order is preserved. It has no semantic meaning in OPC, but it is part of the
 * bytes, and re-ordering would defeat the round-trip gate for no gain.
 */
export class RelationshipSet {
  #relationships: Relationship[];
  #byId: Map<string, Relationship>;
  #dirty = false;

  private constructor(
    readonly source: RelationshipSource,
    relationships: Relationship[],
  ) {
    this.#relationships = relationships;
    this.#byId = new Map();
    for (const relationship of relationships) {
      this.#byId.set(relationship.id, relationship);
    }
  }

  static empty(source: RelationshipSource): RelationshipSet {
    return new RelationshipSet(source, []);
  }

  /**
   * Parse a `.rels` part.
   *
   * `source` is the part the relationships belong to — `/word/document.xml` for
   * `/word/_rels/document.xml.rels` — because that, not the `.rels` file's own
   * location, is the base URI for resolving relative targets.
   */
  static parse(
    xml: string,
    source: RelationshipSource,
    support: XmlSupport,
    relsPartName?: string,
  ): RelationshipSet {
    const cursor = support.createCursor(xml);
    const root = readRootElement(cursor);
    if (root === undefined || root.localName !== 'Relationships' || root.uri !== RELATIONSHIPS_NS) {
      throw new OpcRelationshipError(
        'malformed',
        `Relationships part root must be <Relationships> in ${RELATIONSHIPS_NS}`,
        relsPartName,
      );
    }

    const relationships: Relationship[] = [];
    const seen = new Set<string>();

    forEachChildElement(cursor, (start, text) => {
      if (start.uri !== RELATIONSHIPS_NS || start.localName !== 'Relationship') {
        throw new OpcRelationshipError(
          'malformed',
          `Unexpected element {${start.uri}}${start.localName} in a relationships part`,
          relsPartName,
        );
      }

      const id = requiredAttribute(start.localName, 'Id', attributeValue(start, 'Id'), relsPartName);
      if (!isNcName(id)) {
        throw new OpcRelationshipError(
          'invalid-id',
          'Relationship Id is not an XML NCName, which xsd:ID requires',
          relsPartName,
          id,
        );
      }
      if (seen.has(id)) {
        throw new OpcRelationshipError(
          'duplicate-id',
          'Two relationships in one .rels part share an Id; xsd:ID requires uniqueness',
          relsPartName,
          id,
        );
      }
      seen.add(id);

      const type = requiredAttribute(start.localName, 'Type', attributeValue(start, 'Type'), relsPartName);
      const target = requiredAttribute(
        start.localName,
        'Target',
        attributeValue(start, 'Target'),
        relsPartName,
      );

      const targetModeAttribute = attributeValue(start, 'TargetMode');
      if (
        targetModeAttribute !== undefined &&
        targetModeAttribute !== 'Internal' &&
        targetModeAttribute !== 'External'
      ) {
        throw new OpcRelationshipError(
          'invalid-target-mode',
          `TargetMode must be "Internal" or "External", got ${JSON.stringify(targetModeAttribute)}`,
          relsPartName,
          id,
        );
      }
      const targetMode: TargetMode = targetModeAttribute ?? 'Internal';

      let targetPartName: PartName | undefined;
      if (targetMode === 'Internal') {
        try {
          targetPartName = resolveRelative(source, target);
        } catch (error) {
          throw new OpcRelationshipError(
            'unresolvable-target',
            `Internal relationship target ${JSON.stringify(target)} does not resolve to a part name`,
            relsPartName,
            id,
            { cause: error },
          );
        }
      }

      relationships.push({
        id,
        type,
        target,
        targetMode,
        targetModeExplicit: targetModeAttribute !== undefined,
        targetPartName,
        source,
        unknownAttributes: otherAttributes(start, ['Id', 'Type', 'Target', 'TargetMode']),
        text,
      });
    });

    return new RelationshipSet(source, relationships);
  }

  get relationships(): readonly Relationship[] {
    return this.#relationships;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  byId(id: string): Relationship | undefined {
    return this.#byId.get(id);
  }

  requireById(id: string): Relationship {
    const found = this.#byId.get(id);
    if (found === undefined) {
      throw new OpcRelationshipError(
        'unknown-id',
        'No relationship with this Id',
        isPackageRoot(this.source) ? '/_rels/.rels' : this.source,
        id,
      );
    }
    return found;
  }

  /** All relationships of a type, in declaration order. */
  byType(...types: readonly string[]): readonly Relationship[] {
    const wanted = new Set(types);
    return this.#relationships.filter((relationship) => wanted.has(relationship.type));
  }

  /**
   * The single relationship of a type, or `undefined`.
   *
   * Throws if there is more than one. Several WordprocessingML relationship
   * types — `styles`, `numbering`, `settings` — are singular by definition, and
   * silently picking the first of two would hide a genuinely broken document.
   */
  singleByType(...types: readonly string[]): Relationship | undefined {
    const matches = this.byType(...types);
    if (matches.length > 1) {
      throw new OpcRelationshipError(
        'malformed',
        `Expected at most one relationship of type ${types.join(' or ')}, found ${matches.length}`,
        isPackageRoot(this.source) ? '/_rels/.rels' : this.source,
      );
    }
    return matches[0];
  }

  add(relationship: Omit<Relationship, 'source'>): Relationship {
    if (this.#byId.has(relationship.id)) {
      throw new OpcRelationshipError(
        'duplicate-id',
        'A relationship with this Id already exists',
        isPackageRoot(this.source) ? '/_rels/.rels' : this.source,
        relationship.id,
      );
    }
    const created: Relationship = { ...relationship, source: this.source };
    this.#relationships.push(created);
    this.#byId.set(created.id, created);
    this.#dirty = true;
    return created;
  }

  remove(id: string): boolean {
    const index = this.#relationships.findIndex((relationship) => relationship.id === id);
    if (index < 0) return false;
    this.#relationships.splice(index, 1);
    this.#byId.delete(id);
    this.#dirty = true;
    return true;
  }

  serialize(support: XmlSupport): string {
    const { sink, toString } = support.createStringSink();
    sink.startElement(RELATIONSHIPS_NS, 'Relationships');
    sink.declareNamespace('', RELATIONSHIPS_NS);
    for (const relationship of this.#relationships) {
      sink.startElement(RELATIONSHIPS_NS, 'Relationship');
      sink.attr(null, 'Id', relationship.id);
      sink.attr(null, 'Type', relationship.type);
      sink.attr(null, 'Target', relationship.target);
      if (relationship.targetModeExplicit) {
        sink.attr(null, 'TargetMode', relationship.targetMode);
      }
      writeAttributes(sink, relationship.unknownAttributes);
      if (relationship.text !== '') sink.text(relationship.text);
      sink.endElement();
    }
    sink.endElement();
    return toString();
  }
}

/* -------------------------------------------------------------------------- */
/* The whole graph                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every `.rels` part in the package, indexed by the *source* they describe.
 *
 * Keyed on the canonical (case-folded) source name, because part names compare
 * case-insensitively and a graph that distinguished `/word/document.xml` from
 * `/word/Document.xml` would let a package present two different views of
 * itself depending on how a caller happened to spell a name.
 */
export class RelationshipGraph {
  readonly #sets = new Map<string, RelationshipSet>();

  add(set: RelationshipSet): void {
    this.#sets.set(canonicalPartName(set.source), set);
  }

  /** The relationships declared *by* a part (or by the package). */
  forSource(source: RelationshipSource): RelationshipSet | undefined {
    return this.#sets.get(canonicalPartName(source));
  }

  /** Never `undefined`: an absent `.rels` part is an empty set, not an error. */
  relationshipsOf(source: RelationshipSource): RelationshipSet {
    return this.forSource(source) ?? RelationshipSet.empty(source);
  }

  /** The package-level relationships from `/_rels/.rels`. */
  get packageRelationships(): RelationshipSet {
    return this.relationshipsOf(PACKAGE_ROOT);
  }

  sets(): IterableIterator<RelationshipSet> {
    return this.#sets.values();
  }

  /**
   * Resolve `source` + relationship id to a part name.
   *
   * Throws `external-target-not-a-part` for an External target rather than
   * returning `undefined`, because every caller of this function is about to go
   * looking for bytes, and "there are no bytes, by design" is a different
   * situation from "the id is unknown" that deserves a different message.
   */
  targetPartName(source: RelationshipSource, id: string): PartName {
    const relationship = this.relationshipsOf(source).requireById(id);
    if (relationship.targetPartName === undefined) {
      throw new OpcRelationshipError(
        'external-target-not-a-part',
        'This relationship has TargetMode="External"; it names a resource outside the package, ' +
          'which this library deliberately does not resolve or fetch',
        isPackageRoot(source) ? '/_rels/.rels' : source,
        id,
      );
    }
    return relationship.targetPartName;
  }
}

/* -------------------------------------------------------------------------- */

function requiredAttribute(
  element: string,
  attribute: string,
  value: string | undefined,
  relsPartName: string | undefined,
): string {
  if (value === undefined) {
    throw new OpcRelationshipError(
      'missing-attribute',
      `<${element}> is missing its required ${attribute} attribute`,
      relsPartName,
    );
  }
  return value;
}
