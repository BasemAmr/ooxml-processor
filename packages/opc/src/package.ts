/**
 * The package façade: `openPackage` / `savePackage` and the `OpcPackage` object
 * they hand around.
 *
 * ## The round-trip guarantee, stated precisely
 *
 * A part this library does not understand is held as **bytes** and written back
 * **unchanged** — not re-parsed, not re-serialized, not even re-compressed. The
 * mechanism is deliberately dull: every part keeps a reference to its original
 * ZIP entry, and `savePackage` copies that entry's already-compressed payload
 * straight through unless something explicitly replaced the part's content.
 *
 * This is the load-bearing property of the whole editor. `.docx` files contain
 * a long tail of things we will never model — digital signatures, custom XML
 * from a records-management system, `w14`/`w15` extension markup, thumbnails,
 * printer settings, VBA projects. If opening and saving a document quietly drops
 * any of them, we have corrupted a user's file. So the default for anything
 * unrecognised is "carry it, do not touch it", and the burden of proof is on
 * code that wants to rewrite something.
 *
 * ## Laziness
 *
 * A part's bytes are inflated on first access and cached; its XML is parsed on
 * demand and never cached here (the caller decides what to do with a cursor).
 * The point is not only speed. A package with forty benign parts and one hostile
 * one costs nothing until someone touches the hostile part, and the shared
 * decompression budget means the hostile part still cannot exceed the package's
 * total allowance no matter which order things are touched in.
 */

import { ContentTypes } from './content-types.js';
import { OpcPackageError } from './errors.js';
import { resolveLimits, type OpcLimits } from './limits.js';
import {
  canonicalPartName,
  isRelationshipPartName,
  PACKAGE_ROOT,
  sourceOfRelsPart,
  type PartName,
  type RelationshipSource,
} from './partname.js';
import { RelationshipGraph, RelationshipSet, type Relationship } from './relationships.js';
import { MEDIA_RELATIONSHIP_TYPES, RelationshipTypes } from './rel-types.js';
import type { XmlSupport } from './xml-support.js';
import {
  createBudget,
  crc32,
  CONTENT_TYPES_ITEM_NAME,
  decompressEntry,
  deflateForEntry,
  readZip,
  writeZip,
  type DecompressionBudget,
  type ZipEntry,
  type ZipWriteEntry,
} from './zip.js';
import type { XmlCursor } from '@ooxml/schema';

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

export interface OpcPart {
  readonly name: PartName;
  /** Resolved through `[Content_Types].xml` at open time; never `undefined`. */
  readonly contentType: string;
  /** True once `replaceBytes` has been called; drives re-compression on save. */
  readonly modified: boolean;

  /** Inflate on first call, then cached. Enforces the package's size budget. */
  bytes(): Uint8Array;
  /** `bytes()` decoded as XML text, honouring a byte-order mark. */
  text(): string;
  /** A fresh cursor over `text()`. Not cached — cursors are stateful. */
  cursor(): XmlCursor;
  /** The relationships declared *by* this part. Empty if it has no `.rels`. */
  relationships(): RelationshipSet;

  replaceBytes(bytes: Uint8Array): void;
}

class Part implements OpcPart {
  #bytes: Uint8Array | undefined;
  #modified = false;

  constructor(
    readonly name: PartName,
    readonly contentType: string,
    private readonly entry: ZipEntry,
    private readonly owner: PackageImpl,
  ) {}

  get modified(): boolean {
    return this.#modified;
  }

  /** The ZIP entry this part came from. `savePackage` needs it; callers do not. */
  get sourceEntry(): ZipEntry {
    return this.entry;
  }

  bytes(): Uint8Array {
    if (this.#bytes === undefined) {
      this.#bytes = decompressEntry(this.entry, this.owner.limits, this.owner.budget);
    }
    return this.#bytes;
  }

  text(): string {
    return decodeXmlText(this.bytes(), this.name);
  }

  cursor(): XmlCursor {
    return this.owner.xml.createCursor(this.text());
  }

  relationships(): RelationshipSet {
    return this.owner.relationships.relationshipsOf(this.name);
  }

  replaceBytes(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#modified = true;
  }
}

/* -------------------------------------------------------------------------- */
/* Well-known WordprocessingML parts                                           */
/* -------------------------------------------------------------------------- */

/**
 * The parts a WordprocessingML consumer asks for by name.
 *
 * Every one is found by *following a relationship*, never by guessing a path.
 * The conventional layout (`/word/document.xml`, `/word/styles.xml`) is a Word
 * convention, not a rule; LibreOffice, Google Docs and Pages all conform to OPC
 * while laying parts out differently, and a path-guessing reader reports those
 * files as corrupt.
 *
 * Singular slots are `undefined` when absent rather than throwing — a document
 * with no numbering part is entirely normal. `mainDocument` is the exception:
 * without it there is no document, so `openPackage` refuses.
 */
export interface WordPartIndex {
  readonly mainDocument: OpcPart;
  readonly styles: OpcPart | undefined;
  readonly stylesWithEffects: OpcPart | undefined;
  readonly numbering: OpcPart | undefined;
  readonly settings: OpcPart | undefined;
  readonly webSettings: OpcPart | undefined;
  readonly fontTable: OpcPart | undefined;
  readonly theme: OpcPart | undefined;
  readonly footnotes: OpcPart | undefined;
  readonly endnotes: OpcPart | undefined;
  readonly comments: OpcPart | undefined;
  readonly glossaryDocument: OpcPart | undefined;
  /** In relationship-declaration order. `w:headerReference/@r:id` selects among them. */
  readonly headers: readonly OpcPart[];
  readonly footers: readonly OpcPart[];
  /** Every internally-targeted image/video/audio part, from anywhere in the package. */
  readonly media: readonly OpcPart[];

  readonly coreProperties: OpcPart | undefined;
  readonly extendedProperties: OpcPart | undefined;
  readonly customProperties: OpcPart | undefined;
  readonly thumbnail: OpcPart | undefined;
}

/* -------------------------------------------------------------------------- */
/* Package                                                                     */
/* -------------------------------------------------------------------------- */

export interface OpcPackage {
  /** Every part, keyed by canonical (ASCII-lower-cased) part name. */
  readonly parts: ReadonlyMap<string, OpcPart>;
  readonly contentTypes: ContentTypes;
  readonly relationships: RelationshipGraph;
  readonly packageRelationships: RelationshipSet;
  readonly wordParts: WordPartIndex;
  /** Convenience alias for `wordParts.mainDocument`. */
  readonly mainDocument: OpcPart;
  readonly limits: OpcLimits;

  getPart(name: string): OpcPart | undefined;
  requirePart(name: string): OpcPart;

  /** The parts a source relates to, by relationship type. External targets are skipped. */
  relatedParts(source: RelationshipSource, ...types: readonly string[]): readonly OpcPart[];
  /** The single related part of a type, or `undefined`. Throws if there are several. */
  relatedPart(source: RelationshipSource, ...types: readonly string[]): OpcPart | undefined;

  save(): Promise<Uint8Array>;
}

class PackageImpl implements OpcPackage {
  readonly parts = new Map<string, Part>();
  readonly budget: DecompressionBudget = createBudget();
  #wordParts: WordPartIndex | undefined;

  constructor(
    readonly xml: XmlSupport,
    readonly limits: OpcLimits,
    readonly contentTypes: ContentTypes,
    readonly relationships: RelationshipGraph,
    /** In archive order. This *is* the save order — see `savePackage`. */
    readonly entries: readonly ZipEntry[],
    readonly archiveComment: Uint8Array,
  ) {}

  get packageRelationships(): RelationshipSet {
    return this.relationships.packageRelationships;
  }

  get wordParts(): WordPartIndex {
    if (this.#wordParts === undefined) this.#wordParts = buildWordPartIndex(this);
    return this.#wordParts;
  }

  get mainDocument(): OpcPart {
    return this.wordParts.mainDocument;
  }

  getPart(name: string): OpcPart | undefined {
    return this.parts.get(canonicalPartName(name as PartName));
  }

  requirePart(name: string): OpcPart {
    const part = this.getPart(name);
    if (part === undefined) {
      throw new OpcPackageError('part-not-found', 'No such part in the package', name);
    }
    return part;
  }

  relatedParts(source: RelationshipSource, ...types: readonly string[]): readonly OpcPart[] {
    const found: OpcPart[] = [];
    for (const relationship of this.relationships.relationshipsOf(source).byType(...types)) {
      const part = this.#partForRelationship(relationship);
      if (part !== undefined) found.push(part);
    }
    return found;
  }

  relatedPart(source: RelationshipSource, ...types: readonly string[]): OpcPart | undefined {
    const relationship = this.relationships.relationshipsOf(source).singleByType(...types);
    if (relationship === undefined) return undefined;
    return this.#partForRelationship(relationship);
  }

  /**
   * A relationship's part, or `undefined`.
   *
   * Two distinct reasons to get `undefined`, both deliberately non-fatal:
   * the target is External (there is no part, by design), or the target names a
   * part the package does not contain. The second is a damaged document; Word
   * opens those, and refusing to would make us less useful without making us
   * safer. Code that needs the part to exist calls `requirePart`.
   */
  #partForRelationship(relationship: Relationship): OpcPart | undefined {
    if (relationship.targetPartName === undefined) return undefined;
    return this.getPart(relationship.targetPartName);
  }

  async save(): Promise<Uint8Array> {
    return savePackage(this);
  }
}

/* -------------------------------------------------------------------------- */
/* Open                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Open an OPC package.
 *
 * `xml` is injected rather than imported — see `xml-support.ts` for why.
 *
 * Async in signature only: everything here is synchronous today. The shape is
 * the commitment, because streaming a package from a `ReadableStream` or moving
 * the work into a worker (ADR-0005) both need an async boundary, and changing
 * `openPackage` from sync to async later would break every caller.
 */
export async function openPackage(
  bytes: Uint8Array,
  xml: XmlSupport,
  opts?: Partial<OpcLimits>,
): Promise<OpcPackage> {
  const limits = resolveLimits(opts);
  const archive = readZip(bytes, limits);
  const budget = createBudget();

  const contentTypesEntry = archive.entries.find(
    (entry) => entry.partName === undefined && !entry.isDirectory,
  );
  if (contentTypesEntry === undefined) {
    throw new OpcPackageError(
      'missing-content-types',
      'The package has no [Content_Types].xml stream, which OPC requires; nothing in it can be typed',
    );
  }
  const contentTypes = ContentTypes.parse(
    decodeXmlText(decompressEntry(contentTypesEntry, limits, budget), CONTENT_TYPES_ITEM_NAME),
    xml,
  );

  const graph = new RelationshipGraph();
  const pkg = new PackageImpl(xml, limits, contentTypes, graph, archive.entries, archive.comment);
  // The budget accumulated by the content-types read carries over; it is the
  // same package allowance.
  pkg.budget.totalUncompressedBytes = budget.totalUncompressedBytes;

  for (const entry of archive.entries) {
    if (entry.partName === undefined) continue; // directory entry or the content-types stream
    const part = new Part(entry.partName, contentTypes.contentTypeFor(entry.partName), entry, pkg);
    pkg.parts.set(canonicalPartName(entry.partName), part);
  }

  // Relationship parts are parsed eagerly. They are small, every one of them is
  // needed to answer "what is in this document", and a malformed `.rels` is a
  // structural failure that should surface at open rather than halfway through
  // a render.
  for (const part of pkg.parts.values()) {
    if (!isRelationshipPartName(part.name)) continue;
    const source = sourceOfRelsPart(part.name);
    graph.add(RelationshipSet.parse(part.text(), source, xml, part.name));
  }

  return pkg;
}

/* -------------------------------------------------------------------------- */
/* Save                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Write the package back out.
 *
 * Entries are emitted in their original archive order. That is not cosmetic:
 * ADR-0002 and the Verification §3 gate require second-generation output to be
 * byte-identical to first-generation output, and any reordering — alphabetical,
 * by content type, "content types first" — makes that impossible to reason
 * about the moment a part is added.
 *
 * Unmodified entries are copied through with their compressed bytes, CRC and
 * declared sizes untouched. Only parts whose content changed, and the
 * `[Content_Types].xml` / `.rels` streams that were edited through the model,
 * are re-serialized and re-compressed.
 */
export async function savePackage(pkg: OpcPackage): Promise<Uint8Array> {
  const impl = pkg as PackageImpl;
  const writeEntries: ZipWriteEntry[] = [];

  for (const entry of impl.entries) {
    const replacement = replacementBytesFor(impl, entry);
    writeEntries.push(replacement === undefined ? passThrough(entry) : recompress(entry, replacement));
  }

  return writeZip(writeEntries, impl.archiveComment);
}

/**
 * The new bytes for an entry, or `undefined` to pass it through untouched.
 *
 * Three sources of change, in the order they are checked: a part whose bytes
 * were replaced outright, the content-types stream if the table was edited, and
 * a `.rels` part if its relationship set was edited.
 */
function replacementBytesFor(pkg: PackageImpl, entry: ZipEntry): Uint8Array | undefined {
  if (entry.partName === undefined) {
    if (!entry.isDirectory && pkg.contentTypes.dirty) {
      return encodeXmlText(pkg.contentTypes.serialize(pkg.xml));
    }
    return undefined;
  }

  const part = pkg.parts.get(canonicalPartName(entry.partName));
  if (part === undefined) return undefined;
  if (part.modified) return part.bytes();

  if (isRelationshipPartName(part.name)) {
    const set = pkg.relationships.forSource(sourceOfRelsPart(part.name));
    if (set !== undefined && set.dirty) return encodeXmlText(set.serialize(pkg.xml));
  }
  return undefined;
}

function passThrough(entry: ZipEntry): ZipWriteEntry {
  return {
    nameBytes: entry.nameBytes,
    method: entry.method,
    flags: entry.flags,
    versionMadeBy: entry.versionMadeBy,
    versionNeeded: entry.versionNeeded,
    dosTime: entry.dosTime,
    dosDate: entry.dosDate,
    crc32: entry.crc32,
    uncompressedSize: entry.uncompressedSize,
    compressedData: entry.compressedData,
    localExtra: entry.localExtra,
    centralExtra: entry.centralExtra,
    comment: entry.comment,
    internalAttributes: entry.internalAttributes,
    externalAttributes: entry.externalAttributes,
  };
}

function recompress(entry: ZipEntry, data: Uint8Array): ZipWriteEntry {
  const compressed = deflateForEntry(data);
  return {
    ...passThrough(entry),
    method: compressed.method,
    crc32: crc32(data),
    uncompressedSize: data.length,
    compressedData: compressed.data,
  };
}

/* -------------------------------------------------------------------------- */
/* Well-known part discovery                                                   */
/* -------------------------------------------------------------------------- */

function buildWordPartIndex(pkg: PackageImpl): WordPartIndex {
  const mainRelationship = pkg.packageRelationships.singleByType(...RelationshipTypes.officeDocument);
  if (mainRelationship === undefined) {
    throw new OpcPackageError(
      'missing-main-document',
      'The package has no officeDocument relationship from /_rels/.rels, so it is not a ' +
        'WordprocessingML (or any other OOXML) document',
    );
  }
  if (mainRelationship.targetPartName === undefined) {
    throw new OpcPackageError(
      'missing-main-document',
      'The officeDocument relationship is marked External; the main document part must be inside the package',
      mainRelationship.target,
    );
  }
  const mainDocument = pkg.getPart(mainRelationship.targetPartName);
  if (mainDocument === undefined) {
    throw new OpcPackageError(
      'missing-main-document',
      'The officeDocument relationship targets a part that is not in the package',
      mainRelationship.targetPartName,
    );
  }

  const from = mainDocument.name;
  return {
    mainDocument,
    styles: pkg.relatedPart(from, ...RelationshipTypes.styles),
    stylesWithEffects: pkg.relatedPart(from, ...RelationshipTypes.stylesWithEffects),
    numbering: pkg.relatedPart(from, ...RelationshipTypes.numbering),
    settings: pkg.relatedPart(from, ...RelationshipTypes.settings),
    webSettings: pkg.relatedPart(from, ...RelationshipTypes.webSettings),
    fontTable: pkg.relatedPart(from, ...RelationshipTypes.fontTable),
    theme: pkg.relatedPart(from, ...RelationshipTypes.theme),
    footnotes: pkg.relatedPart(from, ...RelationshipTypes.footnotes),
    endnotes: pkg.relatedPart(from, ...RelationshipTypes.endnotes),
    comments: pkg.relatedPart(from, ...RelationshipTypes.comments),
    glossaryDocument: pkg.relatedPart(from, ...RelationshipTypes.glossaryDocument),
    headers: pkg.relatedParts(from, ...RelationshipTypes.header),
    footers: pkg.relatedParts(from, ...RelationshipTypes.footer),
    media: collectMedia(pkg),

    coreProperties: pkg.relatedPart(PACKAGE_ROOT, ...RelationshipTypes.coreProperties),
    extendedProperties: pkg.relatedPart(PACKAGE_ROOT, ...RelationshipTypes.extendedProperties),
    customProperties: pkg.relatedPart(PACKAGE_ROOT, ...RelationshipTypes.customProperties),
    thumbnail: pkg.relatedPart(PACKAGE_ROOT, ...RelationshipTypes.thumbnail),
  };
}

/**
 * Every internally-targeted media part, from every relationship source.
 *
 * Package-wide rather than main-document-only because images are referenced
 * from headers, footers, footnotes, comments and the glossary document as well,
 * each through its own `.rels`. Deduplicated (one image is commonly referenced
 * from several parts) while keeping first-seen order, so the list is stable
 * across runs — an unstable order would make any golden file that mentions
 * media flap.
 */
function collectMedia(pkg: PackageImpl): readonly OpcPart[] {
  const seen = new Set<string>();
  const media: OpcPart[] = [];
  for (const set of pkg.relationships.sets()) {
    for (const relationship of set.byType(...MEDIA_RELATIONSHIP_TYPES)) {
      if (relationship.targetPartName === undefined) continue; // External: not ours to resolve
      const key = canonicalPartName(relationship.targetPartName);
      if (seen.has(key)) continue;
      const part = pkg.parts.get(key);
      if (part === undefined) continue; // dangling reference in a damaged file
      seen.add(key);
      media.push(part);
    }
  }
  return media;
}

/* -------------------------------------------------------------------------- */
/* Text codecs                                                                 */
/* -------------------------------------------------------------------------- */

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * Decode a part's bytes as XML text.
 *
 * XML permits UTF-16, and OPC does not forbid it. Word writes UTF-8 with a BOM,
 * but `.docx` files produced by Java and .NET toolchains with UTF-16 parts do
 * exist, and handing UTF-16 bytes to a UTF-8 decoder produces a document that
 * appears to be full of NUL characters rather than an error.
 *
 * Decoding is strict. A part that is not valid text in the encoding it claims is
 * an error, not a string full of U+FFFD: a replacement character in markup is a
 * corruption we would then faithfully round-trip back into the user's file.
 *
 * The BOM is stripped. It is not part of the document's character data, and
 * leaving it in front of the XML declaration makes every parser unhappy.
 */
export function decodeXmlText(bytes: Uint8Array, subject: string): string {
  let encoding = 'utf-8';
  let offset = 0;
  if (bytes.length >= 3 && UTF8_BOM.every((byte, i) => bytes[i] === byte)) {
    offset = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    offset = 2;
  }

  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
  } catch (error) {
    throw new OpcPackageError(
      'undecodable-part-text',
      `Part is not well-formed ${encoding} text`,
      `${subject}: ${String(error)}`,
    );
  }
}

/**
 * Encode XML for writing.
 *
 * No BOM. Word emits one and we preserve it on any part we did not touch (the
 * bytes pass through untouched), but for a part we are re-serializing there is
 * nothing to preserve, and a BOM-less UTF-8 XML document is unambiguous.
 */
export function encodeXmlText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
