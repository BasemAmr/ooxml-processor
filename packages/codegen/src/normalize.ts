/**
 * IR → normalized model.
 *
 * Six passes, in order:
 *
 *  1. **Expand groups** — `xsd:group ref` and `xsd:attributeGroup ref` particles
 *     are inlined transitively, multiplying occurrence constraints.
 *  2. **Resolve extensions** — `xsd:complexContent extension` chains are walked
 *     base-first and the base's slots and attributes are prepended. (There is no
 *     `restriction` case: the survey measured zero across all 51 schemas, and
 *     the loader raises `UnsupportedXsdFeature` if one ever appears.)
 *  3. **Flatten particles into slots** — the tree of sequence/choice/element
 *     becomes a flat ordered `Slot[]`.
 *  4. **Name properties** — deterministically, with collision resolution.
 *  5. **Classify simple types** — decide the TypeScript representation.
 *  6. **Compute reachability and coverage** — which types are on the `.docx`
 *     path, which is what the coverage manifest is scoped to.
 *
 * Determinism is a hard requirement throughout: `pnpm gen` must produce
 * byte-identical output on every run, because CI gates on
 * `git diff --exit-code packages/schema/src/generated`. That means no iteration
 * over an unordered structure without an explicit sort, and no name derived from
 * anything but the schema itself.
 */

import {
  qnameKey,
  type IrAttribute,
  type IrAttributeMember,
  type IrComplexType,
  type IrParticle,
  type IrSchemaSet,
  type IrSimpleType,
  type Occurs,
  type QName,
  type TypeRef,
} from './ir.js';
import { DOCX_NAMESPACES } from './namespaces.js';
import type {
  ChoiceAlternative,
  CoverageEntry,
  ModelAttribute,
  ModelComplexType,
  ModelContent,
  ModelDefinition,
  ModelRootElement,
  ModelSet,
  ModelSimpleType,
  NormalizeDiagnostic,
  SimpleRepr,
  Slot,
} from './model.js';

/** Guards against a pathological or cyclic schema rather than hanging. */
const MAX_GROUP_DEPTH = 64;
const MAX_EXTENSION_DEPTH = 32;

class Normalizer {
  private readonly diagnostics: NormalizeDiagnostic[] = [];
  private readonly complexTypes = new Map<string, ModelComplexType>();
  private readonly simpleTypes = new Map<string, ModelSimpleType>();
  private readonly rootElements = new Map<string, ModelRootElement>();

  /**
   * Which `xsd:group` a synthesized compositor was inlined from.
   *
   * Keyed on object identity of the compositor `expandGroups` creates, and used
   * for one thing only: naming. `EG_PContent` gives the property name
   * `pContent`, which is worth far more to anyone reading the generated types
   * than `content2` would be.
   */
  private readonly groupOrigin = new WeakMap<IrParticle, QName>();

  /** Cycle detection for the extension-chain walk. */
  private readonly resolvingExtension = new Set<string>();

  constructor(private readonly ir: IrSchemaSet) {}

  run(): ModelSet {
    // Sorted iteration everywhere: output determinism is a CI gate.
    for (const key of [...this.ir.simpleTypes.keys()].sort()) {
      const st = this.ir.simpleTypes.get(key);
      if (st) this.simpleTypes.set(key, this.normalizeSimpleType(st));
    }

    for (const key of [...this.ir.complexTypes.keys()].sort()) {
      const ct = this.ir.complexTypes.get(key);
      if (ct) this.complexTypes.set(key, this.normalizeComplexType(ct));
    }

    for (const key of [...this.ir.globalElements.keys()].sort()) {
      const ge = this.ir.globalElements.get(key);
      if (!ge) continue;
      this.rootElements.set(key, {
        kind: 'rootElement',
        name: ge.name,
        tsName: ge.name.name,
        type: ge.type,
        dialects: ge.dialects,
        source: ge.source,
      });
    }

    const coverage = this.buildCoverage();

    return {
      complexTypes: this.complexTypes,
      simpleTypes: this.simpleTypes,
      rootElements: this.rootElements,
      coverage,
      diagnostics: this.diagnostics,
    };
  }

  private diag(d: NormalizeDiagnostic): void {
    this.diagnostics.push(d);
  }

  // -------------------------------------------------------------------------
  // Pass 1: group and attribute-group expansion
  // -------------------------------------------------------------------------

  /**
   * Inline `groupRef` particles.
   *
   * Occurrence constraints multiply: a group ref with `maxOccurs="unbounded"`
   * wrapping a choice makes that choice repeating, which is exactly how
   * `EG_PContent` turns `CT_P`'s content into an interleaved list of runs,
   * hyperlinks and field characters.
   */
  private expandGroups(p: IrParticle, depth: number, stack: Set<string>): IrParticle | undefined {
    if (depth > MAX_GROUP_DEPTH) {
      this.diag({
        severity: 'error',
        code: 'cyclic-extension',
        message: `Group expansion exceeded ${MAX_GROUP_DEPTH} levels; the schema likely contains a cyclic xsd:group reference.`,
        source: p.source,
      });
      return undefined;
    }

    switch (p.kind) {
      case 'element':
      case 'any':
        return p;

      case 'groupRef': {
        const key = qnameKey(p.ref);
        if (stack.has(key)) {
          this.diag({
            severity: 'error',
            code: 'cyclic-extension',
            message: `Cyclic xsd:group reference ${key}.`,
            source: p.source,
          });
          return undefined;
        }
        const g = this.ir.groups.get(key);
        if (!g) {
          this.diag({
            severity: 'error',
            code: 'unresolved-ref',
            message: `Unresolved xsd:group reference ${key}.`,
            source: p.source,
          });
          return undefined;
        }

        stack.add(key);
        const inner = this.expandGroups(g.particle, depth + 1, stack);
        stack.delete(key);
        if (!inner || inner.kind === 'groupRef') return undefined;

        // A group whose body is a bare element or wildcard is wrapped in a
        // sequence so the ref's own occurrence constraints have somewhere to
        // live; otherwise the compositor absorbs them by multiplication.
        const expanded: IrParticle =
          inner.kind === 'element' || inner.kind === 'any'
            ? { kind: 'sequence', items: [inner], min: p.min, max: p.max, source: p.source }
            : {
                kind: inner.kind,
                items: inner.items,
                min: p.min * inner.min,
                max: multiplyOccurs(p.max, inner.max),
                source: p.source,
              };
        this.groupOrigin.set(expanded, g.name);
        return expanded;
      }

      case 'sequence':
      case 'choice':
      case 'all': {
        const items = p.items
          .map((i) => this.expandGroups(i, depth + 1, stack))
          .filter((i): i is IrParticle => i !== undefined);
        const expanded: IrParticle = { ...p, items };
        const origin = this.groupOrigin.get(p);
        if (origin) this.groupOrigin.set(expanded, origin);
        return expanded;
      }
    }
  }

  private expandAttributes(
    members: readonly IrAttributeMember[],
    depth: number,
    stack: Set<string>,
  ): IrAttribute[] {
    const out: IrAttribute[] = [];
    for (const m of members) {
      if (m.kind === 'attribute') {
        out.push(m);
        continue;
      }
      const key = qnameKey(m.ref);
      if (stack.has(key) || depth > MAX_GROUP_DEPTH) {
        this.diag({
          severity: 'error',
          code: 'cyclic-extension',
          message: `Cyclic or over-deep xsd:attributeGroup reference ${key}.`,
          source: m.source,
        });
        continue;
      }
      const ag = this.ir.attributeGroups.get(key);
      if (!ag) {
        this.diag({
          severity: 'error',
          code: 'unresolved-ref',
          message: `Unresolved xsd:attributeGroup reference ${key}.`,
          source: m.source,
        });
        continue;
      }
      stack.add(key);
      out.push(...this.expandAttributes(ag.attributes, depth + 1, stack));
      stack.delete(key);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Pass 3: flatten particles into slots
  // -------------------------------------------------------------------------

  /**
   * Collect every leaf reachable through a particle tree, in first-appearance
   * order. Used when a repeating compositor collapses into a single slot.
   */
  private collectLeaves(
    p: IrParticle,
    elements: ChoiceAlternative[],
    wildcards: IrParticle[],
  ): void {
    switch (p.kind) {
      case 'element':
        elements.push({
          tag: p.name,
          element: { ns: p.ns, name: p.name },
          type: p.type,
          ...(p.doc !== undefined ? { doc: p.doc } : {}),
          source: p.source,
        });
        return;
      case 'any':
        wildcards.push(p);
        return;
      case 'groupRef':
        // Pass 1 replaced every groupRef; reaching one here means expansion
        // already reported a diagnostic for it.
        return;
      case 'sequence':
      case 'choice':
      case 'all':
        for (const i of p.items) this.collectLeaves(i, elements, wildcards);
        return;
    }
  }

  /**
   * Flatten a particle tree into an ordered slot list.
   *
   * The governing rule: **a compositor that can repeat collapses into a single
   * slot**, because its contents interleave across iterations and no
   * per-element property could reconstruct document order. A non-repeating
   * sequence contributes its children as independent slots, since the schema
   * fixes their order and the writer can just replay it.
   */
  private toSlots(p: IrParticle, inheritedRepeat: boolean, naming: SlotNaming): Slot[] {
    const repeats = inheritedRepeat || occursMax(p) > 1;

    switch (p.kind) {
      case 'element':
        return [
          {
            kind: 'element',
            prop: p.name,
            element: { ns: p.ns, name: p.name },
            type: p.type,
            cardinality: { required: p.min > 0 && !repeats, repeated: repeats },
            ...(p.doc !== undefined ? { doc: p.doc } : {}),
            source: p.source,
          },
        ];

      case 'any':
        return [
          {
            kind: 'wildcard',
            prop: naming.nameForWildcard(),
            namespaces: p.namespaces,
            processContents: p.processContents,
            cardinality: { required: false, repeated: true },
            source: p.source,
          },
        ];

      case 'groupRef':
        return [];

      case 'choice':
      case 'sequence':
      case 'all': {
        // A non-repeating sequence / all is transparent: its children become
        // independent slots. `xsd:all` is order-insensitive on read; we emit in
        // schema order on write, which is always valid.
        if (!repeats && p.kind !== 'choice') {
          return p.items.flatMap((i) => this.toSlots(i, false, naming));
        }

        const elements: ChoiceAlternative[] = [];
        const wildcards: IrParticle[] = [];
        this.collectLeaves(p, elements, wildcards);

        // Disambiguate tags when multiple alternatives share the same local name
        // from different namespaces (e.g., w:r and m:r both map to tag 'r'). The
        // discriminated union needs unique `kind` values, so suffix cross-namespace
        // alternatives with their namespace token.
        const tagCounts = new Map<string, number>();
        for (const el of elements) tagCounts.set(el.tag, (tagCounts.get(el.tag) ?? 0) + 1);
        const disambiguatedElements = elements.map((el) => {
          if (tagCounts.get(el.tag)! > 1 && el.element.ns !== null) {
            return { ...el, tag: `${el.tag}_${el.element.ns}` };
          }
          return el;
        });

        if (repeats && p.kind === 'sequence' && disambiguatedElements.length > 1) {
          // A repeating SEQUENCE of several distinct elements means
          // "a, b, a, b, …". Collapsing it to an interleaved union preserves
          // document order but drops the within-iteration ordering constraint.
          // The measured schemas contain no such construct; say so loudly
          // rather than quietly accepting a weaker model.
          this.diag({
            severity: 'warning',
            code: 'ambiguous-choice',
            message:
              `A repeating xsd:sequence with ${disambiguatedElements.length} distinct child elements ` +
              `(${disambiguatedElements.map((a) => a.tag).join(', ')}) was collapsed into a single ` +
              `interleaved slot. Document order is preserved, but the schema's ` +
              `within-iteration ordering constraint is not enforced on write.`,
            source: p.source,
          });
        }

        const slots: Slot[] = [];
        const first = disambiguatedElements[0];

        if (disambiguatedElements.length === 1 && first) {
          // A one-branch choice is not a union; emit a plain element slot.
          slots.push({
            kind: 'element',
            prop: first.tag,
            element: first.element,
            type: first.type,
            cardinality: { required: !repeats && p.min > 0, repeated: repeats },
            ...(first.doc !== undefined ? { doc: first.doc } : {}),
            source: first.source,
          });
        } else if (disambiguatedElements.length > 1) {
          const origin = this.groupOrigin.get(p);
          slots.push({
            kind: 'choice',
            prop: naming.nameForChoice(origin),
            alternatives: disambiguatedElements,
            cardinality: { required: !repeats && p.min > 0, repeated: repeats },
            ...(origin !== undefined ? { origin } : {}),
            source: p.source,
          });
        }

        for (const w of wildcards) {
          if (w.kind !== 'any') continue;
          slots.push({
            kind: 'wildcard',
            prop: naming.nameForWildcard(),
            namespaces: w.namespaces,
            processContents: w.processContents,
            cardinality: { required: false, repeated: true },
            source: w.source,
          });
        }

        return slots;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2 + 4: complex types
  // -------------------------------------------------------------------------

  private normalizeComplexType(ct: IrComplexType): ModelComplexType {
    const key = qnameKey(ct.name);
    const baseChain: QName[] = [];
    const attributes: IrAttribute[] = [];
    const naming = new SlotNaming();
    const slots: Slot[] = [];
    let content: ModelContent = { kind: 'empty' };

    // Walk the extension chain base-first, so inherited slots and attributes
    // precede the derived type's own — which is the order XSD requires on the
    // wire for complexContent extension, and therefore the order the writer
    // must replay.
    for (const link of this.extensionChain(ct, baseChain)) {
      attributes.push(...this.expandAttributes(link.attributes, 0, new Set()));

      if (link.content.kind === 'simpleContent') {
        content = { kind: 'simpleContent', valueType: link.content.base };
      } else if (link.content.kind === 'elements' && link.content.particle) {
        const expanded = this.expandGroups(link.content.particle, 0, new Set());
        if (expanded) slots.push(...this.toSlots(expanded, false, naming));
      }
    }

    if (content.kind !== 'simpleContent' && slots.length > 0) {
      content = {
        kind: 'elements',
        slots: naming.resolveCollisions(slots, (message) =>
          this.diag({
            severity: 'info',
            code: 'slot-name-collision',
            message: `In ${key}: ${message}`,
            source: ct.source,
          }),
        ),
      };
    }

    // A schema sometimes names an attribute and a child element identically
    // (`CT_Anchor/@simplePos` and `CT_Anchor/simplePos`). The object model
    // cannot expose two properties with the same key, so suffix colliding
    // attributes with `Attr`. Similarly, multiple attributes with the same
    // local name from different namespaces (unqualified `id` and `r:id`)
    // collide; suffix the qualified ones with `_<ns>`.
    const slotProps = new Set(
      content.kind === 'elements' ? content.slots.map((s) => s.prop) : [],
    );
    const deduped = dedupeAttributes(attributes);
    const attrNameCounts = new Map<string, number>();
    for (const a of deduped) attrNameCounts.set(a.name, (attrNameCounts.get(a.name) ?? 0) + 1);

    const modelAttributes = deduped.map((a) => {
      let prop = a.name;
      // Multi-namespace collision: suffix qualified attributes with namespace
      if (a.ns !== null && attrNameCounts.get(a.name)! > 1) {
        prop = `${prop}_${a.ns}`;
      }
      // Slot collision: suffix with Attr
      if (slotProps.has(prop)) prop = `${prop}Attr`;
      return { ...toModelAttribute(a), prop };
    });

    return {
      kind: 'complexType',
      name: ct.name,
      tsName: ct.name.name,
      content,
      attributes: modelAttributes,
      baseChain,
      dialects: ct.dialects,
      ...(ct.doc !== undefined ? { doc: ct.doc } : {}),
      source: ct.source,
    };
  }

  /** The `xsd:extension` chain, base-first, with cycle detection. */
  private extensionChain(ct: IrComplexType, out: QName[]): IrComplexType[] {
    const key = qnameKey(ct.name);

    if (this.resolvingExtension.has(key)) {
      this.diag({
        severity: 'error',
        code: 'cyclic-extension',
        message: `Cyclic xsd:extension chain involving ${key}.`,
        source: ct.source,
      });
      return [ct];
    }
    if (out.length >= MAX_EXTENSION_DEPTH) {
      this.diag({
        severity: 'error',
        code: 'cyclic-extension',
        message: `Extension chain for ${key} exceeded ${MAX_EXTENSION_DEPTH} levels.`,
        source: ct.source,
      });
      return [ct];
    }

    if (ct.content.kind !== 'elements' || !ct.content.extends) return [ct];

    const baseName = ct.content.extends;
    const base = this.ir.complexTypes.get(qnameKey(baseName));
    if (!base) {
      this.diag({
        severity: 'error',
        code: 'unresolved-ref',
        message: `Unresolved xsd:extension base ${qnameKey(baseName)} of ${key}.`,
        source: ct.source,
      });
      return [ct];
    }

    out.unshift(baseName);
    this.resolvingExtension.add(key);
    const chain = [...this.extensionChain(base, out), ct];
    this.resolvingExtension.delete(key);
    return chain;
  }

  // -------------------------------------------------------------------------
  // Pass 5: simple types
  // -------------------------------------------------------------------------

  private normalizeSimpleType(st: IrSimpleType): ModelSimpleType {
    let repr: SimpleRepr;

    switch (st.kind) {
      case 'enum':
        repr = { kind: 'enum', values: st.values.map((v) => v.value) };
        break;

      case 'union':
        repr = { kind: 'union', members: st.members };
        break;

      case 'list':
        repr = { kind: 'list', item: st.item };
        break;

      case 'restriction': {
        // ST_OnOff's semantics cannot be derived from its facets: it is a string
        // restriction over 1|0|true|false|on|off in which an ABSENT value means
        // true. Special-cased here so every generated site routes through
        // runtime/onoff.ts rather than through a generated string parser that
        // would get the absent case wrong.
        if (ON_OFF_TYPES.has(st.name.name)) {
          repr = { kind: 'boolean' };
          break;
        }
        const brand = UNIT_BRANDS[st.name.name];
        // `base` is retained on the number repr because integral-vs-fractional
        // is decided by the XSD primitive, not by the brand or the type name —
        // see the field's doc in model.ts. The inline `kind === 'builtin'`
        // check both narrows `st.base` for `.name` and guards the numeric set.
        repr =
          st.base.kind === 'builtin' && NUMERIC_BUILTINS.has(st.base.name)
            ? {
                kind: 'number',
                ...(brand !== undefined ? { brand } : {}),
                base: st.base.name,
                facets: st.facets,
              }
            : { kind: 'string', facets: st.facets };
        break;
      }
    }

    return {
      kind: 'simpleType',
      name: st.name,
      tsName: st.name.name,
      repr,
      dialects: st.dialects,
      ...(st.doc !== undefined ? { doc: st.doc } : {}),
      source: st.source,
    };
  }

  // -------------------------------------------------------------------------
  // Pass 6: reachability and coverage
  // -------------------------------------------------------------------------

  /**
   * Which types are reachable from a WordprocessingML part root.
   *
   * This scopes the coverage manifest. A SpreadsheetML type left unimplemented
   * is not a conformance gap for a `.docx` editor, and counting it as one would
   * make the manifest's headline number meaningless.
   */
  private docxReachable(): Set<string> {
    const seen = new Set<string>();
    const queue: QName[] = [];

    const push = (t: TypeRef): void => {
      if (t.kind === 'named') queue.push(t.ref);
    };

    for (const key of [...this.rootElements.keys()].sort()) {
      const root = this.rootElements.get(key);
      if (root && DOCX_NAMESPACES.has(root.name.ns)) push(root.type);
    }

    while (queue.length > 0) {
      const q = queue.pop();
      if (!q) continue;
      const key = qnameKey(q);
      if (seen.has(key)) continue;
      seen.add(key);

      const ct = this.complexTypes.get(key);
      if (ct) {
        for (const a of ct.attributes) push(a.type);
        if (ct.content.kind === 'simpleContent') push(ct.content.valueType);
        if (ct.content.kind === 'elements') {
          for (const s of ct.content.slots) {
            if (s.kind === 'element') push(s.type);
            else if (s.kind === 'choice') for (const alt of s.alternatives) push(alt.type);
          }
        }
        continue;
      }

      const stt = this.simpleTypes.get(key);
      if (!stt) continue;
      if (stt.repr.kind === 'union') for (const m of stt.repr.members) push(m);
      else if (stt.repr.kind === 'list') push(stt.repr.item);
    }

    return seen;
  }

  private buildCoverage(): CoverageEntry[] {
    const reachable = this.docxReachable();
    const all: ModelDefinition[] = [...this.complexTypes.values(), ...this.simpleTypes.values()];

    for (const d of all) {
      // A type declared in a .docx namespace that nothing on the .docx path
      // refers to is worth surfacing: either it is genuinely orphaned in the
      // schema, or our reachability roots are incomplete.
      if (DOCX_NAMESPACES.has(d.name.ns) && !reachable.has(qnameKey(d.name))) {
        this.diag({
          severity: 'info',
          code: 'unreachable-type',
          message: `${qnameKey(d.name)} is declared in a .docx namespace but is not reachable from any WordprocessingML part root.`,
          source: d.source,
        });
      }
    }

    return all
      .map((d) => ({
        qname: qnameKey(d.name),
        tsName: d.tsName,
        file: d.source.file,
        line: d.source.line,
        dialects: d.dialects,
        docxPath: reachable.has(qnameKey(d.name)),
        // Codegen sets `modelled` and nothing else. The other three states are
        // asserted by the packages that implement them, so a type can never be
        // marked painted by the same code that claims to paint it.
        states: { modelled: true, laidOut: false, painted: false, roundTripped: false },
      }))
      .sort((a, b) => (a.qname < b.qname ? -1 : a.qname > b.qname ? 1 : 0));
  }
}

// ---------------------------------------------------------------------------
// Property naming
// ---------------------------------------------------------------------------

/**
 * Deterministic property naming with collision resolution, scoped to one
 * complex type.
 *
 * Determinism matters more than elegance here: generated output is gated on
 * `git diff --exit-code`, so a name that depended on iteration order or a hash
 * would produce spurious CI failures.
 */
class SlotNaming {
  private anonymousChoices = 0;
  private wildcards = 0;

  /**
   * `EG_PContent` → `pContent`; `EG_ContentRowContent` → `contentRowContent`.
   * Anonymous choices fall back to `content`, `content2`, … in schema order.
   */
  nameForChoice(origin: QName | undefined): string {
    if (origin) {
      const stripped = origin.name.replace(/^(EG_|CT_|AG_|G_)/, '');
      if (stripped.length > 0) return stripped.charAt(0).toLowerCase() + stripped.slice(1);
    }
    this.anonymousChoices += 1;
    return this.anonymousChoices === 1 ? 'content' : `content${this.anonymousChoices}`;
  }

  nameForWildcard(): string {
    this.wildcards += 1;
    return this.wildcards === 1 ? 'any' : `any${this.wildcards}`;
  }

  /**
   * Two slots can legitimately want the same property name — most often an
   * element that appears in both a base type and its extension. Suffix the
   * later ones deterministically and report it, since a collision usually means
   * the model could be expressed better.
   */
  resolveCollisions(slots: readonly Slot[], report: (message: string) => void): Slot[] {
    const counts = new Map<string, number>();
    return slots.map((s) => {
      const n = (counts.get(s.prop) ?? 0) + 1;
      counts.set(s.prop, n);
      if (n === 1) return s;
      report(`property "${s.prop}" occurs ${n} times; renamed to "${s.prop}${n}"`);
      return { ...s, prop: `${s.prop}${n}` };
    });
  }
}

// ---------------------------------------------------------------------------
// The flattening precondition
// ---------------------------------------------------------------------------

export interface FlattenViolation {
  /** The complex type or group whose content model contains the violation. */
  readonly type: string;
  /** The leaf element names in the offending branch. */
  readonly branch: readonly string[];
  readonly file: string;
  readonly line: number;
}

/**
 * Re-check the precondition that makes choice flattening sound.
 *
 * Flattening a repeating choice into one array of a discriminated union is only
 * valid if no branch of that choice is a multi-element sequence — a branch like
 * `<sequence><element a/><element b/></sequence>` means "pick this branch and
 * you get *both*, adjacent", which a flat union cannot express.
 *
 * Measured across all 26 Transitional schemas: 154 `xsd:choice`, exactly one
 * containing an `xsd:sequence`, and that one wraps a single group ref
 * (`CT_RPR` in `shared-math.xsd:141`) — a redundant wrapper. Zero branches are
 * multi-element sequences. This function re-derives that on every `pnpm gen`
 * rather than trusting the measurement to stay true across a schema revision.
 */
export function assertFlattenable(ir: IrSchemaSet): FlattenViolation[] {
  const violations: FlattenViolation[] = [];

  /** How many elements one selection of this particle yields. */
  const leafCount = (p: IrParticle, depth: number): number => {
    if (depth > MAX_GROUP_DEPTH) return 0;
    switch (p.kind) {
      case 'element':
      case 'any':
        return 1;
      case 'groupRef': {
        const g = ir.groups.get(qnameKey(p.ref));
        return g ? leafCount(g.particle, depth + 1) : 0;
      }
      case 'sequence':
      case 'all':
        return p.items.reduce((n, i) => n + leafCount(i, depth + 1), 0);
      case 'choice':
        // A choice yields one leaf per selection, however many branches it has.
        return p.items.length === 0 ? 0 : 1;
    }
  };

  const leafNames = (p: IrParticle, depth: number, out: string[]): void => {
    if (depth > MAX_GROUP_DEPTH) return;
    switch (p.kind) {
      case 'element':
        out.push(p.name);
        return;
      case 'any':
        out.push('<any>');
        return;
      case 'groupRef': {
        const g = ir.groups.get(qnameKey(p.ref));
        if (g) leafNames(g.particle, depth + 1, out);
        return;
      }
      default:
        for (const i of p.items) leafNames(i, depth + 1, out);
    }
  };

  const walk = (p: IrParticle, owner: string, depth: number, stack: Set<string>): void => {
    if (depth > MAX_GROUP_DEPTH) return;
    switch (p.kind) {
      case 'element':
      case 'any':
        return;
      case 'groupRef': {
        const key = qnameKey(p.ref);
        if (stack.has(key)) return;
        const g = ir.groups.get(key);
        if (!g) return;
        stack.add(key);
        walk(g.particle, owner, depth + 1, stack);
        stack.delete(key);
        return;
      }
      case 'choice': {
        for (const branch of p.items) {
          if ((branch.kind === 'sequence' || branch.kind === 'all') && leafCount(branch, 0) > 1) {
            const names: string[] = [];
            leafNames(branch, 0, names);
            violations.push({
              type: owner,
              branch: names,
              file: branch.source.file,
              line: branch.source.line,
            });
          }
          walk(branch, owner, depth + 1, stack);
        }
        return;
      }
      case 'sequence':
      case 'all':
        for (const i of p.items) walk(i, owner, depth + 1, stack);
    }
  };

  for (const key of [...ir.complexTypes.keys()].sort()) {
    const ct = ir.complexTypes.get(key);
    if (ct?.content.kind === 'elements' && ct.content.particle) {
      walk(ct.content.particle, key, 0, new Set());
    }
  }
  for (const key of [...ir.groups.keys()].sort()) {
    const g = ir.groups.get(key);
    if (g) walk(g.particle, key, 0, new Set());
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function occursMax(p: IrParticle): number {
  return p.max === 'unbounded' ? Number.POSITIVE_INFINITY : p.max;
}

function multiplyOccurs(a: Occurs, b: Occurs): Occurs {
  if (a === 'unbounded' || b === 'unbounded') return 'unbounded';
  return a * b;
}

/**
 * A derived type may redeclare an inherited attribute. Later wins, which
 * matches XSD's own rule for extension. `prohibited` removes it entirely.
 */
function dedupeAttributes(attrs: readonly IrAttribute[]): IrAttribute[] {
  const byKey = new Map<string, IrAttribute>();
  for (const a of attrs) {
    const key = `${a.ns ?? ''}#${a.name}`;
    if (a.use === 'prohibited') byKey.delete(key);
    else byKey.set(key, a);
  }
  return [...byKey.values()];
}

function toModelAttribute(a: IrAttribute): ModelAttribute {
  return {
    prop: a.name,
    name: a.name,
    ns: a.ns,
    type: a.type,
    required: a.use === 'required',
    ...(a.default !== undefined ? { default: a.default } : {}),
    ...(a.doc !== undefined ? { doc: a.doc } : {}),
    source: a.source,
  };
}

/**
 * `ST_OnOff` and its aliases. `ST_OnOff1` is the VML spelling; all of these
 * carry the absent-means-true rule.
 */
const ON_OFF_TYPES: ReadonlySet<string> = new Set(['ST_OnOff', 'ST_OnOff1', 'ST_TrueFalse']);

const NUMERIC_BUILTINS: ReadonlySet<string> = new Set([
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
  'xsd:positiveInteger',
  'xsd:nonNegativeInteger',
]);

/**
 * Simple types that carry a unit, mapped to the brand in `runtime/units.ts`.
 *
 * OOXML mixes twips (1/1440 in), EMUs (1/914400 in), half-points, eighth-points
 * and 60,000ths of a degree throughout. Confusing two of them produces layout
 * that is wrong in a way no ordinary type error catches, and wrong by a factor
 * of hundreds — so brand them and let the compiler catch it.
 */
const UNIT_BRANDS: Readonly<Record<string, string>> = {
  ST_TwipsMeasure: 'Twip',
  ST_SignedTwipsMeasure: 'Twip',
  ST_HpsMeasure: 'HalfPoint',
  ST_SignedHpsMeasure: 'HalfPoint',
  ST_EighthPointMeasure: 'EighthPoint',
  ST_PointMeasure: 'Point',
  ST_Coordinate: 'Emu',
  ST_CoordinateUnqualified: 'Emu',
  ST_PositiveCoordinate: 'Emu',
  ST_Angle: 'Degree60k',
  ST_FixedAngle: 'Degree60k',
  ST_PositiveFixedAngle: 'Degree60k',
  ST_Percentage: 'Pct1000',
  ST_PositivePercentage: 'Pct1000',
  ST_FixedPercentage: 'Pct1000',
  ST_PositiveFixedPercentage: 'Pct1000',
  ST_TablePercent: 'Pct50',
  ST_TablePercentMeasure: 'Pct50',
  // `ST_DecimalNumber` and `ST_UnsignedDecimalNumber` are deliberately absent.
  // They are plain `xsd:int`/`xsd:unsignedInt` with no unit attached, so a brand
  // would buy no safety — nothing can be confused with them — while forcing a
  // cast at every arithmetic use. Brands are for units, not for widths.
};

/** Entry point. */
export function normalize(ir: IrSchemaSet): ModelSet {
  return new Normalizer(ir).run();
}
