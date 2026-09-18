import { describe, expect, it } from 'vitest';
import type {
  IrComplexType,
  IrParticle,
  IrSchemaSet,
  Occurs,
  QName,
  SourceRef,
  TypeRef,
} from '../ir.js';
import { qnameKey } from '../ir.js';
import { normalize } from '../normalize.js';
import { emitWriter } from './writer.js';

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

function schema(parts: { complexTypes?: IrComplexType[] }): IrSchemaSet {
  const byKey = <T extends { name: QName }>(xs: readonly T[] = []): ReadonlyMap<string, T> =>
    new Map(xs.map((x) => [qnameKey(x.name), x]));
  return {
    namespaces: new Map(),
    uriToToken: new Map(),
    complexTypes: byKey(parts.complexTypes),
    simpleTypes: new Map(),
    globalElements: new Map(),
    groups: new Map(),
    attributeGroups: new Map(),
    diagnostics: [],
  };
}

const empty = (name: string): IrComplexType => ({
  kind: 'complexType',
  name: q(name),
  content: { kind: 'empty' },
  attributes: [],
  dialects: ['transitional'],
  source: SRC,
});

describe('writer emitter', () => {
  it('emits PositionedRawQueue interleaving for types with unknown preservation', () => {
    const ir = schema({
      complexTypes: [
        {
          kind: 'complexType',
          name: q('CT_Grid'),
          content: {
            kind: 'elements',
            particle: seq([el('col', ref('CT_Col'), 0, 'unbounded')]),
          },
          attributes: [
            {
              kind: 'attribute',
              name: 'val',
              ns: null,
              type: str,
              use: 'optional',
              source: SRC,
            },
          ],
          dialects: ['transitional'],
          source: SRC,
        },
        empty('CT_Col'),
      ],
    });

    const out = emitWriter(normalize(ir), 'wml').contents;

    expect(out).toContain('const $q = new PositionedRawQueue(value.$unknown);');
    expect(out).toContain('$q.flush(s, -1);');
    expect(out).toContain('$q.flush(s, 0, idx);');
    expect(out).toContain('$q.flush(s, 0);');
    expect(out).toContain('$q.flushRemaining(s);');
    expect(out).toContain("if (value['val'] !== undefined)");
  });
});
