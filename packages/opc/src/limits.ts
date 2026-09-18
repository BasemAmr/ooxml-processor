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
   * Cheap first gate: an oversized input is rejected without reading a byte of
   * the central directory.
   */
  readonly maxArchiveBytes: number;

  /**
   * Cap on the number of ZIP entries.
   *
   * A `.docx` with a hundred images has perhaps 150 entries. Tens of thousands
   * of entries is not a document, it is an attempt to make the part graph, the
   * content-type table and the relationship index each quadratic in something.
   */
  readonly maxEntryCount: number;

  /** Cap on a single part's uncompressed size. */
  readonly maxEntryUncompressedBytes: number;

  /**
   * Cap on the sum of all *materialised* part sizes.
   *
   * "Materialised" matters: parts are inflated lazily, so this budget is
   * consumed as parts are touched, not at open. It is also pre-checked against
   * the sizes the central directory *declares*, which catches the honest bomb
   * before we inflate anything — a dishonest central directory is caught by the
   * streaming check instead.
   */
  readonly maxTotalUncompressedBytes: number;

  /**
   * Maximum uncompressed:compressed ratio for one entry.
   *
   * DEFLATE's theoretical maximum is 1032:1, so anything near that is a bomb by
   * definition. Real-world XML compresses at roughly 5:1 to 15:1; embedded
   * fonts and images are close to 1:1. 200 leaves an enormous margin for a
   * pathologically repetitive but legitimate document (a table of 50,000 empty
   * cells does compress remarkably well) while still being 5× below the point
   * where DEFLATE can do real damage.
   */
  readonly maxCompressionRatio: number;

  /**
   * Bytes below which the ratio check does not apply.
   *
   * Without this the ratio cap produces false positives on every small part: a
   * 40-byte DEFLATE stream expanding to a 9 KB `[Content_Types].xml` is a ratio
   * of 225 and entirely normal, because the fixed Huffman overhead dominates at
   * small sizes. One mebibyte of output is small enough to be harmless
   * regardless of ratio and large enough to cover every real part that trips it.
   */
  readonly ratioCheckFloorBytes: number;

  /** Cap on part-name length. See `DEFAULT_MAX_PART_NAME_LENGTH`. */
  readonly maxPartNameLength: number;
}

export const DEFAULT_OPC_LIMITS: OpcLimits = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntryCount: 8192,
  maxEntryUncompressedBytes: 256 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  ratioCheckFloorBytes: 1024 * 1024,
  maxPartNameLength: DEFAULT_MAX_PART_NAME_LENGTH,
};

/** Fill in defaults for anything the caller left out. */
export function resolveLimits(overrides?: Partial<OpcLimits>): OpcLimits {
  if (overrides === undefined) return DEFAULT_OPC_LIMITS;
  return { ...DEFAULT_OPC_LIMITS, ...overrides };
}
