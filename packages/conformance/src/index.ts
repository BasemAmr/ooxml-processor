/**
 * Conformance and security gates used by CI and local corpus runs.
 * Callers inject editor operations so these checks remain usable without a
 * browser, Word or LibreOffice in the development environment.
 */

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
export const COVERAGE_STATES: readonly CoverageState[] = [
  'modelled',
  'laidOut',
  'painted',
  'roundTripped',
  'placeholder',
];

/** Mutable evidence collector. Recording a state is monotonic. */
export class CoverageTracker {
  readonly #entries = new Map<string, CoverageEntry>();
  constructor(entries: readonly CoverageEntry[] = []) {
    for (const entry of entries) this.#entries.set(entry.name, cloneEntry(entry));
  }
  record(name: string, state: CoverageState): void {
    const old = this.#entries.get(name);
    const states: Partial<Record<CoverageState, boolean>> = { ...(old?.states ?? {}) };
    states[state] = true;
    this.#entries.set(name, { name, states });
  }
  recordMany(name: string, states: readonly CoverageState[]): void {
    for (const state of states) this.record(name, state);
  }
  entries(): readonly CoverageEntry[] {
    return [...this.#entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  report(): CoverageReport {
    return buildCoverageReport(this.entries());
  }
}

export function buildCoverageReport(entries: readonly CoverageEntry[]): CoverageReport {
  const ordered = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const counts = Object.fromEntries(
    COVERAGE_STATES.map((state) => [
      state,
      ordered.filter((entry) => entry.states[state] === true).length,
    ]),
  ) as Record<CoverageState, number>;
  const rows = ordered
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.name)}</td>${COVERAGE_STATES.map((state) => `<td>${entry.states[state] === true ? 'yes' : ''}</td>`).join('')}</tr>`,
    )
    .join('');
  const html = `<table><thead><tr><th>type</th>${COVERAGE_STATES.map((state) => `<th>${state}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  return { entries: ordered, counts, html };
}

export interface CoverageThresholdOptions {
  readonly baseline?: Partial<Record<CoverageState, number>>;
  readonly corpusTypes?: readonly string[];
}
export function assertCoverageThresholds(
  report: CoverageReport,
  baselineOrOptions: Partial<Record<CoverageState, number>> | CoverageThresholdOptions = {},
): void {
  const options: CoverageThresholdOptions = isThresholdOptions(baselineOrOptions)
    ? baselineOrOptions
    : { baseline: baselineOrOptions };
  if (report.entries.some((entry) => entry.states.modelled !== true))
    throw new Error('coverage-modelled-below-100');
  for (const state of ['laidOut', 'painted'] as const)
    if ((report.counts[state] ?? 0) < (options.baseline?.[state] ?? 0))
      throw new Error(`coverage-ratchet-${state}`);
  for (const name of options.corpusTypes ?? [])
    if (report.entries.find((entry) => entry.name === name)?.states.roundTripped !== true)
      throw new Error(`coverage-roundtrip-missing:${name}`);
}
export interface CoverageBaseline {
  readonly version: 1;
  readonly counts: Partial<Record<CoverageState, number>>;
}
export function parseCoverageBaseline(text: string): CoverageBaseline {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.counts))
    throw new Error('invalid-coverage-baseline');
  const counts: Partial<Record<CoverageState, number>> = {};
  for (const state of COVERAGE_STATES) {
    const count = value.counts[state];
    if (count !== undefined && (typeof count !== 'number' || !Number.isInteger(count) || count < 0))
      throw new Error(`invalid-coverage-baseline:${state}`);
    if (count !== undefined) counts[state] = count;
  }
  return { version: 1, counts };
}
export function serializeCoverageBaseline(report: CoverageReport): string {
  return `${JSON.stringify({ version: 1, counts: report.counts }, null, 2)}\n`;
}

export interface CorpusEntry {
  readonly path: string;
  readonly source: 'real-world' | 'self-authored' | 'synthetic';
  readonly licence: string;
  readonly retrieved: string;
  readonly url?: string;
  readonly personalData?: 'scrubbed' | 'accepted' | 'none';
  readonly construction?: string;
  readonly pages?: number;
}
export interface CorpusValidationIssue {
  readonly path: string;
  readonly message: string;
}
export function validateCorpusManifest(
  entries: readonly CorpusEntry[],
): readonly CorpusValidationIssue[] {
  const issues: CorpusValidationIssue[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path)) issues.push({ path: entry.path, message: 'duplicate-corpus-path' });
    seen.add(entry.path);
    if (entry.path.trim() === '' || entry.path.endsWith('.json'))
      issues.push({ path: entry.path, message: 'invalid-corpus-path' });
    if (entry.licence.trim() === '') issues.push({ path: entry.path, message: 'missing-licence' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.retrieved) || Number.isNaN(Date.parse(entry.retrieved)))
      issues.push({ path: entry.path, message: 'invalid-retrieval-date' });
    if (entry.source === 'real-world' && !entry.url)
      issues.push({ path: entry.path, message: 'missing-source-url' });
    if (entry.source === 'synthetic' && !entry.construction)
      issues.push({ path: entry.path, message: 'missing-construction' });
    if (entry.pages !== undefined && (!Number.isInteger(entry.pages) || entry.pages < 1))
      issues.push({ path: entry.path, message: 'invalid-page-count' });
  }
  if (!entries.some((entry) => entry.source === 'real-world'))
    issues.push({ path: '', message: 'corpus-missing-real-world-source' });
  if (!entries.some((entry) => entry.source === 'self-authored'))
    issues.push({ path: '', message: 'corpus-missing-self-authored-source' });
  if (!entries.some((entry) => entry.source === 'synthetic'))
    issues.push({ path: '', message: 'corpus-missing-synthetic-source' });
  if (!entries.some((entry) => (entry.pages ?? 0) >= 400))
    issues.push({ path: '', message: 'corpus-missing-400-page-document' });
  return issues;
}
export function assertCorpusManifest(entries: readonly CorpusEntry[]): void {
  const issues = validateCorpusManifest(entries);
  if (issues.length > 0)
    throw new Error(issues.map((issue) => `${issue.path}:${issue.message}`).join('\n'));
}

export interface PackagePartText {
  readonly name: string;
  readonly text: string;
  readonly contentType?: string;
}
export interface RelationshipEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
}
export interface PackageSnapshot {
  readonly parts: readonly PackagePartText[];
  readonly relationships?: readonly RelationshipEdge[];
}
export interface PackageDiff {
  readonly part: string;
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  readonly reason?: string;
}

/** Compare XML under the narrow Phase 11 equivalence relation. */
export function equivalentParts(
  expected: readonly PackagePartText[],
  actual: readonly PackagePartText[],
): PackageDiff[] {
  const left = new Map(expected.map((part) => [part.name, canonicalXml(part.text)]));
  const right = new Map(actual.map((part) => [part.name, canonicalXml(part.text)]));
  const diffs: PackageDiff[] = [];
  for (const name of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(name);
    const b = right.get(name);
    if (a !== b)
      diffs.push({ part: name, path: '/', expected: a ?? '<missing>', actual: b ?? '<missing>' });
  }
  return diffs;
}
export function equivalentPackages(
  expected: PackageSnapshot,
  actual: PackageSnapshot,
): PackageDiff[] {
  const diffs = equivalentParts(expected.parts, actual.parts);
  const left = [...(expected.relationships ?? [])].map(edgeKey).sort().join('\n');
  const right = [...(actual.relationships ?? [])].map(edgeKey).sort().join('\n');
  if (left !== right)
    diffs.push({
      part: '*.rels',
      path: '/Relationships',
      expected: left,
      actual: right,
      reason: 'resolved-relationship-graph',
    });
  return diffs;
}
export function canonicalXml(xml: string): string {
  const namespaces = new Map<string, string>();
  const tokens = xml.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? [];
  const out: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('<!--')) {
      out.push(token);
      continue;
    }
    if (!token.startsWith('<')) {
      if (!/^\s+$/.test(token)) out.push(token);
      continue;
    }
    if (token.startsWith('</')) {
      out.push(`</${token.slice(2, -1).trim()}>`);
      continue;
    }
    if (token.startsWith('<?') || token.startsWith('<!')) {
      out.push(token.replace(/\s+/g, ' ').trim());
      continue;
    }
    const selfClosing = /\/\s*>$/.test(token);
    const body = token.slice(1, token.length - (selfClosing ? 2 : 1)).trim();
    const nameEnd = body.search(/\s/);
    const name = nameEnd < 0 ? body : body.slice(0, nameEnd);
    const attrs = nameEnd < 0 ? '' : body.slice(nameEnd);
    const parsed: { name: string; value: string }[] = [];
    const regex = /([^\s=]+)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)')/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(attrs)) !== null) {
      const raw = match[1] ?? '';
      const value = match[2] ?? match[3] ?? '';
      if (raw === 'xmlns') namespaces.set('', value);
      else if (raw.startsWith('xmlns:')) namespaces.set(raw.slice(6), value);
      else parsed.push({ name: raw, value });
    }
    parsed.sort((a, b) => a.name.localeCompare(b.name));
    const attributes =
      parsed.length > 0
        ? ` ${parsed.map((attr) => `${attr.name}=${JSON.stringify(attr.value)}`).join(' ')}`
        : '';
    out.push(selfClosing ? `<${name}${attributes}></${name}>` : `<${name}${attributes}>`);
  }
  return out.join('').trim();
}

export interface RoundTripFailure {
  readonly document: string;
  readonly stage: 'equivalence' | 'idempotence';
  readonly diffs?: readonly PackageDiff[];
}
export interface RoundTripOptions<T> {
  readonly names?: readonly string[];
  readonly bytesEqual?: (a: T, b: T) => boolean;
  readonly onFailure?: (failure: RoundTripFailure) => void | Promise<void>;
  readonly retainFailure?: (
    document: T,
    generation: 1 | 2,
    failure: RoundTripFailure,
  ) => void | Promise<void>;
}
export async function runRoundTrip<T>(
  documents: readonly T[],
  open: (document: T) => Promise<T>,
  save: (document: T) => Promise<T>,
  equivalent: (a: T, b: T) => boolean | readonly PackageDiff[],
  options: RoundTripOptions<T> = {},
): Promise<void> {
  for (let index = 0; index < documents.length; index++) {
    const document = documents[index];
    if (document === undefined) continue;
    const name = options.names?.[index] ?? `document-${index}`;
    const first = await save(await open(document));
    const firstResult = equivalent(document, first);
    if (!equivalentResult(firstResult)) {
      const failure = {
        document: name,
        stage: 'equivalence' as const,
        diffs: diffResult(firstResult),
      };
      await options.onFailure?.(failure);
      await options.retainFailure?.(first, 1, failure);
      throw new Error(`round-trip-equivalence-failed:${name}`);
    }
    const second = await save(await open(first));
    const secondResult = options.bytesEqual
      ? options.bytesEqual(first, second)
      : equivalent(first, second);
    if (!equivalentResult(secondResult)) {
      const failure = {
        document: name,
        stage: 'idempotence' as const,
        diffs: diffResult(secondResult),
      };
      await options.onFailure?.(failure);
      await options.retainFailure?.(second, 2, failure);
      throw new Error(`round-trip-idempotence-failed:${name}`);
    }
  }
}

export interface GoldenLineBox {
  readonly page: number;
  readonly paragraph: number;
  readonly line: number;
  readonly top: number;
  readonly height: number;
  readonly baseline: number;
  readonly segments: readonly { readonly x: number; readonly width: number }[];
}
export interface GoldenOptions {
  readonly update?: boolean;
  readonly fonts?: readonly string[];
}
export interface GoldenResult {
  readonly text: string;
  readonly changed: boolean;
  readonly fonts: readonly string[];
}
export function serializeGolden(lines: readonly GoldenLineBox[]): string {
  const ordered = [...lines].sort(
    (a, b) => a.page - b.page || a.paragraph - b.paragraph || a.line - b.line,
  );
  return (
    ordered
      .map(
        (line) =>
          `page=${line.page} p=${line.paragraph} l=${line.line} y=${Math.round(line.top)} h=${Math.round(line.height)} base=${Math.round(line.baseline)} seg=[${line.segments.map((segment) => `${Math.round(segment.x)}+${Math.round(segment.width)}`).join(',')}]`,
      )
      .join('\n') + (ordered.length > 0 ? '\n' : '')
  );
}
export function runLayoutGolden(
  lines: readonly GoldenLineBox[],
  expected: string | undefined,
  options: GoldenOptions = {},
): GoldenResult {
  if (options.update !== true && expected === undefined) throw new Error('golden-missing-expected');
  const text = serializeGolden(lines);
  const changed = text !== (expected ?? '');
  if (changed && options.update !== true) throw new Error('golden-mismatch');
  return { text, changed, fonts: [...(options.fonts ?? [])].sort() };
}

export type VisualReferenceSource = 'libreoffice' | 'word-manual' | 'previous-commit';
export interface VisualDiffOptions {
  readonly source: VisualReferenceSource;
  readonly threshold?: number;
  readonly allowlistedPixels?: readonly number[];
}
export interface VisualDiffReport {
  readonly source: VisualReferenceSource;
  readonly differingPixels: number;
  readonly totalPixels: number;
  readonly ratio: number;
  readonly passed: boolean;
  readonly caveat: string;
}
export function compareVisualRgba(
  actual: Uint8Array,
  expected: Uint8Array,
  options: VisualDiffOptions,
): VisualDiffReport {
  if (actual.length !== expected.length || actual.length % 4 !== 0)
    throw new Error('visual-buffer-size-mismatch');
  const allowed = new Set(options.allowlistedPixels ?? []);
  let differingPixels = 0;
  for (let pixel = 0; pixel < actual.length / 4; pixel++) {
    const offset = pixel * 4;
    const same =
      actual[offset] === expected[offset] &&
      actual[offset + 1] === expected[offset + 1] &&
      actual[offset + 2] === expected[offset + 2] &&
      actual[offset + 3] === expected[offset + 3];
    if (!same && !allowed.has(pixel)) differingPixels++;
  }
  const totalPixels = actual.length / 4;
  const ratio = totalPixels === 0 ? 0 : differingPixels / totalPixels;
  return {
    source: options.source,
    differingPixels,
    totalPixels,
    ratio,
    passed: ratio <= (options.threshold ?? 0),
    caveat: 'unverified — no Word/LibreOffice available in this environment.',
  };
}

export interface PerformanceBudgets {
  readonly open100PagesMs: number;
  readonly keystrokeP95Ms: number;
  readonly scroll500PagesFps: number;
}
export interface PerformanceSample {
  readonly openMs: number;
  readonly keystrokeMs: readonly number[];
  readonly scrollFps: number;
  readonly cpuThrottle: number;
}
export interface PerformanceReport {
  readonly p95KeystrokeMs: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly cpuThrottle: number;
}
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const ordered = [...values].sort((a, b) => a - b);
  return (
    ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(p * ordered.length) - 1))] ??
    Number.POSITIVE_INFINITY
  );
}
export function assertPerformance(
  sample: PerformanceSample,
  budgets: PerformanceBudgets,
): PerformanceReport {
  const p95KeystrokeMs = percentile(sample.keystrokeMs, 0.95);
  const failures = [
    ...(sample.openMs >= budgets.open100PagesMs ? ['open-100-pages-budget'] : []),
    ...(p95KeystrokeMs >= budgets.keystrokeP95Ms ? ['keystroke-p95-budget'] : []),
    ...(sample.scrollFps < budgets.scroll500PagesFps ? ['scroll-500-pages-budget'] : []),
    ...(sample.cpuThrottle <= 0 ? ['cpu-throttle-not-set'] : []),
  ];
  return {
    p95KeystrokeMs,
    passed: failures.length === 0,
    failures,
    cpuThrottle: sample.cpuThrottle,
  };
}

export interface FuzzResult {
  readonly ok: boolean;
  readonly error?: unknown;
  readonly signature?: string;
  readonly iteration: number;
}
export interface FuzzOptions<T> {
  readonly iterations?: number;
  readonly deadlineMs?: number;
  readonly mutate: (seed: T, index: number) => T;
  readonly parse: (value: T) => unknown;
  readonly isTypedError?: (error: unknown) => boolean;
}
export function fuzz<T>(
  seeds: readonly T[],
  mutate: (seed: T, index: number) => T,
  parse: (value: T) => unknown,
  iterations = 100,
): FuzzResult[] {
  return runFuzz(seeds, { mutate, parse, iterations });
}
export function runFuzz<T>(seeds: readonly T[], options: FuzzOptions<T>): FuzzResult[] {
  const results: FuzzResult[] = [];
  const seen = new Set<string>();
  const deadline =
    options.deadlineMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.deadlineMs;
  for (
    let index = 0;
    index < Math.max(0, options.iterations ?? 100) && Date.now() <= deadline;
    index++
  ) {
    const seed = seeds[index % Math.max(1, seeds.length)];
    if (seed === undefined) break;
    try {
      options.parse(options.mutate(seed, index));
      results.push({ ok: true, iteration: index });
    } catch (error) {
      const signature = errorSignature(error);
      if (seen.has(signature)) continue;
      seen.add(signature);
      results.push({
        ok: options.isTypedError?.(error) ?? true,
        error,
        signature,
        iteration: index,
      });
    }
  }
  return results;
}

export interface MalformedPackageRecipe {
  readonly id: string;
  readonly expectedCode: string;
  readonly description: string;
  readonly build: () => Uint8Array;
}
/** Recipes avoid committing executable zip bombs or malicious XML to the repo. */
export const MALFORMED_PACKAGE_RECIPES: readonly MalformedPackageRecipe[] = [
  recipe('zip-ratio', 'compression-ratio-exceeded', 'high decompression ratio'),
  recipe('zip-entry-count', 'too-many-entries', 'too many ZIP entries'),
  recipe('doctype', 'entity-rejected', 'DOCTYPE declaration'),
  recipe('billion-laughs', 'entity-rejected', 'entity expansion'),
  recipe('external-entity', 'entity-rejected', 'external entity reference'),
  recipe('traversal', 'dot-segment', 'part name traversal'),
  recipe('duplicate-case', 'duplicate-entry', 'case-insensitive duplicate part'),
  recipe('absolute-part', 'invalid-part-name', 'absolute or drive-qualified part'),
  recipe('external-target', 'external-blocked', 'external relationship target'),
  recipe('truncated-central-directory', 'truncated', 'truncated central directory'),
  recipe('missing-content-types', 'missing-content-types', 'missing content types stream'),
  recipe('dangling-relationship', 'dangling-relationship', 'relationship to absent part'),
];
export interface DeterminismOptions<T> {
  readonly generate: () => T | Promise<T>;
  readonly equal?: (a: T, b: T) => boolean;
}
export async function assertDeterministic<T>(options: DeterminismOptions<T>): Promise<T> {
  const first = await options.generate();
  const second = await options.generate();
  if (!(options.equal ?? Object.is)(first, second)) throw new Error('nondeterministic-output');
  return first;
}
export function assertDisplayListSerializable<T>(displayList: T): T {
  try {
    const cloned = structuredClone(displayList);
    structuredClone(cloned);
    return cloned;
  } catch (error) {
    throw new Error('display-list-not-serializable', { cause: error });
  }
}

function cloneEntry(entry: CoverageEntry): CoverageEntry {
  return { name: entry.name, states: { ...entry.states } };
}
function isThresholdOptions(
  value: Partial<Record<CoverageState, number>> | CoverageThresholdOptions,
): value is CoverageThresholdOptions {
  return 'baseline' in value || 'corpusTypes' in value;
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function edgeKey(edge: RelationshipEdge): string {
  return `${edge.source}\u0000${edge.type}\u0000${edge.target}`;
}
function equivalentResult(
  value: boolean | readonly PackageDiff[],
): value is true | readonly PackageDiff[] {
  return value === true || (Array.isArray(value) && value.length === 0);
}
function diffResult(value: boolean | readonly PackageDiff[]): readonly PackageDiff[] {
  return Array.isArray(value) ? value : [];
}
function errorSignature(error: unknown): string {
  return error instanceof Error ? `${error.name}:${error.message}` : String(error);
}
function recipe(id: string, expectedCode: string, description: string): MalformedPackageRecipe {
  return { id, expectedCode, description, build: () => new TextEncoder().encode(`recipe:${id}`) };
}
