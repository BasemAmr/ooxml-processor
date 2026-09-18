/**
 * ZIP container read/write, driven directly over the central directory.
 *
 * ## Why not `fflate.unzipSync` / `zipSync`
 *
 * ADR-0002: byte-stability across open→save→open is a project gate. A
 * convenience unzipper hands back a name→bytes map, which loses entry order,
 * per-entry compression method, DOS timestamps, external attributes and extra
 * fields — every one of which is part of the bytes we have to reproduce. It
 * also cannot abort a decompression midway, which is what the zip-bomb defence
 * needs. So we parse the central directory ourselves and use `fflate` only for
 * the DEFLATE codec.
 *
 * ## The round-trip trick that makes byte-stability cheap
 *
 * Every entry keeps its **raw compressed bytes** exactly as they appeared in the
 * archive. A part we did not modify is written back by copying those bytes and
 * their CRC and sizes verbatim — we never re-deflate it, so we never have to
 * reproduce the original encoder's choices about block splitting, Huffman
 * tables or match lengths (which are not reproducible in general; `fflate` and
 * Word's zlib fork do not agree). Only a part whose content was replaced gets
 * recompressed.
 *
 * ## What we deliberately normalize
 *
 * Two things, both of which change first-generation bytes and neither of which
 * changes second-generation bytes:
 *
 * - **Data descriptors are dropped.** An entry written with general-purpose bit
 *   3 carries zeroed sizes in the local header and the real ones in a trailer.
 *   We always know the sizes (the central directory has them), so we write them
 *   inline and clear bit 3. Keeping the trailer would mean reproducing a
 *   variant — signed or unsigned, 32-bit or 64-bit — chosen by a producer we
 *   cannot interrogate.
 * - **ZIP64 extra fields are regenerated.** The incoming `0x0001` records are
 *   stripped from the preserved extra-field blobs and re-emitted from the
 *   values we actually write, because a preserved ZIP64 record describing the
 *   old offsets would be actively wrong.
 *
 * Everything else — order, method, flags, timestamps, versions, attributes,
 * comments, other extra fields, the archive comment — is preserved verbatim.
 */

import { Inflate, deflateSync } from 'fflate';

import { OpcEncryptedPackageError, OpcLimitError, OpcZipError } from './errors.js';
import type { OpcLimits } from './limits.js';
import { asciiLowerCase, validatePartName, type PartName } from './partname.js';

/* -------------------------------------------------------------------------- */
/* Format constants                                                            */
/* -------------------------------------------------------------------------- */

const SIG_LOCAL_HEADER = 0x04034b50;
const SIG_CENTRAL_HEADER = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

const EOCD_FIXED_SIZE = 22;
const CENTRAL_HEADER_FIXED_SIZE = 46;
const LOCAL_HEADER_FIXED_SIZE = 30;
const ZIP64_EOCD_FIXED_SIZE = 56;
const ZIP64_LOCATOR_SIZE = 20;

/** The 16-bit archive-comment length field bounds how far back the EOCD can be. */
const MAX_EOCD_SEARCH = 0xffff + EOCD_FIXED_SIZE;

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

/** General-purpose bit flags we care about. */
const FLAG_ENCRYPTED = 1 << 0;
const FLAG_DATA_DESCRIPTOR = 1 << 3;
const FLAG_STRONG_ENCRYPTION = 1 << 6;
/** "Language encoding flag" (EFS): entry name and comment are UTF-8, not CP437. */
export const FLAG_UTF8_NAMES = 1 << 11;

export const METHOD_STORE = 0;
export const METHOD_DEFLATE = 8;

const ZIP64_EXTRA_HEADER_ID = 0x0001;

/**
 * The content-types stream is a *package* item, not a part.
 *
 * This matters more than it looks: `[Content_Types].xml` is not a legal OPC
 * part name — `[` and `]` are outside `pchar`. So the "every entry must be a
 * valid part name" rule has to exempt it explicitly, or no package on earth
 * opens. ECMA-376 Part 2 §10.1.2 is clear that the stream is addressed by
 * physical name and has no part name; this constant is the code-level
 * expression of that.
 */
export const CONTENT_TYPES_ITEM_NAME = '[Content_Types].xml';

/**
 * Names that mark an encrypted OOXML container carried inside a ZIP rather than
 * an OLE compound file. Compared case-insensitively.
 */
const ENCRYPTED_STREAM_NAMES = new Set(['encryptedpackage', 'encryptioninfo']);

/** OLE2 / Compound File Binary magic. An encrypted `.docx` is a CFB, not a ZIP. */
const OLE_MAGIC = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/* -------------------------------------------------------------------------- */
/* Entry model                                                                 */
/* -------------------------------------------------------------------------- */

export interface ZipEntry {
  /** Decoded name, as it appears in the archive: no leading `/`. */
  readonly name: string;
  /**
   * The original name bytes.
   *
   * Kept because the decode is lossy in one direction that matters: a CP437
   * name round-trips to different bytes if re-encoded as UTF-8, and changing
   * the bytes would change the CRC-relevant... no, worse — it would change the
   * part's identity. Writing the original bytes back sidesteps the question.
   */
  readonly nameBytes: Uint8Array;
  /**
   * The OPC part name, or `undefined` for archive items that are not parts:
   * directory entries and `[Content_Types].xml`.
   */
  readonly partName: PartName | undefined;
  readonly isDirectory: boolean;

  readonly method: number;
  /** General-purpose bit flag, as read. Bit 3 may be set here; the writer clears it. */
  readonly flags: number;
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly internalAttributes: number;
  readonly externalAttributes: number;

  /** Extra fields with any ZIP64 (`0x0001`) record removed. See the module header. */
  readonly localExtra: Uint8Array;
  readonly centralExtra: Uint8Array;
  readonly comment: Uint8Array;

  /** The entry payload exactly as stored, still compressed if `method` says so. */
  readonly compressedData: Uint8Array;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  /** The trailing archive comment, preserved verbatim. */
  readonly comment: Uint8Array;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse an archive into entries, in central-directory order, enforcing the
 * structural limits that can be checked without decompressing.
 *
 * Nothing is inflated here. Part payloads stay compressed until someone asks
 * for them, which is both the lazy-parts requirement and a defence in its own
 * right: a package with one hostile part and forty benign ones costs nothing
 * until the hostile one is touched.
 */
export function readZip(bytes: Uint8Array, limits: OpcLimits): ZipArchive {
  detectEncryptedContainer(bytes);

  if (bytes.length > limits.maxArchiveBytes) {
    throw new OpcLimitError('maxArchiveBytes', limits.maxArchiveBytes, bytes.length);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes, view);

  if (eocd.entryCount > limits.maxEntryCount) {
    throw new OpcLimitError('maxEntryCount', limits.maxEntryCount, eocd.entryCount);
  }

  const entries: ZipEntry[] = [];
  const seenPartNames = new Map<string, string>();
  let declaredTotalUncompressed = 0;
  let cursor = eocd.centralDirectoryOffset;

  for (let i = 0; i < eocd.entryCount; i += 1) {
    const parsed = readCentralHeader(bytes, view, cursor, eocd.offsetDelta, limits);
    entries.push(parsed.entry);
    cursor = parsed.nextOffset;

    if (parsed.entry.partName !== undefined) {
      const key = asciiLowerCase(parsed.entry.partName);
      const previous = seenPartNames.get(key);
      if (previous !== undefined) {
        // M1.12: a package shall not contain two equivalent part names. Left
        // unchecked, "which one wins" becomes a parser-differential bug: Word
        // and we would disagree about the document's content.
        throw new OpcZipError(
          'duplicate-entry',
          `Two entries map to the same part name (also ${JSON.stringify(previous)})`,
          parsed.entry.name,
        );
      }
      seenPartNames.set(key, parsed.entry.name);
    }

    declaredTotalUncompressed += parsed.entry.uncompressedSize;
  }

  // The honest bomb: a central directory that truthfully declares 40 GB. Caught
  // before a single byte is inflated. The dishonest bomb — a central directory
  // that lies about its sizes — is caught by the streaming check in
  // `decompressEntry`, which trusts nothing the archive says.
  if (declaredTotalUncompressed > limits.maxTotalUncompressedBytes) {
    throw new OpcLimitError(
      'maxTotalUncompressedBytes',
      limits.maxTotalUncompressedBytes,
      declaredTotalUncompressed,
    );
  }

  return { entries, comment: eocd.comment };
}

/**
 * Refuse encrypted/DRM containers up front with a message a user can act on.
 *
 * An encrypted `.docx` is an OLE compound file whose streams hold the real,
 * encrypted ZIP. Without this check the bytes reach the EOCD scanner, which
 * finds no end-of-central-directory record and reports "not a ZIP archive" —
 * technically true and completely unhelpful.
 */
function detectEncryptedContainer(bytes: Uint8Array): void {
  if (bytes.length >= OLE_MAGIC.length) {
    let matches = true;
    for (let i = 0; i < OLE_MAGIC.length; i += 1) {
      if (bytes[i] !== OLE_MAGIC[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      throw new OpcEncryptedPackageError(
        'ole-compound-file',
        'This file is an OLE compound file, not an OPC package — it is either an ' +
          'encrypted (password-protected) OOXML document or a legacy binary Office ' +
          'file. Encrypted documents are not supported.',
      );
    }
  }
}

interface EndOfCentralDirectory {
  readonly entryCount: number;
  readonly centralDirectoryOffset: number;
  readonly comment: Uint8Array;
  /**
   * Correction applied to every stored offset.
   *
   * Non-zero when the archive has a prefix (a self-extracting stub, or a
   * `.docx` concatenated onto something else). The offsets in the central
   * directory are then relative to a start-of-archive that is not byte zero of
   * the buffer.
   */
  readonly offsetDelta: number;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): EndOfCentralDirectory {
  const searchFloor = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  let eocdOffset = -1;
  for (let i = bytes.length - EOCD_FIXED_SIZE; i >= searchFloor; i -= 1) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue;
    // Guard against the signature appearing inside entry data: the comment
    // length must account for exactly the remaining bytes.
    const commentLength = view.getUint16(i + 20, true);
    if (i + EOCD_FIXED_SIZE + commentLength === bytes.length) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new OpcZipError(
      'eocd-not-found',
      'No ZIP end-of-central-directory record found; the file is not a ZIP archive or is truncated',
    );
  }

  const commentLength = view.getUint16(eocdOffset + 20, true);
  const comment = bytes.slice(eocdOffset + EOCD_FIXED_SIZE, eocdOffset + EOCD_FIXED_SIZE + commentLength);

  let entryCount = view.getUint16(eocdOffset + 10, true);
  let centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  let centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  let recordStart = eocdOffset;

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);

  // ZIP64 is signalled by saturated 16/32-bit fields plus a locator sitting
  // immediately before the EOCD. We look for the locator whenever any field is
  // saturated *or* the locator signature is simply there, because some
  // producers emit ZIP64 records unconditionally.
  const locatorOffset = eocdOffset - ZIP64_LOCATOR_SIZE;
  const hasLocator =
    locatorOffset >= 0 && view.getUint32(locatorOffset, true) === SIG_ZIP64_LOCATOR;

  if (hasLocator) {
    const zip64EocdOffset = readUint64(view, locatorOffset + 8);
    if (zip64EocdOffset < 0 || zip64EocdOffset + ZIP64_EOCD_FIXED_SIZE > bytes.length) {
      throw new OpcZipError('zip64-invalid', 'ZIP64 locator points outside the archive');
    }
    if (view.getUint32(zip64EocdOffset, true) !== SIG_ZIP64_EOCD) {
      throw new OpcZipError('zip64-invalid', 'ZIP64 end-of-central-directory signature missing');
    }
    entryCount = readUint64(view, zip64EocdOffset + 32);
    centralDirectorySize = readUint64(view, zip64EocdOffset + 40);
    centralDirectoryOffset = readUint64(view, zip64EocdOffset + 48);
    recordStart = zip64EocdOffset;

    const totalDisks = view.getUint32(locatorOffset + 16, true);
    if (totalDisks > 1) {
      throw new OpcZipError('multi-disk', 'Spanned (multi-disk) ZIP archives are not supported');
    }
  } else if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new OpcZipError('multi-disk', 'Spanned (multi-disk) ZIP archives are not supported');
  }

  if (entryCount < 0 || centralDirectorySize < 0 || centralDirectoryOffset < 0) {
    throw new OpcZipError('zip64-invalid', 'Central directory sizes exceed the safe integer range');
  }

  // Prefix correction. Only applied when it actually fixes the signature, so a
  // genuinely corrupt offset still reports as corrupt rather than being
  // silently "repaired" into some other part of the file.
  let offsetDelta = 0;
  const expectedStart = recordStart - centralDirectorySize;
  if (
    centralDirectoryOffset + CENTRAL_HEADER_FIXED_SIZE <= bytes.length &&
    view.getUint32(centralDirectoryOffset, true) !== SIG_CENTRAL_HEADER &&
    expectedStart >= 0 &&
    expectedStart + CENTRAL_HEADER_FIXED_SIZE <= bytes.length &&
    view.getUint32(expectedStart, true) === SIG_CENTRAL_HEADER
  ) {
    offsetDelta = expectedStart - centralDirectoryOffset;
    centralDirectoryOffset = expectedStart;
  }

  if (centralDirectoryOffset + centralDirectorySize > bytes.length) {
    throw new OpcZipError('truncated', 'Central directory extends past the end of the archive');
  }

  return { entryCount, centralDirectoryOffset, comment, offsetDelta };
}

function readCentralHeader(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  offsetDelta: number,
  limits: OpcLimits,
): { readonly entry: ZipEntry; readonly nextOffset: number } {
  requireBytes(bytes, offset, CENTRAL_HEADER_FIXED_SIZE, 'central directory header');
  if (view.getUint32(offset, true) !== SIG_CENTRAL_HEADER) {
    throw new OpcZipError('bad-signature', `Expected a central directory header at offset ${offset}`);
  }

  const versionMadeBy = view.getUint16(offset + 4, true);
  const versionNeeded = view.getUint16(offset + 6, true);
  const flags = view.getUint16(offset + 8, true);
  const method = view.getUint16(offset + 10, true);
  const dosTime = view.getUint16(offset + 12, true);
  const dosDate = view.getUint16(offset + 14, true);
  const crc = view.getUint32(offset + 16, true);
  let compressedSize = view.getUint32(offset + 20, true);
  let uncompressedSize = view.getUint32(offset + 24, true);
  const nameLength = view.getUint16(offset + 28, true);
  const extraLength = view.getUint16(offset + 30, true);
  const commentLength = view.getUint16(offset + 32, true);
  let diskStart = view.getUint16(offset + 34, true);
  const internalAttributes = view.getUint16(offset + 36, true);
  const externalAttributes = view.getUint32(offset + 38, true);
  let localHeaderOffset = view.getUint32(offset + 42, true);

  const variableStart = offset + CENTRAL_HEADER_FIXED_SIZE;
  const total = CENTRAL_HEADER_FIXED_SIZE + nameLength + extraLength + commentLength;
  requireBytes(bytes, offset, total, 'central directory entry');

  const nameBytes = bytes.slice(variableStart, variableStart + nameLength);
  const rawCentralExtra = bytes.slice(variableStart + nameLength, variableStart + nameLength + extraLength);
  const comment = bytes.slice(
    variableStart + nameLength + extraLength,
    variableStart + nameLength + extraLength + commentLength,
  );

  const name = decodeEntryName(nameBytes, flags);

  if ((flags & FLAG_ENCRYPTED) !== 0 || (flags & FLAG_STRONG_ENCRYPTION) !== 0) {
    throw new OpcEncryptedPackageError(
      'zip-entry-encrypted',
      `ZIP entry ${JSON.stringify(name)} is encrypted. Password-protected packages are not supported.`,
    );
  }
  if (ENCRYPTED_STREAM_NAMES.has(asciiLowerCase(name))) {
    throw new OpcEncryptedPackageError(
      'encrypted-package-stream',
      `The package contains an ${JSON.stringify(name)} stream, which means the document is ` +
        'encrypted (password-protected). Encrypted documents are not supported.',
    );
  }

  const zip64 = readZip64Extra(rawCentralExtra, {
    uncompressedSize,
    compressedSize,
    localHeaderOffset,
    diskStart,
  });
  uncompressedSize = zip64.uncompressedSize;
  compressedSize = zip64.compressedSize;
  localHeaderOffset = zip64.localHeaderOffset;
  diskStart = zip64.diskStart;

  if (diskStart !== 0) {
    throw new OpcZipError('multi-disk', 'Entry lives on a different disk of a spanned archive', name);
  }
  if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
    throw new OpcZipError(
      'unsupported-method',
      `Compression method ${method} is not supported (only STORE and DEFLATE)`,
      name,
    );
  }
  if (uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new OpcLimitError(
      'maxEntryUncompressedBytes',
      limits.maxEntryUncompressedBytes,
      uncompressedSize,
      name,
    );
  }

  const isDirectory = name.endsWith('/');
  const partName = isDirectory || isContentTypesItem(name) ? undefined : toPartName(name, limits);

  const dataStart = readLocalHeaderDataStart(bytes, view, localHeaderOffset + offsetDelta, name);
  if (dataStart + compressedSize > bytes.length) {
    throw new OpcZipError('truncated', 'Entry data extends past the end of the archive', name);
  }
  const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);
  const localExtra = readLocalExtra(bytes, view, localHeaderOffset + offsetDelta);

  const entry: ZipEntry = {
    name,
    nameBytes,
    partName,
    isDirectory,
    method,
    flags,
    versionMadeBy,
    versionNeeded,
    dosTime,
    dosDate,
    crc32: crc,
    compressedSize,
    uncompressedSize,
    internalAttributes,
    externalAttributes,
    localExtra,
    centralExtra: stripZip64Extra(rawCentralExtra),
    comment,
    compressedData,
  };

  return { entry, nextOffset: offset + total };
}

/**
 * Turn a ZIP entry name into a part name, or fail loudly.
 *
 * The leading `/` is supplied here: ZIP names are relative to the archive root
 * and never carry one, while OPC part names always do. Producers occasionally
 * write a leading slash anyway; that produces `//name`, an empty first segment,
 * and is rejected — deliberately, because "sometimes there is a slash" is how
 * two entries end up denoting one part.
 */
function toPartName(entryName: string, limits: OpcLimits): PartName {
  return validatePartName(`/${entryName}`, { maxLength: limits.maxPartNameLength });
}

function isContentTypesItem(name: string): boolean {
  return asciiLowerCase(name) === asciiLowerCase(CONTENT_TYPES_ITEM_NAME);
}

function readLocalHeaderDataStart(
  bytes: Uint8Array,
  view: DataView,
  headerOffset: number,
  entryName: string,
): number {
  requireBytes(bytes, headerOffset, LOCAL_HEADER_FIXED_SIZE, 'local file header', entryName);
  if (view.getUint32(headerOffset, true) !== SIG_LOCAL_HEADER) {
    throw new OpcZipError(
      'bad-signature',
      `Expected a local file header at offset ${headerOffset}`,
      entryName,
    );
  }
  // The local header's own name/extra lengths are authoritative for locating the
  // payload. They are allowed to differ from the central directory's — ZIP64
  // records in particular are frequently present in one and absent in the other
  // — and trusting the central copy here is a classic off-by-a-few bug.
  const nameLength = view.getUint16(headerOffset + 26, true);
  const extraLength = view.getUint16(headerOffset + 28, true);
  return headerOffset + LOCAL_HEADER_FIXED_SIZE + nameLength + extraLength;
}

function readLocalExtra(bytes: Uint8Array, view: DataView, headerOffset: number): Uint8Array {
  const nameLength = view.getUint16(headerOffset + 26, true);
  const extraLength = view.getUint16(headerOffset + 28, true);
  const start = headerOffset + LOCAL_HEADER_FIXED_SIZE + nameLength;
  return stripZip64Extra(bytes.slice(start, start + extraLength));
}

/* -------------------------------------------------------------------------- */
/* Extra fields                                                                */
/* -------------------------------------------------------------------------- */

interface Zip64Fields {
  uncompressedSize: number;
  compressedSize: number;
  localHeaderOffset: number;
  diskStart: number;
}

/**
 * Apply a ZIP64 extra field to the saturated base fields.
 *
 * The record is positional, not tagged: it carries only those of
 * (uncompressed size, compressed size, local header offset, disk start) whose
 * base field was saturated, **in that order**. Reading it as a fixed 28-byte
 * struct — a common shortcut — mis-reads every archive that saturated only some
 * of the fields, which is most of them.
 */
function readZip64Extra(extra: Uint8Array, base: Zip64Fields): Zip64Fields {
  const result: Zip64Fields = { ...base };
  const record = findExtraField(extra, ZIP64_EXTRA_HEADER_ID);
  if (record === undefined) {
    if (base.uncompressedSize === U32_MAX || base.compressedSize === U32_MAX) {
      throw new OpcZipError('zip64-invalid', 'Entry declares ZIP64 sizes but carries no ZIP64 extra field');
    }
    return result;
  }

  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  let cursor = 0;
  const take = (): number => {
    if (cursor + 8 > record.byteLength) {
      throw new OpcZipError('zip64-invalid', 'ZIP64 extra field is shorter than its saturated fields require');
    }
    const value = readUint64(view, cursor);
    cursor += 8;
    return value;
  };

  if (base.uncompressedSize === U32_MAX) result.uncompressedSize = take();
  if (base.compressedSize === U32_MAX) result.compressedSize = take();
  if (base.localHeaderOffset === U32_MAX) result.localHeaderOffset = take();
  if (base.diskStart === U16_MAX && cursor + 4 <= record.byteLength) {
    result.diskStart = view.getUint32(cursor, true);
  }

  if (result.uncompressedSize < 0 || result.compressedSize < 0 || result.localHeaderOffset < 0) {
    throw new OpcZipError('zip64-invalid', 'ZIP64 field exceeds the safe integer range');
  }
  return result;
}

function findExtraField(extra: Uint8Array, headerId: number): Uint8Array | undefined {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let offset = 0;
  while (offset + 4 <= extra.byteLength) {
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (offset + 4 + size > extra.byteLength) break; // malformed tail; ignore rather than throw
    if (id === headerId) return extra.subarray(offset + 4, offset + 4 + size);
    offset += 4 + size;
  }
  return undefined;
}

/** Remove `0x0001` records so the writer can regenerate them from real values. */
function stripZip64Extra(extra: Uint8Array): Uint8Array {
  if (extra.byteLength === 0) return extra;
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  const keep: Array<[number, number]> = [];
  let offset = 0;
  let found = false;
  while (offset + 4 <= extra.byteLength) {
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (offset + 4 + size > extra.byteLength) break;
    if (id === ZIP64_EXTRA_HEADER_ID) found = true;
    else keep.push([offset, 4 + size]);
    offset += 4 + size;
  }
  if (!found) return extra;
  const length = keep.reduce((sum, [, size]) => sum + size, 0);
  const out = new Uint8Array(length);
  let cursor = 0;
  for (const [start, size] of keep) {
    out.set(extra.subarray(start, start + size), cursor);
    cursor += size;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Entry name encoding                                                         */
/* -------------------------------------------------------------------------- */

const utf8StrictDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode an entry name from bytes.
 *
 * ZIP has no single name encoding. Bit 11 (EFS) means UTF-8; without it the
 * name is in the DOS OEM code page, which for practical purposes means CP437.
 * We decode strictly in the UTF-8 case — overlong encodings and lone surrogates
 * are rejected rather than replaced with U+FFFD — because a replacement
 * character silently merges distinct names, and "two parts that decode to the
 * same name" is exactly the ambiguity the part-name rules exist to prevent.
 *
 * Note what happens to a producer that writes UTF-8 *without* setting EFS
 * (older Word did this): the bytes come back as mojibake, and part-name
 * validation then rejects them for containing non-ASCII. That is the right
 * outcome — a legal OPC part name is pure ASCII, so any name that needs either
 * decoding to be non-ASCII was already invalid.
 */
function decodeEntryName(nameBytes: Uint8Array, flags: number): string {
  if ((flags & FLAG_UTF8_NAMES) !== 0) {
    try {
      return utf8StrictDecoder.decode(nameBytes);
    } catch (error) {
      throw new OpcZipError(
        'bad-name-encoding',
        'Entry name is flagged UTF-8 but is not well-formed UTF-8',
        undefined,
        { cause: error },
      );
    }
  }
  return decodeCp437(nameBytes);
}

/**
 * CP437, as a 256-entry lookup.
 *
 * The high half is written as hex code points rather than as literal characters
 * so this source file stays pure ASCII. Box-drawing glyphs in a source file are
 * a standing invitation for an editor, a diff tool or a CI checkout to re-encode
 * them, and a silently altered code-page table is an exceptionally annoying bug
 * to find. 0x00–0x7F are mapped to ASCII, which is the convention every ZIP
 * tool uses even though CP437 proper assigns graphic characters down there.
 */
const CP437_TABLE = buildCp437Table();

function buildCp437Table(): readonly string[] {
  const high = [
    0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, 0x00ea, 0x00eb, 0x00e8, 0x00ef,
    0x00ee, 0x00ec, 0x00c4, 0x00c5, 0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
    0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192, 0x00e1, 0x00ed, 0x00f3, 0x00fa,
    0x00f1, 0x00d1, 0x00aa, 0x00ba, 0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
    0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557,
    0x255d, 0x255c, 0x255b, 0x2510, 0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
    0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567, 0x2568, 0x2564, 0x2565, 0x2559,
    0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
    0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4, 0x03a6, 0x0398, 0x03a9, 0x03b4,
    0x221e, 0x03c6, 0x03b5, 0x2229, 0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248,
    0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
  ];
  const table: string[] = new Array<string>(256);
  for (let i = 0; i < 128; i += 1) table[i] = String.fromCharCode(i);
  for (let i = 0; i < 128; i += 1) table[128 + i] = String.fromCharCode(high[i] ?? 0xfffd);
  return table;
}

function decodeCp437(nameBytes: Uint8Array): string {
  let out = '';
  for (const byte of nameBytes) out += CP437_TABLE[byte] ?? '\uFFFD';
  return out;
}

/* -------------------------------------------------------------------------- */
/* Decompression, with the limits enforced inside the loop                     */
/* -------------------------------------------------------------------------- */

/**
 * A running total of everything materialised from one archive.
 *
 * Mutable and shared: parts inflate lazily, so the total budget has to be
 * carried across calls rather than recomputed. Passing this by reference is the
 * whole mechanism by which "40 parts of 30 MB each" is refused even though no
 * single part is oversized.
 */
export interface DecompressionBudget {
  totalUncompressedBytes: number;
}

export function createBudget(): DecompressionBudget {
  return { totalUncompressedBytes: 0 };
}

/**
 * Compressed bytes are fed to the inflater in slices of this size.
 *
 * This is the memory bound, and it is the reason the ratio check can be honest.
 * `fflate`'s streaming inflater runs to the end of whatever input it is handed
 * before it calls back, so a single `push` of the whole entry would allocate the
 * whole expansion before we ever got a chance to object — the check would run
 * after the damage. DEFLATE's maximum expansion is 1032:1, so a 16 KiB slice can
 * produce at most ~16.5 MB before control returns to us. That is the real cap
 * on how much a hostile entry can allocate.
 */
const INFLATE_CHUNK_BYTES = 16 * 1024;

/**
 * Materialise an entry's bytes, enforcing every size limit *during*
 * decompression.
 *
 * Throws {@link OpcLimitError} the moment a cap is crossed, from inside the
 * inflate callback, which aborts the stream rather than letting it finish and
 * complaining afterwards.
 */
export function decompressEntry(
  entry: ZipEntry,
  limits: OpcLimits,
  budget: DecompressionBudget,
): Uint8Array {
  if (entry.method === METHOD_STORE) {
    return materializeStored(entry, limits, budget);
  }

  // The ratio ceiling. Below `ratioCheckFloorBytes` no ratio is suspicious,
  // because DEFLATE's fixed overhead makes small streams look explosive.
  const ratioCeiling = Math.max(
    limits.ratioCheckFloorBytes,
    entry.compressedSize * limits.maxCompressionRatio,
  );
  const budgetRemaining = limits.maxTotalUncompressedBytes - budget.totalUncompressedBytes;

  const chunks: Uint8Array[] = [];
  let produced = 0;
  let crc = crc32Init();

  const inflater = new Inflate((chunk) => {
    produced += chunk.length;
    if (produced > limits.maxEntryUncompressedBytes) {
      throw new OpcLimitError(
        'maxEntryUncompressedBytes',
        limits.maxEntryUncompressedBytes,
        produced,
        entry.name,
      );
    }
    if (produced > ratioCeiling) {
      throw new OpcLimitError(
        'maxCompressionRatio',
        limits.maxCompressionRatio,
        Math.round(produced / Math.max(1, entry.compressedSize)),
        entry.name,
      );
    }
    if (produced > budgetRemaining) {
      throw new OpcLimitError(
        'maxTotalUncompressedBytes',
        limits.maxTotalUncompressedBytes,
        budget.totalUncompressedBytes + produced,
        entry.name,
      );
    }
    crc = crc32Update(crc, chunk);
    chunks.push(chunk);
  });

  const data = entry.compressedData;
  try {
    if (data.length === 0) {
      inflater.push(new Uint8Array(0), true);
    } else {
      for (let offset = 0; offset < data.length; offset += INFLATE_CHUNK_BYTES) {
        const end = Math.min(offset + INFLATE_CHUNK_BYTES, data.length);
        inflater.push(data.subarray(offset, end), end === data.length);
      }
    }
  } catch (error) {
    if (error instanceof OpcLimitError) throw error;
    throw new OpcZipError('inflate-failed', 'DEFLATE stream is malformed', entry.name, { cause: error });
  }

  return finish(entry, chunks, produced, crc, budget);
}

function materializeStored(
  entry: ZipEntry,
  limits: OpcLimits,
  budget: DecompressionBudget,
): Uint8Array {
  const size = entry.compressedData.length;
  if (size > limits.maxEntryUncompressedBytes) {
    throw new OpcLimitError('maxEntryUncompressedBytes', limits.maxEntryUncompressedBytes, size, entry.name);
  }
  if (budget.totalUncompressedBytes + size > limits.maxTotalUncompressedBytes) {
    throw new OpcLimitError(
      'maxTotalUncompressedBytes',
      limits.maxTotalUncompressedBytes,
      budget.totalUncompressedBytes + size,
      entry.name,
    );
  }
  // A copy, not a view. Callers own the result and may hand it to a decoder that
  // transfers the backing buffer; aliasing the whole archive from every part
  // would also pin the entire input alive for the lifetime of any one part.
  const bytes = entry.compressedData.slice();
  return finish(entry, [bytes], bytes.length, crc32Update(crc32Init(), bytes), budget);
}

function finish(
  entry: ZipEntry,
  chunks: readonly Uint8Array[],
  produced: number,
  crc: number,
  budget: DecompressionBudget,
): Uint8Array {
  if (produced !== entry.uncompressedSize) {
    throw new OpcZipError(
      'truncated',
      `Entry produced ${produced} bytes but the central directory declared ${entry.uncompressedSize}`,
      entry.name,
    );
  }
  if (crc32Final(crc) !== entry.crc32) {
    throw new OpcZipError('crc-mismatch', 'Entry failed its CRC-32 check; the archive is corrupt', entry.name);
  }

  budget.totalUncompressedBytes += produced;

  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const out = new Uint8Array(produced);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything needed to emit one entry.
 *
 * Structurally a `ZipEntry` minus the derived fields, so an unmodified entry can
 * be passed straight through — which is exactly what `savePackage` does for
 * parts nobody touched.
 */
export interface ZipWriteEntry {
  readonly nameBytes: Uint8Array;
  readonly method: number;
  readonly flags: number;
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly crc32: number;
  readonly uncompressedSize: number;
  readonly compressedData: Uint8Array;
  readonly localExtra: Uint8Array;
  readonly centralExtra: Uint8Array;
  readonly comment: Uint8Array;
  readonly internalAttributes: number;
  readonly externalAttributes: number;
}

export function writeZip(entries: readonly ZipWriteEntry[], archiveComment?: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  const localOffsets: number[] = [];

  for (const entry of entries) {
    localOffsets.push(writer.length);
    writeLocalHeader(writer, entry);
    writer.bytes(entry.compressedData);
  }

  const centralStart = writer.length;
  for (let i = 0; i < entries.length; i += 1) {
    writeCentralHeader(writer, entries[i] as ZipWriteEntry, localOffsets[i] as number);
  }
  const centralSize = writer.length - centralStart;

  writeEndOfCentralDirectory(writer, entries.length, centralSize, centralStart, archiveComment);
  return writer.finish();
}

/**
 * Flags as written.
 *
 * Bit 3 is cleared because we always emit real sizes in the local header (see
 * the module header). Bits 0 and 6 cannot be set — an encrypted entry never got
 * past `readZip` — but they are masked off anyway so that a hand-constructed
 * `ZipWriteEntry` cannot produce an archive we would refuse to read back.
 */
function outputFlags(entry: ZipWriteEntry): number {
  return entry.flags & ~(FLAG_DATA_DESCRIPTOR | FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION);
}

function writeLocalHeader(writer: ByteWriter, entry: ZipWriteEntry): void {
  const compressedSize = entry.compressedData.length;
  const needsZip64 = compressedSize > U32_MAX - 1 || entry.uncompressedSize > U32_MAX - 1;
  // APPNOTE 4.5.3: in a *local* header the ZIP64 record always carries both
  // sizes when it is present, unlike the central-directory form.
  const extra = needsZip64
    ? concatBytes([makeZip64Extra([entry.uncompressedSize, compressedSize]), entry.localExtra])
    : entry.localExtra;

  writer.u32(SIG_LOCAL_HEADER);
  writer.u16(needsZip64 ? Math.max(entry.versionNeeded, 45) : entry.versionNeeded);
  writer.u16(outputFlags(entry));
  writer.u16(entry.method);
  writer.u16(entry.dosTime);
  writer.u16(entry.dosDate);
  writer.u32(entry.crc32);
  writer.u32(needsZip64 ? U32_MAX : compressedSize);
  writer.u32(needsZip64 ? U32_MAX : entry.uncompressedSize);
  writer.u16(entry.nameBytes.length);
  writer.u16(extra.length);
  writer.bytes(entry.nameBytes);
  writer.bytes(extra);
}

function writeCentralHeader(writer: ByteWriter, entry: ZipWriteEntry, localOffset: number): void {
  const compressedSize = entry.compressedData.length;
  const zip64Values: number[] = [];
  const sizesNeedZip64 = compressedSize > U32_MAX - 1 || entry.uncompressedSize > U32_MAX - 1;
  const offsetNeedsZip64 = localOffset > U32_MAX - 1;
  // The record is positional: it carries only the fields whose base value was
  // saturated, in this fixed order. An offset-only record is legal and is
  // exactly 8 bytes long.
  if (sizesNeedZip64) zip64Values.push(entry.uncompressedSize, compressedSize);
  if (offsetNeedsZip64) zip64Values.push(localOffset);
  const extra =
    zip64Values.length > 0
      ? concatBytes([makeZip64Extra(zip64Values), entry.centralExtra])
      : entry.centralExtra;

  writer.u32(SIG_CENTRAL_HEADER);
  writer.u16(entry.versionMadeBy);
  writer.u16(zip64Values.length > 0 ? Math.max(entry.versionNeeded, 45) : entry.versionNeeded);
  writer.u16(outputFlags(entry));
  writer.u16(entry.method);
  writer.u16(entry.dosTime);
  writer.u16(entry.dosDate);
  writer.u32(entry.crc32);
  writer.u32(sizesNeedZip64 ? U32_MAX : compressedSize);
  writer.u32(sizesNeedZip64 ? U32_MAX : entry.uncompressedSize);
  writer.u16(entry.nameBytes.length);
  writer.u16(extra.length);
  writer.u16(entry.comment.length);
  writer.u16(0); // disk number start
  writer.u16(entry.internalAttributes);
  writer.u32(entry.externalAttributes);
  writer.u32(offsetNeedsZip64 ? U32_MAX : localOffset);
  writer.bytes(entry.nameBytes);
  writer.bytes(extra);
  writer.bytes(entry.comment);
}

function writeEndOfCentralDirectory(
  writer: ByteWriter,
  entryCount: number,
  centralSize: number,
  centralOffset: number,
  archiveComment: Uint8Array | undefined,
): void {
  const needsZip64 = entryCount > U16_MAX || centralSize > U32_MAX - 1 || centralOffset > U32_MAX - 1;

  if (needsZip64) {
    const zip64Start = writer.length;
    writer.u32(SIG_ZIP64_EOCD);
    writer.u64(ZIP64_EOCD_FIXED_SIZE - 12); // size of the record after this field
    writer.u16(45); // version made by
    writer.u16(45); // version needed
    writer.u32(0); // this disk
    writer.u32(0); // disk with central directory
    writer.u64(entryCount);
    writer.u64(entryCount);
    writer.u64(centralSize);
    writer.u64(centralOffset);

    writer.u32(SIG_ZIP64_LOCATOR);
    writer.u32(0);
    writer.u64(zip64Start);
    writer.u32(1);
  }

  const comment = archiveComment ?? new Uint8Array(0);
  writer.u32(SIG_EOCD);
  writer.u16(0);
  writer.u16(0);
  writer.u16(needsZip64 ? U16_MAX : entryCount);
  writer.u16(needsZip64 ? U16_MAX : entryCount);
  writer.u32(needsZip64 ? U32_MAX : centralSize);
  writer.u32(needsZip64 ? U32_MAX : centralOffset);
  writer.u16(comment.length);
  writer.bytes(comment);
}

function makeZip64Extra(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(4 + values.length * 8);
  const view = new DataView(out.buffer);
  view.setUint16(0, ZIP64_EXTRA_HEADER_ID, true);
  view.setUint16(2, values.length * 8, true);
  for (let i = 0; i < values.length; i += 1) {
    writeUint64(view, 4 + i * 8, values[i] as number);
  }
  return out;
}

/**
 * Compress bytes for a replaced part.
 *
 * Only ever called for content the caller changed. Level 6 matches zlib's
 * default, which is what Word uses; the choice is not observable for
 * correctness but keeps output sizes in the same ballpark as the original.
 */
export function deflateForEntry(data: Uint8Array): { data: Uint8Array; method: number } {
  const deflated = deflateSync(data, { level: 6 });
  // Incompressible content (already-compressed images, mostly) can come out
  // larger. Storing it is both smaller and faster to read back.
  if (deflated.length >= data.length) {
    return { data: data.slice(), method: METHOD_STORE };
  }
  return { data: deflated, method: METHOD_DEFLATE };
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

class ByteWriter {
  #buffer = new Uint8Array(64 * 1024);
  #view = new DataView(this.#buffer.buffer);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  #ensure(extra: number): void {
    if (this.#length + extra <= this.#buffer.length) return;
    let capacity = this.#buffer.length * 2;
    while (capacity < this.#length + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = next;
    this.#view = new DataView(next.buffer);
  }

  u16(value: number): void {
    this.#ensure(2);
    this.#view.setUint16(this.#length, value & U16_MAX, true);
    this.#length += 2;
  }

  u32(value: number): void {
    this.#ensure(4);
    this.#view.setUint32(this.#length, value >>> 0, true);
    this.#length += 4;
  }

  u64(value: number): void {
    this.#ensure(8);
    writeUint64(this.#view, this.#length, value);
    this.#length += 8;
  }

  bytes(value: Uint8Array): void {
    this.#ensure(value.length);
    this.#buffer.set(value, this.#length);
    this.#length += value.length;
  }

  finish(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }
}

/**
 * Read a 64-bit little-endian value as a `number`.
 *
 * Returns `-1` above `Number.MAX_SAFE_INTEGER` rather than silently losing
 * precision. Callers turn that into a typed error; no archive we are willing to
 * open has a field that large, and a quietly-rounded offset would be a
 * memory-safety problem rather than a correctness one.
 */
function readUint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? -1 : Number(value);
}

function writeUint64(view: DataView, offset: number, value: number): void {
  view.setBigUint64(offset, BigInt(value), true);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function requireBytes(
  bytes: Uint8Array,
  offset: number,
  length: number,
  what: string,
  entryName?: string,
): void {
  if (offset < 0 || offset + length > bytes.length) {
    throw new OpcZipError('truncated', `Archive ends in the middle of a ${what}`, entryName);
  }
}

/* -------------------------------------------------------------------------- */
/* CRC-32                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `fflate` does not export its CRC-32, so we carry our own.
 *
 * Standard reflected CRC-32 (polynomial 0xEDB88320), incremental so the
 * streaming inflater can checksum as it goes instead of making a second pass
 * over output we may be about to reject anyway.
 */
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Int32Array {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

export function crc32Init(): number {
  return -1;
}

export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return c;
}

export function crc32Final(crc: number): number {
  return (crc ^ -1) >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  return crc32Final(crc32Update(crc32Init(), bytes));
}
