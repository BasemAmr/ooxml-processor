/** Phase 11 conformance and deterministic test-runner primitives. */

export type CoverageState = 'modelled' | 'laidOut' | 'painted' | 'roundTripped' | 'placeholder';
export interface CoverageEntry {
  readonly name: string;
  readonly states: Partial<Record<CoverageState, boolean>>;
}
export interface CoverageReport {
  readonly entries: readonly CoverageEntry[];
  readonly counts: Readonly<Record<CoverageState, number>>;
  readonly html: string;
}

const STATES: readonly CoverageState[] = [
  'modelled',
  'laidOut',
  'painted',
  'roundTripped',
  'placeholder',
];

export function buildCoverageReport(entries: readonly CoverageEntry[]): CoverageReport {
  const ordered = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const counts = Object.fromEntries(
    STATES.map((state) => [state, ordered.filter((entry) => entry.states[state] === true).length]),
  ) as Record<CoverageState, number>;
  const rows = ordered
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.name)}</td>${STATES.map((state) => `<td>${entry.states[state] === true ? 'yes' : ''}</td>`).join('')}</tr>`,
    )
    .join('');
  const html = `<table><thead><tr><th>type</th>${STATES.map((state) => `<th>${state}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  return { entries: ordered, counts, html };
}

export function assertCoverageThresholds(
  report: CoverageReport,
  baseline: Partial<Record<CoverageState, number>> = {},
): void {
  if (report.entries.some((entry) => entry.states.modelled !== true))
    throw new Error('coverage-modelled-below-100');
  for (const state of ['laidOut', 'painted'] as const)
    if ((report.counts[state] ?? 0) < (baseline[state] ?? 0))
      throw new Error(`coverage-ratchet-${state}`);
}

export interface PackagePartText {
  readonly name: string;
  readonly text: string;
}
export interface PackageDiff {
  readonly part: string;
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
}

/** Compares XML content while preserving text and lexical attribute values. */
export function equivalentParts(
  expected: readonly PackagePartText[],
  actual: readonly PackagePartText[],
): PackageDiff[] {
  const left = new Map(expected.map((part) => [part.name, canonicalXml(part.text)]));
  const right = new Map(actual.map((part) => [part.name, canonicalXml(part.text)]));
  const diffs: PackageDiff[] = [];
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(name);
    const b = right.get(name);
    if (a !== b)
      diffs.push({ part: name, path: '/', expected: a ?? '<missing>', actual: b ?? '<missing>' });
  }
  return diffs;
}

export function canonicalXml(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

export async function runRoundTrip<T>(
  documents: readonly T[],
  open: (document: T) => Promise<T>,
  save: (document: T) => Promise<T>,
  equivalent: (a: T, b: T) => boolean,
): Promise<void> {
  for (const document of documents) {
    const first = await save(await open(document));
    if (!equivalent(document, first)) throw new Error('round-trip-equivalence-failed');
    const second = await save(await open(first));
    if (!equivalent(first, second)) throw new Error('round-trip-idempotence-failed');
  }
}

export interface FuzzResult {
  readonly ok: boolean;
  readonly error?: unknown;
}
export function fuzz<T>(
  seeds: readonly T[],
  mutate: (seed: T, index: number) => T,
  parse: (value: T) => unknown,
  iterations = 100,
): FuzzResult[] {
  const results: FuzzResult[] = [];
  for (let i = 0; i < iterations; i++) {
    const seed = seeds[i % Math.max(1, seeds.length)];
    if (seed === undefined) break;
    try {
      parse(mutate(seed, i));
      results.push({ ok: true });
    } catch (error) {
      results.push({ ok: false, error });
    }
  }
  return results;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
