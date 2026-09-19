import type { CT_R, CT_R_RunInnerContent } from '@ooxml/schema';
import { parseFieldInstruction, type FieldInstruction } from './parser.js';

export interface FieldDiagnostic {
  readonly code: 'unbalanced-begin' | 'unbalanced-end';
  readonly runIndex: number;
}

export interface FieldNode {
  readonly instruction: FieldInstruction;
  readonly cachedResult: string;
  readonly startRun: number;
  readonly endRun: number;
  readonly balanced: boolean;
  readonly children: readonly FieldNode[];
}

interface Frame {
  readonly startRun: number;
  instructionText: string;
  sawSeparate: boolean;
  resultText: string;
  children: FieldNode[];
}

function textOf(content: CT_R_RunInnerContent): string {
  return content.kind === 't' ||
    content.kind === 'instrText' ||
    content.kind === 'delText' ||
    content.kind === 'delInstrText'
    ? content.value.$value
    : '';
}

/** Recognises nested complex fields while leaving the source runs untouched. */
export function parseComplexFields(runs: readonly CT_R[]): {
  fields: readonly FieldNode[];
  diagnostics: readonly FieldDiagnostic[];
} {
  const stack: Frame[] = [];
  const fields: FieldNode[] = [];
  const diagnostics: FieldDiagnostic[] = [];
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex]!;
    for (const content of run.runInnerContent) {
      if (content.kind === 'fldChar') {
        const type = content.value.fldCharType;
        if (type === 'begin') {
          stack.push({
            startRun: runIndex,
            instructionText: '',
            sawSeparate: false,
            resultText: '',
            children: [],
          });
        } else if (type === 'separate') {
          const frame = stack[stack.length - 1];
          if (frame) frame.sawSeparate = true;
          else diagnostics.push({ code: 'unbalanced-end', runIndex });
        } else if (type === 'end') {
          const frame = stack.pop();
          if (!frame) {
            diagnostics.push({ code: 'unbalanced-end', runIndex });
            continue;
          }
          const node: FieldNode = {
            instruction: parseFieldInstruction(frame.instructionText.trim()),
            cachedResult: frame.resultText,
            startRun: frame.startRun,
            endRun: runIndex,
            balanced: frame.sawSeparate,
            children: frame.children,
          };
          const parent = stack[stack.length - 1];
          if (parent) {
            parent.children.push(node);
            if (parent.sawSeparate) parent.resultText += frame.resultText;
            else parent.instructionText += frame.resultText;
          } else fields.push(node);
        }
        continue;
      }
      const value = textOf(content);
      const frame = stack[stack.length - 1];
      if (!frame || value.length === 0) continue;
      if (frame.sawSeparate) frame.resultText += value;
      else if (content.kind === 'instrText') frame.instructionText += value;
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    diagnostics.push({ code: 'unbalanced-begin', runIndex: frame.startRun });
  }
  return { fields, diagnostics };
}
