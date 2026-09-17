/**
 * Normalization tests.
 *
 * These run against hand-written IR rather than the real schemas, which is the
 * separation `ir.ts` was designed for: the loader can be tested against the
 * vendored XSDs with no normalization decisions baked in, and normalization can
 * be tested against fixtures with no XML parsing involved.
 *
 * The fixtures below are miniatures of real WordprocessingML structures —
 * `CT_P`'s group-nested repeating choice, `CT_Text`'s simple content, the
 * extension chain — because the interesting failures are structural, and a
 * fixture that does not have the real structure cannot reproduce them.
 */

import { describe, expect, it } from 'vitest';
import type {
  IrAttribute,
  IrAttributeGroup,
  IrComplexType,
  IrGlobalElement,
  IrGroup,
  IrParticle,
  IrSchemaSet,
  IrSimpleType,
  Occurs,
  QName,
  SourceRef,
  TypeRef,
} from './ir.js';
import { qnameKey } from './ir.js';
import { assertFlattenable, normalize } from './normalize.js';
import type { ChoiceSlot, ElementSlot, Slot, WildcardSlot } from './model.js';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const SRC: SourceRef = { file: 'test/fixture.xsd', line: 1 };

const q = (name: string, ns = 'wml'): QName => ({ ns, name });
const ref = (name: string, ns = 'wml'): TypeRef => ({ kind: 'named', ref: q(name, ns) });
const str: TypeRef = { kind: 'builtin', name: 'xsd:string' };

const el = (name: string, type: TypeRef, min = 1, max: Occurs = 1, ns = 'wml'): IrParticle => ({
  kind: 'element',
  name,
  ns,
  type,
  min,
  max,
  source: SRC,
});

const seq = (items: IrParticle[], min = 1, max: Occurs = 1): IrParticle => ({
  kind: 'sequence',
  items,
  min,
  max,
  source: SRC,
});

const choice = (items: IrParticle[], min = 1, max: Occurs = 1): IrParticle => ({
  kind: 'choice',
  items,
  min,
  max,
  source: SRC,
});

const gref = (name: string, min = 1, max: Occurs = 1, ns = 'wml'): IrParticle => ({
  kind: 'groupRef',
  ref: q(name, ns),
  min,
  max,
  source: SRC,
});

const anyOf = (namespaces: string[], min = 0, max: Occurs = 'unbounded'): IrParticle => ({
  kind: 'any',
  namespaces: { kind: 'list', namespaces },
  processContents: 'lax',
  min,
  max,
  source: SRC,
});

const attr = (name: string, type: TypeRef = str, use: IrAttribute['use'] = 'optional'): IrAttribute => ({
  kind: 'attribute',
  name,
  ns: null,
  type,
  use,
  source: SRC,
});

const group = (name: string, particle: IrParticle, ns = 'wml'): IrGroup => ({
  kind: 'group',
  name: q(name, ns),
  particle,
  dialects: ['transitional', 'strict'],
  source: SRC,
});

const ct = (
  name: string,
  content: IrComplexType['content'],
  attributes: IrComplexType['attributes'] = [],
  ns = 'wml',
): IrComplexType => ({
  kind: 'complexType',
  name: q(name, ns),
  content,
  attributes,
  dialects: ['transitional', 'strict'],
  source: SRC,
});

const elements = (particle: IrParticle | undefined, extendsBase?: QName): IrComplexType['content'] =>
  extendsBase ? { kind: 'elements', extends: extendsBase, particle } : { kind: 'elements', particle };

const root = (name: string, type: TypeRef, ns = 'wml'): IrGlobalElement => ({
  kind: 'globalElement',
  name: q(name, ns),
  type,
  dialects: ['transitional', 'strict'],
  source: SRC,
});

interface SchemaParts {
  complexTypes?: IrComplexType[];
  simpleTypes?: IrSimpleType[];
  groups?: IrGroup[];
  attributeGroups?: IrAttributeGroup[];
  globalElements?: IrGlobalElement[];
}

function schema(parts: SchemaParts): IrSchemaSet {
  const byKey = <T extends { name: QName }>(xs: readonly T[] = []): ReadonlyMap<string, T> =>
    new Map(xs.map((x) => [qnameKey(x.name), x]));
  return {
    namespaces: new Map(),
    uriToToken: new Map(),
    complexTypes: byKey(parts.complexTypes),
    simpleTypes: byKey(parts.simpleTypes),
    globalElements: byKey(parts.globalElements),
    groups: byKey(parts.groups),
    attributeGroups: byKey(parts.attributeGroups),
    diagnostics: [],
  };
}

function slotsOf(set: ReturnType<typeof normalize>, name: string, ns = 'wml'): readonly Slot[] {
  const t = set.complexTypes.get(qnameKey(q(name, ns)));
  if (!t) throw new Error(`no such type ${name}`);
  if (t.content.kind !== 'elements') throw new Error(`${name} has ${t.content.kind} content`);
  return t.content.slots;
}

// ---------------------------------------------------------------------------

describe('group expansion and choice flattening', () => {
  /**
   * A miniature of the real `CT_P`: a sequence whose second member is a
   * repeating group ref, three group levels deep, bottoming out in elements
   * that must all end up as alternatives of ONE interleaved slot.
   */
  const paragraphish = schema({
    groups: [
      group('EG_RunLevelElts', choice([el('proofErr', ref('CT_ProofErr')), el('permStart', ref('CT_Perm'))])),
      group(
        'EG_ContentRunContent',
        choice([el('r', ref('CT_R')), el('hyperlink', ref('CT_Hyperlink')), gref('EG_RunLevelElts')]),
      ),
      group('EG_PContent', choice([gref('EG_ContentRunContent'), el('fldSimple', ref('CT_SimpleField'))])),
    ],
    complexTypes: [ct('CT_P', elements(seq([el('pPr', ref('CT_PPr'), 0, 1), gref('EG_PContent', 0, 'unbounded')])))],
  });

  it('collapses a nested repeating group into one interleaved choice slot', () => {
    const slots = slotsOf(normalize(paragraphish), 'CT_P');
    expect(slots).toHaveLength(2);

    const [pPr, content] = slots as [ElementSlot, ChoiceSlot];
    expect(pPr.kind).toBe('element');
    expect(pPr.prop).toBe('pPr');
    expect(pPr.cardinality).toEqual({ required: false, repeated: false });

    expect(content.kind).toBe('choice');
    expect(content.cardinality).toEqual({ required: false, repeated: true });
    // All five leaves, from three group levels, in first-appearance order.
    expect(content.alternatives.map((a) => a.tag)).toEqual([
      'r',
      'hyperlink',
      'proofErr',
      'permStart',
      'fldSimple',
    ]);
  });

  it('names the choice property after the originating group', () => {
    const [, content] = slotsOf(normalize(paragraphish), 'CT_P') as [ElementSlot, ChoiceSlot];
    // EG_PContent -> pContent. Anything named `content2` here means the origin
    // was lost during expansion.
    expect(content.prop).toBe('pContent');
    expect(content.origin).toEqual(q('EG_PContent'));
  });

  it('multiplies occurrence constraints through a group ref', () => {
    // The group body is a non-repeating choice; the REF is unbounded. The
    // result must repeat — if the ref's maxOccurs were dropped, CT_P would
    // hold at most one run.
    const [, content] = slotsOf(normalize(paragraphish), 'CT_P') as [ElementSlot, ChoiceSlot];
    expect(content.cardinality.repeated).toBe(true);
  });

  it('emits a plain element slot for a single-alternative choice', () => {
    const set = normalize(
      schema({ complexTypes: [ct('CT_Only', elements(choice([el('x', ref('CT_X'))], 0, 1)))] }),
    );
    const [only] = slotsOf(set, 'CT_Only') as [ElementSlot];
    expect(only.kind).toBe('element');
    expect(only.prop).toBe('x');
  });

  it('keeps a non-repeating sequence transparent', () => {
    const set = normalize(
      schema({
        complexTypes: [
          ct('CT_Seq', elements(seq([el('a', ref('CT_A')), el('b', ref('CT_B'), 0, 1), el('c', ref('CT_C'))]))),
        ],
      }),
    );
    const slots = slotsOf(set, 'CT_Seq');
    expect(slots.map((s) => s.prop)).toEqual(['a', 'b', 'c']);
    expect(slots.map((s) => s.cardinality.required)).toEqual([true, false, true]);
  });

  it('warns when a repeating sequence of distinct elements is collapsed', () => {
    // No such construct exists in the vendored schemas. If one ever appears,
    // the model gets weaker and the build must say so rather than accept it.
    const set = normalize(
      schema({
        complexTypes: [ct('CT_Pairs', elements(seq([el('a', ref('CT_A')), el('b', ref('CT_B'))], 0, 'unbounded')))],
      }),
    );
    const warning = set.diagnostics.find((d) => d.code === 'ambiguous-choice');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('a, b');
    // It still produces a usable model rather than throwing.
    const [slot] = slotsOf(set, 'CT_Pairs') as [ChoiceSlot];
    expect(slot.alternatives.map((a) => a.tag)).toEqual(['a', 'b']);
  });
});

describe('extension chains', () => {
  const inherited = schema({
    complexTypes: [
      ct('CT_Base', elements(seq([el('x', ref('CT_X'))])), [attr('baseAttr')]),
      ct('CT_Mid', elements(seq([el('y', ref('CT_Y'))]), q('CT_Base')), [attr('midAttr')]),
      ct('CT_Leaf', elements(seq([el('z', ref('CT_Z'))]), q('CT_Mid')), [attr('leafAttr', str, 'required')]),
    ],
  });

  it('prepends base slots in wire order', () => {
    // complexContent extension puts the base's particle FIRST on the wire.
    // Emitting z before x would produce a schema-invalid document.
    expect(slotsOf(normalize(inherited), 'CT_Leaf').map((s) => s.prop)).toEqual(['x', 'y', 'z']);
  });

  it('flattens attributes across the whole chain and records the base chain', () => {
    const leaf = normalize(inherited).complexTypes.get(qnameKey(q('CT_Leaf')));
    expect(leaf?.attributes.map((a) => a.name)).toEqual(['baseAttr', 'midAttr', 'leafAttr']);
    expect(leaf?.attributes.map((a) => a.required)).toEqual([false, false, true]);
    expect(leaf?.baseChain).toEqual([q('CT_Base'), q('CT_Mid')]);
  });

  it('lets a derived type override an inherited attribute', () => {
    const set = normalize(
      schema({
        complexTypes: [
          ct('CT_B', elements(undefined), [attr('val', str, 'optional')]),
          ct('CT_D', elements(undefined, q('CT_B')), [attr('val', ref('ST_Thing'), 'required')]),
        ],
      }),
    );
    const d = set.complexTypes.get(qnameKey(q('CT_D')));
    expect(d?.attributes).toHaveLength(1);
    expect(d?.attributes[0]?.required).toBe(true);
    expect(d?.attributes[0]?.type).toEqual(ref('ST_Thing'));
  });

  it('reports a cyclic extension chain instead of recursing forever', () => {
    const set = normalize(
      schema({
        complexTypes: [
          ct('CT_A', elements(seq([el('a', str)]), q('CT_B'))),
          ct('CT_B', elements(seq([el('b', str)]), q('CT_A'))),
        ],
      }),
    );
    expect(set.diagnostics.some((d) => d.code === 'cyclic-extension')).toBe(true);
  });

  it('reports an unresolved extension base', () => {
    const set = normalize({
      ...schema({ complexTypes: [ct('CT_A', elements(undefined, q('CT_Missing')))] }),
    });
    const d = set.diagnostics.find((x) => x.code === 'unresolved-ref');
    expect(d?.message).toContain('CT_Missing');
  });
});

describe('attribute groups', () => {
  it('expands transitively and reports cycles', () => {
    const inner: IrAttributeGroup = {
      kind: 'attributeGroup',
      name: q('AG_Inner'),
      attributes: [attr('i')],
      dialects: ['transitional'],
      source: SRC,
    };
    const outer: IrAttributeGroup = {
      kind: 'attributeGroup',
      name: q('AG_Outer'),
      attributes: [attr('o'), { kind: 'attributeGroupRef', ref: q('AG_Inner'), source: SRC }],
      dialects: ['transitional'],
      source: SRC,
    };
    const set = normalize(
      schema({
        attributeGroups: [inner, outer],
        complexTypes: [
          ct('CT_Uses', { kind: 'empty' }, [{ kind: 'attributeGroupRef', ref: q('AG_Outer'), source: SRC }]),
        ],
      }),
    );
    expect(set.complexTypes.get(qnameKey(q('CT_Uses')))?.attributes.map((a) => a.name)).toEqual(['o', 'i']);
  });
});

describe('content kinds', () => {
  it('models simpleContent as a value type, not slots', () => {
    // CT_Text: the run's text plus xml:space. Turning this into an element slot
    // would lose the text entirely.
    const set = normalize(
      schema({
        complexTypes: [ct('CT_Text', { kind: 'simpleContent', base: str }, [attr('space', str)])],
      }),
    );
    const t = set.complexTypes.get(qnameKey(q('CT_Text')));
    expect(t?.content).toEqual({ kind: 'simpleContent', valueType: str });
    expect(t?.attributes.map((a) => a.name)).toEqual(['space']);
  });

  it('models an attributes-only type as empty content', () => {
    const set = normalize(schema({ complexTypes: [ct('CT_Flag', { kind: 'empty' }, [attr('val')])] }));
    expect(set.complexTypes.get(qnameKey(q('CT_Flag')))?.content.kind).toBe('empty');
  });

  it('captures xsd:any as a wildcard slot', () => {
    // This is the mechanism that makes VML inside w:pict survive a round-trip.
    const set = normalize(
      schema({
        complexTypes: [ct('CT_Picture', elements(seq([anyOf(['vml', 'vml-office'])])))],
      }),
    );
    const [w] = slotsOf(set, 'CT_Picture') as [WildcardSlot];
    expect(w.kind).toBe('wildcard');
    expect(w.prop).toBe('any');
    expect(w.processContents).toBe('lax');
    expect(w.namespaces).toEqual({ kind: 'list', namespaces: ['vml', 'vml-office'] });
    expect(w.cardinality.repeated).toBe(true);
  });
});

describe('property naming', () => {
  it('disambiguates a collision and reports it', () => {
    // An element redeclared in an extension is the usual cause.
    const set = normalize(
      schema({
        complexTypes: [
          ct('CT_Base', elements(seq([el('x', ref('CT_X'))]))),
          ct('CT_Derived', elements(seq([el('x', ref('CT_X2'))]), q('CT_Base'))),
        ],
      }),
    );
    expect(slotsOf(set, 'CT_Derived').map((s) => s.prop)).toEqual(['x', 'x2']);
    expect(set.diagnostics.some((d) => d.code === 'slot-name-collision')).toBe(true);
  });

  it('numbers anonymous choices in schema order', () => {
    const set = normalize(
      schema({
        complexTypes: [
          ct(
            'CT_Two',
            elements(
              seq([
                choice([el('a', str), el('b', str)], 0, 'unbounded'),
                choice([el('c', str), el('d', str)], 0, 'unbounded'),
              ]),
            ),
          ),
        ],
      }),
    );
    expect(slotsOf(set, 'CT_Two').map((s) => s.prop)).toEqual(['content', 'content2']);
  });
});

describe('simple types', () => {
  const st = (name: string, kind: 'restriction', base: TypeRef): IrSimpleType => ({
    kind,
    name: q(name, 'shared-types'),
    base,
    facets: {},
    dialects: ['transitional', 'strict'],
    source: SRC,
  });

  it('maps ST_OnOff to boolean rather than a string union', () => {
    // Absent means true. A generated string parser would get that wrong at
    // every one of the hundreds of sites that use it.
    const set = normalize(schema({ simpleTypes: [st('ST_OnOff', 'restriction', str)] }));
    expect(set.simpleTypes.get(qnameKey(q('ST_OnOff', 'shared-types')))?.repr).toEqual({ kind: 'boolean' });
  });

  it('brands unit-carrying numeric types', () => {
    const int: TypeRef = { kind: 'builtin', name: 'xsd:int' };
    const set = normalize(
      schema({
        simpleTypes: [
          st('ST_TwipsMeasure', 'restriction', int),
          st('ST_HpsMeasure', 'restriction', int),
          st('ST_Coordinate', 'restriction', { kind: 'builtin', name: 'xsd:long' }),
          st('ST_Guid', 'restriction', str),
        ],
      }),
    );
    const brand = (n: string): unknown => set.simpleTypes.get(qnameKey(q(n, 'shared-types')))?.repr;
    expect(brand('ST_TwipsMeasure')).toMatchObject({ kind: 'number', brand: 'Twip' });
    expect(brand('ST_HpsMeasure')).toMatchObject({ kind: 'number', brand: 'HalfPoint' });
    expect(brand('ST_Coordinate')).toMatchObject({ kind: 'number', brand: 'Emu' });
    // A string restriction is not a number and carries no brand.
    expect(brand('ST_Guid')).toMatchObject({ kind: 'string' });
  });

  it('carries enum values through in declaration order', () => {
    const set = normalize(
      schema({
        simpleTypes: [
          {
            kind: 'enum',
            name: q('ST_Jc', 'wml'),
            base: str,
            values: [
              { value: 'start', source: SRC },
              { value: 'center', source: SRC },
              { value: 'both', source: SRC },
            ],
            dialects: ['transitional', 'strict'],
            source: SRC,
          },
        ],
      }),
    );
    expect(set.simpleTypes.get(qnameKey(q('ST_Jc')))?.repr).toEqual({
      kind: 'enum',
      values: ['start', 'center', 'both'],
    });
  });
});

describe('coverage', () => {
  const reachability = schema({
    globalElements: [root('document', ref('CT_Document')), root('worksheet', ref('CT_Worksheet', 'sml'), 'sml')],
    complexTypes: [
      ct('CT_Document', elements(seq([el('body', ref('CT_Body'))]))),
      ct('CT_Body', elements(seq([el('p', ref('CT_P'))]))),
      ct('CT_P', { kind: 'empty' }, [attr('rsid', ref('ST_Rsid', 'shared-types'))]),
      ct('CT_Orphan', { kind: 'empty' }),
      ct('CT_Worksheet', { kind: 'empty' }, [], 'sml'),
    ],
    simpleTypes: [
      {
        kind: 'restriction',
        name: q('ST_Rsid', 'shared-types'),
        base: str,
        facets: {},
        dialects: ['transitional'],
        source: SRC,
      },
    ],
  });

  it('marks types reachable from a WordprocessingML root as on the .docx path', () => {
    const entries = new Map(normalize(reachability).coverage.map((c) => [c.qname, c]));
    expect(entries.get('wml#CT_Document')?.docxPath).toBe(true);
    expect(entries.get('wml#CT_Body')?.docxPath).toBe(true);
    expect(entries.get('wml#CT_P')?.docxPath).toBe(true);
    // Reached only through an attribute's type — the walk must follow those too.
    expect(entries.get('shared-types#ST_Rsid')?.docxPath).toBe(true);
  });

  it('excludes types reachable only from a non-.docx root', () => {
    const entries = new Map(normalize(reachability).coverage.map((c) => [c.qname, c]));
    expect(entries.get('sml#CT_Worksheet')?.docxPath).toBe(false);
  });

  it('reports a .docx-namespace type that nothing references', () => {
    const set = normalize(reachability);
    const orphan = set.diagnostics.find(
      (d) => d.code === 'unreachable-type' && d.message.includes('CT_Orphan'),
    );
    expect(orphan).toBeDefined();
    // ...but a SpreadsheetML type is not a .docx gap and must not be reported.
    expect(set.diagnostics.some((d) => d.message.includes('CT_Worksheet'))).toBe(false);
  });

  it('sets only `modelled`, leaving the downstream states to their own packages', () => {
    const entry = normalize(reachability).coverage.find((c) => c.qname === 'wml#CT_P');
    expect(entry?.states).toEqual({
      modelled: true,
      laidOut: false,
      painted: false,
      roundTripped: false,
    });
  });

  it('emits coverage sorted by qname', () => {
    const names = normalize(reachability).coverage.map((c) => c.qname);
    expect(names).toEqual([...names].sort());
  });
});

describe('determinism', () => {
  it('produces identical output across runs', () => {
    // `pnpm gen` output is gated on `git diff --exit-code`; any iteration-order
    // dependence here shows up as a spurious CI failure.
    const ir = schema({
      groups: [group('EG_X', choice([el('a', str), el('b', str)]))],
      complexTypes: [
        ct('CT_One', elements(seq([el('p', str, 0, 1), gref('EG_X', 0, 'unbounded')]))),
        ct('CT_Two', elements(seq([el('q', str)]), q('CT_One'))),
      ],
      globalElements: [root('doc', ref('CT_One'))],
    });
    const a = JSON.stringify(normalize(ir).coverage);
    const b = JSON.stringify(normalize(ir).coverage);
    expect(a).toBe(b);
    expect(JSON.stringify(slotsOf(normalize(ir), 'CT_Two'))).toBe(
      JSON.stringify(slotsOf(normalize(ir), 'CT_Two')),
    );
  });
});

describe('cycles', () => {
  it('reports a cyclic group reference instead of hanging', () => {
    const set = normalize(
      schema({
        groups: [group('EG_Loop', choice([el('a', str), gref('EG_Loop')]))],
        complexTypes: [ct('CT_Loop', elements(gref('EG_Loop', 0, 'unbounded')))],
      }),
    );
    expect(set.diagnostics.some((d) => d.code === 'cyclic-extension')).toBe(true);
  });

  it('reports an unresolved group reference', () => {
    const set = normalize(schema({ complexTypes: [ct('CT_X', elements(gref('EG_Missing')))] }));
    expect(set.diagnostics.find((d) => d.code === 'unresolved-ref')?.message).toContain('EG_Missing');
  });
});

describe('assertFlattenable', () => {
  it('accepts a choice branch that redundantly wraps a single group ref', () => {
    // This is the one real occurrence in the vendored schemas: CT_RPR in
    // shared-math.xsd:141. It is benign, and flagging it would make the check
    // cry wolf on every run.
    const ir = schema({
      groups: [group('EG_Inner', choice([el('x', str), el('y', str)]))],
      complexTypes: [ct('CT_RPR', elements(choice([seq([gref('EG_Inner')]), el('z', str)])))],
    });
    expect(assertFlattenable(ir)).toEqual([]);
  });

  it('rejects a choice branch that is a multi-element sequence', () => {
    // "Pick this branch and you get BOTH a and b, adjacent" — a flat
    // discriminated union cannot express that, so flattening would be unsound.
    const ir = schema({
      complexTypes: [
        ct('CT_Bad', elements(choice([seq([el('a', str), el('b', str)]), el('c', str)], 0, 'unbounded'))),
      ],
    });
    const violations = assertFlattenable(ir);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.type).toBe('wml#CT_Bad');
    expect(violations[0]?.branch).toEqual(['a', 'b']);
  });

  it('sees through a group ref into a multi-element branch', () => {
    const ir = schema({
      groups: [group('EG_Pair', seq([el('a', str), el('b', str)]))],
      complexTypes: [ct('CT_Bad', elements(choice([seq([gref('EG_Pair')]), el('c', str)])))],
    });
    expect(assertFlattenable(ir)).toHaveLength(1);
  });

  it('does not flag a branch that is a nested choice', () => {
    // A nested choice still yields exactly one element per selection.
    const ir = schema({
      complexTypes: [ct('CT_Ok', elements(choice([choice([el('a', str), el('b', str)]), el('c', str)])))],
    });
    expect(assertFlattenable(ir)).toEqual([]);
  });

  it('terminates on a cyclic group', () => {
    const ir = schema({
      groups: [group('EG_Loop', choice([el('a', str), gref('EG_Loop')]))],
      complexTypes: [ct('CT_Loop', elements(gref('EG_Loop')))],
    });
    expect(assertFlattenable(ir)).toEqual([]);
  });
});
