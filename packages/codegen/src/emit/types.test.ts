/**
 * Types-emitter tests.
 *
 * These run the real pipeline — hand-written IR → `normalize` → `emitTypes` —
 * and assert on the emitted source text. Asserting on text rather than on an
 * AST is deliberate: the committed generated files ARE text, `pnpm gen` is
 * gated on `git diff --exit-code`, and a change that alters bytes without
 * altering semantics still breaks the build. The bytes are the contract.
 */

import { describe, expect, it } from 'vitest';
import type {
  IrComplexType,
  IrGroup,
  IrParticle,
  IrSchemaSet,
  IrSimpleType,
  Occurs,
  QName,
  SourceRef,
  TypeRef,
} from '../ir.js';
import { qnameKey } from '../ir.js';
import { normalize } from '../normalize.js';
import { emitTypes } from './types.js';
import { identifier, isBareProperty, propertyKey, SourceFile } from './source.js';

const SRC: SourceRef = { file: 'transitional/wml.xsd', line: 42 };
const q = (name: string, ns = 'wml'): QName => ({ ns, name });
const ref = (name: string, ns = 'wml'): TypeRef => ({ kind: 'named', ref: q(name, ns) });
const str: TypeRef = { kind: 'builtin', name: 'xsd:string' };

const el = (name: string, type: TypeRef, min = 1, max: Occurs = 1): IrParticle => ({
  kind: 'element',
  name,
  ns: 'wml',
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
const gref = (name: string, min = 1, max: Occurs = 1): IrParticle => ({
  kind: 'groupRef',
  ref: q(name),
  min,
  max,
  source: SRC,
});

function schema(parts: {
  complexTypes?: IrComplexType[];
  simpleTypes?: IrSimpleType[];
  groups?: IrGroup[];
}): IrSchemaSet {
  const byKey = <T extends { name: QName }>(xs: readonly T[] = []): ReadonlyMap<string, T> =>
    new Map(xs.map((x) => [qnameKey(x.name), x]));
  return {
    namespaces: new Map(),
    uriToToken: new Map(),
    complexTypes: byKey(parts.complexTypes),
    simpleTypes: byKey(parts.simpleTypes),
    globalElements: new Map(),
    groups: byKey(parts.groups),
    attributeGroups: new Map(),
    diagnostics: [],
  };
}

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

const emit = (ir: IrSchemaSet, ns = 'wml'): string => emitTypes(normalize(ir), ns).contents;

// ---------------------------------------------------------------------------

describe('source builder', () => {
  it('quotes only property names that need it', () => {
    expect(propertyKey('pPr')).toBe('pPr');
    expect(propertyKey('$value')).toBe('$value');
    // Reserved words are legal property names in JS and TS; quoting them would
    // change bytes for no reason.
    expect(propertyKey('default')).toBe('default');
    // NCName permits '-' and '.', which identifiers do not.
    expect(propertyKey('some-name')).toBe('"some-name"');
    expect(isBareProperty('a.b')).toBe(false);
  });

  it('escapes reserved words used as bindings', () => {
    expect(identifier('default')).toBe('default_');
    expect(identifier('some-name')).toBe('some_name');
    expect(identifier('9lives')).toBe('_9lives');
  });

  it('sorts imports and aliases collisions deterministically', () => {
    const f = new SourceFile('/** banner */');
    // Requested out of order, and both modules export `CT_Extension`.
    expect(f.importName('../sml/types.js', 'CT_Extension')).toBe('CT_Extension');
    expect(f.importName('../dml-chart/types.js', 'CT_Extension')).toBe('dml_chart_CT_Extension');
    f.importName('../dml-chart/types.js', 'CT_Chart');
    f.line('export type X = CT_Extension;');

    const out = f.toString();
    const dmlLine = out.indexOf("from '../dml-chart/types.js'");
    const smlLine = out.indexOf("from '../sml/types.js'");
    expect(dmlLine).toBeGreaterThan(-1);
    expect(dmlLine).toBeLessThan(smlLine);
    expect(out).toContain('CT_Extension as dml_chart_CT_Extension');
    // Names within one import clause are sorted, not insertion-ordered.
    expect(out).toMatch(/CT_Chart, CT_Extension as dml_chart_CT_Extension/);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

describe('simple types', () => {
  const simple = (name: string, kind: 'restriction', base: TypeRef): IrSimpleType => ({
    kind,
    name: q(name),
    base,
    facets: {},
    dialects: ['transitional'],
    source: SRC,
  });

  it('emits an enum as a literal union plus a validation set', () => {
    const out = emit(
      schema({
        simpleTypes: [
          {
            kind: 'enum',
            name: q('ST_Jc'),
            base: str,
            values: [
              { value: 'start', source: SRC },
              { value: 'center', source: SRC },
              { value: 'both', source: SRC },
            ],
            dialects: ['transitional'],
            source: SRC,
          },
        ],
      }),
    );
    expect(out).toContain("export type ST_Jc = 'start' | 'center' | 'both';");
    expect(out).toContain(
      "export const ST_Jc_VALUES: ReadonlySet<string> = new Set(['start', 'center', 'both']);",
    );
  });

  it('breaks a long enum across lines with the semicolon on the last alternative', () => {
    const values = Array.from({ length: 20 }, (_, i) => ({
      value: `alternative${i}`,
      source: SRC,
    }));
    const out = emit(
      schema({
        simpleTypes: [
          {
            kind: 'enum',
            name: q('ST_Long'),
            base: str,
            values,
            dialects: ['transitional'],
            source: SRC,
          },
        ],
      }),
    );
    expect(out).toContain("export type ST_Long =\n  | 'alternative0'\n");
    expect(out).toContain("| 'alternative19';");
    // A bare `;` on its own line would be valid TypeScript and ugly forever.
    expect(out).not.toMatch(/^;$/m);
  });

  it('brands unit-carrying numerics and imports the brand', () => {
    const out = emit(
      schema({
        simpleTypes: [
          simple('ST_TwipsMeasure', 'restriction', { kind: 'builtin', name: 'xsd:unsignedLong' }),
        ],
      }),
    );
    expect(out).toContain('export type ST_TwipsMeasure = Twip;');
    expect(out).toContain("import type { Twip } from '../../runtime/index.js';");
  });

  it('emits ST_OnOff as a plain boolean', () => {
    const out = emit(schema({ simpleTypes: [simple('ST_OnOff', 'restriction', str)] }));
    expect(out).toContain('export type ST_OnOff = boolean;');
  });

  it('emits xsd:list as a readonly array', () => {
    const out = emit(
      schema({
        simpleTypes: [
          {
            kind: 'list',
            name: q('ST_Panose'),
            item: { kind: 'builtin', name: 'xsd:unsignedByte' },
            dialects: ['transitional'],
            source: SRC,
          },
        ],
      }),
    );
    expect(out).toContain('export type ST_Panose = readonly number[];');
  });
});

describe('complex types', () => {
  /** A miniature CT_P: optional pPr, then a repeating group-derived choice. */
  const paragraphish = schema({
    groups: [
      {
        kind: 'group',
        name: q('EG_PContent'),
        particle: choice([el('r', ref('CT_R')), el('hyperlink', ref('CT_Hyperlink'))]),
        dialects: ['transitional'],
        source: SRC,
      },
    ],
    complexTypes: [
      ct('CT_P', {
        kind: 'elements',
        particle: seq([el('pPr', ref('CT_PPr'), 0, 1), gref('EG_PContent', 0, 'unbounded')]),
      }),
      ct('CT_PPr', { kind: 'empty' }),
      ct('CT_R', { kind: 'empty' }),
      ct('CT_Hyperlink', { kind: 'empty' }),
    ],
  });

  it('emits optional, required and repeated slots correctly', () => {
    const out = emit(paragraphish);
    expect(out).toContain('readonly pPr?: CT_PPr | undefined;');
    expect(out).toContain('readonly pContent: readonly CT_P_PContent[];');
  });

  it('emits a repeating choice as a discriminated union with a $raw alternative', () => {
    const out = emit(paragraphish);
    expect(out).toContain('export type CT_P_PContent =');
    expect(out).toContain("| { readonly kind: 'r'; readonly value: CT_R }");
    expect(out).toContain("| { readonly kind: 'hyperlink'; readonly value: CT_Hyperlink }");
    // ADR 0009: unknown children ride in the same ordered array as the known
    // ones, which is what preserves their position.
    expect(out).toContain("| { readonly kind: '$raw'; readonly value: RawNode };");
  });

  it('omits $raw from a non-repeating choice', () => {
    // Exactly one recognized alternative appears; there is nowhere for unknown
    // content to sit, so offering a $raw case would be a lie.
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_One', {
            kind: 'elements',
            particle: choice([el('a', ref('CT_A')), el('b', ref('CT_B'))], 0, 1),
          }),
          ct('CT_A', { kind: 'empty' }),
          ct('CT_B', { kind: 'empty' }),
        ],
      }),
    );
    expect(out).toContain('export type CT_One_Content =');
    expect(out).not.toContain("kind: '$raw'");
  });

  it('gives a type with only fixed slots a positional unknown anchor', () => {
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_Tbl', {
            kind: 'elements',
            particle: seq([el('tblPr', ref('CT_TblPr'), 0, 1), el('tblGrid', ref('CT_TblGrid'))]),
          }),
          ct('CT_TblPr', { kind: 'empty' }),
          ct('CT_TblGrid', { kind: 'empty' }),
        ],
      }),
    );
    expect(out).toContain('readonly $unknown?: readonly PositionedRaw[] | undefined;');
  });

  it('omits the positional anchor when a repeating choice already carries $raw', () => {
    // Two mechanisms for the same job would mean two places for the writer to
    // look and two chances to emit content twice.
    const out = emit(paragraphish);
    const ctP = out.slice(out.indexOf('export interface CT_P {'));
    expect(ctP.slice(0, ctP.indexOf('}'))).not.toContain('$unknown?');
  });

  it('emits simpleContent as a $value property', () => {
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_Text', { kind: 'simpleContent', base: str }, [
            {
              kind: 'attribute',
              name: 'space',
              ns: 'xml',
              type: str,
              use: 'optional',
              source: SRC,
            },
          ]),
        ],
      }),
    );
    expect(out).toContain('readonly $value: string;');
    expect(out).toContain('readonly space?: string | undefined;');
  });

  it('marks required attributes as non-optional', () => {
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_Rel', { kind: 'empty' }, [
            { kind: 'attribute', name: 'id', ns: null, type: str, use: 'required', source: SRC },
            { kind: 'attribute', name: 'val', ns: null, type: str, use: 'optional', source: SRC },
          ]),
        ],
      }),
    );
    expect(out).toContain('readonly id?: string | undefined;');
    expect(out).toContain('readonly val?: string | undefined;');
  });

  it('documents a schema default without applying it', () => {
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_Ind', { kind: 'empty' }, [
            {
              kind: 'attribute',
              name: 'left',
              ns: null,
              type: str,
              use: 'optional',
              default: '0',
              source: SRC,
            },
          ]),
        ],
      }),
    );
    // Absence must stay distinguishable from an explicit default, or every save
    // of an untouched document produces a diff.
    expect(out).toContain('Schema default `0`');
    expect(out).toContain('readonly left?: string | undefined;');
  });

  it('flags a dialect-specific type in its doc comment', () => {
    const out = emit(
      schema({
        complexTypes: [
          {
            kind: 'complexType',
            name: q('CT_Picture'),
            content: { kind: 'empty' },
            attributes: [],
            dialects: ['transitional'],
            source: SRC,
          },
        ],
      }),
    );
    expect(out).toContain('**Transitional only.**');
  });

  it('records the extension chain in the doc comment', () => {
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_Base', { kind: 'elements', particle: seq([el('x', ref('CT_X'))]) }),
          ct('CT_Derived', {
            kind: 'elements',
            extends: q('CT_Base'),
            particle: seq([el('y', ref('CT_Y'))]),
          }),
          ct('CT_X', { kind: 'empty' }),
          ct('CT_Y', { kind: 'empty' }),
        ],
      }),
    );
    expect(out).toContain('Extends `CT_Base`.');
    // Wire order: the base's particle comes first.
    const iface = out.slice(out.indexOf('export interface CT_Derived {'));
    expect(iface.indexOf('readonly x')).toBeLessThan(iface.indexOf('readonly y'));
  });

  it('imports across namespaces rather than duplicating a type', () => {
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_Drawing', {
            kind: 'elements',
            particle: seq([
              el('inline', ref('CT_Inline', 'dml-wordprocessingDrawing'), 0, 'unbounded'),
            ]),
          }),
          ct('CT_Inline', { kind: 'empty' }, [], 'dml-wordprocessingDrawing'),
        ],
      }),
    );
    expect(out).toContain(
      "import type { CT_Inline } from '../dml-wordprocessingDrawing/types.js';",
    );
  });

  it('throws on an unresolved type reference rather than emitting `unknown`', () => {
    // A dangling ref is a loader bug. Letting it through would surface as a
    // type error thousands of lines away from the cause.
    expect(() =>
      emit(
        schema({
          complexTypes: [
            ct('CT_A', { kind: 'elements', particle: seq([el('x', ref('CT_Gone'))]) }),
          ],
        }),
      ),
    ).toThrow(/Unresolved type reference wml#CT_Gone/);
  });
});

describe('output shape', () => {
  it('carries the generated banner and a stable trailing newline', () => {
    const out = emit(schema({ complexTypes: [ct('CT_A', { kind: 'empty' })] }));
    expect(out.startsWith('/**\n * @generated by @ooxml/codegen — do not edit.')).toBe(true);
    expect(out).toContain('Regenerate with `pnpm gen`');
    expect(out.endsWith('};\n') || out.endsWith('}\n')).toBe(true);
  });

  it('is byte-identical across runs', () => {
    const ir = schema({
      groups: [
        {
          kind: 'group',
          name: q('EG_X'),
          particle: choice([el('a', ref('CT_A')), el('b', ref('CT_B'))]),
          dialects: ['transitional'],
          source: SRC,
        },
      ],
      complexTypes: [
        ct('CT_Host', { kind: 'elements', particle: seq([gref('EG_X', 0, 'unbounded')]) }),
        ct('CT_A', { kind: 'empty' }),
        ct('CT_B', { kind: 'empty' }),
      ],
    });
    expect(emit(ir)).toBe(emit(ir));
  });

  it('emits types sorted by name so insertion order cannot leak in', () => {
    const out = emit(
      schema({
        complexTypes: [
          ct('CT_Zebra', { kind: 'empty' }),
          ct('CT_Apple', { kind: 'empty' }),
          ct('CT_Mango', { kind: 'empty' }),
        ],
      }),
    );
    const order = ['CT_Apple', 'CT_Mango', 'CT_Zebra'].map((n) =>
      out.indexOf(`export interface ${n}`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('golden', () => {
  it('emits a readable module for a realistic miniature', () => {
    // A deliberately small but structurally complete slice: an enum, a branded
    // measure, simpleContent, a repeating group-derived choice, an extension
    // chain and a required/defaulted attribute pair. If the emitted shape
    // changes, it becomes visible here in review rather than inside a
    // 300k-line regenerated diff.
    const ir = schema({
      simpleTypes: [
        {
          kind: 'enum',
          name: q('ST_Jc'),
          base: str,
          values: [
            { value: 'start', source: SRC },
            { value: 'center', source: SRC },
            { value: 'end', source: SRC },
          ],
          dialects: ['transitional', 'strict'],
          doc: 'Paragraph alignment.',
          source: SRC,
        },
        {
          kind: 'restriction',
          name: q('ST_TwipsMeasure'),
          base: { kind: 'builtin', name: 'xsd:unsignedLong' },
          facets: {},
          dialects: ['transitional', 'strict'],
          source: SRC,
        },
      ],
      groups: [
        {
          kind: 'group',
          name: q('EG_PContent'),
          particle: choice([el('r', ref('CT_R')), el('hyperlink', ref('CT_Hyperlink'))]),
          dialects: ['transitional'],
          source: SRC,
        },
      ],
      complexTypes: [
        ct('CT_P', {
          kind: 'elements',
          particle: seq([el('pPr', ref('CT_PPr'), 0, 1), gref('EG_PContent', 0, 'unbounded')]),
        }),
        ct('CT_PPrBase', { kind: 'elements', particle: seq([el('jc', ref('CT_Jc'), 0, 1)]) }),
        ct('CT_PPr', {
          kind: 'elements',
          extends: q('CT_PPrBase'),
          particle: seq([el('sectPr', ref('CT_SectPr'), 0, 1)]),
        }),
        ct('CT_Jc', { kind: 'empty' }, [
          {
            kind: 'attribute',
            name: 'val',
            ns: null,
            type: ref('ST_Jc'),
            use: 'required',
            source: SRC,
          },
        ]),
        ct('CT_SectPr', { kind: 'empty' }, [
          {
            kind: 'attribute',
            name: 'gutter',
            ns: null,
            type: ref('ST_TwipsMeasure'),
            use: 'optional',
            default: '0',
            source: SRC,
          },
        ]),
        ct('CT_Text', { kind: 'simpleContent', base: str }, [
          { kind: 'attribute', name: 'space', ns: 'xml', type: str, use: 'optional', source: SRC },
        ]),
        ct('CT_R', { kind: 'elements', particle: seq([el('t', ref('CT_Text'), 0, 'unbounded')]) }),
        ct('CT_Hyperlink', { kind: 'empty' }),
      ],
    });
    expect(emit(ir)).toMatchInlineSnapshot(`
      "/**
       * @generated by @ooxml/codegen — do not edit.
       *
       * Source: the wml namespace of the ECMA-376 5th edition schema set
       *
       * Regenerate with \`pnpm gen\`. CI fails if this file differs from a fresh run,
       * so hand edits will be reverted by the next build.
       */

      import type { PositionedRaw, RawNode, Twip, XmlAttr } from '../../runtime/index.js';

      // Simple types.

      /** Paragraph alignment. */
      export type ST_Jc = 'start' | 'center' | 'end';

      /** Lexical space of \`ST_Jc\`, for validation. */
      export const ST_Jc_VALUES: ReadonlySet<string> = new Set(['start', 'center', 'end']);

      export type ST_TwipsMeasure = Twip;

      // Complex types.

      /** Defined at \`transitional/wml.xsd:42\`. */
      export interface CT_Hyperlink {
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }

      /** Defined at \`transitional/wml.xsd:42\`. */
      export interface CT_Jc {
        readonly val?: ST_Jc | undefined;
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }

      /** Alternatives of \`EG_PContent\` as used by \`CT_P\`. */
      export type CT_P_PContent =
        | { readonly kind: 'r'; readonly value: CT_R }
        | { readonly kind: 'hyperlink'; readonly value: CT_Hyperlink }
        | { readonly kind: '$raw'; readonly value: RawNode };

      /** Defined at \`transitional/wml.xsd:42\`. */
      export interface CT_P {
        readonly pPr?: CT_PPr | undefined;
        /** Child content in document order. */
        readonly pContent: readonly CT_P_PContent[];
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }

      /**
       * Extends \`CT_PPrBase\`. Inherited slots and attributes are flattened in, in wire order.
       *
       * Defined at \`transitional/wml.xsd:42\`.
       */
      export interface CT_PPr {
        readonly jc?: CT_Jc | undefined;
        readonly sectPr?: CT_SectPr | undefined;
        /** Unrecognized children, anchored to the slot they followed. See ADR 0009. */
        readonly $unknown?: readonly PositionedRaw[] | undefined;
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }

      /** Defined at \`transitional/wml.xsd:42\`. */
      export interface CT_PPrBase {
        readonly jc?: CT_Jc | undefined;
        /** Unrecognized children, anchored to the slot they followed. See ADR 0009. */
        readonly $unknown?: readonly PositionedRaw[] | undefined;
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }

      /** Defined at \`transitional/wml.xsd:42\`. */
      export interface CT_R {
        readonly t: readonly CT_Text[];
        /** Unrecognized children, anchored to the slot they followed. See ADR 0009. */
        readonly $unknown?: readonly PositionedRaw[] | undefined;
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }

      /** Defined at \`transitional/wml.xsd:42\`. */
      export interface CT_SectPr {
        /** Schema default \`0\`. Not applied on read — absence is preserved. */
        readonly gutter?: ST_TwipsMeasure | undefined;
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }

      /** Defined at \`transitional/wml.xsd:42\`. */
      export interface CT_Text {
        /** Text content of this element. */
        readonly $value: string;
        readonly space?: string | undefined;
        /** Unrecognized attributes, in source order. See ADR 0009. */
        readonly $unknownAttrs?: readonly XmlAttr[] | undefined;
      }
      "
    `);
  });
});
