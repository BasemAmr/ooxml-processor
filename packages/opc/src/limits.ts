/**
 * Resource limits for opening a package.
 *
 * ## Why limits live in this package and not in a wrapper
 *
 * A limit that is applied *after* decompression is not a limit, it is a report.
 * The zip-bomb defence only works if the ratio check runs inside the inflate
 * loop and aborts it, which means the check has to live where the loop lives —
 * `zip.ts`. Bolting it on at the application boundary would mean the 4 GB has
 * already been allocated by the time anyone objects.
 *
 * The defaults below are sized for "a document a human wrote", not for the
 * largest file the format permits. They are deliberately low enough that a
 * legitimate outlier will hit them and the operator will have to opt in, rather
 * than high enough that a malicious file slides under them. Every one is
 * overridable per call, so this is a policy default, not a ceiling on the
 * format.
 */

import { DEFAULT_MAX_PART_NAME_LENGTH } from './partname.js';

export interface OpcLimits {
  /**
   * Cap on the archive itself, before any parsing.
   *
   * ## Rationale
   * Cheap first gate: an oversized input is rejected without reading a byte of
   * the central directory, preventing multi-gigabyte buffer allocations in
   * memory during container ingestion.
   *
   * ## Corpus bounds
   * Normal OOXML documents are 50 KB – 5 MB. Heavy presentations or documents
   * containing high-resolution photography, raw audio, or embedded video can
   * reach 20–100 MB. 512 MiB accommodates large legitimate documents with ample
   * margin while stopping multi-gigabyte resource exhaustion attacks.
   */
  readonly maxArchiveBytes: number;

  /**
   * Cap on the number of ZIP entries.
   *
   * ## Rationale
   * A `.docx` with a hundred images has perhaps 150 entries. Tens of thousands
   * of entries is not a document, it is an attempt to make the part graph, the
   * content-type table and the relationship index each quadratic in something.
   *
   * ## Corpus bounds
   * Average documents have 15–50 entries; extreme documents with thousands of
   * embedded icons or shapes stay under 500–1,000 entries. 8,192 entries provides
   * an order-of-magnitude headroom over legitimate complex packages while
   * bounding O(N) or O(N^2) loops over the central directory.
   */
  readonly maxEntryCount: number;

  /**
   * Cap on a single part's uncompressed size.
   *
   * ## Rationale
   * Bounds the maximum contiguous buffer allocated in memory when decompressing
   * any single part, preventing out-of-memory crashes on single hostile streams.
   *
   * ## Corpus bounds
   * Standard XML parts (`document.xml`, `styles.xml`) rarely exceed 5–20 MB even
   * for massive 1,000+ page manuscripts. High-definition embedded media parts
   * rarely exceed 50–100 MB. 256 MiB easily fits legitimate large parts while
   * ensuring individual parts cannot exhaust the process heap.
   */
  readonly maxEntryUncompressedBytes: number;

  /**
   * Cap on the sum of all *materialised* part sizes.
   *
   * ## Rationale
   * "Materialised" matters: parts are inflated lazily, so this budget is
   * consumed as parts are touched, not at open. It is also pre-checked against
   * the sizes the central directory *declares*, which catches the honest bomb
   * before we inflate anything — a dishonest central directory is caught by the
   * streaming check instead.
   *
   * ## Corpus bounds
   * Typical total uncompressed size across an entire document is under 20–50 MB;
   * media-rich documents rarely exceed 200–500 MB uncompressed. 1 GiB (1024 MiB)
   * provides generous headroom for heavy documents while bounding aggregate
   * process memory consumption.
   */
  readonly maxTotalUncompressedBytes: number;

  /**
   * Maximum uncompressed:compressed ratio for one entry.
   *
   * ## Rationale
   * DEFLATE's theoretical maximum is 1032:1, so anything near that is a bomb by
   * definition. Real-world XML compresses at roughly 5:1 to 15:1; embedded
   * fonts and images are close to 1:1. 200 leaves an enormous margin for a
   * pathologically repetitive but legitimate document (a table of 50,000 empty
   * cells does compress remarkably well) while still being 5× below the point
   * where DEFLATE can do real damage.
   *
   * ## Corpus bounds
   * Highly repetitive synthetic tables in real documents rarely compress
   * beyond 30:1 to 50:1. 200:1 safely rejects zip bombs during streaming
   * decompression without risk of false positives on legitimate documents.
   */
  readonly maxCompressionRatio: number;

  /**
   * Bytes below which the ratio check does not apply.
   *
   * ## Rationale
   * Without this the ratio cap produces false positives on every small part: a
   * 40-byte DEFLATE stream expanding to a 9 KB `[Content_Types].xml` is a ratio
   * of 225 and entirely normal, because the fixed Huffman overhead dominates at
   * small sizes.
   *
   * ## Corpus bounds
   * An expansion under 1 MiB (1024 * 1024 bytes) poses zero memory exhaustion
   * risk regardless of ratio and is large enough to cover every real small part
   * that would otherwise trip the ratio cap.
   */
  readonly ratioCheckFloorBytes: number;

  /**
   * Cap on part-name length. See `DEFAULT_MAX_PART_NAME_LENGTH`.
   *
   * ## Rationale
   * Prevents path-name memory amplification in URI resolution, hash maps,
   * error messages, and logging.
   *
   * ## Corpus bounds
   * Typical OPC part names are 15–60 characters (e.g. `/word/document.xml`).
   * Deeply nested custom XML parts rarely exceed 120 characters. 2,048 characters
   * gives >15× headroom over known legitimate documents while preventing
   * megabyte-scale string allocations.
   */
  readonly maxPartNameLength: number;
}

export const DEFAULT_OPC_LIMITS: OpcLimits = {
  /** 512 MiB: accommodates large media-heavy documents while rejecting gigabyte DoS inputs. */
  maxArchiveBytes: 512 * 1024 * 1024,
  /** 8,192 entries: >16× headroom over complex packages while bounding CD traversal loops. */
  maxEntryCount: 8192,
  /** 256 MiB: bounds single-part peak memory while permitting large media items. */
  maxEntryUncompressedBytes: 256 * 1024 * 1024,
  /** 1 GiB: aggregate materialisation budget protecting total process heap. */
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  /** 200:1: 5× below DEFLATE's 1032:1 max; protects against zip bombs while permitting repetitive tables. */
  maxCompressionRatio: 200,
  /** 1 MiB: suppresses ratio checks for small parts to prevent false positives from Huffman overhead. */
  ratioCheckFloorBytes: 1024 * 1024,
  /** 2,048 chars: >15× headroom over typical part names while bounding string allocation. */
  maxPartNameLength: DEFAULT_MAX_PART_NAME_LENGTH,
};

/** Fill in defaults for anything the caller left out. */
export function resolveLimits(overrides?: Partial<OpcLimits>): OpcLimits {
  if (overrides === undefined) return DEFAULT_OPC_LIMITS;
  return { ...DEFAULT_OPC_LIMITS, ...overrides };
}
