/**
 * Emits `packages/schema/src/generated/<ns>/reader.ts`.
 *
 * Two kinds of function per module:
 *
 *   - `parseST_Foo(value: string): ST_Foo | undefined` — one per simple type.
 *     Returns `undefined` for anything outside the type's lexical space, never
 *     throws, never guesses. Having one per type (rather than inlining the check
 *     at each of the ~14,000 attribute sites) is what keeps the complex-type
 *     readers small enough to read, and gives unions and lists somewhere to
 *     recurse.
 *   - `readCT_Foo(cur, ctx): CT_Foo` — one per complex type.
 *
 * ## The cursor contract, which every reader depends on
 *
 * On entry the cursor is on the type's `startElement`. On return it is on the
 * event *after* the matching `endElement`. That is the same contract
 * `XmlCursor.skipToRaw()` already honours, which is what lets a child loop call
 * either one and then just keep looping.
 *
 * ## Dispatch
 *
 * A child element is matched by `(uri, localName)`. The URI is compared against
 * a local hoisted out of `ctx.uris` — one property load per element read rather
 * than one per child — so a `w:p` inside a Strict package matches by the same
 * generated code that matches it in a Transitional one. See ADR 0008.
 *
 * Named elements are tried first, then wildcards (with their namespace
 * constraint), and anything left over is preserved: into a repeating choice as
 * `$raw` if the type has one, otherwise into `$unknown` with a slot anchor.
 * See ADR 0009.
 */

import type { LogicalNs, NsConstraint, QName, TypeRef } from '../ir.js';
import type {
  ChoiceSlot,
  ModelAttribute,
  ModelComplexType,
  ModelSet,
  ModelSimpleType,
  Slot,
} from '../model.js';
import { qnameKey } from '../ir.js';
import type { EmittedModule } from './types.js';
import { generatedBanner, propertyKey, SourceFile, stringLiteral } from './source.js';

const RUNTIME = '../../runtime/index.js';

/** XSD built-in → the runtime codec that parses it. */
const BUILTIN_PARSER: Readonly<Record<string, string | null>> = {
  'xsd:string': null,
  'xsd:token': null,
  'xsd:NCName': null,
  'xsd:ID': null,
  'xsd:IDREF': null,
  'xsd:NMTOKEN': null,
  'xsd:language': null,
  'xsd:anyURI': null,
  'xsd:base64Binary': null,
  'xsd:hexBinary': null,
  'xsd:dateTime': null,
  'xsd:date': null,
  'xsd:time': null,
  'xsd:duration': null,
  'xsd:boolean': 'parseXsdBoolean',
  'xsd:int': 'parseInteger',
  'xsd:integer': 'parseInteger',
  'xsd:long': 'parseInteger',
  'xsd:unsignedInt': 'parseInteger',
  'xsd:unsignedLong': 'parseInteger',
  'xsd:unsignedShort': 'parseInteger',
  'xsd:byte': 'parseInteger',
  'xsd:unsignedByte': 'parseInteger',
  'xsd:positiveInteger': 'parseInteger',
  'xsd:nonNegativeInteger': 'parseInteger',
  'xsd:decimal': 'parseDecimal',
  'xsd:double': 'parseDouble',
  'xsd:float': 'parseDouble',
};

export function emitReader(set: ModelSet, ns: LogicalNs): EmittedModule {
  const file = new SourceFile(
    generatedBanner(`readers for the ${ns} namespace of the ECMA-376 5th edition schema set`),
  );
  const ctx = new ReaderContext(set, ns, file);

  const simpleTypes = [...set.simpleTypes.values()].filter((t) => t.name.ns === ns).sort(byTsName);
  const complexTypes = [...set.complexTypes.values()]
    .filter((t) => t.name.ns === ns)
    .sort(byTsName);

  emitScalarReader(ctx, file);

  if (simpleTypes.length > 0) {
    file.comment('Simple-type parsers. `undefined` means "outside the lexical space".');
    file.blank();
    for (const st of simpleTypes) {
      emitSimpleParser(st, ctx, file);
      file.blank();
    }
  }

  if (complexTypes.length > 0) {
    file.comment('Complex-type readers.');
    file.blank();
    for (const ct of complexTypes) {
      emitComplexReader(ct, ctx, file);
      file.blank();
    }
  }

  return { path: `${ns}/reader.ts`, contents: file.toString() };
}

// ---------------------------------------------------------------------------

class ReaderContext {
  constructor(
    readonly set: ModelSet,
    readonly ns: LogicalNs,
    readonly file: SourceFile,
  ) {}

  /** Import a runtime helper, returning its local name. */
  rt(name: string, typeOnly = false): string {
    return this.file.importName(RUNTIME, name, typeOnly);
  }

  /** The TypeScript type name for a ref, imported from the right `types.ts`. */
  typeName(ref: TypeRef): string {
    if (ref.kind === 'builtin') {
      const ts = BUILTIN_TS_FOR_LOCALS[ref.name];
      if (!ts) throw new Error(`No TypeScript mapping for XSD built-in ${ref.name}`);
      return ts;
    }
    return this.moduleName(ref.ref, 'types', (d) => d.tsName, true);
  }

  /** `parseST_Foo` for a simple type, or a runtime codec for a built-in. */
  parserFor(ref: TypeRef): string | undefined {
    if (ref.kind === 'builtin') {
      const codec = BUILTIN_PARSER[ref.name];
      if (codec === undefined) throw new Error(`No parser for XSD built-in ${ref.name}`);
      return codec === null ? undefined : this.rt(codec);
    }
    return this.moduleName(ref.ref, 'reader', (d) => `parse${d.tsName}`, false);
  }

  /** `readCT_Foo` for a complex type. */
  readerFor(ref: TypeRef): string {
    if (ref.kind === 'builtin') throw new Error(`Element typed as built-in ${ref.name}`);
    return this.moduleName(ref.ref, 'reader', (d) => `read${d.tsName}`, false);
  }

  /** The hoisted local holding one namespace's URI for this document's dialect. */
  nsLocal(ns: LogicalNs): string {
    return `NS_${ns.replace(/[^A-Za-z0-9]/g, '_')}`;
  }

  /** The human-readable name a diagnostic reports. */
  private moduleName(
    q: QName,
    module: 'types' | 'reader',
    pick: (d: { tsName: string }) => string,
    typeOnly: boolean,
  ): string {
    const key = qnameKey(q);
    const def = this.set.complexTypes.get(key) ?? this.set.simpleTypes.get(key);
    if (!def && (q.ns === 'xml' || q.ns === 'dcterms' || q.ns === 'dc')) return 'string';
    if (!def) throw new Error(`Unresolved type reference ${key}`);
    const name = pick(def);
    const spec = q.ns === this.ns ? `./${module}.js` : `../${q.ns}/${module}.js`;
    return this.file.importName(spec, name, typeOnly);
  }
}

/** Built-ins as they appear in a `let` declaration inside a reader. */
const BUILTIN_TS_FOR_LOCALS: Readonly<Record<string, string>> = {
  'xsd:string': 'string',
  'xsd:token': 'string',
  'xsd:NCName': 'string',
  'xsd:ID': 'string',
  'xsd:IDREF': 'string',
  'xsd:NMTOKEN': 'string',
  'xsd:language': 'string',
  'xsd:anyURI': 'string',
  'xsd:base64Binary': 'string',
  'xsd:hexBinary': 'string',
  'xsd:dateTime': 'string',
  'xsd:date': 'string',
  'xsd:time': 'string',
  'xsd:duration': 'string',
  'xsd:boolean': 'boolean',
  'xsd:int': 'number',
  'xsd:integer': 'number',
  'xsd:long': 'number',
  'xsd:unsignedInt': 'number',
  'xsd:unsignedLong': 'number',
  'xsd:unsignedShort': 'number',
  'xsd:byte': 'number',
  'xsd:unsignedByte': 'number',
  'xsd:positiveInteger': 'number',
  'xsd:nonNegativeInteger': 'number',
  'xsd:decimal': 'number',
  'xsd:double': 'number',
  'xsd:float': 'number',
};

function emitScalarReader(ctx: ReaderContext, file: SourceFile): void {
  const cursor = ctx.rt('XmlCursor', true);
  const read = ctx.rt('ReadContext', true);
  file.block(`export function readScalar(cur: ${cursor}, ctx: ${read}): string {`, () => {
    file.line("const ev = cur.current;");
    file.line("if (ev?.type === 'startElement') { cur.next(); const text = cur.current; if (text?.type === 'text') { cur.next(); } while (cur.current?.type !== 'endElement' && cur.current !== undefined) cur.next(); cur.next(); return text?.type === 'text' ? text.value : ''; }");
    file.line("return '';");
  });
  file.blank();
}

function byTsName(a: { tsName: string }, b: { tsName: string }): number {
  return a.tsName < b.tsName ? -1 : a.tsName > b.tsName ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Simple types
// ---------------------------------------------------------------------------

function emitSimpleParser(st: ModelSimpleType, ctx: ReaderContext, file: SourceFile): void {
  const t = ctx.file.importName(`./types.js`, st.tsName, true);
  const sig = `export function parse${st.tsName}(value: string): ${t} | undefined {`;

  switch (st.repr.kind) {
    case 'enum': {
      const values = ctx.file.importName('./types.js', `${st.tsName}_VALUES`, false);
      const collapse = ctx.rt('collapse');
      file.block(sig, () => {
        file.line(`const s = ${collapse}(value);`);
        file.line(`return ${values}.has(s) ? (s as ${t}) : undefined;`);
      });
      return;
    }

    case 'boolean': {
      // `ST_OnOff`. `parseOnOffAttr` answers "what did the attribute say?" and
      // returns undefined for an absent one *without* applying the
      // absent-means-true rule — that rule belongs to the element, not the
      // attribute, and applying it here would rewrite `<w:b/>` on every save.
      const parse = ctx.rt('parseOnOffAttr');
      file.block(sig, () => file.line(`return ${parse}(value);`));
      return;
    }

    case 'number': {
      const codec = ctx.rt(numericCodec(st));
      file.block(sig, () => {
        file.line(`const n = ${codec}(value);`);
        file.line(`return n === undefined ? undefined : (n as ${t});`);
      });
      return;
    }

    case 'string':
      file.block(sig, () => file.line(`return value as ${t};`));
      return;

    case 'union': {
      // Ordered: the first member that accepts the lexical form wins, which is
      // the XSD rule. `??` and not `||` — a member parsing to `false` or `0` is
      // a successful parse.
      const members = st.repr.members.map((m) => ctx.parserFor(m));
      file.block(sig, () => {
        const calls = members.map((p) => (p === undefined ? `(value as ${t})` : `${p}(value)`));
        file.line(`return (${calls.join(' ?? ')}) as ${t} | undefined;`);
      });
      return;
    }

    case 'list': {
      const parseList = ctx.rt('parseList');
      const item = ctx.parserFor(st.repr.item);
      file.block(sig, () => {
        file.line(
          item === undefined
            ? `return ${parseList}(value, (s) => s) as ${t} | undefined;`
            : `return ${parseList}(value, ${item}) as ${t} | undefined;`,
        );
      });
      return;
    }
  }
}

/**
 * Which numeric codec a branded or plain number uses.
 *
 * Integral versus fractional is decided by the facets the normalizer kept rather
 * than by the brand: `ST_Percentage` is an integer in thousandths, `ST_Angle` an
 * integer in sixtythousandths, but `a:CT_Point3D` coordinates are decimals.
 * Guessing from the brand would get the DrawingML ones wrong.
 */
function numericCodec(st: ModelSimpleType): string {
  if (st.repr.kind !== 'number') {
    throw new Error(`numericCodec called for non-numeric simple type ${st.tsName}`);
  }

  // The normalized IR currently retains range/length facets but not the XSD
  // base primitive. Known OOXML integral measure types are all canonical
  // decimal lexicals; the remaining numeric restrictions may use exponent
  // notation, so route them through the broader double codec.
  const integral = /(?:Integer|TwipsMeasure|Emu|HalfPoint|EighthPoint|Percentage|DecimalNumber|Unsigned|Positive|NonNegative|Long|Short|Byte|Int)$/i.test(
    st.tsName,
  );
  return integral ? 'parseDecimal' : 'parseDouble';
}

// ---------------------------------------------------------------------------
// Complex types
// ---------------------------------------------------------------------------

function emitComplexReader(ct: ModelComplexType, ctx: ReaderContext, file: SourceFile): void {
  const slots = ct.content.kind === 'elements' ? ct.content.slots : [];
  const typeName = ctx.file.importName('./types.js', ct.tsName, true);
  const cursorT = ctx.rt('XmlCursor', true);
  const ctxT = ctx.rt('ReadContext', true);
  const name = stringLiteral(ct.tsName);

  // Where unrecognized children go, by the rule in ADR 0009: the first repeating
  // choice at or after the current position. Computed here so the child loop can
  // emit a plain if-chain over known indices.
  const rawSlots = slots
    .map((s, i) => ({ s, i }))
    .filter((e) => e.s.kind === 'choice' && e.s.cardinality.repeated);
  const usesUnknown = slots.length > 0 && rawSlots.length === 0;
  const tracksPosition = usesUnknown || rawSlots.length > 1;

  file.doc(`Read a \`${ct.tsName}\`. See \`${ct.source.file}:${ct.source.line}\`.`);
  file.block(
    `export function read${ct.tsName}(cur: ${cursorT}, ctx: ${ctxT}): ${typeName} {`,
    () => {
      file.line(`const start = ${ctx.rt('requireStart')}(cur, ${name});`);
      emitAttributeLoop(ct, ctx, file, name);

      if (ct.content.kind === 'simpleContent') {
        emitSimpleContentLoop(ct, ctx, file, name);
      } else if (slots.length === 0) {
        emitEmptyLoop(ctx, file, name);
      } else {
        emitChildLoop(ct, slots, rawSlots, { usesUnknown, tracksPosition }, ctx, file, name);
      }

      emitReturn(ct, slots, usesUnknown, file);
    },
  );
}

function emitAttributeLoop(
  ct: ModelComplexType,
  ctx: ReaderContext,
  file: SourceFile,
  name: string,
): void {
  const attrT = ctx.rt('XmlAttr', true);

  for (const a of ct.attributes) {
    file.line(`let ${local(a.prop)}: ${ctx.typeName(a.type)} | undefined;`);
  }
  file.line(`let $unknownAttrs: ${attrT}[] | undefined;`);
  file.blank();

  // Qualified attributes are the minority (`xml:space`, `r:id`, `r:embed`), so
  // group by namespace and let the unqualified case — which is almost all of
  // them — be the first branch.
  const byNs = new Map<string | null, ModelAttribute[]>();
  for (const a of ct.attributes) {
    const bucket = byNs.get(a.ns);
    if (bucket) bucket.push(a);
    else byNs.set(a.ns, [a]);
  }
  for (const ns of byNs.keys()) {
    if (ns !== null) file.line(`const ${ctx.nsLocal(ns)}_A = ctx.uris[${stringLiteral(ns)}];`);
  }

  file.block('for (const a of start.attrs) {', () => {
    const order = [...byNs.keys()].sort((x, y) => (x === null ? -1 : y === null ? 1 : x < y ? -1 : 1));
    for (const ns of order) {
      const test = ns === null ? `a.uri === ''` : `a.uri === ${ctx.nsLocal(ns)}_A`;
      file.block(`if (${test}) {`, () => {
        file.block('switch (a.localName) {', () => {
          for (const a of byNs.get(ns) ?? []) emitAttributeCase(a, ctx, file, name);
        });
      });
    }
    // Anything that reached here is undeclared or unparseable. Both are
    // preserved verbatim; only the diagnostic differs, and the parse failure
    // already reported its own.
    file.line(`ctx.unexpectedAttribute(${name}, a, cur);`);
    file.line('($unknownAttrs ??= []).push(a);');
  });

  const required = ct.attributes.filter((a) => a.required);
  if (required.length > 0) {
    file.blank();
    for (const a of required) {
      // ADR 0010: reported, not enforced by the type.
      file.line(
        `if (${local(a.prop)} === undefined) ctx.missingRequired(${name}, ${stringLiteral(a.name)}, cur);`,
      );
    }
  }
  file.blank();
}

function emitAttributeCase(
  a: ModelAttribute,
  ctx: ReaderContext,
  file: SourceFile,
  name: string,
): void {
  const parser = ctx.parserFor(a.type);
  const key = stringLiteral(a.name);
  if (parser === undefined) {
    // A string type: every lexical form is valid, so there is nothing to fail.
    file.block(`case ${key}:`, () => {
      file.line(`${local(a.prop)} = a.value as ${ctx.typeName(a.type)};`);
      file.line('continue;');
    }, '');
    return;
  }
  file.block(`case ${key}: {`, () => {
    file.line(`const v = ${parser}(a.value);`);
    file.block(`if (v !== undefined) {`, () => {
      file.line(`${local(a.prop)} = v;`);
      file.line('continue;');
    });
    file.line(`ctx.invalidValue(${name}, a, ${stringLiteral(typeLabel(a.type))}, cur);`);
    file.line('break;');
  });
}

function typeLabel(ref: TypeRef): string {
  return ref.kind === 'builtin' ? ref.name : `${ref.ref.name}`;
}

/** `empty` content: nothing but an end tag is expected, but text may appear. */
function emitEmptyLoop(ctx: ReaderContext, file: SourceFile, name: string): void {
  file.line('cur.next();');
  file.block('for (;;) {', () => {
    file.line('const ev = cur.current;');
    file.line(`if (ev === undefined) { ctx.unexpectedEof(${name}, cur); break; }`);
    file.line("if (ev.type === 'endElement') { cur.next(); break; }");
    file.block("if (ev.type === 'startElement') {", () => {
      file.line(`ctx.unexpectedElement(${name}, ev.localName, ev.uri, cur);`);
      file.line('cur.skip();');
      file.line('continue;');
    });
    file.line(
      `if (ev.type === 'text' && !${ctx.rt('isIgnorableWhitespace')}(ev.value)) ctx.unexpectedText(${name}, cur);`,
    );
    file.line('cur.next();');
  });
}

/** `simpleContent`: accumulate text, complain about elements. */
function emitSimpleContentLoop(
  ct: ModelComplexType,
  ctx: ReaderContext,
  file: SourceFile,
  name: string,
): void {
  file.line('let $value = ￿;'.replace('￿', "''"));
  file.line('cur.next();');
  file.block('for (;;) {', () => {
    file.line('const ev = cur.current;');
    file.line(`if (ev === undefined) { ctx.unexpectedEof(${name}, cur); break; }`);
    file.line("if (ev.type === 'endElement') { cur.next(); break; }");
    file.line("if (ev.type === 'text') { $value += ev.value; cur.next(); continue; }");
    file.block("if (ev.type === 'startElement') {", () => {
      file.line(`ctx.unexpectedElement(${name}, ev.localName, ev.uri, cur);`);
      file.line('cur.skip();');
      file.line('continue;');
    });
    file.line('cur.next();');
  });
  if (ct.content.kind === 'simpleContent') {
    const parser = ctx.parserFor(ct.content.valueType);
    if (parser !== undefined) {
      file.line(`const $parsed = ${parser}($value);`);
    }
  }
  file.blank();
}

interface LoopFlags {
  readonly usesUnknown: boolean;
  readonly tracksPosition: boolean;
}

function emitChildLoop(
  ct: ModelComplexType,
  slots: readonly Slot[],
  rawSlots: readonly { s: Slot; i: number }[],
  flags: LoopFlags,
  ctx: ReaderContext,
  file: SourceFile,
  name: string,
): void {
  // Declarations, one per slot.
  for (const slot of slots) emitSlotDeclaration(ct, slot, ctx, file);
  if (flags.usesUnknown) {
    file.line(`let $unknown: ${ctx.rt('PositionedRaw', true)}[] | undefined;`);
  }
  if (flags.tracksPosition) {
    file.line('let $slot = -1;');
    file.line('let $index: number | undefined;');
  }
  file.blank();

  // One hoisted URI per namespace the content model mentions.
  const namespaces = [...collectNamespaces(slots)].sort();
  for (const ns of namespaces) {
    file.line(`const ${ctx.nsLocal(ns)} = ctx.uris[${stringLiteral(ns)}];`);
  }

  file.line('cur.next();');
  file.block('for (;;) {', () => {
    file.line('const ev = cur.current;');
    file.line(`if (ev === undefined) { ctx.unexpectedEof(${name}, cur); break; }`);
    file.line("if (ev.type === 'endElement') { cur.next(); break; }");
    file.block("if (ev.type === 'startElement') {", () => {
      for (const ns of namespaces) {
        const cases = slotCases(slots, ns, ctx, flags);
        if (cases.length === 0) continue;
        file.block(`if (ev.uri === ${ctx.nsLocal(ns)}) {`, () => {
          file.block('switch (ev.localName) {', () => {
            for (const c of cases) c(file);
          });
        });
      }
      emitWildcardDispatch(slots, flags, ctx, file);
      file.line(`ctx.unexpectedElement(${name}, ev.localName, ev.uri, cur);`);
      emitRawCapture(rawSlots, flags, file);
      file.line('continue;');
    });
    file.line(
      `if (ev.type === 'text' && !${ctx.rt('isIgnorableWhitespace')}(ev.value)) ctx.unexpectedText(${name}, cur);`,
    );
    file.line('cur.next();');
  });
  file.blank();
}

function emitSlotDeclaration(
  ct: ModelComplexType,
  slot: Slot,
  ctx: ReaderContext,
  file: SourceFile,
): void {
  const v = local(slot.prop);
  switch (slot.kind) {
    case 'element':
      file.line(
        slot.cardinality.repeated
          ? `const ${v}: ${ctx.typeName(slot.type)}[] = [];`
          : `let ${v}: ${ctx.typeName(slot.type)} | undefined;`,
      );
      return;
    case 'choice': {
      const union = ctx.file.importName('./types.js', choiceUnionName(ct, slot), true);
      file.line(
        slot.cardinality.repeated ? `const ${v}: ${union}[] = [];` : `let ${v}: ${union} | undefined;`,
      );
      return;
    }
    case 'wildcard':
      file.line(`const ${v}: ${ctx.rt('RawNode', true)}[] = [];`);
      return;
  }
}

/** One `case` per element this namespace contributes, across all slots. */
function slotCases(
  slots: readonly Slot[],
  ns: LogicalNs,
  ctx: ReaderContext,
  flags: LoopFlags,
): ((file: SourceFile) => void)[] {
  const out: ((file: SourceFile) => void)[] = [];

  slots.forEach((slot, i) => {
    const v = local(slot.prop);
    if (slot.kind === 'element' && slot.element.ns === ns) {
      const read = slot.type.kind === 'builtin' ? ctx.rt('readScalar') : ctx.readerFor(slot.type);
      out.push((file) =>
        file.block(`case ${stringLiteral(slot.element.name)}: {`, () => {
          file.line(
            slot.cardinality.repeated ? `${v}.push(${read}(cur, ctx));` : `${v} = ${read}(cur, ctx);`,
          );
          emitPositionUpdate(file, flags, i, slot.cardinality.repeated ? v : undefined);
          file.line('continue;');
        }),
      );
      return;
    }
    if (slot.kind === 'choice') {
      for (const alt of slot.alternatives) {
        if (alt.element.ns !== ns) continue;
        const read = alt.type.kind === 'builtin' ? ctx.rt('readScalar') : ctx.readerFor(alt.type);
        out.push((file) =>
          file.block(`case ${stringLiteral(alt.element.name)}: {`, () => {
            const value = `{ kind: ${stringLiteral(alt.tag)}, value: ${read}(cur, ctx) }`;
            file.line(slot.cardinality.repeated ? `${v}.push(${value});` : `${v} = ${value};`);
            emitPositionUpdate(file, flags, i, slot.cardinality.repeated ? v : undefined);
            file.line('continue;');
          }),
        );
      }
    }
  });

  return out;
}

function emitPositionUpdate(
  file: SourceFile,
  flags: LoopFlags,
  slotIndex: number,
  repeatedVar: string | undefined,
): void {
  if (!flags.tracksPosition) return;
  file.line(`$slot = ${slotIndex};`);
  file.line(repeatedVar === undefined ? '$index = undefined;' : `$index = ${repeatedVar}.length - 1;`);
}

function emitWildcardDispatch(
  slots: readonly Slot[],
  flags: LoopFlags,
  ctx: ReaderContext,
  file: SourceFile,
): void {
  slots.forEach((slot, i) => {
    if (slot.kind !== 'wildcard') return;
    const v = local(slot.prop);
    const test = wildcardTest(slot.namespaces, ctx);
    file.block(`if (${test}) {`, () => {
      file.line(`${v}.push(cur.skipToRaw());`);
      emitPositionUpdate(file, flags, i, v);
      file.line('continue;');
    });
  });
}

function wildcardTest(c: NsConstraint, ctx: ReaderContext): string {
  switch (c.kind) {
    case 'any':
      return 'true';
    case 'local':
      return `ev.uri === ''`;
    case 'other':
      return `ev.uri !== ctx.uris[${stringLiteral(c.excluding)}]`;
    case 'list':
      return c.namespaces
        .map((n) => `ev.uri === ctx.uris[${stringLiteral(n)}]`)
        .join(' || ');
  }
}

/**
 * Route an unrecognized child to its preservation slot.
 *
 * The target is the first repeating choice at or after the current position,
 * which is what puts an unknown element between `w:tblPr` and `w:tblGrid` into
 * `CT_Tbl`'s *row* content rather than its leading range-markup content. With
 * one repeating choice — the overwhelming majority — this collapses to a single
 * push with no branch.
 */
function emitRawCapture(
  rawSlots: readonly { s: Slot; i: number }[],
  flags: LoopFlags,
  file: SourceFile,
): void {
  if (rawSlots.length === 0) {
    file.line(
      flags.tracksPosition
        ? '($unknown ??= []).push({ afterSlot: $slot, afterIndex: $index, node: cur.skipToRaw() });'
        : '($unknown ??= []).push({ afterSlot: -1, node: cur.skipToRaw() });',
    );
    return;
  }

  const push = (v: string): string => `${v}.push({ kind: '$raw', value: cur.skipToRaw() });`;
  if (rawSlots.length === 1) {
    const only = rawSlots[0];
    if (only) file.line(push(local(only.s.prop)));
    return;
  }

  file.line('const $raw = cur.skipToRaw();');
  rawSlots.forEach((entry, n) => {
    const v = local(entry.s.prop);
    const stmt = `${v}.push({ kind: '$raw', value: $raw });`;
    if (n === rawSlots.length - 1) file.line(`else ${stmt}`);
    else file.line(`${n === 0 ? 'if' : 'else if'} ($slot <= ${entry.i}) ${stmt}`);
  });
}

function emitReturn(
  ct: ModelComplexType,
  slots: readonly Slot[],
  usesUnknown: boolean,
  file: SourceFile,
): void {
  const fields: string[] = [];
  if (ct.content.kind === 'simpleContent') fields.push('$value: $parsed ?? $value');
  for (const slot of slots) fields.push(field(slot.prop));
  for (const a of ct.attributes) fields.push(field(a.prop));
  if (usesUnknown) fields.push('$unknown');
  fields.push('$unknownAttrs');

  file.block('return {', () => {
    for (const f of fields) file.line(`${f},`);
  }, '};');
}

/** `pPr` → `pPr`, but `default` → `default_` and `some-name` → `some_name`. */
function local(prop: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop) && !RESERVED_LOCALS.has(prop)
    ? prop
    : `${prop.replace(/[^A-Za-z0-9_$]/g, '_')}_`;
}

/** An object-literal field, shorthand when the property name allows it. */
function field(prop: string): string {
  const v = local(prop);
  return v === prop ? prop : `${propertyKey(prop)}: ${v}`;
}

const RESERVED_LOCALS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield', 'await', 'start', 'cur', 'ctx', 'ev', 'a', 'v',
]);

function collectNamespaces(slots: readonly Slot[]): Set<LogicalNs> {
  const out = new Set<LogicalNs>();
  for (const slot of slots) {
    if (slot.kind === 'element') out.add(slot.element.ns);
    else if (slot.kind === 'choice') for (const alt of slot.alternatives) out.add(alt.element.ns);
  }
  return out;
}

function choiceUnionName(ct: ModelComplexType, slot: ChoiceSlot): string {
  return `${ct.tsName}_${slot.prop.charAt(0).toUpperCase()}${slot.prop.slice(1)}`;
}
