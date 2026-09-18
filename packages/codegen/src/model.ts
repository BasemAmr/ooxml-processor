/**
 * The normalized, emit-ready model.
 *
 * `ir.ts` is a faithful transcription of the XSD documents. This is what the
 * emitters actually consume: groups expanded, extension chains resolved,
 * particle trees flattened into a flat ordered list of *slots*, and dialects
 * unified. Nothing here refers to XSD constructs — an emitter never has to know
 * what an `xsd:group` was.
 *
 * ## Why slots
 *
 * Every complex type's content becomes an ordered `Slot[]`. A slot is one
 * property on the emitted TypeScript interface. Order is the schema-declared
 * order, which is what the writer replays.
 *
 * That works because `xsd:sequence` fixes the order of its particles. `CT_Tbl`
 * is a sequence of (repeating range-markup, `tblPr`, `tblGrid`, repeating rows);
 * emitting four properties and writing them back in slot order reproduces
 * document order exactly. Within a repeating slot, array order is document
 * order.
 *
 * ## Why flattening repeating choices is sound
 *
 * A repeating `xsd:choice` — `EG_PContent` in `CT_P`, say — lets alternatives
 * interleave freely, so its contents must live in ONE array of a discriminated
 * union rather than one array per alternative. Flattening nested
 * choices/groups down to leaf elements is only valid if no choice branch is a
 * multi-element sequence (which would mean "pick this branch and you get *both*
 * of these, adjacent").
 *
 * Measured across all 26 Transitional schemas: 154 `xsd:choice`, exactly one
 * containing an `xsd:sequence`, and that sequence wraps a single group ref
 * (`CT_RPR` in `shared-math.xsd:141`) — a redundant wrapper. **Zero** choice
 * branches are multi-element sequences. So the flattening is sound for this
 * schema set. `assertFlattenable()` re-checks it on every run rather than
 * trusting this comment.
 */

import type {
  Dialect,
  Facets,
  NsConstraint,
  ProcessContents,
  QName,
  SourceRef,
  TypeRef,
} from './ir.js';

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** How many of this slot may appear. */
export interface Cardinality {
  /** False when `minOccurs="0"` — emits an optional property. */
  readonly required: boolean;
  /** True when `maxOccurs > 1` — emits an array property. */
  readonly repeated: boolean;
}

/** One alternative in a choice slot. Becomes one member of a discriminated union. */
export interface ChoiceAlternative {
  /**
   * The discriminant value. Equal to the element's local name, which is unique
   * within a choice because two branches cannot accept the same element name in
   * the same namespace without making the content model ambiguous.
   */
  readonly tag: string;
  readonly element: QName;
  readonly type: TypeRef;
  readonly doc?: string;
  readonly source: SourceRef;
}

/** A single named element: `pPr?: CT_PPr` or `tblPr: CT_TblPr`. */
export interface ElementSlot {
  readonly kind: 'element';
  readonly prop: string;
  readonly element: QName;
  readonly type: TypeRef;
  readonly cardinality: Cardinality;
  readonly doc?: string;
  readonly source: SourceRef;
}

/**
 * A choice: `content: Array<{ kind: 'r'; value: CT_R } | { kind: 'hyperlink'; ... }>`.
 *
 * Also used for a non-repeating choice, which emits a single optional property
 * of the union type.
 */
export interface ChoiceSlot {
  readonly kind: 'choice';
  readonly prop: string;
  readonly alternatives: readonly ChoiceAlternative[];
  readonly cardinality: Cardinality;
  /** The group this choice came from, if any. Only used to name the property. */
  readonly origin?: QName;
  readonly source: SourceRef;
}

/**
 * An `xsd:any` wildcard. Content is captured as `RawNode[]` and replayed
 * verbatim — the mechanism that makes VML inside `w:pict` and Word's
 * extension namespaces survive a round-trip. Only 8 sites exist on the `.docx`
 * path; see `docs/xsd-feature-survey.md`.
 */
export interface WildcardSlot {
  readonly kind: 'wildcard';
  readonly prop: string;
  readonly namespaces: NsConstraint;
  readonly processContents: ProcessContents;
  readonly cardinality: Cardinality;
  readonly source: SourceRef;
}

export type Slot = ElementSlot | ChoiceSlot | WildcardSlot;

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export interface ModelAttribute {
  readonly prop: string;
  readonly name: string;
  /** `null` for unqualified — the overwhelming majority. */
  readonly ns: string | null;
  readonly type: TypeRef;
  readonly required: boolean;
  /**
   * Schema default, recorded but **never applied at read time**.
   *
   * An absent attribute and an attribute written with its default value are
   * semantically identical but textually different; materializing the default
   * on read means writing it back on save, which produces a diff on every
   * round-trip. 1,236 attributes carry a default, so this is not a corner case.
   * Defaults are applied in `@ooxml/wml` during property resolution.
   */
  readonly default?: string;
  readonly doc?: string;
  readonly source: SourceRef;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelContent =
  | { readonly kind: 'empty' }
  /**
   * `xsd:simpleContent` — text plus attributes. `CT_Text` (`w:t`) is the
   * important one: its value is the run's text and its `xml:space` attribute
   * decides whether surrounding whitespace is significant.
   */
  | { readonly kind: 'simpleContent'; readonly valueType: TypeRef }
  | { readonly kind: 'elements'; readonly slots: readonly Slot[] };

export interface ModelComplexType {
  readonly kind: 'complexType';
  readonly name: QName;
  /** Emitted TypeScript identifier, e.g. `CT_P`. Unique across the whole output. */
  readonly tsName: string;
  readonly content: ModelContent;
  readonly attributes: readonly ModelAttribute[];
  /**
   * Resolved `xsd:extension` chain, nearest base first. Kept for documentation
   * and diagnostics only: slots and attributes are already flattened to include
   * everything inherited, because a reader needs one flat dispatch table and
   * splitting it across an inheritance chain would cost a lookup per element.
   */
  readonly baseChain: readonly QName[];
  readonly dialects: readonly Dialect[];
  readonly doc?: string;
  readonly source: SourceRef;
}

/** How a simple type is represented in TypeScript. */
export type SimpleRepr =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  /**
   * A branded number — `Twip`, `Emu`, `HalfPoint`. See `runtime/units.ts`.
   * `base` is the XSD primitive the type restricts, and is what decides the
   * parse codec: integral bases parse with `parseInteger`, `xsd:decimal` with
   * `parseDecimal`, `xsd:double`/`xsd:float` with `parseDouble`. It is kept
   * here precisely because nothing else discriminates correctly — the brand
   * does not (`ST_Percentage` is integral, DrawingML coordinates are not), and
   * the type name does not either.
   */
  | {
      readonly kind: 'number';
      readonly brand?: string;
      readonly base: string;
      readonly facets: Facets;
    }
  | { readonly kind: 'string'; readonly facets: Facets }
  /** `ST_OnOff`. Absent `val` means **true** — see `runtime/onoff.ts`. */
  | { readonly kind: 'boolean' }
  | { readonly kind: 'union'; readonly members: readonly TypeRef[] }
  | { readonly kind: 'list'; readonly item: TypeRef };

export interface ModelSimpleType {
  readonly kind: 'simpleType';
  readonly name: QName;
  readonly tsName: string;
  readonly repr: SimpleRepr;
  readonly dialects: readonly Dialect[];
  readonly doc?: string;
  readonly source: SourceRef;
}

/** A global element — a legal part root, e.g. `w:document`, `w:styles`. */
export interface ModelRootElement {
  readonly kind: 'rootElement';
  readonly name: QName;
  readonly tsName: string;
  readonly type: TypeRef;
  readonly dialects: readonly Dialect[];
  readonly source: SourceRef;
}

export type ModelDefinition = ModelComplexType | ModelSimpleType | ModelRootElement;

/**
 * Namespaces referenced by the schemas but not defined in the schema set, whose
 * members are all strings as far as the `.docx` path is concerned
 * (`xml:space`, `xml:lang`, the Dublin Core elements in core properties).
 *
 * A type ref into one of these resolves to `string` in the generated code and
 * to "no parser/validator to call" in the emitters. There is deliberately no
 * silent fallback beyond that: anything outside this set and the schema set is
 * an unresolved reference and fails the build loudly (B3).
 */
export const STRING_FALLBACK_NS: ReadonlySet<string> = new Set(['xml', 'dcterms', 'dc']);

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * One entry in the coverage manifest.
 *
 * The manifest is what makes conformance *measured* rather than claimed. Each
 * type advances through four states, and CI fails if `modelled` coverage of
 * `.docx`-path types drops below 100% or if the others regress.
 *
 * The states are deliberately not booleans-with-a-default: an unimplemented
 * construct should degrade visibly. A type that is `modelled` but not `painted`
 * round-trips correctly and renders as a labelled placeholder, which is an
 * honest outcome. Silently rendering nothing is not.
 */
export interface CoverageEntry {
  /** `{token}#{name}`, matching `qnameKey`. */
  readonly qname: string;
  readonly tsName: string;
  readonly file: string;
  readonly line: number;
  readonly dialects: readonly Dialect[];
  /** True when this type is reachable from a WordprocessingML part root. */
  readonly docxPath: boolean;
  readonly states: CoverageStates;
}

export interface CoverageStates {
  /** Generated, parsed into a typed value, written back. Set by codegen. */
  readonly modelled: boolean;
  /** `@ooxml/layout` produces geometry for it. */
  readonly laidOut: boolean;
  /** `@ooxml/paint` draws it. */
  readonly painted: boolean;
  /** Proven byte-stable across open→save→open by the conformance corpus. */
  readonly roundTripped: boolean;
}

// ---------------------------------------------------------------------------
// The normalized set
// ---------------------------------------------------------------------------

export interface ModelSet {
  readonly complexTypes: ReadonlyMap<string, ModelComplexType>;
  readonly simpleTypes: ReadonlyMap<string, ModelSimpleType>;
  readonly rootElements: ReadonlyMap<string, ModelRootElement>;
  readonly coverage: readonly CoverageEntry[];
  readonly diagnostics: readonly NormalizeDiagnostic[];
}

export interface NormalizeDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code:
    | 'dialect-divergence'
    | 'unreachable-type'
    | 'slot-name-collision'
    | 'ambiguous-choice'
    | 'cyclic-extension'
    | 'unresolved-ref';
  readonly message: string;
  readonly source?: SourceRef;
}
