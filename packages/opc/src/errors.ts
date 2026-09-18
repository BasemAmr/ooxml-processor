/**
 * The single error hierarchy for `@ooxml/opc`.
 *
 * Every failure path in this package throws one of these. Never a bare `Error`,
 * never a string, never a rejected promise carrying a plain object.
 *
 * The reason is a verification gate, not tidiness: ADR-0007 §8 requires that a
 * corpus of malformed packages (zip bombs, truncated archives, `../` part
 * names, encrypted packages) each produce *a clean typed error, never a hang,
 * crash or filesystem escape*. A test can only assert that if the error carries
 * a stable machine-readable discriminant. Message text is for humans and is
 * explicitly not part of the contract; `code` is.
 *
 * Every error also carries the *subject* it failed on — the offending part
 * name, ZIP entry name or relationship id — because the single most common
 * support question about a broken `.docx` is "which part?", and reconstructing
 * that from a stack trace is miserable.
 */

/** Discriminates the error classes below without `instanceof`, which is fragile across bundles. */
export type OpcErrorKind =
  'part-name' | 'zip' | 'limit' | 'encrypted' | 'content-type' | 'relationship' | 'package';

/**
 * Base class. Abstract so that every throw site has to pick a specific kind;
 * a generic `new OpcError(...)` escape hatch would erode the whole point.
 */
export abstract class OpcError extends Error {
  /** Coarse category, for `switch` at a boundary that does not care about detail. */
  abstract readonly kind: OpcErrorKind;

  protected constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
    // `Error` subclassing across the ES2022 target keeps the prototype, but the
    // name has to be set explicitly or every subclass reports "Error".
    this.name = new.target.name;
  }
}

/* -------------------------------------------------------------------------- */
/* Part names                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Why these codes exist as a closed union: the part-name grammar is the
 * security boundary of this package (ECMA-376 Part 2 §9.1.1), and the fuzz
 * corpus asserts *which* rule rejected an input. A test that only asserts
 * "it threw" would pass even if `../../../etc/passwd` were rejected for being
 * too long rather than for escaping the package root.
 */
export type PartNameErrorCode =
  /** Did not begin with `/`. Part names are always absolute within the package. */
  | 'not-absolute'
  /** Contained `//`, or was exactly `/`. Empty segments are forbidden. */
  | 'empty-segment'
  /** Ended with `/`. A part name never names a folder. */
  | 'trailing-slash'
  /** A segment ended with `.` — forbidden outright, not just for `.`/`..`. */
  | 'segment-ends-with-dot'
  /** A `.` or `..` segment, literal or percent-encoded. */
  | 'dot-segment'
  /** A character outside `pchar` (RFC 3986): `?`, `#`, `[`, `]`, `\`, space, controls… */
  | 'invalid-character'
  /** A code point above U+007F. Non-ASCII must be percent-encoded UTF-8. */
  | 'non-ascii'
  /** `%` not followed by exactly two hex digits. */
  | 'bad-percent-encoding'
  /** `%2F` or `%5C` — an encoded path separator. */
  | 'encoded-separator'
  /** A percent-encoding of a C0 control or DEL, including `%00`. */
  | 'encoded-control'
  /** Exceeded the configured maximum length. */
  | 'too-long'
  /** A relative target resolved above the package root. Rejected, never clamped. */
  | 'escapes-root'
  /** The target had a URI scheme (`http:`, `file:`, `C:`…) and is not a part reference. */
  | 'absolute-uri'
  /** The target was a network-path reference (`//host/path`). */
  | 'network-path'
  /** The target carried a `#fragment`, forbidden on Internal relationship targets. */
  | 'has-fragment'
  /** The target carried a `?query`. Part names have no query component. */
  | 'has-query'
  /** A `_rels` segment appeared somewhere other than as the parent of a `.rels` part. */
  | 'misplaced-rels-segment'
  /** Asked for the relationships part of a relationships part. Rels parts have no rels. */
  | 'rels-of-rels'
  /** A name was expected to be a relationships part name and was not. */
  | 'not-a-rels-name';

export class OpcPartNameError extends OpcError {
  override readonly kind = 'part-name' as const;

  constructor(
    readonly code: PartNameErrorCode,
    /**
     * The offending name, verbatim and untruncated-until-display.
     *
     * Deliberately *not* called `name`: that is `Error.name`, and a parameter
     * property of that name would quietly overwrite the class name set by the
     * base constructor, so every part-name error would report itself as
     * `"/../../etc/passwd: message"`.
     */
    readonly partName: string,
    message: string,
  ) {
    super(`${message} (part name ${JSON.stringify(truncate(partName))})`);
  }
}

/* -------------------------------------------------------------------------- */
/* ZIP container                                                               */
/* -------------------------------------------------------------------------- */

export type ZipErrorCode =
  /** No end-of-central-directory record in the last 64 KiB + 22 bytes. Not a ZIP. */
  | 'eocd-not-found'
  /** A record ran past the end of the buffer. */
  | 'truncated'
  /** A fixed signature did not match where the central directory said it would be. */
  | 'bad-signature'
  /** Multi-disk / spanned archives. OPC forbids them and we will not reassemble one. */
  | 'multi-disk'
  /** A compression method other than STORE (0) or DEFLATE (8). */
  | 'unsupported-method'
  /** A ZIP64 extra field that is malformed or inconsistent with its base record. */
  | 'zip64-invalid'
  /** Inflated bytes did not match the CRC-32 in the central directory. */
  | 'crc-mismatch'
  /** `fflate` refused the DEFLATE stream. */
  | 'inflate-failed'
  /** An EFS-flagged entry name was not well-formed UTF-8 (overlong, lone surrogate…). */
  | 'bad-name-encoding'
  /** Two entries resolved to the same OPC part name. */
  | 'duplicate-entry'
  /** Central directory declared a different entry count than we could read. */
  | 'entry-count-mismatch';

export class OpcZipError extends OpcError {
  override readonly kind = 'zip' as const;

  constructor(
    readonly code: ZipErrorCode,
    message: string,
    /** ZIP entry name, when the failure is attributable to one entry. */
    readonly entryName?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(
      entryName === undefined
        ? message
        : `${message} (entry ${JSON.stringify(truncate(entryName))})`,
      options,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Resource limits                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which limit tripped. Named after the field on {@link OpcLimits} so the
 * message can tell an operator exactly which knob to turn.
 */
export type OpcLimitName =
  | 'maxArchiveBytes'
  | 'maxEntryCount'
  | 'maxEntryUncompressedBytes'
  | 'maxTotalUncompressedBytes'
  | 'maxCompressionRatio'
  | 'maxPartNameLength';

export class OpcLimitError extends OpcError {
  override readonly kind = 'limit' as const;

  constructor(
    readonly limit: OpcLimitName,
    /** The configured ceiling. */
    readonly allowed: number,
    /** What was observed, or as much of it as we saw before aborting. */
    readonly observed: number,
    /** The entry that tripped it, if attributable. */
    readonly entryName?: string,
  ) {
    super(
      `OPC limit ${limit} exceeded: observed ${observed}, allowed ${allowed}` +
        (entryName === undefined ? '' : ` (entry ${JSON.stringify(truncate(entryName))})`),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Encryption                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Thrown when the bytes are an encrypted/DRM-protected OOXML document rather
 * than a plain package.
 *
 * This is deliberately its own class rather than a `OpcZipError` code. An
 * encrypted `.docx` is not a corrupt file — it is a perfectly valid file we
 * choose not to support (ADR-0002, "Known limits"). The UI wants to say
 * "this document is password-protected", not "this file is damaged", and it
 * should not have to string-match to tell the difference.
 */
export class OpcEncryptedPackageError extends OpcError {
  override readonly kind = 'encrypted' as const;

  constructor(
    /**
     * How we recognised it. `ole-compound-file` means the container is an OLE2
     * compound file (the standard Office "agile encryption" wrapper, and also
     * what a legacy `.doc` looks like). `encrypted-package-stream` means a ZIP
     * that carries an `EncryptedPackage` item. `zip-entry-encrypted` means
     * general-purpose bit 0 was set on an entry (classic ZipCrypto/AES).
     */
    readonly detectedAs: 'ole-compound-file' | 'encrypted-package-stream' | 'zip-entry-encrypted',
    message: string,
  ) {
    super(message);
  }
}

/* -------------------------------------------------------------------------- */
/* [Content_Types].xml                                                         */
/* -------------------------------------------------------------------------- */

export type ContentTypeErrorCode =
  /** The stream was not well-formed, or the root was not `<Types>` in the OPC namespace. */
  | 'malformed'
  /** A required attribute (`Extension`, `PartName`, `ContentType`) was absent. */
  | 'missing-attribute'
  /** Two `<Default>` elements for the same extension (compared case-insensitively). */
  | 'duplicate-default'
  /** Two `<Override>` elements for the same part name (compared case-insensitively). */
  | 'duplicate-override'
  /** `Extension` did not match `ST_Extension`. */
  | 'invalid-extension'
  /** `ContentType` did not match `ST_ContentType` (RFC 2616 media type). */
  | 'invalid-content-type'
  /** No Override and no Default matched the part. OPC requires every part be typed. */
  | 'no-content-type-for-part';

export class OpcContentTypeError extends OpcError {
  override readonly kind = 'content-type' as const;

  constructor(
    readonly code: ContentTypeErrorCode,
    message: string,
    /** The part name or extension at fault. */
    readonly subject?: string,
  ) {
    super(subject === undefined ? message : `${message} (${JSON.stringify(truncate(subject))})`);
  }
}

/* -------------------------------------------------------------------------- */
/* Relationships                                                               */
/* -------------------------------------------------------------------------- */

export type RelationshipErrorCode =
  /** Not well-formed, or the root was not `<Relationships>` in the OPC namespace. */
  | 'malformed'
  /** A required attribute (`Id`, `Type`, `Target`) was absent. */
  | 'missing-attribute'
  /** Two `<Relationship>` elements in one `.rels` part shared an `Id`. `xsd:ID` forbids it. */
  | 'duplicate-id'
  /** `Id` was not an XML `NCName`, which `xsd:ID` requires. */
  | 'invalid-id'
  /** `TargetMode` was neither `Internal` nor `External`. */
  | 'invalid-target-mode'
  /** An Internal target did not resolve to a valid part name. */
  | 'unresolvable-target'
  /** Someone asked for the part behind an External target. There is none, by design. */
  | 'external-target-not-a-part'
  /** A relationship id was looked up and does not exist on that source. */
  | 'unknown-id';

export class OpcRelationshipError extends OpcError {
  override readonly kind = 'relationship' as const;

  constructor(
    readonly code: RelationshipErrorCode,
    message: string,
    /** The `.rels` part being processed. */
    readonly partName?: string,
    /** The relationship id at fault, when known. */
    readonly relationshipId?: string,
    options?: { readonly cause?: unknown },
  ) {
    const where = [
      partName === undefined ? undefined : `in ${JSON.stringify(truncate(partName))}`,
      relationshipId === undefined ? undefined : `id ${JSON.stringify(truncate(relationshipId))}`,
    ]
      .filter((s): s is string => s !== undefined)
      .join(', ');
    super(where === '' ? message : `${message} (${where})`, options);
  }
}

/* -------------------------------------------------------------------------- */
/* Package structure                                                           */
/* -------------------------------------------------------------------------- */

export type PackageErrorCode =
  /** `[Content_Types].xml` was absent. OPC requires it; without it nothing is typed. */
  | 'missing-content-types'
  /** A part referenced by a relationship or by the caller does not exist. */
  | 'part-not-found'
  /** No relationship of type `.../officeDocument` from the package root. Not a `.docx`. */
  | 'missing-main-document'
  /** More than one relationship of a type that OPC/WML permits only once. */
  | 'ambiguous-relationship'
  /** A part's bytes are not decodable text in the encoding its byte-order mark claims. */
  | 'undecodable-part-text'
  /** A write was attempted against a part that is not backed by a ZIP entry. */
  | 'unwritable-part';

export class OpcPackageError extends OpcError {
  override readonly kind = 'package' as const;

  constructor(
    readonly code: PackageErrorCode,
    message: string,
    readonly subject?: string,
  ) {
    super(subject === undefined ? message : `${message} (${JSON.stringify(truncate(subject))})`);
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Names in a hostile package can be megabytes long; a 2 MB exception message
 * turns a clean rejection into a different denial of service. Truncate for
 * display only — the full value stays on the error object.
 */
const MAX_MESSAGE_SUBJECT = 120;

function truncate(value: string): string {
  return value.length <= MAX_MESSAGE_SUBJECT
    ? value
    : `${value.slice(0, MAX_MESSAGE_SUBJECT)}… (+${value.length - MAX_MESSAGE_SUBJECT} chars)`;
}
