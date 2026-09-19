import type { CT_SimpleField } from '@ooxml/schema';
import { parseFieldInstruction, type FieldInstruction } from './parser.js';

export type FieldPolicy = 'ALWAYS' | 'ON_OPEN' | 'NEVER' | 'DIRTY';

export interface FieldContext {
  readonly page?: number | undefined;
  readonly numPages?: number | undefined;
  readonly sectionPages?: number | undefined;
  readonly bookmarks?: ReadonlyMap<string, string> | undefined;
  readonly sequence?: ReadonlyMap<string, number> | undefined;
  readonly now?: Date | undefined;
}

export interface FieldValue {
  readonly instruction: FieldInstruction;
  readonly value: string;
  readonly recalculated: boolean;
  readonly diagnostic?: string | undefined;
}

export function policyForField(name: string, locked = false): FieldPolicy {
  if (locked) return 'NEVER';
  switch (name.toUpperCase()) {
    case 'PAGE':
    case 'NUMPAGES':
    case 'SECTIONPAGES':
    case 'PAGEREF':
    case 'STYLEREF':
      return 'ALWAYS';
    case 'DATE':
    case 'TIME':
    case 'CREATEDATE':
    case 'SAVEDATE':
    case 'SEQ':
      return 'ON_OPEN';
    case 'MERGEFIELD':
    case 'HYPERLINK':
    case 'TOC':
      return 'NEVER';
    default:
      return 'NEVER';
  }
}

function cachedText(field: CT_SimpleField): string {
  return field.pContent
    .map((content) =>
      content.kind === 'r'
        ? content.value.runInnerContent
            .filter((item) => item.kind === 't')
            .map((item) => item.value.$value)
            .join('')
        : '',
    )
    .join('');
}

function evaluate(instruction: FieldInstruction, context: FieldContext): string | undefined {
  switch (instruction.name) {
    case 'PAGE':
      return context.page === undefined ? undefined : String(context.page);
    case 'NUMPAGES':
      return context.numPages === undefined ? undefined : String(context.numPages);
    case 'SECTIONPAGES':
      return context.sectionPages === undefined ? undefined : String(context.sectionPages);
    case 'REF':
    case 'PAGEREF':
      return context.bookmarks?.get(instruction.arguments[0] ?? '');
    case 'SEQ':
      return String((context.sequence?.get(instruction.arguments[0] ?? '') ?? 0) + 1);
    case 'DATE':
    case 'TIME': {
      const date = context.now ?? new Date();
      const format = instruction.switches.find((item) => item.letter === '@')?.argument;
      if (format === undefined) return date.toLocaleDateString('en-US');
      // Word date pictures are a separate grammar; support common tokens while
      // preserving the source instruction for unsupported pictures.
      return format
        .replace(/yyyy/g, String(date.getFullYear()))
        .replace(/MMMM/g, date.toLocaleString('en-US', { month: 'long' }))
        .replace(/MM/g, String(date.getMonth() + 1).padStart(2, '0'))
        .replace(/dd/g, String(date.getDate()).padStart(2, '0'));
    }
    default:
      return undefined;
  }
}

export function evaluateSimpleField(
  field: CT_SimpleField,
  context: FieldContext = {},
  recalculate = true,
): FieldValue {
  const instruction = parseFieldInstruction(field.instr ?? '');
  const cached = cachedText(field);
  const locked = field.fldLock === true || field.fldLock === 'on';
  const policy = policyForField(instruction.name, locked);
  const dirty = field.dirty === true || field.dirty === 'on';
  if (!recalculate || policy === 'NEVER' || (policy === 'DIRTY' && !dirty))
    return { instruction, value: cached || instruction.raw, recalculated: false };
  const value = evaluate(instruction, context);
  if (value !== undefined) return { instruction, value, recalculated: true };
  return {
    instruction,
    value: cached || instruction.raw,
    recalculated: false,
    diagnostic: 'field-evaluation-failed',
  };
}
