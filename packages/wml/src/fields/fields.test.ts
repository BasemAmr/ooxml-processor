import { describe, expect, it } from 'vitest';
import { parseFieldInstruction } from './parser';
import { parseComplexFields } from './complex';
import { evaluateSimpleField } from './evaluate';
import type { CT_R, CT_SimpleField } from '@ooxml/schema';

const run = (...content: never[]) => ({ runInnerContent: content }) as unknown as CT_R;
const text = (kind: 't' | 'instrText', value: string) =>
  ({ kind, value: { $value: value } }) as never;
const fld = (fldCharType: 'begin' | 'separate' | 'end') =>
  ({ kind: 'fldChar', value: { fldCharType } }) as never;

describe('fields', () => {
  it('keeps quoted arguments and unknown switches', () => {
    const parsed = parseFieldInstruction('DATE \\@ "dd MMMM yyyy" \\x custom');
    expect(parsed.name).toBe('DATE');
    expect(parsed.switches[0]?.argument).toBe('dd MMMM yyyy');
    expect(parsed.switches[1]).toMatchObject({ letter: 'x', known: false });
  });

  it('parses nested fields with a stack', () => {
    const parsed = parseComplexFields([
      run(fld('begin')),
      run(text('instrText', 'IF ')),
      run(fld('begin')),
      run(text('instrText', 'PAGE')),
      run(fld('separate')),
      run(text('t', '2')),
      run(fld('end')),
      run(fld('separate')),
      run(text('t', 'yes')),
      run(fld('end')),
    ]);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.fields[0]?.children).toHaveLength(1);
    expect(parsed.fields[0]?.cachedResult).toBe('yes');
  });

  it('falls back to a cached result when evaluation is unavailable', () => {
    const field = {
      instr: 'PAGEREF Missing',
      pContent: [{ kind: 'r', value: { runInnerContent: [text('t', '7')] } }],
    } as unknown as CT_SimpleField;
    const value = evaluateSimpleField(field, {});
    expect(value.value).toBe('7');
    expect(value.recalculated).toBe(false);
    expect(value.diagnostic).toBe('field-evaluation-failed');
  });
});
