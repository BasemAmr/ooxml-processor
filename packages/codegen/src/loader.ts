/**
 * Reads the vendored ECMA-376 XSDs into the faithful IR of `ir.ts`.
 *
 * Three properties drive every design decision in this file.
 *
 * **1. Faithful, not normalized.** Groups stay as `groupRef` particles,
 * extension bases stay as unresolved QNames, particles are not flattened. The
 * normalizer is a separate pass with its own tests; mixing the two would make
 * both untestable, because a bug in group expansion would be indistinguishable
 * from a bug in parsing.
 *
 * **2. One symbol table for both dialects.** Transitional and Strict are two
 * spellings of one format. `namespaces.ts` maps both URI families onto a single
 * logical token, so `wml#CT_P` from either dialect lands on the same key. Where
 * the two definitions agree structurally they merge into one IR node carrying
 * `dialects: ['transitional','strict']`; where they disagree the loader records
 * a `dialect-divergence` diagnostic naming the exact difference rather than
 * silently preferring one. `docs/adr/0008-dialect-handling.md` names that report
 * as the falsification test for the whole strategy, so its precision matters
 * more than its brevity.
 *
 * **3. Loud on anything unmeasured.** `docs/xsd-feature-survey.md` records which
 * XSD constructs the 51 vendored schemas actually use. Anything outside that set
 * throws — `UnsupportedXsdFeature` for constructs the survey retired, and
 * `XsdLoadError` for constructs the IR simply cannot express. A schema revision
 * that introduces one fails the build instead of being quietly dropped into a
 * corrupted document.
 *
 * The XML layer is `saxes` in namespace-tracking mode. The parser refuses any
 * document with a DOCTYPE: an internal subset is the entity-expansion attack
 * surface (billion laughs), and no legitimate XSD in the set has one, so the
 * guard costs nothing and closes the hole permanently.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { SaxesParser } from 'saxes';
import type { SaxesTagNS } from 'saxes';

import type {
  AttributeUse,
  BuiltinType,
  Dialect,
  Diagnostic,
  EnumValue,
  Facets,
  IrAttribute,
  IrAttributeGroup,
  IrAttributeGroupRef,
  IrAttributeMember,
  IrComplexType,
  IrContent,
  IrDefinition,
  IrElementParticle,
  IrGlobalElement,
  IrGroup,
  IrParticle,
  IrSchemaSet,
  IrSimpleType,
  LogicalNs,
  NsConstraint,
  Occurs,
  ProcessContents,
  QName,
  SourceRef,
  TypeRef,
} from './ir.js';
import { UnsupportedXsdFeature, qnameKey } from './ir.js';
import { NS_BY_TOKEN, NS_BY_URI, TRANSITIONAL_ONLY } from './namespaces.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A schema the loader cannot read.
 *
 * Distinct from `UnsupportedXsdFeature`, which means "legal XSD that the survey
 * says is unused, so we deliberately did not implement it". `XsdLoadError` means
 * "this input is malformed, unsafe, or names something the namespace table does
 * not know", and always identifies the offending file and line.
 */
export class XsdLoadError extends Error {
  constructor(
    message: string,
    readonly source: SourceRef,
  ) {
    super(`${message} (at ${source.file}:${source.line})`);
    this.name = 'XsdLoadError';
  }
}

// ---------------------------------------------------------------------------
// A minimal XSD document model
// ---------------------------------------------------------------------------

/** The XML Schema namespace. Elements outside it are not schema constructs. */
export const XSD_NS = 'http://www.w3.org/2001/XMLSchema';

/** Implicitly bound in every XML document; no `xmlns:xml` declaration needed. */
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const XMLNS_ATTR_NS = 'http://www.w3.org/2000/xmlns/';

/**
 * One element of a parsed XSD.
 *
 * A tiny read-only tree rather than a streaming visitor: the schemas total
 * ~2.5 MB, so materializing them costs nothing measurable, and the compiler
 * below reads far more clearly as recursive functions over a tree than as a
 * state machine over SAX events. `survey.ts` walks the same tree, which keeps
 * the DOCTYPE guard and the CRLF handling in exactly one place.
 */
export interface XsdNode {
  /** Local name, e.g. `complexType`. */
  readonly local: string;
  /** Namespace URI of the element itself. */
  readonly uri: string;
  /** Unprefixed attributes only; `xmlns` declarations are lifted into `bindings`. */
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: readonly XsdNode[];
  /** Concatenated character data, line endings normalized and trimmed. */
  readonly text: string;
  /** 1-based line of the element's start tag. */
  readonly line: number;
  /** Prefix → URI, including everything inherited from ancestors. */
  readonly bindings: ReadonlyMap<string, string>;
}

interface XsdFrame {
  readonly local: string;
  readonly uri: string;
  readonly attrs: Map<string, string>;
  readonly children: XsdNode[];
  readonly text: string[];
  readonly line: number;
  readonly bindings: ReadonlyMap<string, string>;
}

const EMPTY_BINDINGS: ReadonlyMap<string, string> = new Map();

/**
 * XML normalizes CRLF to LF; the vendored files are CRLF, so anything captured
 * verbatim would otherwise carry `\r` into generated output and into diagnostic
 * messages. Normalizing here means no downstream consumer has to think about it.
 */
function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n');
}

/**
 * Parses one XSD document into an `XsdNode` tree.
 *
 * Rejects any document with a DOCTYPE. This is a security boundary, not a
 * convenience: an internal subset can define entities that expand
 * exponentially, and a generator that reads attacker-supplied schemas without
 * this check is a denial-of-service waiting to happen. No XSD in the vendored
 * set has one, so the check is free.
 */
export function parseXsdDocument(xml: string, file: string): XsdNode {
  // Node's `readFile` keeps the UTF-8 BOM; the OPC schemas have one and saxes
  // would report it as stray text before the root element.
  const source = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;

  const stack: XsdFrame[] = [];
  let root: XsdNode | undefined;
  let startLine = 1;
  let sawDoctype = false;

  const parser = new SaxesParser<{ xmlns: true; position: true }>({
    xmlns: true,
    position: true,
  });

  parser.on('doctype', () => {
    sawDoctype = true;
    throw new XsdLoadError(
      'Refusing to parse an XSD that declares a DOCTYPE. An internal subset can ' +
        'define entities that expand exponentially (the "billion laughs" attack), and ' +
        'no schema in the ECMA-376 asset set uses one, so the loader treats any ' +
        'DOCTYPE as hostile input',
      { file, line: parser.line },
    );
  });

  parser.on('error', (err: Error) => {
    throw new XsdLoadError(`Malformed XML: ${err.message}`, { file, line: parser.line });
  });

  // `opentagstart` fires as soon as the tag name ends, which is the last moment
  // the parser is still positioned on the start tag: by the time `opentag`
  // fires it may have consumed attributes spanning several lines, which these
  // files do constantly. So the line is latched here. Start and open events
  // never interleave across elements, so one slot is enough.
  //
  // The off-by-one: saxes has to consume the delimiter after the name before it
  // knows the name ended, and when that delimiter is the newline of
  // `<xsd:complexType\n    name="...">` the line counter has already advanced.
  // `column === 0` happens only immediately after consuming a newline, so it is
  // an exact test for that case rather than a guess.
  parser.on('opentagstart', () => {
    startLine = parser.column === 0 && parser.line > 1 ? parser.line - 1 : parser.line;
  });

  parser.on('opentag', (tag: SaxesTagNS) => {
    const parent = stack[stack.length - 1];
    const bindings = collectBindings(tag, parent?.bindings);
    const attrs = new Map<string, string>();
    for (const attr of Object.values(tag.attributes)) {
      if (attr.uri === XMLNS_ATTR_NS || attr.name === 'xmlns') continue;
      attrs.set(attr.name, normalizeText(attr.value));
    }
    stack.push({
      local: tag.local,
      uri: tag.uri,
      attrs,
      children: [],
      text: [],
      line: startLine,
      bindings,
    });
  });

  const onText = (chunk: string): void => {
    stack[stack.length - 1]?.text.push(chunk);
  };
  parser.on('text', onText);
  parser.on('cdata', onText);

  parser.on('closetag', () => {
    const frame = stack.pop();
    if (frame === undefined) return;
    const node: XsdNode = {
      local: frame.local,
      uri: frame.uri,
      attrs: frame.attrs,
      children: frame.children,
      text: normalizeText(frame.text.join('')).trim(),
      line: frame.line,
      bindings: frame.bindings,
    };
    const parent = stack[stack.length - 1];
    if (parent === undefined) root = node;
    else parent.children.push(node);
  });

  parser.write(source).close();

  // Belt and braces: if a future saxes release ever swallowed handler
  // exceptions, the flag still fails the load.
  if (sawDoctype) {
    throw new XsdLoadError('Refusing to parse an XSD that declares a DOCTYPE', { file, line: 1 });
  }
  if (root === undefined) {
    throw new XsdLoadError('Document has no root element', { file, line: 1 });
  }
  return root;
}

/**
 * Builds the in-scope prefix bindings for a tag.
 *
 * saxes keeps only a tag's *own* declarations on `tag.ns`, so inherited
 * bindings have to be chained by hand. The common case — a tag that declares
 * nothing — reuses the parent's map rather than copying it, which keeps this
 * from being O(depth x prefixes) on every element of a 5,000-line schema.
 */
function collectBindings(
  tag: SaxesTagNS,
  parent: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> {
  let own: Map<string, string> | undefined;
  for (const attr of Object.values(tag.attributes)) {
    if (attr.name === 'xmlns') {
      own ??= new Map(parent);
      own.set('', attr.value);
    } else if (attr.uri === XMLNS_ATTR_NS) {
      own ??= new Map(parent);
      own.set(attr.local, attr.value);
    }
  }
  return own ?? parent ?? EMPTY_BINDINGS;
}

// ---------------------------------------------------------------------------
// Built-in types
// ---------------------------------------------------------------------------

const BUILTIN_TYPE_NAMES = [
  'xsd:string',
  'xsd:boolean',
  'xsd:int',
  'xsd:integer',
  'xsd:long',
  'xsd:unsignedInt',
  'xsd:unsignedLong',
  'xsd:unsignedShort',
  'xsd:byte',
  'xsd:unsignedByte',
  'xsd:double',
  'xsd:float',
  'xsd:decimal',
  'xsd:dateTime',
  'xsd:date',
  'xsd:time',
  'xsd:duration',
  'xsd:base64Binary',
  'xsd:hexBinary',
  'xsd:anyURI',
  'xsd:token',
  'xsd:NCName',
  'xsd:ID',
  'xsd:IDREF',
  'xsd:NMTOKEN',
  'xsd:language',
  'xsd:positiveInteger',
  'xsd:nonNegativeInteger',
] as const satisfies readonly BuiltinType[];

/** Compile-time guard: fails if `ir.ts` gains a builtin this table forgot. */
type AssertNever<T extends never> = T;
export type _AllBuiltinsEnumerated = AssertNever<
  Exclude<BuiltinType, (typeof BUILTIN_TYPE_NAMES)[number]>
>;

const BUILTIN_TYPES: ReadonlySet<string> = new Set<string>(BUILTIN_TYPE_NAMES);

/**
 * XSD built-ins used by the schemas that `ir.ts`'s `BuiltinType` does not list.
 *
 * There is exactly one, and it is deliberate rather than an oversight worth
 * working around silently: `shared-documentPropertiesVariantTypes.xsd` types the
 * `vt:i2` element as `xsd:short`. Widening to `xsd:int` is lossless for reading
 * (every short is an int) and loses only the 16-bit range check on write, which
 * no other layer enforces today. Every substitution raises an
 * `unsupported-builtin` diagnostic naming the site, so the compromise is visible
 * in the load report rather than buried here. Anything *not* in this table is a
 * hard error: guessing at an unknown primitive is how generators produce
 * plausible, wrong output.
 */
const BUILTIN_SUBSTITUTIONS: ReadonlyMap<string, BuiltinType> = new Map<string, BuiltinType>([
  ['xsd:short', 'xsd:int'],
]);

// ---------------------------------------------------------------------------
// Small node helpers
// ---------------------------------------------------------------------------

function schemaChildren(node: XsdNode): readonly XsdNode[] {
  return node.children.filter((c) => c.uri === XSD_NS && c.local !== 'annotation');
}

function firstChild(node: XsdNode, local: string): XsdNode | undefined {
  return node.children.find((c) => c.uri === XSD_NS && c.local === local);
}

/** `<xsd:annotation><xsd:documentation>` text, if any. */
function documentationOf(node: XsdNode): string | undefined {
  const annotation = firstChild(node, 'annotation');
  if (annotation === undefined) return undefined;
  const parts: string[] = [];
  for (const child of annotation.children) {
    if (child.uri === XSD_NS && child.local === 'documentation' && child.text !== '') {
      parts.push(child.text);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/** Spreadable optional property — `exactOptionalPropertyTypes` forbids `x: undefined`. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

// ---------------------------------------------------------------------------
// Symbol tables
// ---------------------------------------------------------------------------

/**
 * A global `xsd:attribute`. It has no `ir.ts` counterpart — `IrSchemaSet`
 * exposes no `globalAttributes` map — but 67 of them exist (`r:id` and the VML
 * `o:*` family) and `<xsd:attribute ref=...>` cannot be given a type without
 * them, so they are kept loader-internal purely to resolve references.
 */
interface GlobalAttributeDecl {
  readonly name: QName;
  readonly type: TypeRef;
  readonly default?: string;
  readonly source: SourceRef;
}

interface SymbolTable {
  readonly complexTypes: Map<string, IrComplexType>;
  readonly simpleTypes: Map<string, IrSimpleType>;
  readonly globalElements: Map<string, IrGlobalElement>;
  readonly groups: Map<string, IrGroup>;
  readonly attributeGroups: Map<string, IrAttributeGroup>;
  readonly globalAttributes: Map<string, GlobalAttributeDecl>;
}

function newSymbolTable(): SymbolTable {
  return {
    complexTypes: new Map(),
    simpleTypes: new Map(),
    globalElements: new Map(),
    groups: new Map(),
    attributeGroups: new Map(),
    globalAttributes: new Map(),
  };
}

/**
 * Element and attribute particles built from `ref=`, held mutably until the
 * whole set is parsed.
 *
 * `IrElementParticle` requires a concrete `type`, but `<xsd:element ref="a:graphic"/>`
 * carries only a name; the type lives on the global declaration, which may be in
 * a file not yet read. Rather than resolve mid-parse (which would make load
 * order significant) the loader parks these and fills them in once every file is
 * in. This is reference *lookup*, not normalization: no group is expanded and no
 * extension is flattened.
 */
interface MutableElementParticle {
  kind: 'element';
  name: string;
  ns: LogicalNs;
  type: TypeRef;
  min: number;
  max: Occurs;
  default?: string;
  doc?: string;
  source: SourceRef;
}

interface MutableAttribute {
  kind: 'attribute';
  name: string;
  ns: LogicalNs | null;
  type: TypeRef;
  use: AttributeUse;
  default?: string;
  doc?: string;
  source: SourceRef;
}

interface PendingRef<T> {
  readonly slot: T;
  readonly ref: QName;
  readonly source: SourceRef;
}

type MutableFacets = { -readonly [K in keyof Facets]: Facets[K] };

/** Per-file state: target namespace and the two `form` defaults. */
interface SchemaScope {
  readonly file: string;
  readonly targetNs: LogicalNs;
  readonly elementFormQualified: boolean;
  readonly attributeFormQualified: boolean;
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/**
 * Compiles every XSD in one directory into a single symbol table.
 *
 * One instance per dialect, plus one for the dialect-independent OPC schemas.
 * Keeping the tables separate until the merge step is what makes the
 * dialect-divergence report possible: once they are combined the evidence of
 * which dialect said what is gone.
 */
class SchemaCompiler {
  readonly tables: SymbolTable = newSymbolTable();
  private readonly pendingElementRefs: PendingRef<MutableElementParticle>[] = [];
  private readonly pendingAttributeRefs: PendingRef<MutableAttribute>[] = [];

  constructor(
    /** Only used in diagnostic text; the merge step assigns the real dialects. */
    private readonly label: string,
    private readonly diagnostics: Diagnostic[],
  ) {}

  async loadDirectory(assetsDir: string, subdir: string): Promise<void> {
    const entries = await readdir(join(assetsDir, subdir));
    // Sorted so that anonymous-type numbering — and therefore every generated
    // name — is identical on every machine. Codegen determinism is a CI gate.
    const files = entries.filter((e) => e.endsWith('.xsd')).sort();
    for (const name of files) {
      // POSIX separators regardless of host: `SourceRef.file` ends up in
      // generated headers and in committed reports.
      const relative = `${subdir}/${name}`;
      const xml = await readFile(join(assetsDir, subdir, name), 'utf8');
      this.compileFile(parseXsdDocument(xml, relative), relative);
    }
  }

  // -- namespaces ----------------------------------------------------------

  private tokenForUri(uri: string, source: SourceRef): LogicalNs {
    const token = NS_BY_URI.get(uri);
    if (token === undefined) {
      throw new XsdLoadError(
        `Namespace URI "${uri}" is not in the namespace table. Add a NamespaceBinding ` +
          `for it to packages/codegen/src/namespaces.ts — the loader will not invent a ` +
          `logical token, because a wrong token silently merges two unrelated namespaces`,
        source,
      );
    }
    return token;
  }

  /** Resolves a QName-valued attribute through the document's own prefix bindings. */
  private resolveQName(raw: string, node: XsdNode, scope: SchemaScope): QName {
    const source = this.src(node, scope);
    const trimmed = raw.trim();
    const colon = trimmed.indexOf(':');
    const prefix = colon === -1 ? '' : trimmed.slice(0, colon);
    const local = colon === -1 ? trimmed : trimmed.slice(colon + 1);
    if (local === '') {
      throw new XsdLoadError(`Malformed QName "${raw}"`, source);
    }
    const uri = prefix === 'xml' ? XML_NS : node.bindings.get(prefix);
    if (uri === undefined) {
      throw new XsdLoadError(
        prefix === ''
          ? `QName "${raw}" is unprefixed but the document declares no default namespace`
          : `QName "${raw}" uses prefix "${prefix}", which the document does not bind`,
        source,
      );
    }
    return { ns: this.tokenForUri(uri, source), name: local };
  }

  /** A `type=` / `base=` / `itemType=` value: either an XSD built-in or a schema type. */
  private resolveTypeRef(raw: string, node: XsdNode, scope: SchemaScope): TypeRef {
    const trimmed = raw.trim();
    const colon = trimmed.indexOf(':');
    const prefix = colon === -1 ? '' : trimmed.slice(0, colon);
    const local = colon === -1 ? trimmed : trimmed.slice(colon + 1);
    const uri = prefix === 'xml' ? XML_NS : node.bindings.get(prefix);

    if (uri === XSD_NS) {
      // Canonical spelling: `ir.ts` names built-ins `xsd:*` no matter which
      // prefix the document happened to bind (the OPC schemas use `xs:`).
      const canonical = `xsd:${local}`;
      if (BUILTIN_TYPES.has(canonical)) {
        return { kind: 'builtin', name: canonical as BuiltinType };
      }
      const substitute = BUILTIN_SUBSTITUTIONS.get(canonical);
      if (substitute !== undefined) {
        this.diagnostics.push({
          severity: 'warning',
          code: 'unsupported-builtin',
          message:
            `${canonical} is not one of the built-ins ir.ts models; substituting ` +
            `${substitute}. Reading is lossless, but the narrower range is not enforced ` +
            `on write. Add ${canonical} to BuiltinType if that matters.`,
          source: this.src(node, scope),
        });
        return { kind: 'builtin', name: substitute };
      }
      throw new XsdLoadError(
        `Unknown XML Schema built-in type "${canonical}". ir.ts's BuiltinType union is ` +
          `the allow-list; extend it deliberately rather than letting an unmodelled ` +
          `primitive through as a string`,
        this.src(node, scope),
      );
    }
    return { kind: 'named', ref: this.resolveQName(raw, node, scope) };
  }

  // -- generic helpers -----------------------------------------------------

  private src(node: XsdNode, scope: SchemaScope): SourceRef {
    return { file: scope.file, line: node.line };
  }

  private requireAttr(node: XsdNode, name: string, scope: SchemaScope): string {
    const value = node.attrs.get(name);
    if (value === undefined) {
      throw new XsdLoadError(`<xsd:${node.local}> is missing the required "${name}"`, this.src(node, scope));
    }
    return value;
  }

  /** Rejects the constructs `docs/xsd-feature-survey.md` measured as unused. */
  private guardRetired(node: XsdNode, scope: SchemaScope): void {
    const source = this.src(node, scope);
    if (node.attrs.has('substitutionGroup')) {
      throw new UnsupportedXsdFeature('substitutionGroup', source);
    }
    if (node.attrs.has('nillable')) {
      throw new UnsupportedXsdFeature('nillable', source);
    }
    if (node.attrs.get('abstract') === 'true') {
      throw new UnsupportedXsdFeature('abstract="true"', source);
    }
  }

  private register<T extends IrDefinition>(
    map: Map<string, T>,
    name: QName,
    definition: T,
    source: SourceRef,
  ): void {
    const key = qnameKey(name);
    const existing = map.get(key);
    if (existing !== undefined) {
      this.diagnostics.push({
        severity: 'warning',
        code: 'duplicate-definition',
        message:
          `${this.label}: ${key} is defined twice (first at ${existing.source.file}:` +
          `${existing.source.line}); keeping the first`,
        source,
      });
      return;
    }
    map.set(key, definition);
  }

  // -- top level -----------------------------------------------------------

  private compileFile(root: XsdNode, file: string): void {
    if (root.uri !== XSD_NS || root.local !== 'schema') {
      throw new XsdLoadError(`Root element is <${root.local}>, expected <xsd:schema>`, {
        file,
        line: root.line,
      });
    }
    const targetUri = root.attrs.get('targetNamespace');
    if (targetUri === undefined) {
      throw new XsdLoadError('<xsd:schema> has no targetNamespace', { file, line: root.line });
    }
    const scope: SchemaScope = {
      file,
      targetNs: this.tokenForUri(targetUri, { file, line: root.line }),
      // Absent means "unqualified" per the XSD spec. Every vendored schema sets
      // elementFormDefault="qualified"; attributeFormDefault varies — wml.xsd,
      // shared-math.xsd and the customXml pair are "qualified", which is why
      // `w:val` is namespace-prefixed in real documents.
      elementFormQualified: root.attrs.get('elementFormDefault') === 'qualified',
      attributeFormQualified: root.attrs.get('attributeFormDefault') === 'qualified',
    };

    for (const child of root.children) {
      if (child.uri !== XSD_NS) continue;
      switch (child.local) {
        case 'annotation':
          break;
        case 'import':
          // Recorded only implicitly: every schema in the set is loaded
          // explicitly by directory scan, so `schemaLocation` is never followed.
          // Not following it is also what keeps the loader from reaching out to
          // the network — opc-coreProperties.xsd points at dublincore.org.
          break;
        case 'include':
        case 'redefine':
          throw new UnsupportedXsdFeature(`xsd:${child.local}`, this.src(child, scope));
        case 'complexType':
          this.declareComplexType(child, scope);
          break;
        case 'simpleType':
          this.declareSimpleType(child, scope, [this.requireAttr(child, 'name', scope)]);
          break;
        case 'element':
          this.declareGlobalElement(child, scope);
          break;
        case 'attribute':
          this.declareGlobalAttribute(child, scope);
          break;
        case 'group':
          this.declareGroup(child, scope);
          break;
        case 'attributeGroup':
          this.declareAttributeGroup(child, scope);
          break;
        default:
          throw new XsdLoadError(
            `Unhandled top-level <xsd:${child.local}>`,
            this.src(child, scope),
          );
      }
    }
  }

  // -- complex types -------------------------------------------------------

  private declareComplexType(node: XsdNode, scope: SchemaScope): void {
    const name = this.requireAttr(node, 'name', scope);
    this.guardRetired(node, scope);
    const qname: QName = { ns: scope.targetNs, name };
    const source = this.src(node, scope);

    if (node.attrs.get('mixed') === 'true') {
      // Not fatal: the one WML-adjacent case is OPC's CT_Keywords. But the IR
      // has no "mixed" flag, so interleaved text would be dropped on write, and
      // that has to be visible.
      this.diagnostics.push({
        severity: 'warning',
        code: 'mixed-content',
        message:
          `${qnameKey(qname)} declares mixed="true"; the IR has no representation for ` +
          `interleaved text, so text between child elements will not round-trip`,
        source,
      });
    }

    const attributes: IrAttributeMember[] = [];
    const content = this.compileComplexBody(node, scope, [name], attributes);
    const definition: IrComplexType = {
      kind: 'complexType',
      name: qname,
      content,
      attributes,
      dialects: [],
      ...optional('doc', documentationOf(node)),
      source,
    };
    this.register(this.tables.complexTypes, qname, definition, source);
  }

  /** Reads a `complexType` body, appending attribute members to `attributes`. */
  private compileComplexBody(
    node: XsdNode,
    scope: SchemaScope,
    path: readonly string[],
    attributes: IrAttributeMember[],
  ): IrContent {
    let content: IrContent = { kind: 'empty' };
    for (const child of schemaChildren(node)) {
      switch (child.local) {
        case 'simpleContent':
          content = this.compileSimpleContent(child, scope, path, attributes);
          break;
        case 'complexContent':
          content = this.compileComplexContent(child, scope, path, attributes);
          break;
        case 'sequence':
        case 'choice':
        case 'all':
        case 'group':
          content = { kind: 'elements', particle: this.compileParticle(child, scope, path) };
          break;
        case 'attribute':
          attributes.push(this.compileAttribute(child, scope, path));
          break;
        case 'attributeGroup':
          attributes.push(this.compileAttributeGroupRef(child, scope));
          break;
        case 'anyAttribute':
          throw new UnsupportedXsdFeature('xsd:anyAttribute', this.src(child, scope));
        default:
          throw new XsdLoadError(
            `Unhandled <xsd:${child.local}> inside <xsd:complexType>`,
            this.src(child, scope),
          );
      }
    }
    return content;
  }

  private compileSimpleContent(
    node: XsdNode,
    scope: SchemaScope,
    path: readonly string[],
    attributes: IrAttributeMember[],
  ): IrContent {
    if (firstChild(node, 'restriction') !== undefined) {
      throw new UnsupportedXsdFeature('xsd:simpleContent/xsd:restriction', this.src(node, scope));
    }
    const extension = firstChild(node, 'extension');
    if (extension === undefined) {
      throw new XsdLoadError('<xsd:simpleContent> has no <xsd:extension>', this.src(node, scope));
    }
    const base = this.resolveTypeRef(
      this.requireAttr(extension, 'base', scope),
      extension,
      scope,
    );
    this.collectAttributeMembers(extension, scope, path, attributes);
    return { kind: 'simpleContent', base };
  }

  private compileComplexContent(
    node: XsdNode,
    scope: SchemaScope,
    path: readonly string[],
    attributes: IrAttributeMember[],
  ): IrContent {
    if (firstChild(node, 'restriction') !== undefined) {
      throw new UnsupportedXsdFeature('xsd:complexContent/xsd:restriction', this.src(node, scope));
    }
    const extension = firstChild(node, 'extension');
    if (extension === undefined) {
      throw new XsdLoadError('<xsd:complexContent> has no <xsd:extension>', this.src(node, scope));
    }
    // Left unresolved on purpose: flattening the base into this type is the
    // normalizer's job, and doing it here would make the loader's output
    // untestable against the XSD text.
    const base = this.resolveQName(this.requireAttr(extension, 'base', scope), extension, scope);

    let particle: IrParticle | undefined;
    for (const child of schemaChildren(extension)) {
      switch (child.local) {
        case 'sequence':
        case 'choice':
        case 'all':
        case 'group':
          particle = this.compileParticle(child, scope, path);
          break;
        case 'attribute':
          attributes.push(this.compileAttribute(child, scope, path));
          break;
        case 'attributeGroup':
          attributes.push(this.compileAttributeGroupRef(child, scope));
          break;
        case 'anyAttribute':
          throw new UnsupportedXsdFeature('xsd:anyAttribute', this.src(child, scope));
        default:
          throw new XsdLoadError(
            `Unhandled <xsd:${child.local}> inside <xsd:extension>`,
            this.src(child, scope),
          );
      }
    }
    return { kind: 'elements', extends: base, particle };
  }

  private collectAttributeMembers(
    node: XsdNode,
    scope: SchemaScope,
    path: readonly string[],
    attributes: IrAttributeMember[],
  ): void {
    for (const child of schemaChildren(node)) {
      switch (child.local) {
        case 'attribute':
          attributes.push(this.compileAttribute(child, scope, path));
          break;
        case 'attributeGroup':
          attributes.push(this.compileAttributeGroupRef(child, scope));
          break;
        case 'anyAttribute':
          throw new UnsupportedXsdFeature('xsd:anyAttribute', this.src(child, scope));
        default:
          throw new XsdLoadError(
            `Unhandled <xsd:${child.local}> where only attributes are allowed`,
            this.src(child, scope),
          );
      }
    }
  }

  // -- particles -----------------------------------------------------------

  private readMin(node: XsdNode, scope: SchemaScope): number {
    const raw = node.attrs.get('minOccurs');
    if (raw === undefined) return 1;
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new XsdLoadError(`Invalid minOccurs="${raw}"`, this.src(node, scope));
    }
    return value;
  }

  private readMax(node: XsdNode, scope: SchemaScope): Occurs {
    const raw = node.attrs.get('maxOccurs');
    if (raw === undefined) return 1;
    if (raw === 'unbounded') return 'unbounded';
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new XsdLoadError(`Invalid maxOccurs="${raw}"`, this.src(node, scope));
    }
    return value;
  }

  private compileParticle(node: XsdNode, scope: SchemaScope, path: readonly string[]): IrParticle {
    const source = this.src(node, scope);
    switch (node.local) {
      case 'sequence':
      case 'choice':
      case 'all':
        return {
          kind: node.local,
          items: schemaChildren(node).map((c) => this.compileParticle(c, scope, path)),
          min: this.readMin(node, scope),
          max: this.readMax(node, scope),
          source,
        };
      case 'group': {
        const ref = node.attrs.get('ref');
        if (ref === undefined) {
          throw new XsdLoadError(
            '<xsd:group> inside a content model must carry ref=',
            source,
          );
        }
        return {
          kind: 'groupRef',
          ref: this.resolveQName(ref, node, scope),
          min: this.readMin(node, scope),
          max: this.readMax(node, scope),
          source,
        };
      }
      case 'element':
        return this.compileElementParticle(node, scope, path);
      case 'any':
        return {
          kind: 'any',
          namespaces: this.compileNsConstraint(node, scope),
          processContents: this.readProcessContents(node, scope),
          min: this.readMin(node, scope),
          max: this.readMax(node, scope),
          source,
        };
      default:
        throw new XsdLoadError(`Unhandled particle <xsd:${node.local}>`, source);
    }
  }

  private readProcessContents(node: XsdNode, scope: SchemaScope): ProcessContents {
    const raw = node.attrs.get('processContents') ?? 'strict';
    if (raw === 'strict' || raw === 'lax' || raw === 'skip') return raw;
    throw new XsdLoadError(`Invalid processContents="${raw}"`, this.src(node, scope));
  }

  private compileNsConstraint(node: XsdNode, scope: SchemaScope): NsConstraint {
    const raw = node.attrs.get('namespace');
    if (raw === undefined || raw.trim() === '##any') return { kind: 'any' };
    const trimmed = raw.trim();
    if (trimmed === '##local') return { kind: 'local' };
    if (trimmed === '##other') return { kind: 'other', excluding: scope.targetNs };
    const source = this.src(node, scope);
    const namespaces = trimmed
      .split(/\s+/)
      .map((item) =>
        item === '##targetNamespace' ? scope.targetNs : this.tokenForUri(item, source),
      );
    return { kind: 'list', namespaces };
  }

  private compileElementParticle(
    node: XsdNode,
    scope: SchemaScope,
    path: readonly string[],
  ): IrElementParticle {
    const source = this.src(node, scope);
    const min = this.readMin(node, scope);
    const max = this.readMax(node, scope);

    const rawRef = node.attrs.get('ref');
    if (rawRef !== undefined) {
      const ref = this.resolveQName(rawRef, node, scope);
      // Placeholder type: overwritten by `resolveReferences` once the global
      // declaration is in the table. If it never resolves, leaving the element's
      // own QName here at least keeps the reference traceable, and a diagnostic
      // says so.
      const slot: MutableElementParticle = {
        kind: 'element',
        name: ref.name,
        ns: ref.ns,
        type: { kind: 'named', ref },
        min,
        max,
        source,
      };
      this.pendingElementRefs.push({ slot, ref, source });
      return slot;
    }

    const name = this.requireAttr(node, 'name', scope);
    this.guardRetired(node, scope);
    const qualified = (node.attrs.get('form') ?? (scope.elementFormQualified ? 'qualified' : 'unqualified')) === 'qualified';
    if (!qualified) {
      throw new XsdLoadError(
        `Local element "${name}" would be namespace-unqualified, which IrElementParticle ` +
          `cannot express (its ns is non-nullable). Every vendored schema sets ` +
          `elementFormDefault="qualified", so this means the schema set changed`,
        source,
      );
    }
    return {
      kind: 'element',
      name,
      ns: scope.targetNs,
      type: this.elementType(node, scope, [...path, name]),
      min,
      max,
      ...optional('default', node.attrs.get('default')),
      ...optional('doc', documentationOf(node)),
      source,
    };
  }

  /** `type=`, or an inline anonymous type, which is registered as a normal definition. */
  private elementType(node: XsdNode, scope: SchemaScope, path: readonly string[]): TypeRef {
    const explicit = node.attrs.get('type');
    if (explicit !== undefined) return this.resolveTypeRef(explicit, node, scope);

    const inlineComplex = firstChild(node, 'complexType');
    if (inlineComplex !== undefined) {
      return { kind: 'named', ref: this.declareAnonymousComplexType(inlineComplex, scope, path) };
    }
    const inlineSimple = firstChild(node, 'simpleType');
    if (inlineSimple !== undefined) {
      return { kind: 'named', ref: this.declareSimpleType(inlineSimple, scope, path) };
    }
    throw new XsdLoadError(
      `<xsd:element name="${path[path.length - 1] ?? '?'}"> has neither type= nor an inline ` +
        `type. XSD would default it to xsd:anyType; no vendored schema does this, and the ` +
        `IR has no anyType, so the loader refuses to guess`,
      this.src(node, scope),
    );
  }

  // -- attributes ----------------------------------------------------------

  private readUse(node: XsdNode, scope: SchemaScope): AttributeUse {
    const raw = node.attrs.get('use') ?? 'optional';
    if (raw === 'optional' || raw === 'required' || raw === 'prohibited') return raw;
    throw new XsdLoadError(`Invalid use="${raw}"`, this.src(node, scope));
  }

  private compileAttribute(
    node: XsdNode,
    scope: SchemaScope,
    path: readonly string[],
  ): IrAttribute {
    const source = this.src(node, scope);
    const use = this.readUse(node, scope);
    const rawRef = node.attrs.get('ref');

    if (rawRef !== undefined) {
      const ref = this.resolveQName(rawRef, node, scope);
      // A referenced attribute is global, so it is always qualified by the
      // namespace that declares it — `xml:space` on `w:t`, `r:id` everywhere.
      const slot: MutableAttribute = {
        kind: 'attribute',
        name: ref.name,
        ns: ref.ns,
        type: { kind: 'named', ref },
        use,
        ...optional('default', node.attrs.get('default')),
        source,
      };
      this.pendingAttributeRefs.push({ slot, ref, source });
      return slot;
    }

    const name = this.requireAttr(node, 'name', scope);
    const qualified =
      (node.attrs.get('form') ?? (scope.attributeFormQualified ? 'qualified' : 'unqualified')) ===
      'qualified';
    return {
      kind: 'attribute',
      name,
      ns: qualified ? scope.targetNs : null,
      type: this.attributeType(node, scope, [...path, name]),
      use,
      // Recorded, never applied at read time: writing back a default the source
      // omitted produces a diff on every save. See the survey.
      ...optional('default', node.attrs.get('default')),
      ...optional('doc', documentationOf(node)),
      source,
    };
  }

  private attributeType(node: XsdNode, scope: SchemaScope, path: readonly string[]): TypeRef {
    const explicit = node.attrs.get('type');
    if (explicit !== undefined) return this.resolveTypeRef(explicit, node, scope);
    const inline = firstChild(node, 'simpleType');
    if (inline !== undefined) {
      return { kind: 'named', ref: this.declareSimpleType(inline, scope, path) };
    }
    throw new XsdLoadError(
      `<xsd:attribute name="${path[path.length - 1] ?? '?'}"> has neither type= nor an inline ` +
        `simpleType; XSD would default it to xsd:anySimpleType, which the IR cannot express`,
      this.src(node, scope),
    );
  }

  private compileAttributeGroupRef(node: XsdNode, scope: SchemaScope): IrAttributeGroupRef {
    const source = this.src(node, scope);
    const ref = node.attrs.get('ref');
    if (ref === undefined) {
      throw new XsdLoadError('<xsd:attributeGroup> inside a type must carry ref=', source);
    }
    return { kind: 'attributeGroupRef', ref: this.resolveQName(ref, node, scope), source };
  }

  // -- simple types --------------------------------------------------------

  /**
   * Registers a simple type and returns its QName.
   *
   * `path` is the enclosing-definition path: `['CT_Foo','bar']` for an inline
   * type on local element `bar` of `CT_Foo`. Named types pass `[name]`.
   */
  private declareSimpleType(node: XsdNode, scope: SchemaScope, path: readonly string[]): QName {
    const declared = node.attrs.get('name');
    const name = declared ?? this.synthesizeAnonymousName(path, scope.targetNs);
    const qname: QName = { ns: scope.targetNs, name };
    const source = this.src(node, scope);
    const doc = documentationOf(node);
    const childPath = declared === undefined ? path : [name];

    const restriction = firstChild(node, 'restriction');
    const union = firstChild(node, 'union');
    const list = firstChild(node, 'list');

    let definition: IrSimpleType;
    if (restriction !== undefined) {
      definition = this.compileRestriction(restriction, scope, qname, doc, source);
    } else if (union !== undefined) {
      definition = this.compileUnion(union, scope, qname, childPath, doc, source);
    } else if (list !== undefined) {
      definition = this.compileList(list, scope, qname, childPath, doc, source);
    } else {
      throw new XsdLoadError(
        `<xsd:simpleType> "${name}" has no restriction, union or list`,
        source,
      );
    }

    this.register(this.tables.simpleTypes, qname, definition, source);
    return qname;
  }

  private compileRestriction(
    node: XsdNode,
    scope: SchemaScope,
    name: QName,
    doc: string | undefined,
    source: SourceRef,
  ): IrSimpleType {
    const base = this.resolveTypeRef(this.requireAttr(node, 'base', scope), node, scope);
    const values: EnumValue[] = [];
    const facets: MutableFacets = {};
    const facetNames: string[] = [];

    for (const facet of schemaChildren(node)) {
      const facetSource = this.src(facet, scope);
      switch (facet.local) {
        case 'enumeration':
          values.push({
            value: this.requireAttr(facet, 'value', scope),
            ...optional('doc', documentationOf(facet)),
            source: facetSource,
          });
          break;
        case 'minInclusive':
          facets.minInclusive = this.requireAttr(facet, 'value', scope);
          facetNames.push(facet.local);
          break;
        case 'maxInclusive':
          facets.maxInclusive = this.requireAttr(facet, 'value', scope);
          facetNames.push(facet.local);
          break;
        case 'minExclusive':
          facets.minExclusive = this.requireAttr(facet, 'value', scope);
          facetNames.push(facet.local);
          break;
        case 'maxExclusive':
          facets.maxExclusive = this.requireAttr(facet, 'value', scope);
          facetNames.push(facet.local);
          break;
        case 'pattern':
          // XSD regex dialect, not ECMAScript. Translated at emit, not here.
          facets.pattern = this.requireAttr(facet, 'value', scope);
          facetNames.push(facet.local);
          break;
        case 'length':
          facets.length = this.readNumericFacet(facet, scope);
          facetNames.push(facet.local);
          break;
        case 'minLength':
          facets.minLength = this.readNumericFacet(facet, scope);
          facetNames.push(facet.local);
          break;
        case 'maxLength':
          facets.maxLength = this.readNumericFacet(facet, scope);
          facetNames.push(facet.local);
          break;
        case 'simpleType':
          throw new XsdLoadError(
            '<xsd:restriction> with an inline base simpleType is not used by any vendored ' +
              'schema; base= is expected',
            facetSource,
          );
        default:
          throw new XsdLoadError(`Unhandled facet <xsd:${facet.local}>`, facetSource);
      }
    }

    if (values.length > 0) {
      if (facetNames.length > 0) {
        this.diagnostics.push({
          severity: 'warning',
          code: 'enum-with-facets',
          message:
            `${qnameKey(name)} mixes xsd:enumeration with ${facetNames.join(', ')}; the enum ` +
            `variant of IrSimpleType has no facets field, so those constraints are dropped`,
          source,
        });
      }
      return {
        kind: 'enum',
        name,
        base,
        values,
        dialects: [],
        ...optional('doc', doc),
        source,
      };
    }
    return {
      kind: 'restriction',
      name,
      base,
      facets,
      dialects: [],
      ...optional('doc', doc),
      source,
    };
  }

  private readNumericFacet(node: XsdNode, scope: SchemaScope): number {
    const raw = this.requireAttr(node, 'value', scope);
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new XsdLoadError(`Invalid ${node.local} value="${raw}"`, this.src(node, scope));
    }
    return value;
  }

  private compileUnion(
    node: XsdNode,
    scope: SchemaScope,
    name: QName,
    path: readonly string[],
    doc: string | undefined,
    source: SourceRef,
  ): IrSimpleType {
    const members: TypeRef[] = [];
    const memberTypes = node.attrs.get('memberTypes');
    if (memberTypes !== undefined && memberTypes.trim() !== '') {
      for (const member of memberTypes.trim().split(/\s+/)) {
        members.push(this.resolveTypeRef(member, node, scope));
      }
    }
    // Inline members are registered one at a time so that the collision counter
    // in `synthesizeAnonymousName` sees the previous one — that is what makes
    // `ST_TextRotation_Anon` / `ST_TextRotation_Anon2` stable.
    for (const child of schemaChildren(node)) {
      if (child.local !== 'simpleType') {
        throw new XsdLoadError(`Unhandled <xsd:${child.local}> inside <xsd:union>`, this.src(child, scope));
      }
      members.push({ kind: 'named', ref: this.declareSimpleType(child, scope, path) });
    }
    if (members.length === 0) {
      throw new XsdLoadError('<xsd:union> has no members', source);
    }
    return { kind: 'union', name, members, dialects: [], ...optional('doc', doc), source };
  }

  private compileList(
    node: XsdNode,
    scope: SchemaScope,
    name: QName,
    path: readonly string[],
    doc: string | undefined,
    source: SourceRef,
  ): IrSimpleType {
    const itemType = node.attrs.get('itemType');
    if (itemType !== undefined) {
      return {
        kind: 'list',
        name,
        item: this.resolveTypeRef(itemType, node, scope),
        dialects: [],
        ...optional('doc', doc),
        source,
      };
    }
    const inline = firstChild(node, 'simpleType');
    if (inline === undefined) {
      throw new XsdLoadError('<xsd:list> has neither itemType= nor an inline simpleType', source);
    }
    return {
      kind: 'list',
      name,
      item: { kind: 'named', ref: this.declareSimpleType(inline, scope, path) },
      dialects: [],
      ...optional('doc', doc),
      source,
    };
  }

  private declareAnonymousComplexType(
    node: XsdNode,
    scope: SchemaScope,
    path: readonly string[],
  ): QName {
    const name = this.synthesizeAnonymousName(path, scope.targetNs);
    const qname: QName = { ns: scope.targetNs, name };
    const source = this.src(node, scope);
    const attributes: IrAttributeMember[] = [];
    const content = this.compileComplexBody(node, scope, [name], attributes);
    const definition: IrComplexType = {
      kind: 'complexType',
      name: qname,
      content,
      attributes,
      dialects: [],
      ...optional('doc', documentationOf(node)),
      source,
    };
    this.register(this.tables.complexTypes, qname, definition, source);
    return qname;
  }

  /**
   * Names an inline anonymous type after the path that reaches it —
   * `CT_Foo` + local element `bar` gives `CT_Foo_bar_Anon`.
   *
   * Determinism is the whole requirement: generated file content is compared
   * byte-for-byte in CI, so a name that depends on iteration order or on a
   * counter shared across namespaces would make the build flap. Both dialects
   * walk structurally identical documents in the same sorted file order, so both
   * arrive at the same names and the definitions merge instead of colliding.
   */
  private synthesizeAnonymousName(path: readonly string[], ns: LogicalNs): string {
    const base = `${path.join('_')}_Anon`;
    let candidate = base;
    let counter = 2;
    while (this.isNameTaken(ns, candidate)) {
      candidate = `${base}${counter}`;
      counter += 1;
    }
    return candidate;
  }

  private isNameTaken(ns: LogicalNs, name: string): boolean {
    const key = qnameKey({ ns, name });
    return this.tables.simpleTypes.has(key) || this.tables.complexTypes.has(key);
  }

  // -- other top-level declarations ---------------------------------------

  private declareGlobalElement(node: XsdNode, scope: SchemaScope): void {
    const name = this.requireAttr(node, 'name', scope);
    this.guardRetired(node, scope);
    const qname: QName = { ns: scope.targetNs, name };
    const source = this.src(node, scope);
    const definition: IrGlobalElement = {
      kind: 'globalElement',
      name: qname,
      type: this.elementType(node, scope, [name]),
      dialects: [],
      ...optional('doc', documentationOf(node)),
      source,
    };
    this.register(this.tables.globalElements, qname, definition, source);
  }

  private declareGlobalAttribute(node: XsdNode, scope: SchemaScope): void {
    const name = this.requireAttr(node, 'name', scope);
    const qname: QName = { ns: scope.targetNs, name };
    const source = this.src(node, scope);
    const key = qnameKey(qname);
    if (this.tables.globalAttributes.has(key)) return;
    this.tables.globalAttributes.set(key, {
      name: qname,
      type: this.attributeType(node, scope, [name]),
      ...optional('default', node.attrs.get('default')),
      source,
    });
  }

  private declareGroup(node: XsdNode, scope: SchemaScope): void {
    const name = this.requireAttr(node, 'name', scope);
    const qname: QName = { ns: scope.targetNs, name };
    const source = this.src(node, scope);
    const body = schemaChildren(node)[0];
    if (body === undefined) {
      throw new XsdLoadError(`<xsd:group name="${name}"> has no content model`, source);
    }
    this.register(
      this.tables.groups,
      qname,
      {
        kind: 'group',
        name: qname,
        particle: this.compileParticle(body, scope, [name]),
        dialects: [],
        source,
      } satisfies IrGroup,
      source,
    );
  }

  private declareAttributeGroup(node: XsdNode, scope: SchemaScope): void {
    const name = this.requireAttr(node, 'name', scope);
    const qname: QName = { ns: scope.targetNs, name };
    const source = this.src(node, scope);
    const attributes: IrAttributeMember[] = [];
    this.collectAttributeMembers(node, scope, [name], attributes);
    this.register(
      this.tables.attributeGroups,
      qname,
      {
        kind: 'attributeGroup',
        name: qname,
        attributes,
        dialects: [],
        source,
      } satisfies IrAttributeGroup,
      source,
    );
  }

  // -- reference resolution ------------------------------------------------

  /**
   * Fills in the types of `ref=` element and attribute particles.
   *
   * `scopes` is searched in order; a dialect passes its own table first and the
   * dialect-independent OPC table second. Unresolvable references are real and
   * expected — `opc-coreProperties.xsd` refers to `dc:creator` and `xml:lang`,
   * whose schemas are not part of the ECMA distribution — so they downgrade to a
   * diagnostic rather than failing the load.
   */
  resolveReferences(scopes: readonly SymbolTable[]): void {
    for (const pending of this.pendingElementRefs) {
      const key = qnameKey(pending.ref);
      const target = scopes.reduce<IrGlobalElement | undefined>(
        (found, table) => found ?? table.globalElements.get(key),
        undefined,
      );
      if (target === undefined) {
        this.diagnostics.push({
          severity: 'warning',
          code: 'unresolved-element-ref',
          message:
            `${this.label}: <xsd:element ref="${key}"> has no global declaration in the ` +
            `vendored schema set, so its type is left as an unresolved named reference`,
          source: pending.source,
        });
        continue;
      }
      pending.slot.type = target.type;
      if (pending.slot.doc === undefined && target.doc !== undefined) {
        pending.slot.doc = target.doc;
      }
    }

    for (const pending of this.pendingAttributeRefs) {
      const key = qnameKey(pending.ref);
      const target = scopes.reduce<GlobalAttributeDecl | undefined>(
        (found, table) => found ?? table.globalAttributes.get(key),
        undefined,
      );
      if (target === undefined) {
        this.diagnostics.push({
          severity: 'warning',
          code: 'unresolved-attribute-ref',
          message:
            `${this.label}: <xsd:attribute ref="${key}"> has no global declaration in the ` +
            `vendored schema set, so its type is left as an unresolved named reference`,
          source: pending.source,
        });
        continue;
      }
      pending.slot.type = target.type;
      if (pending.slot.default === undefined && target.default !== undefined) {
        pending.slot.default = target.default;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Structural comparison
// ---------------------------------------------------------------------------

type StructuralValue =
  | string
  | number
  | boolean
  | null
  | readonly StructuralValue[]
  | { readonly [key: string]: StructuralValue };

function viewQName(q: QName): string {
  return qnameKey(q);
}

function viewType(t: TypeRef): string {
  return t.kind === 'builtin' ? t.name : qnameKey(t.ref);
}

function viewParticle(p: IrParticle): StructuralValue {
  switch (p.kind) {
    case 'element':
      return {
        kind: p.kind,
        name: p.name,
        ns: p.ns,
        type: viewType(p.type),
        min: p.min,
        max: p.max,
        default: p.default ?? null,
      };
    case 'any':
      return {
        kind: p.kind,
        namespaces:
          p.namespaces.kind === 'other'
            ? `other:${p.namespaces.excluding}`
            : p.namespaces.kind === 'list'
              ? `list:${[...p.namespaces.namespaces].join(',')}`
              : p.namespaces.kind,
        processContents: p.processContents,
        min: p.min,
        max: p.max,
      };
    case 'groupRef':
      return { kind: p.kind, ref: viewQName(p.ref), min: p.min, max: p.max };
    case 'sequence':
    case 'choice':
    case 'all':
      return { kind: p.kind, min: p.min, max: p.max, items: p.items.map(viewParticle) };
  }
}

function viewAttributeMember(a: IrAttributeMember): StructuralValue {
  return a.kind === 'attributeGroupRef'
    ? { kind: a.kind, ref: viewQName(a.ref) }
    : {
        kind: a.kind,
        name: a.name,
        ns: a.ns,
        type: viewType(a.type),
        use: a.use,
        default: a.default ?? null,
      };
}

function viewContent(c: IrContent): StructuralValue {
  switch (c.kind) {
    case 'empty':
      return { kind: c.kind };
    case 'simpleContent':
      return { kind: c.kind, base: viewType(c.base) };
    case 'elements':
      return {
        kind: c.kind,
        extends: c.extends === undefined ? null : viewQName(c.extends),
        particle: c.particle === undefined ? null : viewParticle(c.particle),
      };
  }
}

/**
 * Projects a definition onto only the parts that must agree between dialects.
 *
 * `source` and `doc` are excluded by construction: the two dialects are
 * different files, so line numbers always differ, and neither carries
 * documentation in this asset set anyway. Namespace *tokens* survive the
 * projection, which is exactly the point — Transitional `w:` and Strict `w:`
 * both become `wml`, so anything still different is a real structural
 * divergence rather than the expected URI substitution.
 */
export function structuralView(def: IrDefinition): StructuralValue {
  switch (def.kind) {
    case 'complexType':
      return {
        kind: def.kind,
        content: viewContent(def.content),
        attributes: def.attributes.map(viewAttributeMember),
      };
    case 'enum':
      return { kind: def.kind, base: viewType(def.base), values: def.values.map((v) => v.value) };
    case 'restriction':
      return { kind: def.kind, base: viewType(def.base), facets: { ...def.facets } };
    case 'union':
      return { kind: def.kind, members: def.members.map(viewType) };
    case 'list':
      return { kind: def.kind, item: viewType(def.item) };
    case 'globalElement':
      return { kind: def.kind, type: viewType(def.type) };
    case 'group':
      return { kind: def.kind, particle: viewParticle(def.particle) };
    case 'attributeGroup':
      return { kind: def.kind, attributes: def.attributes.map(viewAttributeMember) };
  }
}

const MAX_DIFFS_PER_DEFINITION = 8;

function isStructuralObject(
  value: StructuralValue,
): value is { readonly [key: string]: StructuralValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: StructuralValue): string {
  if (isStructuralObject(value) && typeof value['kind'] === 'string') {
    const named = value['name'] ?? value['ref'] ?? value['type'];
    return typeof named === 'string' ? `${value['kind']} "${named}"` : `<${value['kind']}>`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Walks two structural views and reports, in prose, every place they differ.
 *
 * The output is read by a human deciding whether ADR 0008 still holds, so paths
 * are spelled out (`content.particle.items[3].name`) and values are quoted
 * rather than diffed as JSON blobs.
 */
function diffStructural(
  a: StructuralValue,
  b: StructuralValue,
  path: string,
  out: string[],
): void {
  if (out.length >= MAX_DIFFS_PER_DEFINITION) return;
  const where = path === '' ? 'value' : path;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(`${where}: transitional=${describe(a)} strict=${describe(b)}`);
      return;
    }
    if (a.length !== b.length) {
      out.push(`${where}: transitional has ${a.length}, strict has ${b.length}`);
      const onlyIn = a.length > b.length ? a.slice(b.length) : b.slice(a.length);
      const side = a.length > b.length ? 'transitional' : 'strict';
      out.push(
        `${where}: ${side}-only ${onlyIn
          .slice(0, 4)
          .map(describe)
          .join(', ')}${onlyIn.length > 4 ? `, +${onlyIn.length - 4} more` : ''}`,
      );
    }
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i += 1) {
      const left = a[i];
      const right = b[i];
      if (left !== undefined && right !== undefined) {
        diffStructural(left, right, `${where}[${i}]`, out);
      }
    }
    return;
  }

  if (isStructuralObject(a) && isStructuralObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      const left = a[key];
      const right = b[key];
      const childPath = where === 'value' ? key : `${where}.${key}`;
      if (left === undefined && right !== undefined) {
        out.push(`${childPath}: strict-only (${describe(right)})`);
      } else if (right === undefined && left !== undefined) {
        out.push(`${childPath}: transitional-only (${describe(left)})`);
      } else if (left !== undefined && right !== undefined) {
        diffStructural(left, right, childPath, out);
      }
      if (out.length >= MAX_DIFFS_PER_DEFINITION) return;
    }
    return;
  }

  if (a !== b) {
    out.push(`${where}: transitional=${JSON.stringify(a)} strict=${JSON.stringify(b)}`);
  }
}

/**
 * Structural differences between two definitions of the same logical name,
 * ignoring `source` and `doc`. Empty means the two are safe to merge.
 */
export function compareDefinitions(a: IrDefinition, b: IrDefinition): readonly string[] {
  const out: string[] = [];
  diffStructural(structuralView(a), structuralView(b), '', out);
  return out;
}

// ---------------------------------------------------------------------------
// Dialect merge
// ---------------------------------------------------------------------------

const DIALECT_ORDER: readonly Dialect[] = ['transitional', 'strict'];

/** Canonical, de-duplicated, Transitional-first. Transitional is the primary target. */
function canonicalDialects(requested: readonly Dialect[]): readonly Dialect[] {
  return DIALECT_ORDER.filter((d) => requested.includes(d));
}

/**
 * `dialects` cannot be filled in at parse time — it is a property of the merged
 * set, not of any one file — so each definition is rebuilt with its final value.
 * Written out per kind rather than as a generic spread because spreading a
 * discriminated union (`IrSimpleType`) loses the discriminant.
 */
function withDialects<T extends IrDefinition>(def: T, dialects: readonly Dialect[]): T;
function withDialects(def: IrDefinition, dialects: readonly Dialect[]): IrDefinition {
  switch (def.kind) {
    case 'complexType':
      return { ...def, dialects };
    case 'enum':
      return { ...def, dialects };
    case 'restriction':
      return { ...def, dialects };
    case 'union':
      return { ...def, dialects };
    case 'list':
      return { ...def, dialects };
    case 'globalElement':
      return { ...def, dialects };
    case 'group':
      return { ...def, dialects };
    case 'attributeGroup':
      return { ...def, dialects };
  }
}

const KIND_LABELS: Readonly<Record<IrDefinition['kind'], string>> = {
  complexType: 'complexType',
  enum: 'simpleType (enum)',
  restriction: 'simpleType (restriction)',
  union: 'simpleType (union)',
  list: 'simpleType (list)',
  globalElement: 'element',
  group: 'group',
  attributeGroup: 'attributeGroup',
};

interface MergeInput<T extends IrDefinition> {
  readonly dialectTables: ReadonlyArray<readonly [Dialect, ReadonlyMap<string, T>]>;
  readonly shared: ReadonlyMap<string, T>;
  readonly sharedDialects: readonly Dialect[];
  readonly diagnostics: Diagnostic[];
  readonly reportDialectOnly: boolean;
}

/**
 * Folds the per-dialect tables for one kind into a single map.
 *
 * Transitional is processed first and wins every tie, per ADR 0008: it is what
 * Word actually writes, so when the two sets disagree the Transitional shape is
 * the one that has to be right. Disagreement is never silent — it produces a
 * `dialect-divergence` warning naming the exact field.
 */
function mergeKind<T extends IrDefinition>(input: MergeInput<T>): Map<string, T> {
  const merged = new Map<string, T>();
  const dialectsByKey = new Map<string, Dialect[]>();

  for (const [dialect, table] of input.dialectTables) {
    for (const [key, definition] of table) {
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, definition);
        dialectsByKey.set(key, [dialect]);
        continue;
      }
      dialectsByKey.get(key)?.push(dialect);
      const differences = compareDefinitions(existing, definition);
      if (differences.length > 0) {
        input.diagnostics.push({
          severity: 'warning',
          code: 'dialect-divergence',
          message:
            `${KIND_LABELS[existing.kind]} ${key} differs between Transitional ` +
            `(${existing.source.file}:${existing.source.line}) and Strict ` +
            `(${definition.source.file}:${definition.source.line}): ${differences.join('; ')}` +
            `${differences.length >= MAX_DIFFS_PER_DEFINITION ? ' …' : ''}. ` +
            `Keeping the Transitional definition.`,
          source: existing.source,
        });
      }
    }
  }

  const out = new Map<string, T>();
  for (const [key, definition] of merged) {
    const dialects = dialectsByKey.get(key) ?? [];
    if (input.reportDialectOnly && dialects.length === 1) {
      const only = dialects[0];
      // Being Transitional-only is expected, not notable, for namespaces that
      // have no Strict URI at all — VML and its companions. Reporting those
      // would bury the interesting cases under ~250 entries of noise.
      if (only !== undefined && !TRANSITIONAL_ONLY.has(definition.name.ns)) {
        input.diagnostics.push({
          severity: 'info',
          code: 'dialect-only',
          message: `${KIND_LABELS[definition.kind]} ${key} exists only in ${only}`,
          source: definition.source,
        });
      }
    }
    out.set(key, withDialects(definition, dialects));
  }

  // The OPC package schemas are one set shared by both dialects, so they are
  // merged in wholesale rather than compared.
  for (const [key, definition] of input.shared) {
    if (!out.has(key)) out.set(key, withDialects(definition, input.sharedDialects));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface LoadSchemaSetOptions {
  /** Directory holding `transitional/`, `strict/` and `opc/`, i.e. `assets/schema`. */
  readonly assetsDir: string;
  /** Defaults to both. Loading one still produces single-entry `dialects` arrays. */
  readonly dialects?: readonly Dialect[];
}

/**
 * Reads every vendored XSD and returns the unified IR.
 *
 * The OPC package schemas (`[Content_Types].xml`, `.rels`, core properties,
 * digital signatures) are dialect-independent — the package layer is byte-identical
 * in both editions — so they are read once and marked as belonging to whichever
 * dialects were requested.
 */
export async function loadSchemaSet(opts: LoadSchemaSetOptions): Promise<IrSchemaSet> {
  const dialects = canonicalDialects(opts.dialects ?? DIALECT_ORDER);
  if (dialects.length === 0) {
    throw new Error('loadSchemaSet: at least one of "transitional" or "strict" is required');
  }
  const diagnostics: Diagnostic[] = [];

  const opc = new SchemaCompiler('opc', diagnostics);
  await opc.loadDirectory(opts.assetsDir, 'opc');

  const compilers: Array<readonly [Dialect, SchemaCompiler]> = [];
  for (const dialect of dialects) {
    const compiler = new SchemaCompiler(dialect, diagnostics);
    await compiler.loadDirectory(opts.assetsDir, dialect);
    compilers.push([dialect, compiler]);
  }

  // Resolution happens per dialect: a Transitional `ref=` must find the
  // Transitional declaration, never the Strict one, even though both land on the
  // same logical key.
  opc.resolveReferences([opc.tables]);
  for (const [, compiler] of compilers) {
    compiler.resolveReferences([compiler.tables, opc.tables]);
  }

  const reportDialectOnly = dialects.length > 1;
  const shared = opc.tables;
  const merge = <T extends IrDefinition>(
    pick: (t: SymbolTable) => ReadonlyMap<string, T>,
  ): Map<string, T> =>
    mergeKind<T>({
      dialectTables: compilers.map(([d, c]) => [d, pick(c.tables)] as const),
      shared: pick(shared),
      sharedDialects: dialects,
      diagnostics,
      reportDialectOnly,
    });

  return {
    namespaces: NS_BY_TOKEN,
    uriToToken: NS_BY_URI,
    complexTypes: merge((t) => t.complexTypes),
    simpleTypes: merge((t) => t.simpleTypes),
    globalElements: merge((t) => t.globalElements),
    groups: merge((t) => t.groups),
    attributeGroups: merge((t) => t.attributeGroups),
    diagnostics,
  };
}
