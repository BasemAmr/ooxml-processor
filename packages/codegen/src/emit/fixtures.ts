import type { TypeRef } from '../ir.js';
import type { ModelComplexType, ModelSet, Slot } from '../model.js';
import { NS_BY_TOKEN } from '../namespaces.js';
import type { EmittedModule } from './types.js';

/**
 * Emit deterministic synthetic XML fixtures for every complex type.
 *
 * These fixtures prove generator internal consistency and non-crashing behavior;
 * they are not conformance evidence. The fixture model is intentionally simple:
 * required attributes receive stable lexical placeholders, required child slots
 * recurse to a bounded depth, and invalid variants inject one unexpected child.
 */
export function emitFixtures(set: ModelSet): EmittedModule {
  const entries: Record<string, FixtureEntry> = {};
  const types = [...set.complexTypes.values()].sort((a, b) =>
    `${a.name.ns}#${a.tsName}`.localeCompare(`${b.name.ns}#${b.tsName}`),
  );

  for (const ct of types) {
    const key = `${ct.name.ns}#${ct.tsName}`;
    entries[key] = {
      namespace: ct.name.ns,
      type: ct.tsName,
      minimal: minimalXml(set, ct, 0, new Set()),
      invalid: invalidXml(set, ct),
    };
  }

  return {
    path: 'fixtures.json',
    contents: `${JSON.stringify(
      {
        version: 1,
        purpose: 'internal-consistency-only',
        note: 'Generated from the normalized model; not ECMA-376 conformance evidence.',
        entries,
      },
      null,
      2,
    )}\n`,
  };
}

export interface FixtureEntry {
  readonly namespace: string;
  readonly type: string;
  readonly minimal: string;
  readonly invalid: string;
}

function minimalXml(
  set: ModelSet,
  ct: ModelComplexType,
  depth: number,
  active: ReadonlySet<string>,
): string {
  const key = `${ct.name.ns}#${ct.tsName}`;
  if (depth > 4 || active.has(key)) return `<${ct.tsName}/>`;

  const next = new Set(active);
  next.add(key);

  const nsDecls = new Map<string, string>();
  const attrParts: string[] = [];
  for (const a of ct.attributes.filter((x) => x.required)) {
    if (a.ns !== null) {
      const binding = NS_BY_TOKEN.get(a.ns);
      const prefix = binding?.prefix ?? a.ns;
      if (binding?.transitional) {
        nsDecls.set(prefix, binding.transitional);
      }
      attrParts.push(`${prefix}:${a.name}="${lexical(a.type)}"`);
    } else {
      attrParts.push(`${a.name}="${lexical(a.type)}"`);
    }
  }
  const decls = [...nsDecls.entries()].map(([p, uri]) => ` xmlns:${p}="${uri}"`).join('');
  const attrs = attrParts.map((x) => ` ${x}`).join('') + decls;

  const children =
    ct.content.kind === 'elements'
      ? ct.content.slots
          .filter(
            (slot): slot is Exclude<Slot, { kind: 'wildcard' }> =>
              slot.kind !== 'wildcard' && slot.cardinality.required,
          )
          .map((slot) => slotXml(set, slot, depth + 1, next))
          .join('')
      : '';
  return children.length === 0
    ? `<${ct.tsName}${attrs}/>`
    : `<${ct.tsName}${attrs}>${children}</${ct.tsName}>`;
}

function slotXml(
  set: ModelSet,
  slot: Exclude<Slot, { kind: 'wildcard' }>,
  depth: number,
  active: ReadonlySet<string>,
): string {
  if (slot.kind === 'choice') {
    const alternative = slot.alternatives[0];
    return alternative ? `<${alternative.element.name}/>` : '';
  }
  if (slot.type.kind === 'named') {
    const child = set.complexTypes.get(`${slot.type.ref.ns}#${slot.type.ref.name}`);
    if (child) return renameRoot(minimalXml(set, child, depth, active), slot.element.name);
  }
  return `<${slot.element.name}/>`;
}

function renameRoot(xml: string, localName: string): string {
  if (xml.endsWith('/>')) return `<${localName}/>`;
  const openEnd = xml.indexOf('>');
  const closeStart = xml.lastIndexOf('</');
  if (openEnd < 0 || closeStart < 0) return `<${localName}/>`;
  const body = xml.slice(openEnd + 1, closeStart);
  return body.length === 0 ? `<${localName}/>` : `<${localName}>${body}</${localName}>`;
}

function invalidXml(set: ModelSet, ct: ModelComplexType): string {
  const valid = minimalXml(set, ct, 0, new Set());
  if (valid.endsWith('/>')) {
    return `${valid.slice(0, -2)}><unexpected/></${ct.tsName}>`;
  }
  const closeStart = valid.lastIndexOf('</');
  return closeStart < 0
    ? `${valid}<unexpected/>`
    : `${valid.slice(0, closeStart)}<unexpected/>${valid.slice(closeStart)}`;
}

function lexical(type: TypeRef): string {
  if (type.kind === 'builtin') {
    switch (type.name) {
      case 'xsd:boolean':
        return 'true';
      case 'xsd:decimal':
      case 'xsd:double':
      case 'xsd:float':
      case 'xsd:int':
      case 'xsd:integer':
      case 'xsd:long':
      case 'xsd:unsignedByte':
      case 'xsd:unsignedInt':
      case 'xsd:unsignedLong':
      case 'xsd:unsignedShort':
        return '0';
      default:
        return 'fixture';
    }
  }
  return 'fixture';
}
