import { describe, expect, it } from 'vitest';
import type { IrComplexType, IrParticle, IrSchemaSet, IrSimpleType, QName, SourceRef, TypeRef } from '../ir.js';
import { qnameKey } from '../ir.js';
import { normalize } from '../normalize.js';
import { emitValidator } from './validator.js';

const SRC: SourceRef = { file: 'wml.xsd', line: 1 };
const q = (name: string): QName => ({ ns: 'wml', name });
const ref = (name: string): TypeRef => ({ kind: 'named', ref: q(name) });
const str: TypeRef = { kind: 'builtin', name: 'xsd:string' };
const el = (name: string, type: TypeRef, min = 1, max: number | 'unbounded' = 1): IrParticle => ({ kind: 'element', name, ns: 'wml', type, min, max, source: SRC });
function schema(parts: { complexTypes?: IrComplexType[]; simpleTypes?: IrSimpleType[] }): IrSchemaSet {
  const byKey = <T extends { name: QName }>(xs: readonly T[] = []) => new Map(xs.map((x) => [qnameKey(x.name), x]));
  return { namespaces: new Map(), uriToToken: new Map(), complexTypes: byKey(parts.complexTypes), simpleTypes: byKey(parts.simpleTypes), globalElements: new Map(), groups: new Map(), attributeGroups: new Map(), diagnostics: [] };
}

describe('validator emitter', () => {
  it('emits required checks, enum checks and facets', () => {
    const ir = schema({
      simpleTypes: [{ kind: 'enum', name: q('ST_Color'), base: str, values: [{ value: 'red', source: SRC }, { value: 'blue', source: SRC }], dialects: ['transitional'], source: SRC }, { kind: 'restriction', name: q('ST_Short'), base: { kind: 'builtin', name: 'xsd:int' }, facets: { minInclusive: '1', maxInclusive: '3' }, dialects: ['transitional'], source: SRC }],
      complexTypes: [{ kind: 'complexType', name: q('CT_Item'), content: { kind: 'elements', particle: { kind: 'sequence', items: [el('name', str, 1), el('color', ref('ST_Color'), 0), el('n', ref('ST_Short'), 0)], min: 1, max: 1, source: SRC } }, attributes: [{ kind: 'attribute', name: 'id', ns: null, type: str, use: 'required', source: SRC }], dialects: ['transitional'], source: SRC }],
    });
    const out = emitValidator(normalize(ir), 'wml').contents;
    expect(out).toContain("'missing-required'");
    expect(out).toContain('required attribute is absent');
    expect(out).toContain('minInclusive');
    expect(out).toContain('ST_Color_VALUES');
    expect(out).toContain('export function validateCT_Item');
  });
});
