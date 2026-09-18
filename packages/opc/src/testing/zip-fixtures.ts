/**
 * In-memory ZIP fixtures for this package's tests.
 *
 * Two layers, because the tests need both:
 *
 * - {@link buildPackage} builds a well-formed archive through the package's own
 *   `writeZip`. This is what package-level tests use, and it means those tests
 *   exercise the writer rather than a second, subtly different one.
 * - {@link buildRawZip} builds an archive field by field, so a test can produce
 *   things `writeZip` would never emit: data descriptors, ZIP64 extra fields on
 *   a tiny file, an encryption flag, a CP437 name, a self-extracting prefix, a
 *   lying central directory.
 *
 * Everything is built in memory. Nothing here writes to disk — a zip-bomb
 * fixture is a few kilobytes that *would* expand to tens of megabytes, and the
 * expansion must never happen anywhere, least of all on a filesystem.
 */

import { deflateSync } from 'fflate';

import { crc32, METHOD_DEFLATE, METHOD_STORE, writeZip, type ZipWriteEntry } from '../zip.js';

const EMPTY = new Uint8Array(0);

/** 1980-01-01 00:00:00, the DOS epoch. Fixed so fixtures are byte-deterministic. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

const utf8 = new TextEncoder();

export interface PackageItem {
  /** The archive-relative name, with no leading slash: `word/document.xml`. */
  readonly name: string;
  readonly data: Uint8Array | string;
  /** Defaults to DEFLATE, which is what every real producer uses for XML parts. */
  readonly store?: boolean;
}

export function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? utf8.encode(data) : data;
}

/** One entry, ready for `writeZip`. */
export function makeEntry(item: PackageItem): ZipWriteEntry {
  const data = toBytes(item.data);
  const store = item.store === true;
  const compressed = store ? data : deflateSync(data, { level: 6 });
  return {
    nameBytes: utf8.encode(item.name),
    method: store ? METHOD_STORE : METHOD_DEFLATE,
    // Bit 11 (EFS). Real producers set it; so do we, so that the names in a
    // fixture mean the same thing on every platform.
    flags: 1 << 11,
    versionMadeBy: 0x0314,
    versionNeeded: 20,
    dosTime: DOS_TIME,
    dosDate: DOS_DATE,
    crc32: crc32(data),
    uncompressedSize: data.length,
    compressedData: compressed,
    localExtra: EMPTY,
    centralExtra: EMPTY,
    comment: EMPTY,
    internalAttributes: 0,
    externalAttributes: 0,
  };
}

export function buildPackage(items: readonly PackageItem[]): Uint8Array {
  return writeZip(items.map(makeEntry));
}

/* -------------------------------------------------------------------------- */
/* The low-level builder                                                       */
/* -------------------------------------------------------------------------- */

export interface RawEntrySpec {
  /** Name bytes, so a test can supply CP437 or deliberately malformed UTF-8. */
  readonly nameBytes: Uint8Array;
  readonly data: Uint8Array;
  readonly method?: number;
  readonly flags?: number;
  /**
   * Which fields to saturate and move into a ZIP64 extra record. The record is
   * positional, so `{ offset: true }` alone produces an 8-byte record — the
   * shape that a fixed-28-byte reader mis-parses.
   */
  readonly zip64?: { readonly sizes?: boolean; readonly offset?: boolean };
  /** Zero the local header's crc/sizes, set bit 3, and append a trailer. */
  readonly dataDescriptor?: boolean;
  /** Override the compressed payload, for archives that lie about themselves. */
  readonly compressedOverride?: Uint8Array;
  /** Declare a compressed size that is not the payload's real length. */
  readonly compressedSizeOverride?: number;
  readonly crcOverride?: number;
  readonly uncompressedSizeOverride?: number;
  readonly localExtra?: Uint8Array;
  readonly centralExtra?: Uint8Array;
  /** Suppress the ZIP64 extra record while still saturating the base field. */
  readonly omitZip64Extra?: boolean;
}

export interface RawZipOptions {
  /** Bytes prepended before the first local header, as a self-extracting stub would be. */
  readonly prefix?: Uint8Array;
  readonly comment?: Uint8Array;
  /** Lie about the entry count in the EOCD. */
  readonly entryCountOverride?: number;
}

export function buildRawZip(specs: readonly RawEntrySpec[], options?: RawZipOptions): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const emit = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  if (options?.prefix !== undefined) emit(options.prefix);

  const localOffsets: number[] = [];
  const compressedSizes: number[] = [];
  const crcs: number[] = [];
  const uncompressedSizes: number[] = [];

  for (const spec of specs) {
    const method = spec.method ?? METHOD_STORE;
    const compressed =
      spec.compressedOverride ??
      (method === METHOD_DEFLATE ? deflateSync(spec.data, { level: 6 }) : spec.data);
    const crc = spec.crcOverride ?? crc32(spec.data);
    const uncompressedSize = spec.uncompressedSizeOverride ?? spec.data.length;

    localOffsets.push(offset);
    compressedSizes.push(spec.compressedSizeOverride ?? compressed.length);
    crcs.push(crc);
    uncompressedSizes.push(uncompressedSize);

    const saturateSizes = spec.zip64?.sizes === true;
    const zip64Local =
      saturateSizes && spec.omitZip64Extra !== true
        ? zip64Extra([uncompressedSize, spec.compressedSizeOverride ?? compressed.length])
        : EMPTY;
    const localExtra = concat([zip64Local, spec.localExtra ?? EMPTY]);
    const flags = (spec.flags ?? 0) | (spec.dataDescriptor === true ? 1 << 3 : 0);

    const declaredCompressed = spec.compressedSizeOverride ?? compressed.length;
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, saturateSizes ? 45 : 20, true);
    view.setUint16(6, flags, true);
    view.setUint16(8, method, true);
    view.setUint16(10, DOS_TIME, true);
    view.setUint16(12, DOS_DATE, true);
    view.setUint32(14, spec.dataDescriptor === true ? 0 : crc, true);
    view.setUint32(
      18,
      saturateSizes ? 0xffffffff : spec.dataDescriptor === true ? 0 : declaredCompressed,
      true,
    );
    view.setUint32(
      22,
      saturateSizes ? 0xffffffff : spec.dataDescriptor === true ? 0 : uncompressedSize,
      true,
    );
    view.setUint16(26, spec.nameBytes.length, true);
    view.setUint16(28, localExtra.length, true);

    emit(header);
    emit(spec.nameBytes);
    emit(localExtra);
    emit(compressed);

    if (spec.dataDescriptor === true) {
      const trailer = new Uint8Array(16);
      const trailerView = new DataView(trailer.buffer);
      trailerView.setUint32(0, 0x08074b50, true);
      trailerView.setUint32(4, crc, true);
      trailerView.setUint32(8, declaredCompressed, true);
      trailerView.setUint32(12, uncompressedSize, true);
      emit(trailer);
    }
  }

  const centralStart = offset;
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i] as RawEntrySpec;
    const method = spec.method ?? METHOD_STORE;
    const saturateSizes = spec.zip64?.sizes === true;
    const saturateOffset = spec.zip64?.offset === true;

    const zip64Values: number[] = [];
    if (saturateSizes)
      zip64Values.push(uncompressedSizes[i] as number, compressedSizes[i] as number);
    if (saturateOffset) zip64Values.push(localOffsets[i] as number);
    const zip64Central =
      zip64Values.length > 0 && spec.omitZip64Extra !== true ? zip64Extra(zip64Values) : EMPTY;
    const centralExtra = concat([zip64Central, spec.centralExtra ?? EMPTY]);
    const flags = (spec.flags ?? 0) | (spec.dataDescriptor === true ? 1 << 3 : 0);

    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 0x0314, true);
    view.setUint16(6, zip64Values.length > 0 ? 45 : 20, true);
    view.setUint16(8, flags, true);
    view.setUint16(10, method, true);
    view.setUint16(12, DOS_TIME, true);
    view.setUint16(14, DOS_DATE, true);
    view.setUint32(16, crcs[i] as number, true);
    view.setUint32(20, saturateSizes ? 0xffffffff : (compressedSizes[i] as number), true);
    view.setUint32(24, saturateSizes ? 0xffffffff : (uncompressedSizes[i] as number), true);
    view.setUint16(28, spec.nameBytes.length, true);
    view.setUint16(30, centralExtra.length, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, saturateOffset ? 0xffffffff : (localOffsets[i] as number), true);

    emit(header);
    emit(spec.nameBytes);
    emit(centralExtra);
  }
  const centralSize = offset - centralStart;

  const comment = options?.comment ?? EMPTY;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, options?.entryCountOverride ?? specs.length, true);
  eocdView.setUint16(10, options?.entryCountOverride ?? specs.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  eocdView.setUint16(20, comment.length, true);
  emit(eocd);
  emit(comment);

  return concat(chunks);
}

function zip64Extra(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(4 + values.length * 8);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x0001, true);
  view.setUint16(2, values.length * 8, true);
  for (let i = 0; i < values.length; i += 1) {
    view.setBigUint64(4 + i * 8, BigInt(values[i] as number), true);
  }
  return out;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
