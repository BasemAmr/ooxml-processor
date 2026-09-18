import type { RunDirection } from '@ooxml/text';

export interface IndentProps {
  left?: number;
  right?: number;
  start?: number;
  end?: number;
  firstLine?: number;
  hanging?: number;
}

export interface ResolvedIndent {
  physicalLeft: number;
  physicalRight: number;
  firstLineIndent: number;
}

/**
 * Resolves paragraph indentation taking into account bidi logical vs physical properties,
 * and firstLine vs hanging interactions.
 *
 * Precedence: logical properties (start/end) take precedence over physical properties (left/right)
 * if both are specified. Undefined values resolve to 0.
 *
 * @param props The indentation properties from the paragraph style/direct formatting
 * @param direction The base paragraph direction
 */
export function resolveIndentation(props: IndentProps, direction: RunDirection): ResolvedIndent {
  // Logical start/end flip based on direction.
  // Precedence: start/end override left/right.
  let physicalLeft = 0;
  let physicalRight = 0;

  if (direction === 'rtl') {
    physicalLeft = props.end ?? props.left ?? 0;
    physicalRight = props.start ?? props.right ?? 0;
  } else {
    physicalLeft = props.start ?? props.left ?? 0;
    physicalRight = props.end ?? props.right ?? 0;
  }

  // Hanging and firstLine are mutually exclusive in practice.
  // Hanging is effectively a negative first-line indent, meaning the first line
  // starts at physicalLeft, and subsequent lines start at physicalLeft + hanging.
  // We represent this as a first-line offset from the base indent.
  let firstLineIndent = 0;

  if (props.hanging !== undefined && props.hanging !== 0) {
    // Hanging moves the first line to the left of the body indent.
    firstLineIndent = -props.hanging;
  } else if (props.firstLine !== undefined && props.firstLine !== 0) {
    // First line moves the first line to the right (for LTR) of the body indent.
    firstLineIndent = props.firstLine;
  }

  return {
    physicalLeft,
    physicalRight,
    firstLineIndent,
  };
}
