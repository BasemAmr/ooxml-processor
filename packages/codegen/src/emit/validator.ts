/**
 * Emits `packages/schema/src/generated/<ns>/validator.ts`.
 *
 * Validators deliberately operate on the loose generated model rather than
 * narrowing its TypeScript properties. Requiredness is a diagnostic concern
 * (ADR 0010), and malformed values must remain round-trippable.
 */
import type { LogicalNs, TypeRef } from '../ir.js';
import type { ModelAttribute, ModelComplexType, ModelSet, ModelSimpleType, Slot } from '../model.js';
import { qnameKey } from '../ir.js';
import { STRING_FALLBACK_NS } from '../model.js';
import { BUILTIN_TS } from './types.js';
import type { EmittedModule } from './types.js';
import { generatedBanner, propertyKey, SourceFile, stringLiteral } from './source.js';

/** Builtin groups by their TypeScript representation, from the one table. */
const BUILTIN_GROUPS: Readonly<Record<string, readonly string[]>> = {
  string: Object.keys(BUILTIN_TS)
    .filter((k) => BUILTIN_TS[k] === 'string')
    .sort(),
  boolean: Object.keys(BUILTIN_TS)
    .filter((k) => BUILTIN_TS[k] === 'boolean')
    .sort(),
  number: Object.keys(BUILTIN_TS)
    .filter((k) => BUILTIN_TS[k] === 'number')
    .sort(),
};

const RUNTIME = '../../runtime/index.js';

export interface ValidatorOptions {
  /** Optional module banner description override, primarily useful to callers. */
  readonly sourceDescription?: string;
}

export function emitValidator(
  set: ModelSet,
  ns: LogicalNs,
  options: ValidatorOptions = {},
): EmittedModule {
  const file = new SourceFile(
    generatedBanner(
      options.sourceDescription ??
        `validators for the ${ns} namespace of the ECMA-376 5th edition schema set`,
    ),
  );
  const ctx = new ValidatorContext(set, ns, file);
  const simple = [...set.simpleTypes.values()].filter((x) => x.name.ns === ns).sort(byName);
  const complex = [...set.complexTypes.values()].filter((x) => x.name.ns === ns).sort(byName);
  // Reserve this module's own function names (and the preamble's helpers) so a
  // cross-namespace import of an identically named type's validator aliases
  // rather than colliding (TS2440).
  for (const st of simple) file.reserveLocal(`validate${st.tsName}`);
  for (const ct of complex) file.reserveLocal(`validate${ct.tsName}`);
  for (const local of ['issue', 'invalidEnum', 'validBuiltin', 'BUILTIN_GROUPS']) file.reserveLocal(local);
  emitPreamble(file, ctx);
  for (const st of simple) {
    emitSimpleValidator(st, ctx, file);
    file.blank();
  }
  for (const ct of complex) {
    emitComplexValidator(ct, ctx, file);
    file.blank();
  }
  return { path: `${ns}/validator.ts`, contents: file.toString() };
}

function emitPreamble(file: SourceFile, _ctx: ValidatorContext): void {
  file.line("export type ValidationCode = 'missing-required' | 'invalid-value' | 'facet-violation';");
  file.line('export interface ValidationIssue { readonly path: string; readonly code: ValidationCode; readonly message: string; }');
  file.line('export type ValidationResult = readonly ValidationIssue[];');
  file.line('function issue(path: string, code: ValidationCode, message: string): ValidationIssue { return { path, code, message }; }');
  file.line('function invalidEnum(path: string, value: unknown, values: ReadonlySet<string>): ValidationIssue { return issue(path, \'invalid-value\', `value ${String(value)} is not in the enumeration {${[...values].join(\', \')}}`); }');
  // The groups are generated from the types emitter's BUILTIN_TS table, so a
  // builtin's TypeScript representation and its validation check cannot drift.
  file.line('const BUILTIN_GROUPS = {');
  for (const [ts, names] of Object.entries(BUILTIN_GROUPS)) {
    file.indent(() => file.line(`${ts}: new Set([${names.map(stringLiteral).join(', ')}]),`));
  }
  file.line('};');
  file.line(
    'function validBuiltin(value: unknown, name: string): boolean {' +
      " if (BUILTIN_GROUPS.string.has(name)) return typeof value === 'string';" +
      " if (BUILTIN_GROUPS.boolean.has(name)) return typeof value === 'boolean';" +
      " if (BUILTIN_GROUPS.number.has(name)) return typeof value === 'number' && Number.isFinite(value);" +
      ' return false; }',
  );
  file.blank();
}

class ValidatorContext {
  constructor(
    readonly set: ModelSet,
    readonly ns: LogicalNs,
    readonly file: SourceFile,
  ) {}

  rt(name: string, typeOnly = false): string {
    return this.file.importName(RUNTIME, name, typeOnly);
  }

  typeName(ref: TypeRef): string {
    if (ref.kind === 'builtin') return builtinType(ref.name);
    const def = this.set.complexTypes.get(qnameKey(ref.ref)) ?? this.set.simpleTypes.get(qnameKey(ref.ref));
    if (!def && STRING_FALLBACK_NS.has(ref.ref.ns)) return 'string';
    if (!def) throw new Error(`Unresolved type reference ${qnameKey(ref.ref)}`);
    return this.file.importName(ref.ref.ns === this.ns ? './types.js' : `../${ref.ref.ns}/types.js`, def.tsName, true);
  }

  /**
   * `validateST_Foo`/`validateCT_Foo` for a named reference, or `undefined`
   * when there is nothing to call. A same-namespace validator is local to this
   * module — importing it from `./validator.js` would be a self-import
   * (TS2440). Foreign-namespace string types have no validator; the caller
   * falls back to a `typeof` check.
   */
  validator(ref: TypeRef): string | undefined {
    if (ref.kind === 'builtin') return undefined;
    const def = this.set.complexTypes.get(qnameKey(ref.ref)) ?? this.set.simpleTypes.get(qnameKey(ref.ref));
    if (!def) {
      if (STRING_FALLBACK_NS.has(ref.ref.ns)) return undefined;
      throw new Error(`Unresolved type reference ${qnameKey(ref.ref)}`);
    }
    if (ref.ref.ns === this.ns) return `validate${def.tsName}`;
    return this.file.importName(`../${ref.ref.ns}/validator.js`, `validate${def.tsName}`, false);
  }
}

function byName(a: { tsName: string }, b: { tsName: string }): number {
  return a.tsName < b.tsName ? -1 : a.tsName > b.tsName ? 1 : 0;
}

function emitSimpleValidator(st: ModelSimpleType, ctx: ValidatorContext, file: SourceFile): void {
  const name = `validate${st.tsName}`;
  file.block(`export function ${name}(value: unknown, path = ${stringLiteral(st.tsName)}): ValidationResult {`, () => {
    file.line('const issues: ValidationIssue[] = [];');
    emitPrimitiveCheck(st, file);
    if (st.repr.kind === 'enum') {
      const values = ctx.file.importName('./types.js', `${st.tsName}_VALUES`, false);
      file.line(`if (typeof value === 'string' && !${values}.has(value)) {`);
      file.indent(() => file.line(`issues.push(invalidEnum(path, value, ${values}));`));
      file.line('}');
    }
    if (st.repr.kind === 'number' || st.repr.kind === 'string') emitFacets(st.repr.facets, file);
    if (st.repr.kind === 'union') {
      file.line('let valid = false;');
      for (const member of st.repr.members) {
        const validator = ctx.validator(member);
        if (validator) file.line(`if (${validator}(value, path).length === 0) valid = true;`);
        else if (member.kind === 'builtin') file.line(`if (validBuiltin(value, ${stringLiteral(member.name)})) valid = true;`);
        else file.line("if (typeof value === 'string') valid = true;");
      }
      file.line('if (!valid) issues.push(issue(path, "invalid-value", "value does not match any union member"));');
    }
    file.line('return issues;');
  });
}

function emitPrimitiveCheck(st: ModelSimpleType, file: SourceFile): void {
  if (st.repr.kind === 'enum' || st.repr.kind === 'string' || st.repr.kind === 'union' || st.repr.kind === 'list') {
    file.line(`if (typeof value !== 'string') issues.push(issue(path, 'invalid-value', 'expected a string'));`);
  } else if (st.repr.kind === 'number') {
    file.line(`if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(issue(path, 'invalid-value', 'expected a finite number'));`);
  } else if (st.repr.kind === 'boolean') {
    file.line(`if (typeof value !== 'boolean') issues.push(issue(path, 'invalid-value', 'expected a boolean'));`);
  }
}

function emitFacets(facets: { readonly minInclusive?: string; readonly maxInclusive?: string; readonly minExclusive?: string; readonly maxExclusive?: string; readonly length?: number; readonly minLength?: number; readonly maxLength?: number; readonly pattern?: string }, file: SourceFile): void {
  const numeric = facets.minInclusive !== undefined || facets.maxInclusive !== undefined || facets.minExclusive !== undefined || facets.maxExclusive !== undefined;
  if (numeric) {
    if (facets.minInclusive !== undefined) file.line(`if (typeof value === 'number' && value < ${Number(facets.minInclusive)}) issues.push(issue(path, 'facet-violation', 'below minInclusive'));`);
    if (facets.maxInclusive !== undefined) file.line(`if (typeof value === 'number' && value > ${Number(facets.maxInclusive)}) issues.push(issue(path, 'facet-violation', 'above maxInclusive'));`);
    if (facets.minExclusive !== undefined) file.line(`if (typeof value === 'number' && value <= ${Number(facets.minExclusive)}) issues.push(issue(path, 'facet-violation', 'at or below minExclusive'));`);
    if (facets.maxExclusive !== undefined) file.line(`if (typeof value === 'number' && value >= ${Number(facets.maxExclusive)}) issues.push(issue(path, 'facet-violation', 'at or above maxExclusive'));`);
  }
  if (facets.length !== undefined) file.line(`if (typeof value === 'string' && value.length !== ${facets.length}) issues.push(issue(path, 'facet-violation', 'length mismatch'));`);
  if (facets.minLength !== undefined) file.line(`if (typeof value === 'string' && value.length < ${facets.minLength}) issues.push(issue(path, 'facet-violation', 'below minLength'));`);
  if (facets.maxLength !== undefined) file.line(`if (typeof value === 'string' && value.length > ${facets.maxLength}) issues.push(issue(path, 'facet-violation', 'above maxLength'));`);
  if (facets.pattern !== undefined) {
    const pattern = JSON.stringify(String(facets.pattern));
    file.line(`if (typeof value === 'string' && !(new RegExp(${pattern})).test(value)) issues.push(issue(path, 'facet-violation', 'pattern mismatch'));`);
  }
}

function emitComplexValidator(ct: ModelComplexType, ctx: ValidatorContext, file: SourceFile): void {
  file.block(`export function validate${ct.tsName}(value: unknown, path = ${stringLiteral(ct.tsName)}): ValidationResult {`, () => {
    file.line('const issues: ValidationIssue[] = [];');
    file.line(`if (value === null || typeof value !== 'object') return [issue(path, 'invalid-value', 'expected an object')];`);
    file.line('const v = value as Record<string, unknown>;');
    if (ct.content.kind === 'simpleContent') emitRefCheck('$value', ct.content.valueType, ctx, file);
    if (ct.content.kind === 'elements') for (const slot of ct.content.slots) emitSlot(slot, ctx, file);
    for (const attr of ct.attributes) emitAttribute(attr, ctx, file);
    file.line('return issues;');
  });
}

function emitSlot(slot: Slot, ctx: ValidatorContext, file: SourceFile): void {
  if (slot.kind === 'wildcard') return;
  if (slot.cardinality.repeated) {
    file.line(`if (!Array.isArray(v[${stringLiteral(slot.prop)}])) {`);
    file.indent(() => {
      if (slot.cardinality.required) file.line(`issues.push(issue(path + ${stringLiteral('.' + slot.prop)}, 'missing-required', 'required slot is absent or not an array'));`);
    });
    file.line('} else {');
    file.indent(() => {
      if (slot.cardinality.required) file.line(`if ((v[${stringLiteral(slot.prop)}] as readonly unknown[]).length === 0) issues.push(issue(path + ${stringLiteral('.' + slot.prop)}, 'missing-required', 'required slot is empty'));`);
      file.line(`for (let i = 0; i < (v[${stringLiteral(slot.prop)}] as readonly unknown[]).length; i += 1) {`);
      file.indent(() => emitSlotValue(slot, ctx, file, `(v[${stringLiteral(slot.prop)}] as readonly unknown[])[i]`, `path + ${stringLiteral('.' + slot.prop + '[')} + i + ']'`));
      file.line('}');
    });
    file.line('}');
    return;
  }
  file.line(`if (v[${stringLiteral(slot.prop)}] === undefined) {`);
  file.indent(() => { if (slot.cardinality.required) file.line(`issues.push(issue(path + ${stringLiteral('.' + slot.prop)}, 'missing-required', 'required slot is absent'));`); });
  file.line('} else {');
  file.indent(() => emitSlotValue(slot, ctx, file, `v[${stringLiteral(slot.prop)}]`, `path + ${stringLiteral('.' + slot.prop)}`));
  file.line('}');
}

function emitSlotValue(slot: Exclude<Slot, { kind: 'wildcard' }>, ctx: ValidatorContext, file: SourceFile, expr: string, path: string): void {
  if (slot.kind === 'element') {
    emitRefCheckExpr(expr, path, slot.type, ctx, file);
  } else {
    file.line(`if (${expr} && typeof ${expr} === 'object') {`);
    file.indent(() => {
      file.line(`const item = ${expr} as { kind?: unknown; value?: unknown };`);
      file.line(`if (item.kind !== '$raw') {`);
      file.indent(() => {
        for (const alt of slot.alternatives) {
          const validator = ctx.validator(alt.type);
          if (validator) file.line(`if (item.kind === ${stringLiteral(alt.tag)}) issues.push(...${validator}(item.value, ${path} + '.value'));`);
        }
        // Inside the `item.kind !== '$raw'` guard, so no `$raw` clause — a
        // redundant one is a TS2367 overlapping-comparison error, not noise.
        const unknownAlt = slot.alternatives
          .map((a) => `${stringLiteral(a.tag)} !== item.kind`)
          .join(' && ');
        file.line(`if (${unknownAlt}) issues.push(issue(${path}, 'invalid-value', 'unknown choice alternative'));`);
      });
      file.line('}');
    });
    file.line('}');
  }
}

function emitAttribute(attr: ModelAttribute, ctx: ValidatorContext, file: SourceFile): void {
  const prop = stringLiteral(attr.prop);
  file.line(`if (v[${prop}] === undefined) {`);
  file.indent(() => { if (attr.required) file.line(`issues.push(issue(path + ${stringLiteral('.' + attr.prop)}, 'missing-required', 'required attribute is absent'));`); });
  file.line('} else {');
  file.indent(() => emitRefCheck(attr.prop, attr.type, ctx, file));
  file.line('}');
}

function emitRefCheck(prop: string, ref: TypeRef, ctx: ValidatorContext, file: SourceFile): void {
  emitRefCheckExpr(`v[${stringLiteral(prop)}]`, `path + ${stringLiteral('.' + prop)}`, ref, ctx, file);
}
function emitRefCheckExpr(expr: string, path: string, ref: TypeRef, ctx: ValidatorContext, file: SourceFile): void {
  const validator = ctx.validator(ref);
  if (validator) file.line(`issues.push(...${validator}(${expr}, ${path}));`);
  else if (ref.kind === 'builtin') file.line(`if (!validBuiltin(${expr}, ${stringLiteral(ref.name)})) issues.push(issue(${path}, 'invalid-value', 'invalid ${ref.name}'));`);
  else if (STRING_FALLBACK_NS.has(ref.ref.ns)) file.line(`if (typeof ${expr} !== 'string') issues.push(issue(${path}, 'invalid-value', 'expected a string'));`);
}

function builtinType(name: string): string {
  const ts = BUILTIN_TS[name];
  if (!ts) throw new Error(`No TypeScript mapping for XSD built-in ${name}`);
  return ts;
}

// Kept local in generated output so validators do not depend on a second runtime API.
// This declaration is emitted once by the preamble through the helper body below.
const _unused = 0;
void _unused;
