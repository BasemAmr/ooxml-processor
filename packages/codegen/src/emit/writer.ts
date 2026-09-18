import type { LogicalNs, NsConstraint, TypeRef } from '../ir.js';
import type { ChoiceSlot, ModelAttribute, ModelComplexType, ModelSet, Slot } from '../model.js';
import type { EmittedModule } from './types.js';
import { generatedBanner, SourceFile, stringLiteral } from './source.js';

const RUNTIME = '../../runtime/index.js';

/** Emits deterministic XML writers for one logical namespace. */
export function emitWriter(set: ModelSet, ns: LogicalNs): EmittedModule {
  const file = new SourceFile(
    generatedBanner(`writers for the ${ns} namespace of the ECMA-376 5th edition schema set`),
  );
  const ctx = new WriterContext(set, ns, file);
  const complexTypes = [...set.complexTypes.values()].filter((x) => x.name.ns === ns).sort(byName);
  // Reserve the module's own function names before emitting, so an import of
  // another namespace's identically named type aliases rather than collides.
  for (const ct of complexTypes) file.reserveLocal(`write${ct.tsName}`);
  file.comment('XML writers. Element names are supplied by the owning particle.');
  file.blank();
  for (const ct of complexTypes) {
    emitComplexWriter(ct, ctx, file);
    file.blank();
  }
  return { path: `${ns}/writer.ts`, contents: file.toString() };
}

class WriterContext {
  constructor(
    readonly set: ModelSet,
    readonly ns: LogicalNs,
    readonly file: SourceFile,
  ) {}
  rt(name: string, typeOnly = false): string {
    return this.file.importName(RUNTIME, name, typeOnly);
  }
  typeName(ref: TypeRef): string {
    if (ref.kind === 'builtin') return builtinTs(ref.name);
    const d =
      this.set.complexTypes.get(`${ref.ref.ns}#${ref.ref.name}`) ??
      this.set.simpleTypes.get(`${ref.ref.ns}#${ref.ref.name}`);
    if (!d) throw new Error(`Unresolved type reference ${ref.ref.ns}#${ref.ref.name}`);
    return ref.ref.ns === this.ns
      ? d.tsName
      : this.file.importName(`../${ref.ref.ns}/types.js`, d.tsName, true);
  }
  /**
   * `writeCT_Foo` for a complex type. A same-namespace writer is local to this
   * module — importing it from `./writer.js` would be a self-import (TS2440).
   */
  writerFor(ref: TypeRef): string {
    if (ref.kind === 'builtin') throw new Error(`Element typed as built-in ${ref.name}`);
    const d = this.set.complexTypes.get(`${ref.ref.ns}#${ref.ref.name}`);
    if (!d) throw new Error(`Unresolved complex type ${ref.ref.ns}#${ref.ref.name}`);
    if (ref.ref.ns === this.ns) return `write${d.tsName}`;
    return this.file.importName(`../${ref.ref.ns}/writer.js`, `write${d.tsName}`, false);
  }
  complex(ref: TypeRef): boolean {
    return ref.kind === 'named' && this.set.complexTypes.has(`${ref.ref.ns}#${ref.ref.name}`);
  }
}

function emitComplexWriter(ct: ModelComplexType, ctx: WriterContext, file: SourceFile): void {
  const type = ctx.file.importName('./types.js', ct.tsName, true);
  const sink = ctx.rt('XmlSink', true);
  const writeCtx = ctx.rt('WriteContext', true);
  const uriFor = ctx.rt('uriFor');
  file.doc(`Write a \`${ct.tsName}\`; the caller supplies its element local name.`);
  file.block(
    `export function write${ct.tsName}(s: ${sink}, value: ${type}, ctx: ${writeCtx}, localName: string): void {`,
    () => {
      file.line(`s.startElement(${uriFor}(ctx, ${stringLiteral(ct.name.ns)}), localName);`);
      for (const a of ct.attributes) emitAttribute(a, ctx, file);
      file.line(
        'for (const a of value.$unknownAttrs ?? []) s.attr(a.uri || null, a.localName, a.value);',
      );
      if (ct.content.kind === 'simpleContent') {
        file.line(`s.text(String(value.$value));`);
      } else if (ct.content.kind === 'elements') {
        // The `$unknown` property exists only when the reader emits it, which is
        // exactly when the type has slots and none of them is a repeating choice
        // (a repeating choice absorbs unknowns as `$raw` alternatives). Mirror
        // that condition or the writer references a property the type does not
        // have. Interleaving the captured nodes at their anchors is P1-04.
        const slots = ct.content.slots;
        const hasUnknown =
          slots.length > 0 && !slots.some((x) => x.kind === 'choice' && x.cardinality.repeated);
        if (hasUnknown) {
          const queue = ctx.rt('PositionedRawQueue');
          file.line(`const $q = new ${queue}(value.$unknown);`);
          file.line('$q.flush(s, -1);');
        }
        slots.forEach((slot, i) => {
          emitSlot(ct, slot, i, hasUnknown, ctx, file);
          if (hasUnknown) {
            file.line(`$q.flush(s, ${i});`);
          }
        });
        if (hasUnknown) {
          file.line('$q.flushRemaining(s);');
        }
      }
      file.line('s.endElement();');
    },
  );
}

function emitAttribute(a: ModelAttribute, ctx: WriterContext, file: SourceFile): void {
  const ns = a.ns === null ? 'null' : `${ctx.rt('uriFor')}(ctx, ${stringLiteral(a.ns)})`;
  file.line(
    `if (value[${stringLiteral(a.prop)}] !== undefined) s.attr(${ns}, ${stringLiteral(a.name)}, String(value[${stringLiteral(a.prop)}]));`,
  );
}

function emitSlot(
  ct: ModelComplexType,
  slot: Slot,
  slotIndex: number,
  hasUnknown: boolean,
  ctx: WriterContext,
  file: SourceFile,
): void {
  const p = `value[${stringLiteral(slot.prop)}]`;
  if (slot.kind === 'element') {
    if (!ctx.complex(slot.type)) {
      const one = `v_${safe(slot.prop)}`;
      if (slot.cardinality.repeated) {
        file.block(`for (let idx = 0; idx < ${p}.length; idx++) {`, () => {
          file.line(`const ${one} = ${p}[idx];`);
          file.line(`if (${one} !== undefined) s.text(String(${one}));`);
          if (hasUnknown) file.line(`$q.flush(s, ${slotIndex}, idx);`);
        });
      } else {
        file.line(`if (${p} !== undefined) s.text(String(${p}));`);
      }
      return;
    }
    const w = ctx.writerFor(slot.type);
    const one = `v_${safe(slot.prop)}`;
    if (slot.cardinality.repeated) {
      file.block(`for (let idx = 0; idx < ${p}.length; idx++) {`, () => {
        file.line(`const ${one} = ${p}[idx]!;`);
        file.line(`${w}(s, ${one}, ctx, ${stringLiteral(slot.element.name)});`);
        if (hasUnknown) file.line(`$q.flush(s, ${slotIndex}, idx);`);
      });
    } else {
      file.line(`if (${p} !== undefined) ${w}(s, ${p}, ctx, ${stringLiteral(slot.element.name)});`);
    }
    return;
  }
  if (slot.kind === 'choice') {
    const one = `v_${safe(slot.prop)}`;
    // The `$raw` alternative exists only on REPEATING choices (see types.ts
    // emitChoiceUnion): a non-repeating choice holds exactly one recognized
    // alternative, and unknown content goes to `$unknown` instead. Emitting a
    // `$raw` branch here would compare against a union member that does not
    // exist — a compile error in the generated module, not a runtime concern.
    const rawBranch = slot.cardinality.repeated
      ? `if (${one}.kind === '$raw') { s.raw(${one}.value); }`
      : null;
    const write = (expr: string) => {
      const branches = slot.alternatives.map((a) => {
        if (!ctx.complex(a.type))
          return `if (${expr}.kind === ${stringLiteral(a.tag)}) s.text(String(${expr}.value));`;
        const w = ctx.writerFor(a.type);
        return `if (${expr}.kind === ${stringLiteral(a.tag)}) ${w}(s, ${expr}.value, ctx, ${stringLiteral(a.element.name)});`;
      });
      if (rawBranch) branches.push(rawBranch);
      return branches;
    };
    if (slot.cardinality.repeated)
      file.block(`for (const ${one} of ${p}) {`, () => write(one).forEach((x) => file.line(x)));
    else file.block(`if (${p} !== undefined) {`, () => write(p).forEach((x) => file.line(x)));
    return;
  }
  file.block(`for (const raw of ${p}) {`, () => file.line('s.raw(raw);'));
}

function safe(name: string): string {
  return name.replace(/[^A-Za-z0-9_$]/g, '_');
}
function byName(a: { tsName: string }, b: { tsName: string }): number {
  return a.tsName.localeCompare(b.tsName);
}
function builtinTs(name: string): string {
  return name === 'xsd:boolean'
    ? 'boolean'
    : name === 'xsd:string' || name === 'xsd:token'
      ? 'string'
      : 'number';
}
