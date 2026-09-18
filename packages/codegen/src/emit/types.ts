/**
 * Emits `packages/schema/src/generated/<ns>/types.ts`.
 *
 * One module per logical namespace. Cross-namespace references import from a
 * sibling module, which is also how `tsName` collisions are survivable: three
 * namespaces define `CT_Extension`, and each owns the name inside its own
 * module. `SourceFile.importName` aliases on the rare occasion two of them meet.
 *
 * Shapes emitted per complex type:
 *
 *   - `interface CT_Foo` — one property per slot, plus attributes, plus the
 *     engine-managed `$`-prefixed preservation properties
 *     (see `docs/adr/0009-unknown-content-preservation.md`).
 *   - `type CT_Foo_bar` — the discriminated union for each choice slot.
 *
 * Everything is `readonly`. The document model in `@ooxml/wml` owns mutation;
 * the generated tree is the parse result and edits go through the model layer,
 * which is what keeps range annotations (bookmarks, comments, moves) from being
 * corrupted by a stray in-place write.
 *
 * Every non-repeating property is `?: T | undefined`, regardless of whether the
 * schema marks it required. See `docs/adr/0010-required-is-a-validator-property.md`:
 * a reader that must open defective documents cannot promise a required child is
 * there, and `| undefined` (rather than bare `?`) is what lets the reader build
 * one object literal under `exactOptionalPropertyTypes`.
 */

import type { LogicalNs, QName, TypeRef } from '../ir.js';
import type {
  ChoiceSlot,
  ModelAttribute,
  ModelComplexType,
  ModelSet,
  ModelSimpleType,
  Slot,
} from '../model.js';
import { qnameKey } from '../ir.js';
import { generatedBanner, propertyKey, SourceFile, stringLiteral } from './source.js';

/** Module specifier for the hand-authored runtime, from inside a generated module. */
const RUNTIME = '../../runtime/index.js';

/**
 * XSD built-in → TypeScript. Anything not listed is a codegen bug, not an `any`.
 *
 * Exported because the validator emitter derives its `validBuiltin` sets from
 * the same table — one source of truth for how a built-in maps to TypeScript.
 */
export const BUILTIN_TS: Readonly<Record<string, string>> = {
  'xsd:string': 'string',
  'xsd:boolean': 'boolean',
  'xsd:int': 'number',
  'xsd:integer': 'number',
  'xsd:long': 'number',
  'xsd:unsignedInt': 'number',
  'xsd:unsignedLong': 'number',
  'xsd:unsignedShort': 'number',
  'xsd:byte': 'number',
  'xsd:unsignedByte': 'number',
  'xsd:double': 'number',
  'xsd:float': 'number',
  'xsd:decimal': 'number',
  'xsd:dateTime': 'string',
  'xsd:date': 'string',
  'xsd:time': 'string',
  'xsd:duration': 'string',
  'xsd:base64Binary': 'string',
  'xsd:hexBinary': 'string',
  'xsd:anyURI': 'string',
  'xsd:token': 'string',
  'xsd:NCName': 'string',
  'xsd:ID': 'string',
  'xsd:IDREF': 'string',
  'xsd:NMTOKEN': 'string',
  'xsd:language': 'string',
  'xsd:positiveInteger': 'number',
  'xsd:nonNegativeInteger': 'number',
};

export interface EmittedModule {
  /** Path relative to `packages/schema/src/generated/`. */
  readonly path: string;
  readonly contents: string;
}

/**
 * Emit the types module for one namespace.
 *
 * `set` is the whole model rather than just this namespace's slice, because
 * resolving a `TypeRef` to a TypeScript type requires knowing whether the
 * target is a complex type (an interface) or a simple type (an alias), and that
 * can point anywhere.
 */
export function emitTypes(set: ModelSet, ns: LogicalNs): EmittedModule {
  const file = new SourceFile(
    generatedBanner(`the ${ns} namespace of the ECMA-376 5th edition schema set`),
  );

  const complexTypes = [...set.complexTypes.values()]
    .filter((t) => t.name.ns === ns)
    .sort(byTsName);
  const simpleTypes = [...set.simpleTypes.values()].filter((t) => t.name.ns === ns).sort(byTsName);

  // Reserve this module's own type names before emitting, so a cross-namespace
  // reference to an identically named type (dml-main#ST_Percentage vs
  // shared-types#ST_Percentage, one a union over the other) aliases the import
  // instead of colliding with the local declaration (TS2440).
  for (const st of simpleTypes) file.reserveLocal(st.tsName);
  for (const ct of complexTypes) file.reserveLocal(ct.tsName);

  const ctx = new TypeContext(set, ns, file);

  if (simpleTypes.length > 0) {
    file.comment('Simple types.');
    file.blank();
    for (const st of simpleTypes) {
      emitSimpleType(st, ctx, file);
      file.blank();
    }
  }

  if (complexTypes.length > 0) {
    file.comment('Complex types.');
    file.blank();
    for (const ct of complexTypes) {
      emitComplexType(ct, ctx, file);
      file.blank();
    }
  }

  return { path: `${ns}/types.ts`, contents: file.toString() };
}

// ---------------------------------------------------------------------------

class TypeContext {
  constructor(
    readonly set: ModelSet,
    readonly ns: LogicalNs,
    readonly file: SourceFile,
  ) {}

  /** The local TypeScript identifier for a reference, importing if needed. */
  tsType(ref: TypeRef): string {
    if (ref.kind === 'builtin') {
      const ts = BUILTIN_TS[ref.name];
      if (!ts) throw new Error(`No TypeScript mapping for XSD built-in ${ref.name}`);
      return ts;
    }
    return this.tsName(ref.ref);
  }

  private tsName(q: QName): string {
    const key = qnameKey(q);
    const def = this.set.complexTypes.get(key) ?? this.set.simpleTypes.get(key);
    if (!def && (q.ns === 'xml' || q.ns === 'dcterms' || q.ns === 'dc')) return 'string';
    if (!def) {
      // A dangling reference is a loader bug. Emitting `unknown` would let it
      // reach the generated code and fail somewhere far away.
      throw new Error(`Unresolved type reference ${key}`);
    }
    if (q.ns === this.ns) return def.tsName;
    return this.file.importName(`../${q.ns}/types.js`, def.tsName);
  }

  raw(): string {
    return this.file.importName(RUNTIME, 'RawNode');
  }

  positionedRaw(): string {
    return this.file.importName(RUNTIME, 'PositionedRaw');
  }

  xmlAttr(): string {
    return this.file.importName(RUNTIME, 'XmlAttr');
  }
}

function byTsName(a: { tsName: string }, b: { tsName: string }): number {
  return a.tsName < b.tsName ? -1 : a.tsName > b.tsName ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Simple types
// ---------------------------------------------------------------------------

function emitSimpleType(st: ModelSimpleType, ctx: TypeContext, file: SourceFile): void {
  file.doc(st.doc);

  switch (st.repr.kind) {
    case 'enum': {
      const values = st.repr.values.map(stringLiteral);
      const oneLine = `export type ${st.tsName} = ${values.join(' | ')};`;
      if (oneLine.length <= 100) {
        file.line(oneLine);
      } else {
        file.line(`export type ${st.tsName} =`);
        file.indent(() => {
          values.forEach((v, i) => file.line(`| ${v}${i === values.length - 1 ? ';' : ''}`));
        });
      }
      // A runtime Set so validators can check membership without a giant switch.
      file.blank();
      file.doc(`Lexical space of \`${st.tsName}\`, for validation.`);
      file.line(
        `export const ${st.tsName}_VALUES: ReadonlySet<string> = new Set([${st.repr.values
          .map(stringLiteral)
          .join(', ')}]);`,
      );
      return;
    }

    case 'boolean':
      // ST_OnOff. The absent-means-true rule lives in runtime/onoff.ts; the
      // type is just a boolean by the time it reaches a consumer.
      file.line(`export type ${st.tsName} = boolean;`);
      return;

    case 'number': {
      if (st.repr.brand === undefined) {
        file.line(`export type ${st.tsName} = number;`);
        return;
      }
      // Branded so a twip cannot be passed where an EMU is expected. The two
      // differ by a factor of 635, and nothing but the type system will catch
      // the mistake.
      const brand = ctx.file.importName(RUNTIME, st.repr.brand);
      file.line(`export type ${st.tsName} = ${brand};`);
      return;
    }

    case 'string':
      file.line(`export type ${st.tsName} = string;`);
      return;

    case 'union':
      file.line(
        `export type ${st.tsName} = ${st.repr.members.map((m) => ctx.tsType(m)).join(' | ')};`,
      );
      return;

    case 'list':
      // xsd:list — whitespace-separated in the document, an array in the model.
      file.line(`export type ${st.tsName} = readonly ${ctx.tsType(st.repr.item)}[];`);
      return;
  }
}

// ---------------------------------------------------------------------------
// Complex types
// ---------------------------------------------------------------------------

function emitComplexType(ct: ModelComplexType, ctx: TypeContext, file: SourceFile): void {
  const slots = ct.content.kind === 'elements' ? ct.content.slots : [];

  // Choice unions are emitted first so the interface can reference them.
  for (const slot of slots) {
    if (slot.kind === 'choice') {
      emitChoiceUnion(ct, slot, ctx, file);
      file.blank();
    }
  }

  file.doc(docFor(ct));
  file.block(`export interface ${ct.tsName} {`, () => {
    if (ct.content.kind === 'simpleContent') {
      file.doc('Text content of this element.');
      file.line(`readonly $value: ${ctx.tsType(ct.content.valueType)};`);
    }

    for (const slot of slots) emitSlot(ct, slot, ctx, file);
    for (const a of ct.attributes) emitAttribute(a, ctx, file);

    emitPreservationProperties(ct, slots, ctx, file);
  });
}

function emitSlot(ct: ModelComplexType, slot: Slot, ctx: TypeContext, file: SourceFile): void {
  const key = propertyKey(slot.prop);

  switch (slot.kind) {
    case 'element': {
      const t = ctx.tsType(slot.type);
      if (slot.cardinality.repeated) {
        file.doc(slot.doc);
        file.line(`readonly ${key}: readonly ${t}[];`);
      } else {
        file.doc(slot.doc);
        file.line(`readonly ${key}?: ${t} | undefined;`);
      }
      return;
    }

    case 'choice': {
      const unionName = choiceUnionName(ct, slot);
      if (slot.cardinality.repeated) {
        file.doc('Child content in document order.');
        file.line(`readonly ${key}: readonly ${unionName}[];`);
      } else {
        file.line(`readonly ${key}?: ${unionName} | undefined;`);
      }
      return;
    }

    case 'wildcard': {
      file.doc(
        `\`xsd:any\` content, captured verbatim and replayed on write. ` +
          `processContents="${slot.processContents}".`,
      );
      file.line(`readonly ${key}: readonly ${ctx.raw()}[];`);
      return;
    }
  }
}

function emitChoiceUnion(
  ct: ModelComplexType,
  slot: ChoiceSlot,
  ctx: TypeContext,
  file: SourceFile,
): void {
  const name = choiceUnionName(ct, slot);
  const alternatives = slot.alternatives.map(
    (alt) =>
      `| { readonly kind: ${stringLiteral(alt.tag)}; readonly value: ${ctx.tsType(alt.type)} }`,
  );

  // A repeating choice is where unknown children keep their position — see
  // ADR 0009. A non-repeating choice holds exactly one recognized alternative,
  // so there is nowhere for unknown content to sit.
  if (slot.cardinality.repeated) {
    alternatives.push(`| { readonly kind: '$raw'; readonly value: ${ctx.raw()} }`);
  }

  file.doc(
    slot.origin
      ? `Alternatives of \`${slot.origin.name}\` as used by \`${ct.tsName}\`.`
      : `Alternatives of the \`${slot.prop}\` choice in \`${ct.tsName}\`.`,
  );
  file.line(`export type ${name} =`);
  file.indent(() => {
    for (let i = 0; i < alternatives.length; i += 1) {
      const isLast = i === alternatives.length - 1;
      file.line(isLast ? `${alternatives[i]};` : `${alternatives[i]}`);
    }
  });
}

function emitAttribute(a: ModelAttribute, ctx: TypeContext, file: SourceFile): void {
  const doc = [
    a.doc,
    a.default !== undefined
      ? `Schema default \`${a.default}\`. Not applied on read — absence is preserved.`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');

  file.doc(doc.length > 0 ? doc : undefined);
  file.line(`readonly ${propertyKey(a.prop)}?: ${ctx.tsType(a.type)} | undefined;`);
}

/**
 * The `$`-prefixed engine-managed properties. See ADR 0009.
 *
 * `$` cannot begin an NCName, so this namespace provably never collides with
 * schema content.
 */
function emitPreservationProperties(
  _ct: ModelComplexType,
  slots: readonly Slot[],
  ctx: TypeContext,
  file: SourceFile,
): void {
  // Unknown children only need a positional anchor where they are NOT already
  // covered by a repeating choice's `$raw` alternative. A wildcard slot does
  // *not* count: `##other` excludes the target namespace, so a same-namespace
  // element the content model does not allow has nowhere to go without this.
  const coveredByRaw = slots.some((s) => s.kind === 'choice' && s.cardinality.repeated);

  // These docs are emitted ~2,800 times. Long prose here is 30k lines of noise
  // in every regenerated diff; the ADR is the place for the reasoning.
  if (slots.length > 0 && !coveredByRaw) {
    file.doc('Unrecognized children, anchored to the slot they followed. See ADR 0009.');
    file.line(`readonly $unknown?: readonly ${ctx.positionedRaw()}[] | undefined;`);
  }

  // Unconditional: an extension attribute can appear on *any* element, including
  // one the schema declares with no attributes at all (Word puts `w14:paraId` on
  // `w:p`, and there is no rule saying it could not have picked `w:hyperlink`).
  // Gating this on `attributes.length > 0` would silently drop them, and silent
  // loss is the exact failure ADR 0009 exists to prevent.
  file.doc('Unrecognized attributes, in source order. See ADR 0009.');
  file.line(`readonly $unknownAttrs?: readonly ${ctx.xmlAttr()}[] | undefined;`);
}

function choiceUnionName(ct: ModelComplexType, slot: ChoiceSlot): string {
  return `${ct.tsName}_${slot.prop.charAt(0).toUpperCase()}${slot.prop.slice(1)}`;
}

function docFor(ct: ModelComplexType): string {
  const parts = [ct.doc];
  if (ct.baseChain.length > 0) {
    parts.push(
      `Extends ${ct.baseChain.map((b) => `\`${b.name}\``).join(' → ')}. Inherited slots and ` +
        `attributes are flattened in, in wire order.`,
    );
  }
  if (ct.dialects.length === 1) {
    parts.push(
      `**${ct.dialects[0] === 'transitional' ? 'Transitional' : 'Strict'} only.** The writer ` +
        `refuses to emit this into a package of the other dialect.`,
    );
  }
  parts.push(`Defined at \`${ct.source.file}:${ct.source.line}\`.`);
  return parts.filter(Boolean).join('\n\n');
}
