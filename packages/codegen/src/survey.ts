/**
 * Measures which XSD constructs the vendored schemas actually use, and fails the
 * build if one the generator deliberately does not implement ever appears.
 *
 * `docs/xsd-feature-survey.md` is the human-readable form of this file's output.
 * The numbers there are not decoration: they are the justification for every
 * simplification in `ir.ts`. "complexContent restriction: 0" is why `IrContent`
 * has no restriction variant; "substitutionGroup: 0" is why there is no
 * polymorphic dispatch layer. If a schema revision breaks one of those
 * assumptions, the correct outcome is a loud build failure, not a generator that
 * quietly emits a reader which drops content.
 *
 * Run it with `pnpm --filter @ooxml/codegen run survey`.
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

import type { SourceRef } from './ir.js';
import { UnsupportedXsdFeature } from './ir.js';
import { DOCX_NAMESPACES, NS_BY_URI } from './namespaces.js';
import { XSD_NS, type XsdNode, parseXsdDocument } from './loader.js';

/** The three schema families under `assets/schema`. */
export type SchemaFamily = 'transitional' | 'strict' | 'opc';

export const SCHEMA_FAMILIES: readonly SchemaFamily[] = ['transitional', 'strict', 'opc'];

/**
 * Raw construct counts for one schema family.
 *
 * Counts are of XSD *elements*, not of unique names: `complexTypes` counts every
 * `<xsd:complexType>` tag whether named or inline, and `groups` counts both
 * `<xsd:group name=>` definitions and `<xsd:group ref=>` uses. That is what the
 * numbers in the survey document mean, and conflating the two is how "we handle
 * all 269 groups" turns into "we handle 77 of them".
 */
export interface FeatureCounts {
  readonly files: number;
  /**
   * `element` + `complexType` + `simpleType` + `group` + `attributeGroup` tags
   * that carry a `name`. Deliberately excludes `xsd:attribute`, which the survey
   * counts on its own row.
   */
  readonly namedDefinitions: number;
  readonly elements: number;
  readonly namedElements: number;
  readonly attributes: number;
  readonly complexTypes: number;
  readonly namedComplexTypes: number;
  readonly simpleTypes: number;
  readonly namedSimpleTypes: number;
  readonly enumerations: number;
  readonly groups: number;
  readonly namedGroups: number;
  readonly attributeGroups: number;
  readonly namedAttributeGroups: number;
  readonly any: number;
  readonly all: number;
  readonly unions: number;
  readonly lists: number;
  readonly attributeDefaults: number;
  readonly elementDefaults: number;
  readonly formQualified: number;
  readonly refs: number;
  readonly imports: number;
  readonly restrictions: number;
  readonly extensions: number;
  readonly complexContent: number;
  readonly simpleContent: number;
  /** Per-file named-definition totals; `PROVENANCE.md` quotes `wml.xsd`. */
  readonly namedByFile: ReadonlyMap<string, number>;
}

/** One occurrence of a construct the generator refuses to implement. */
export interface RetiredSite {
  readonly feature: string;
  readonly source: SourceRef;
  /** Enclosing named definition, for a message a human can act on. */
  readonly context: string;
}

export interface WildcardSite {
  readonly context: string;
  readonly source: SourceRef;
  /** As written in the schema, e.g. `##any`, `##local`, or a URI list. */
  readonly namespace: string;
  readonly processContents: string;
  /** Whether the declaring schema's namespace is on the `.docx` path. */
  readonly docxPath: boolean;
}

export interface MixedContentSite {
  readonly context: string;
  readonly source: SourceRef;
  readonly docxPath: boolean;
}

export interface SurveyResult {
  readonly counts: ReadonlyMap<SchemaFamily, FeatureCounts>;
  /** Empty in a healthy tree. Non-empty is a build failure. */
  readonly retired: readonly RetiredSite[];
  /** Every `xsd:any`, so the survey document's wildcard table stays honest. */
  readonly wildcards: readonly WildcardSite[];
  /**
   * `mixed="true"`. Reported rather than thrown, because it genuinely occurs —
   * `CT_Schema` in both `sml.xsd` files and `CT_Keywords` in
   * `opc-coreProperties.xsd`. The survey document currently records only the
   * SpreadsheetML one; the OPC case is real and the IR cannot represent it.
   */
  readonly mixed: readonly MixedContentSite[];
}

/**
 * Constructs `docs/xsd-feature-survey.md` measured as unused and the generator
 * therefore does not implement.
 *
 * `block` is here even though the loader ignores it: it constrains derivation,
 * which the generator flattens away, so its appearance would mean someone has to
 * make a decision rather than that the loader silently mis-parsed something.
 */
const RETIRED_FEATURES: readonly string[] = [
  'xsd:include',
  'xsd:redefine',
  'substitutionGroup',
  'nillable',
  'abstract="true"',
  'block',
  'xsd:complexContent/xsd:restriction',
  'xsd:simpleContent/xsd:restriction',
  'xsd:anyAttribute',
];

interface Accumulator {
  files: number;
  namedDefinitions: number;
  elements: number;
  namedElements: number;
  attributes: number;
  complexTypes: number;
  namedComplexTypes: number;
  simpleTypes: number;
  namedSimpleTypes: number;
  enumerations: number;
  groups: number;
  namedGroups: number;
  attributeGroups: number;
  namedAttributeGroups: number;
  any: number;
  all: number;
  unions: number;
  lists: number;
  attributeDefaults: number;
  elementDefaults: number;
  formQualified: number;
  refs: number;
  imports: number;
  restrictions: number;
  extensions: number;
  complexContent: number;
  simpleContent: number;
  readonly namedByFile: Map<string, number>;
}

function newAccumulator(): Accumulator {
  return {
    files: 0,
    namedDefinitions: 0,
    elements: 0,
    namedElements: 0,
    attributes: 0,
    complexTypes: 0,
    namedComplexTypes: 0,
    simpleTypes: 0,
    namedSimpleTypes: 0,
    enumerations: 0,
    groups: 0,
    namedGroups: 0,
    attributeGroups: 0,
    namedAttributeGroups: 0,
    any: 0,
    all: 0,
    unions: 0,
    lists: 0,
    attributeDefaults: 0,
    elementDefaults: 0,
    formQualified: 0,
    refs: 0,
    imports: 0,
    restrictions: 0,
    extensions: 0,
    complexContent: 0,
    simpleContent: 0,
    namedByFile: new Map(),
  };
}

interface WalkContext {
  readonly file: string;
  /** Nearest enclosing named definition, for readable diagnostics. */
  readonly context: string;
  /** Local name of the parent XSD element, so `restriction` can be classified. */
  readonly parent: string;
  readonly docxPath: boolean;
}

interface Sinks {
  readonly retired: RetiredSite[];
  readonly wildcards: WildcardSite[];
  readonly mixed: MixedContentSite[];
}

const NAMED_DEFINITION_TAGS: ReadonlySet<string> = new Set([
  'element',
  'complexType',
  'simpleType',
  'group',
  'attributeGroup',
]);

function walk(node: XsdNode, ctx: WalkContext, acc: Accumulator, sinks: Sinks): void {
  if (node.uri !== XSD_NS) return;
  const source: SourceRef = { file: ctx.file, line: node.line };
  const name = node.attrs.get('name');

  if (name !== undefined && NAMED_DEFINITION_TAGS.has(node.local)) {
    acc.namedDefinitions += 1;
    acc.namedByFile.set(ctx.file, (acc.namedByFile.get(ctx.file) ?? 0) + 1);
  }
  if (node.attrs.has('ref')) acc.refs += 1;
  if (node.attrs.get('form') === 'qualified') acc.formQualified += 1;

  // Retired attributes can sit on any construct, so they are checked generically.
  if (node.attrs.has('substitutionGroup')) {
    sinks.retired.push({ feature: 'substitutionGroup', source, context: ctx.context });
  }
  if (node.attrs.has('nillable')) {
    sinks.retired.push({ feature: 'nillable', source, context: ctx.context });
  }
  if (node.attrs.get('abstract') === 'true') {
    sinks.retired.push({ feature: 'abstract="true"', source, context: ctx.context });
  }
  if (node.attrs.has('block')) {
    sinks.retired.push({ feature: 'block', source, context: ctx.context });
  }

  switch (node.local) {
    case 'element':
      acc.elements += 1;
      if (name !== undefined) acc.namedElements += 1;
      if (node.attrs.has('default')) acc.elementDefaults += 1;
      break;
    case 'attribute':
      acc.attributes += 1;
      if (node.attrs.has('default')) acc.attributeDefaults += 1;
      break;
    case 'complexType':
      acc.complexTypes += 1;
      if (name !== undefined) acc.namedComplexTypes += 1;
      if (node.attrs.get('mixed') === 'true') {
        sinks.mixed.push({
          context: name ?? ctx.context,
          source,
          docxPath: ctx.docxPath,
        });
      }
      break;
    case 'simpleType':
      acc.simpleTypes += 1;
      if (name !== undefined) acc.namedSimpleTypes += 1;
      break;
    case 'group':
      acc.groups += 1;
      if (name !== undefined) acc.namedGroups += 1;
      break;
    case 'attributeGroup':
      acc.attributeGroups += 1;
      if (name !== undefined) acc.namedAttributeGroups += 1;
      break;
    case 'enumeration':
      acc.enumerations += 1;
      break;
    case 'all':
      acc.all += 1;
      break;
    case 'union':
      acc.unions += 1;
      break;
    case 'list':
      acc.lists += 1;
      break;
    case 'import':
      acc.imports += 1;
      break;
    case 'include':
    case 'redefine':
      sinks.retired.push({ feature: `xsd:${node.local}`, source, context: ctx.context });
      break;
    case 'anyAttribute':
      sinks.retired.push({ feature: 'xsd:anyAttribute', source, context: ctx.context });
      break;
    case 'extension':
      acc.extensions += 1;
      break;
    case 'complexContent':
      acc.complexContent += 1;
      break;
    case 'simpleContent':
      acc.simpleContent += 1;
      break;
    case 'restriction':
      acc.restrictions += 1;
      // The finding that retires an entire class of generator complexity:
      // restriction against a complex base requires re-deriving a particle list
      // by subtraction. Every occurrence in this set is a simple-type facet
      // restriction instead.
      if (ctx.parent === 'complexContent' || ctx.parent === 'simpleContent') {
        sinks.retired.push({
          feature: `xsd:${ctx.parent}/xsd:restriction`,
          source,
          context: ctx.context,
        });
      }
      break;
    case 'any':
      acc.any += 1;
      sinks.wildcards.push({
        context: ctx.context,
        source,
        namespace: node.attrs.get('namespace') ?? '##any',
        processContents: node.attrs.get('processContents') ?? 'strict',
        docxPath: ctx.docxPath,
      });
      break;
    default:
      break;
  }

  const childContext =
    name !== undefined && NAMED_DEFINITION_TAGS.has(node.local) && node.local !== 'element'
      ? name
      : ctx.context;
  const childCtx: WalkContext = {
    file: ctx.file,
    context: childContext,
    parent: node.local,
    docxPath: ctx.docxPath,
  };
  for (const child of node.children) walk(child, childCtx, acc, sinks);
}

async function surveyFamily(
  assetsDir: string,
  family: SchemaFamily,
  sinks: Sinks,
): Promise<FeatureCounts> {
  const acc = newAccumulator();
  const entries = await readdir(join(assetsDir, family));
  for (const name of entries.filter((e) => e.endsWith('.xsd')).sort()) {
    const file = `${family}/${name}`;
    const root = parseXsdDocument(await readFile(join(assetsDir, family, name), 'utf8'), file);
    acc.files += 1;
    acc.namedByFile.set(file, 0);
    const targetUri = root.attrs.get('targetNamespace');
    const token = targetUri === undefined ? undefined : NS_BY_URI.get(targetUri);
    walk(
      root,
      {
        file,
        context: '(schema)',
        parent: '',
        docxPath: token !== undefined && DOCX_NAMESPACES.has(token),
      },
      acc,
      sinks,
    );
  }
  return { ...acc, namedByFile: acc.namedByFile };
}

/**
 * Counts every construct in every vendored schema.
 *
 * Reuses the loader's document parser, which means the survey inherits the same
 * DOCTYPE refusal and the same CRLF normalization. It also means the survey
 * counts what the loader sees — a grep-based survey silently disagrees with the
 * loader whenever an attribute is written in an unusual order, which is exactly
 * how the published `pml.xsd` writes two of its declarations.
 */
export async function surveySchemas(assetsDir: string): Promise<SurveyResult> {
  const sinks: Sinks = { retired: [], wildcards: [], mixed: [] };
  const counts = new Map<SchemaFamily, FeatureCounts>();
  for (const family of SCHEMA_FAMILIES) {
    counts.set(family, await surveyFamily(assetsDir, family, sinks));
  }
  return { counts, retired: sinks.retired, wildcards: sinks.wildcards, mixed: sinks.mixed };
}

/**
 * Throws `UnsupportedXsdFeature` if any retired construct appears.
 *
 * Reports the first site of the first offending feature: if the schema set has
 * changed enough to introduce one, the right response is to go read it, not to
 * skim a list of 400 occurrences.
 */
export function assertNoUnsupportedFeatures(survey: SurveyResult): void {
  for (const feature of RETIRED_FEATURES) {
    const site = survey.retired.find((s) => s.feature === feature);
    if (site !== undefined) throw new UnsupportedXsdFeature(feature, site.source);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function row(label: string, ...values: readonly (string | number)[]): string {
  return `${label.padEnd(26)}${values.map((v) => String(v).padStart(14)).join('')}`;
}

/** Keys of `FeatureCounts` that are plain counts, i.e. everything but `namedByFile`. */
type CountKey = {
  [K in keyof FeatureCounts]: FeatureCounts[K] extends number ? K : never;
}[keyof FeatureCounts];

/** Renders the survey as the tables in `docs/xsd-feature-survey.md`. */
export function formatSurvey(survey: SurveyResult): string {
  const t = survey.counts.get('transitional');
  const s = survey.counts.get('strict');
  const o = survey.counts.get('opc');
  if (t === undefined || s === undefined || o === undefined) {
    return 'survey: incomplete result';
  }
  const lines: string[] = [];
  lines.push(row('', 'Transitional', 'Strict', 'OPC'));
  lines.push('-'.repeat(68));
  const pick = (key: CountKey, label: string): void => {
    lines.push(row(label, t[key], s[key], o[key]));
  };
  pick('files', 'files');
  pick('namedDefinitions', 'named definitions');
  pick('elements', 'xsd:element');
  pick('attributes', 'xsd:attribute');
  pick('complexTypes', 'xsd:complexType');
  pick('simpleTypes', 'xsd:simpleType');
  pick('enumerations', 'xsd:enumeration');
  pick('groups', 'xsd:group');
  pick('attributeGroups', 'xsd:attributeGroup');
  lines.push('-'.repeat(68));
  pick('any', 'xsd:any');
  pick('all', 'xsd:all');
  pick('unions', 'xsd:union');
  pick('lists', 'xsd:list');
  pick('attributeDefaults', 'attribute default=');
  pick('elementDefaults', 'element default=');
  pick('formQualified', 'form="qualified"');
  pick('refs', 'ref=');
  pick('imports', 'xsd:import');
  pick('restrictions', 'xsd:restriction');
  pick('extensions', 'xsd:extension');
  pick('complexContent', 'xsd:complexContent');
  pick('simpleContent', 'xsd:simpleContent');
  lines.push('');
  lines.push(`retired features found: ${survey.retired.length}`);
  for (const site of survey.retired.slice(0, 20)) {
    lines.push(`  ${site.feature} in ${site.context} at ${site.source.file}:${site.source.line}`);
  }
  lines.push('');
  lines.push(`mixed="true": ${survey.mixed.length}`);
  for (const site of survey.mixed) {
    lines.push(
      `  ${site.context} at ${site.source.file}:${site.source.line}` +
        `${site.docxPath ? '  [.docx path]' : ''}`,
    );
  }
  lines.push('');
  lines.push(`xsd:any sites on the .docx path: ${survey.wildcards.filter((w) => w.docxPath).length}`);
  for (const site of survey.wildcards.filter((w) => w.docxPath)) {
    lines.push(
      `  ${site.context.padEnd(26)} ${site.source.file}:${site.source.line}` +
        `  ns=${site.namespace}  processContents=${site.processContents}`,
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** `assets/schema`, relative to this module's location in `packages/codegen/dist`. */
function defaultAssetsDir(): string {
  return fileURLToPath(new URL('../../../assets/schema/', import.meta.url));
}

async function main(): Promise<void> {
  const assetsDir = process.argv[2] ?? defaultAssetsDir();
  const survey = await surveySchemas(assetsDir);
  process.stdout.write(`${formatSurvey(survey)}\n`);
  assertNoUnsupportedFeatures(survey);
}

// Runs only when executed directly, so importing this module from tests or from
// the generator costs nothing.
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  await main();
}
