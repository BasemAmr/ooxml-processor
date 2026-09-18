/**
 * Idempotence verification harness for OPC packages.
 *
 * ## The Invariant A2 guarantee
 *
 * For any well-formed OPC package opened into an `OpcPackage` and saved without
 * modifications to `gen2`, opening `gen2` into another `OpcPackage` and saving
 * that without modifications to `gen3` MUST produce byte-for-byte identical output:
 *
 *     gen2 === gen3
 *
 * Furthermore, all parts, content types, and relationship graphs must match
 * between the first and second generations.
 *
 * When `gen2` and `gen3` diverge, this harness reads both archives through
 * `readZip`, compares their entries in archive order, decompresses payloads, and
 * identifies the exact differing part name and byte offset to make failures
 * immediately actionable.
 */

import { resolveLimits, type OpcLimits } from './limits.js';
import { openPackage, type OpcPackage } from './package.js';
import type { XmlSupport } from './xml-support.js';
import { createBudget, decompressEntry, readZip } from './zip.js';

export interface AssertIdempotentOptions {
  readonly limits?: Partial<OpcLimits>;
  /**
   * Optional test hook invoked on `p2` before saving `gen3`.
   * Enables deliberate perturbation of parts to test failure diagnostics.
   */
  readonly onP2?: (p2: OpcPackage) => void;
}

/**
 * Compares two Uint8Arrays for byte-for-byte equality.
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Detailed diagnostic diff between two package archives.
 *
 * Decompresses and inspects each ZIP entry in archive order to pinpoint the
 * exact part name and byte offset where `gen2` and `gen3` diverge.
 * Always throws an informative Error detailing the difference.
 */
export function diagnosePackageDiff(
  gen2: Uint8Array,
  gen3: Uint8Array,
  limits: OpcLimits = resolveLimits(),
): never {
  const archive2 = readZip(gen2, limits);
  const archive3 = readZip(gen3, limits);

  if (archive2.entries.length !== archive3.entries.length) {
    throw new Error(
      `Archive entry count differs: gen2 has ${archive2.entries.length} entries, gen3 has ${archive3.entries.length} entries`,
    );
  }

  for (let i = 0; i < archive2.entries.length; i++) {
    const e2 = archive2.entries[i]!;
    const e3 = archive3.entries[i]!;

    if (e2.name !== e3.name) {
      throw new Error(
        `Entry name at index ${i} differs: expected "${e2.name}", actual "${e3.name}"`,
      );
    }

    const partLabel = e2.partName ?? (e2.name.startsWith('/') ? e2.name : `/${e2.name}`);

    if (e2.method !== e3.method) {
      throw new Error(
        `Part "${partLabel}" compression method differs (expected ${e2.method}, actual ${e3.method})`,
      );
    }

    // Compare uncompressed payload byte-by-byte
    const budget2 = createBudget();
    const budget3 = createBudget();
    const data2 = decompressEntry(e2, limits, budget2);
    const data3 = decompressEntry(e3, limits, budget3);

    const minLen = Math.min(data2.length, data3.length);
    for (let b = 0; b < minLen; b++) {
      if (data2[b] !== data3[b]) {
        const expHex = `0x${data2[b]!.toString(16)}`;
        const actHex = `0x${data3[b]!.toString(16)}`;
        throw new Error(
          `Part "${partLabel}" differs at byte offset ${b} (expected ${expHex}, actual ${actHex})`,
        );
      }
    }

    if (data2.length !== data3.length) {
      throw new Error(
        `Part "${partLabel}" differs in length: expected ${data2.length} bytes, actual ${data3.length} bytes`,
      );
    }

    // Uncompressed payloads match; check CRC32 and compressed bytes for metadata divergence
    if (e2.crc32 !== e3.crc32) {
      throw new Error(
        `Part "${partLabel}" CRC-32 differs: expected 0x${e2.crc32.toString(16)}, actual 0x${e3.crc32.toString(16)}`,
      );
    }

    const minComp = Math.min(e2.compressedData.length, e3.compressedData.length);
    for (let b = 0; b < minComp; b++) {
      if (e2.compressedData[b] !== e3.compressedData[b]) {
        const expHex = `0x${e2.compressedData[b]!.toString(16)}`;
        const actHex = `0x${e3.compressedData[b]!.toString(16)}`;
        throw new Error(
          `Part "${partLabel}" compressed data differs at byte offset ${b} (expected ${expHex}, actual ${actHex})`,
        );
      }
    }

    if (e2.compressedData.length !== e3.compressedData.length) {
      throw new Error(
        `Part "${partLabel}" compressed data length differs: expected ${e2.compressedData.length} bytes, actual ${e3.compressedData.length} bytes`,
      );
    }
  }

  // If all entries and payloads match, archive framing or central directory differed
  const minRaw = Math.min(gen2.length, gen3.length);
  for (let b = 0; b < minRaw; b++) {
    if (gen2[b] !== gen3[b]) {
      const expHex = `0x${gen2[b]!.toString(16)}`;
      const actHex = `0x${gen3[b]!.toString(16)}`;
      throw new Error(
        `Archive framing differs at byte offset ${b} (expected ${expHex}, actual ${actHex})`,
      );
    }
  }

  throw new Error(
    `Archives differ in size: gen2 is ${gen2.length} bytes, gen3 is ${gen3.length} bytes`,
  );
}

/**
 * Asserts that an OPC package is round-trip idempotent across generations 2 and 3.
 *
 * 1. Open package from `bytes` -> `p1`.
 * 2. Save `p1` -> `gen2`.
 * 3. Open package from `gen2` -> `p2`.
 * 4. Save `p2` -> `gen3`.
 * 5. Assert `partNames(p1) === partNames(p2)`.
 * 6. Assert `contentTypes(p1) === contentTypes(p2)`.
 * 7. Assert relationship graphs match between `p1` and `p2`.
 * 8. If `gen2` and `gen3` do not match byte-for-byte, throw detailed diagnostic error.
 * 9. Return `{ gen2, gen3 }`.
 */
export async function assertPackageIdempotent(
  bytes: Uint8Array,
  xml: XmlSupport,
  options?: AssertIdempotentOptions,
): Promise<{ gen2: Uint8Array; gen3: Uint8Array }> {
  const resolvedLimits = resolveLimits(options?.limits);

  // 1. Open package from bytes -> p1
  const p1 = await openPackage(bytes, xml, resolvedLimits);

  // 2. Save p1 -> gen2
  const gen2 = await p1.save();

  // 3. Open package from gen2 -> p2
  const p2 = await openPackage(gen2, xml, resolvedLimits);

  // Allow optional mutation of p2 before gen3 save (e.g. for testing failure diagnostics)
  if (options?.onP2) {
    options.onP2(p2);
  }

  // 4. Save p2 -> gen3
  const gen3 = await p2.save();

  // 5. Assert that partNames(p1) === partNames(p2)
  const p1Names = Array.from(p1.parts.keys()).sort();
  const p2Names = Array.from(p2.parts.keys()).sort();
  if (p1Names.length !== p2Names.length || !p1Names.every((name, i) => name === p2Names[i])) {
    throw new Error(
      `Part names mismatch between p1 and p2: ` +
        `p1=[${p1Names.join(', ')}], p2=[${p2Names.join(', ')}]`,
    );
  }

  // 6. Assert that contentTypes(p1) === contentTypes(p2)
  for (const name of p1Names) {
    const ct1 = p1.requirePart(name).contentType;
    const ct2 = p2.requirePart(name).contentType;
    if (ct1 !== ct2) {
      throw new Error(
        `Content type mismatch for part "${name}": expected "${ct1}", actual "${ct2}"`,
      );
    }
  }

  const decls1 = p1.contentTypes.declarations;
  const decls2 = p2.contentTypes.declarations;
  if (decls1.length !== decls2.length) {
    throw new Error(
      `Content type declarations count mismatch: expected ${decls1.length}, actual ${decls2.length}`,
    );
  }
  for (let i = 0; i < decls1.length; i++) {
    const d1 = decls1[i]!;
    const d2 = decls2[i]!;
    if (d1.kind !== d2.kind || d1.contentType !== d2.contentType) {
      throw new Error(
        `Content type declaration mismatch at index ${i}: ` +
          `p1=(kind=${d1.kind}, contentType=${d1.contentType}), ` +
          `p2=(kind=${d2.kind}, contentType=${d2.contentType})`,
      );
    }
    if (d1.kind === 'default' && (d2.kind !== 'default' || d1.extension !== d2.extension)) {
      throw new Error(
        `Default extension mismatch at index ${i}: expected "${d1.extension}", actual "${(d2 as unknown as { extension: string }).extension}"`,
      );
    }
    if (d1.kind === 'override' && (d2.kind !== 'override' || d1.partName !== d2.partName)) {
      throw new Error(
        `Override partName mismatch at index ${i}: expected "${d1.partName}", actual "${(d2 as unknown as { partName: string }).partName}"`,
      );
    }
  }

  // 7. Assert that relationship graph (including IDs and target modes) matches
  const sources1 = Array.from(p1.relationships.sets())
    .map((s) => s.source)
    .sort();
  const sources2 = Array.from(p2.relationships.sets())
    .map((s) => s.source)
    .sort();
  if (sources1.length !== sources2.length || !sources1.every((s, i) => s === sources2[i])) {
    throw new Error(
      `Relationship sources mismatch between p1 and p2: ` +
        `p1=[${sources1.join(', ')}], p2=[${sources2.join(', ')}]`,
    );
  }
  for (const source of sources1) {
    const rels1 = p1.relationships.relationshipsOf(source).relationships;
    const rels2 = p2.relationships.relationshipsOf(source).relationships;
    if (rels1.length !== rels2.length) {
      throw new Error(
        `Relationship count mismatch for source "${source}": expected ${rels1.length}, actual ${rels2.length}`,
      );
    }
    for (let j = 0; j < rels1.length; j++) {
      const r1 = rels1[j]!;
      const r2 = rels2[j]!;
      if (
        r1.id !== r2.id ||
        r1.type !== r2.type ||
        r1.target !== r2.target ||
        r1.targetMode !== r2.targetMode ||
        r1.targetModeExplicit !== r2.targetModeExplicit ||
        r1.targetPartName !== r2.targetPartName
      ) {
        throw new Error(
          `Relationship mismatch at index ${j} for source "${source}": ` +
            `expected (id=${r1.id}, type=${r1.type}, target=${r1.target}, targetMode=${r1.targetMode}, explicit=${r1.targetModeExplicit}, targetPartName=${r1.targetPartName}), ` +
            `actual (id=${r2.id}, type=${r2.type}, target=${r2.target}, targetMode=${r2.targetMode}, explicit=${r2.targetModeExplicit}, targetPartName=${r2.targetPartName})`,
        );
      }
    }
  }

  // 8. Assert gen2 is byte-identical to gen3 (Invariant A2)
  if (!bytesEqual(gen2, gen3)) {
    diagnosePackageDiff(gen2, gen3, resolvedLimits);
  }

  return { gen2, gen3 };
}
