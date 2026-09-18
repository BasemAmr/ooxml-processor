/**
 * The intermediate representation of a loaded XSD set.
 *
 * This is a *faithful* model of the schema documents — one IR node per XSD
 * construct, references unresolved, groups un-expanded. Normalization (group
 * expansion, extension resolution, particle flattening, dialect unification)
 * happens in `normalize.ts` and produces the separate, emit-ready `model.ts`
 * shapes.
 *
 * Keeping those two apart matters: the loader can be tested against the real
 * schemas without any normalization decisions baked in, and normalization can
 * be tested against hand-written IR fixtures without parsing XML.
 *
 * Scope is deliberately narrow. `docs/xsd-feature-survey.md` measures which XSD
 * features the 51 vendored schemas actually use; constructs that do not appear
 * (`xsd:include`, `xsd:redefine`, `substitutionGroup`, `nillable`, abstract
 * types, complex-content `restriction`) have no representation here at all. The
 * loader raises `UnsupportedXsdFeature` if it meets one, so a schema revision
 * that introduces one fails the build instead of being silently dropped.
 */

/** Which of the two parallel ECMA-376 schema sets a definition came from. */
export type Dialect = 'transitional' | 'strict';

/**
 * A dialect-independent namespace token, e.g. `'wml'`, `'dml-main'`, `'vml'`.
 *
 * Transitional and Strict use different namespace URIs for structurally
 * identical content. The IR keys everything on this token so that a single
 * emitted type serves both; `NamespaceTable` maps token × dialect → URI.
 * See `docs/adr/0008-dialect-handling.md`.
 */
export type LogicalNs = string;

/** A name resolved into the logical namespace space. */
export interface QName {
  readonly ns: LogicalNs;
  readonly name: string;
}

/** Built-in XML Schema types we accept. Anything else is an error, not an `any`. */
export type BuiltinType =
  | 'xsd:string'
  | 'xsd:boolean'
  | 'xsd:int'
  | 'xsd:integer'
  | 'xsd:long'
  | 'xsd:unsignedInt'
  | 'xsd:unsignedLong'
  | 'xsd:unsignedShort'
  | 'xsd:byte'
  | 'xsd:unsignedByte'
  | 'xsd:double'
  | 'xsd:float'
  | 'xsd:decimal'
  | 'xsd:dateTime'
  | 'xsd:date'
  | 'xsd:time'
  | 'xsd:duration'
  | 'xsd:base64Binary'
  | 'xsd:hexBinary'
  | 'xsd:anyURI'
  | 'xsd:token'
  | 'xsd:NCName'
  | 'xsd:ID'
  | 'xsd:IDREF'
  | 'xsd:NMTOKEN'
  | 'xsd:language'
  | 'xsd:positiveInteger'
  | 'xsd:nonNegativeInteger';

/** A reference to either a schema-defined type or an XSD built-in. */
export type TypeRef =
  | { readonly kind: 'named'; readonly ref: QName }
  | { readonly kind: 'builtin'; readonly name: BuiltinType };

/** Source location, kept on every definition so diagnostics can point at the XSD. */
export interface SourceRef {
  /** Path relative to `assets/schema/`, e.g. `transitional/wml.xsd`. */
  readonly file: string;
  readonly line: number;
}

/** `maxOccurs`. Unbounded is its own value rather than `Infinity` so it survives JSON. */
export type Occurs = number | 'unbounded';

// ---------------------------------------------------------------------------
// Simple types
// ---------------------------------------------------------------------------

/** Facets on a simple-type restriction. Only the facets the schemas use appear. */
export interface Facets {
  readonly minInclusive?: string;
  readonly maxInclusive?: string;
  readonly minExclusive?: string;
  readonly maxExclusive?: string;
  readonly length?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  /** XSD regex dialect — *not* ECMAScript. Translated during emit, not here. */
  readonly pattern?: string;
}

export interface EnumValue {
  readonly value: string;
  readonly doc?: string;
  readonly source: SourceRef;
}

export type IrSimpleType =
  /** `xsd:restriction` whose facets are only `xsd:enumeration`. Emits a string-literal union. */
  | {
      readonly kind: 'enum';
      readonly name: QName;
      readonly base: TypeRef;
      readonly values: readonly EnumValue[];
      readonly dialects: readonly Dialect[];
      readonly doc?: string;
      readonly source: SourceRef;
    }
  /** `xsd:restriction` with value/length/pattern facets. Emits a branded primitive. */
  | {
      readonly kind: 'restriction';
      readonly name: QName;
      readonly base: TypeRef;
      readonly facets: Facets;
      readonly dialects: readonly Dialect[];
      readonly doc?: string;
      readonly source: SourceRef;
    }
  /** `xsd:union`. Emits a TS union plus a discriminating parse function. */
  | {
      readonly kind: 'union';
      readonly name: QName;
      readonly members: readonly TypeRef[];
      readonly dialects: readonly Dialect[];
      readonly doc?: string;
      readonly source: SourceRef;
    }
  /** `xsd:list`. Whitespace-separated items, e.g. `ST_Panose`. */
  | {
      readonly kind: 'list';
      readonly name: QName;
      readonly item: TypeRef;
      readonly dialects: readonly Dialect[];
      readonly doc?: string;
      readonly source: SourceRef;
    };

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

/** `xsd:any` namespace constraint, in the XSD spelling. */
export type NsConstraint =
  | { readonly kind: 'any' }
  | { readonly kind: 'local' }
  | { readonly kind: 'other'; readonly excluding: LogicalNs }
  | { readonly kind: 'list'; readonly namespaces: readonly LogicalNs[] };

export type ProcessContents = 'strict' | 'lax' | 'skip';

export interface IrElementParticle {
  readonly kind: 'element';
  /** Local name. Elements are always namespace-qualified in these schemas. */
  readonly name: string;
  readonly ns: LogicalNs;
  readonly type: TypeRef;
  readonly min: number;
  readonly max: Occurs;
  /**
   * Schema-declared default. Recorded but NOT applied at read time — see
   * `docs/xsd-feature-survey.md` on attribute defaults as a round-trip hazard.
   */
  readonly default?: string;
  readonly doc?: string;
  readonly source: SourceRef;
}

export interface IrAnyParticle {
  readonly kind: 'any';
  readonly namespaces: NsConstraint;
  readonly processContents: ProcessContents;
  readonly min: number;
  readonly max: Occurs;
  readonly source: SourceRef;
}

/** `xsd:group ref="..."`. Expanded during normalization, preserved here. */
export interface IrGroupRefParticle {
  readonly kind: 'groupRef';
  readonly ref: QName;
  readonly min: number;
  readonly max: Occurs;
  readonly source: SourceRef;
}

export interface IrCompositor {
  readonly kind: 'sequence' | 'choice' | 'all';
  readonly items: readonly IrParticle[];
  readonly min: number;
  readonly max: Occurs;
  readonly source: SourceRef;
}

export type IrParticle = IrElementParticle | IrAnyParticle | IrGroupRefParticle | IrCompositor;

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export type AttributeUse = 'optional' | 'required' | 'prohibited';

export interface IrAttribute {
  readonly kind: 'attribute';
  readonly name: string;
  /**
   * `null` for unqualified attributes, which is the overwhelming majority.
   * Non-null only where `form="qualified"` or the attribute is imported from
   * another namespace (`xml:space`, and 6 VML attributes — see the survey).
   */
  readonly ns: LogicalNs | null;
  readonly type: TypeRef;
  readonly use: AttributeUse;
  /** Schema default. Recorded, never applied at read time. */
  readonly default?: string;
  readonly doc?: string;
  readonly source: SourceRef;
}

/** `xsd:attributeGroup ref="..."`. Expanded during normalization. */
export interface IrAttributeGroupRef {
  readonly kind: 'attributeGroupRef';
  readonly ref: QName;
  readonly source: SourceRef;
}

export type IrAttributeMember = IrAttribute | IrAttributeGroupRef;

// ---------------------------------------------------------------------------
// Complex types
// ---------------------------------------------------------------------------

/**
 * A complex type's content model.
 *
 * There is no `restriction` variant: the survey measured zero complex-content
 * and zero simple-content restrictions across all 51 schemas. The loader errors
 * on one rather than guessing.
 */
export type IrContent =
  /** No child elements. Attributes only. */
  | { readonly kind: 'empty' }
  /**
   * `xsd:simpleContent` + `xsd:extension` — text content plus attributes.
   * This is how `CT_Text` (`w:t`) and every `ST_*`-valued element works.
   */
  | { readonly kind: 'simpleContent'; readonly base: TypeRef }
  /** Child elements, optionally extending another complex type. */
  | {
      readonly kind: 'elements';
      /** `xsd:complexContent` + `xsd:extension` base, if any. */
      readonly extends?: QName;
      readonly particle: IrParticle | undefined;
    };

export interface IrComplexType {
  readonly kind: 'complexType';
  readonly name: QName;
  readonly content: IrContent;
  readonly attributes: readonly IrAttributeMember[];
  /**
   * Which dialects define this type. A single-entry array means the type is
   * dialect-specific — VML hosts and some `CT_Compat` members are
   * Transitional-only, and the writer must refuse to emit them into a Strict
   * package. See `docs/adr/0008-dialect-handling.md`.
   */
  readonly dialects: readonly Dialect[];
  readonly doc?: string;
  readonly source: SourceRef;
}

// ---------------------------------------------------------------------------
// Top-level declarations
// ---------------------------------------------------------------------------

/** A global `xsd:element` — a legal document root or a `ref=` target. */
export interface IrGlobalElement {
  readonly kind: 'globalElement';
  readonly name: QName;
  readonly type: TypeRef;
  readonly dialects: readonly Dialect[];
  readonly doc?: string;
  readonly source: SourceRef;
}

export interface IrGroup {
  readonly kind: 'group';
  readonly name: QName;
  readonly particle: IrParticle;
  readonly dialects: readonly Dialect[];
  readonly source: SourceRef;
}

export interface IrAttributeGroup {
  readonly kind: 'attributeGroup';
  readonly name: QName;
  readonly attributes: readonly IrAttributeMember[];
  readonly dialects: readonly Dialect[];
  readonly source: SourceRef;
}

export type IrDefinition =
  IrComplexType | IrSimpleType | IrGlobalElement | IrGroup | IrAttributeGroup;

// ---------------------------------------------------------------------------
// The loaded schema set
// ---------------------------------------------------------------------------

/** One namespace token and its per-dialect URIs. */
export interface NamespaceBinding {
  readonly token: LogicalNs;
  /** Conventional prefix, e.g. `w`, `a`, `r`, `wp`. Used when writing. */
  readonly prefix: string;
  readonly transitional?: string;
  readonly strict?: string;
}

/**
 * Everything the loader produces. Definition maps are keyed by
 * `` `${ns}#${name}` `` — see `qnameKey`.
 */
export interface IrSchemaSet {
  readonly namespaces: ReadonlyMap<LogicalNs, NamespaceBinding>;
  /** URI → token, for both dialects. The reader's namespace lookup table. */
  readonly uriToToken: ReadonlyMap<string, LogicalNs>;
  readonly complexTypes: ReadonlyMap<string, IrComplexType>;
  readonly simpleTypes: ReadonlyMap<string, IrSimpleType>;
  readonly globalElements: ReadonlyMap<string, IrGlobalElement>;
  readonly groups: ReadonlyMap<string, IrGroup>;
  readonly attributeGroups: ReadonlyMap<string, IrAttributeGroup>;
  /** Non-fatal observations: dialect-only types, unusual constructs, etc. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface Diagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly source?: SourceRef;
}

export function qnameKey(q: QName): string {
  return `${q.ns}#${q.name}`;
}

/** Thrown when a schema uses a construct the survey says is unused. */
export class UnsupportedXsdFeature extends Error {
  constructor(
    readonly feature: string,
    readonly source: SourceRef,
  ) {
    super(
      `Unsupported XSD feature "${feature}" at ${source.file}:${source.line}. ` +
        `docs/xsd-feature-survey.md records this construct as unused across all 51 ` +
        `vendored schemas, so the generator does not implement it. If the schema set ` +
        `changed, implement it deliberately and update the survey.`,
    );
    this.name = 'UnsupportedXsdFeature';
  }
}
