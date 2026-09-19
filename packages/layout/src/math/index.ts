/** P10-12: deterministic OMML nested-box layout with an explicit MATH-table audit. */

export type MathKind =
  | 'acc'
  | 'bar'
  | 'box'
  | 'borderBox'
  | 'd'
  | 'eqArr'
  | 'f'
  | 'func'
  | 'groupChr'
  | 'limLow'
  | 'limUpp'
  | 'm'
  | 'nary'
  | 'phant'
  | 'rad'
  | 'sPre'
  | 'sSub'
  | 'sSubSup'
  | 'sSup'
  | 'r'
  | 'oMath'
  | 'oMathPara';

export interface MathNode {
  readonly kind: MathKind;
  readonly text?: string;
  readonly children?: readonly MathNode[];
}

export interface MathBox {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
  readonly axisOffset: number;
  readonly italicCorrection: number;
  readonly children: readonly MathBoxChild[];
  readonly placeholder?: boolean;
}

export interface MathBoxChild {
  readonly box: MathBox;
  readonly x: number;
  readonly y: number;
}

export interface MathLayoutOptions {
  readonly fontSize?: number;
  readonly mathTableAvailable?: boolean;
  readonly display?: boolean;
  readonly diagnostics?: string[];
}

export interface MathTableAudit {
  readonly available: false;
  readonly constants: readonly string[];
  readonly glyphAssemblies: false;
  readonly reason: string;
}

const MATH_CONSTANTS = [
  'AxisHeight',
  'FractionNumeratorShiftUp',
  'FractionDenominatorShiftDown',
  'SuperscriptShiftUp',
  'SubscriptShiftDown',
  'StackTopDisplayStyleShiftUp',
  'StackBottomDisplayStyleShiftDown',
  'DelimiterSize',
] as const;

export function auditMathTable(): MathTableAudit {
  return {
    available: false,
    constants: MATH_CONSTANTS,
    glyphAssemblies: false,
    reason:
      'The current font/text stack exposes no OpenType MATH constants or glyph assemblies; exact OMML fidelity is unverified here.',
  };
}

function textBox(text: string, size: number): MathBox {
  const width = Math.max(size * 0.5, [...text].length * size * 0.55);
  return {
    width,
    ascent: size * 0.8,
    descent: size * 0.2,
    axisOffset: size * 0.25,
    italicCorrection: size * 0.04,
    children: [],
  };
}

function childrenOf(node: MathNode, options: MathLayoutOptions): MathBox[] {
  return (node.children ?? []).map((child) => layoutMath(child, options));
}

function horizontal(boxes: readonly MathBox[], gap: number, display: boolean): MathBox {
  const width =
    boxes.reduce((sum, box) => sum + box.width, 0) + Math.max(0, boxes.length - 1) * gap;
  const ascent = Math.max(0, ...boxes.map((box) => box.ascent));
  const descent = Math.max(0, ...boxes.map((box) => box.descent));
  let x = 0;
  const placed = boxes.map((box) => {
    const child = { box, x, y: 0 };
    x += box.width + gap;
    return child;
  });
  return {
    width,
    ascent,
    descent,
    axisOffset: display ? ascent * 0.42 : ascent * 0.35,
    italicCorrection: 0,
    children: placed,
  };
}

/** Lays out every OMML kind using a stable fallback metric model. */
export function layoutMath(node: MathNode, options: MathLayoutOptions = {}): MathBox {
  const size = options.fontSize ?? 16;
  const display = options.display || node.kind === 'oMathPara';
  if (options.mathTableAvailable === false)
    options.diagnostics?.includes('math-math-table-unavailable') ||
      options.diagnostics?.push('math-math-table-unavailable');
  if (node.kind === 'r') return textBox(node.text ?? '', size);
  const boxes = childrenOf(node, { ...options, display });
  if (node.kind === 'phant')
    return {
      width: boxes.reduce((sum, box) => sum + box.width, 0),
      ascent: size * 0.8,
      descent: size * 0.2,
      axisOffset: size * 0.25,
      italicCorrection: 0,
      children: [],
    };
  if (node.kind === 'f') {
    const numerator = boxes[0] ?? textBox('', size * 0.8);
    const denominator = boxes[1] ?? textBox('', size * 0.8);
    const gap = size * 0.2;
    const width = Math.max(numerator.width, denominator.width) + size * 0.4;
    return {
      width,
      ascent: numerator.ascent + numerator.descent + gap + size * 0.1,
      descent: denominator.ascent + denominator.descent + gap,
      axisOffset: size * 0.25,
      italicCorrection: 0,
      children: [
        { box: numerator, x: (width - numerator.width) / 2, y: -numerator.ascent - gap },
        { box: denominator, x: (width - denominator.width) / 2, y: gap },
      ],
    };
  }
  if (
    node.kind === 'sSup' ||
    node.kind === 'sSub' ||
    node.kind === 'sSubSup' ||
    node.kind === 'sPre'
  ) {
    const base = boxes[0] ?? textBox('', size);
    const scripts = boxes.slice(1);
    const scriptWidth = scripts.reduce((sum, box) => sum + box.width, 0);
    const extra = size * 0.15;
    return {
      width: base.width + scriptWidth + extra,
      ascent: base.ascent + (scripts[0]?.ascent ?? 0) * 0.7,
      descent: base.descent + (scripts[1]?.descent ?? scripts[0]?.descent ?? 0) * 0.7,
      axisOffset: base.axisOffset,
      italicCorrection: base.italicCorrection,
      children: [
        { box: base, x: node.kind === 'sPre' ? scriptWidth : 0, y: 0 },
        ...scripts.map((box, index) => ({
          box,
          x: node.kind === 'sPre' ? index * box.width : base.width + index * box.width,
          y: index === 0 ? -box.ascent * 0.7 : box.descent * 0.7,
        })),
      ],
    };
  }
  if (
    node.kind === 'd' ||
    node.kind === 'rad' ||
    node.kind === 'borderBox' ||
    node.kind === 'box' ||
    node.kind === 'bar' ||
    node.kind === 'acc' ||
    node.kind === 'groupChr'
  ) {
    const inner = horizontal(boxes, size * 0.1, display);
    const pad = size * 0.18;
    return {
      ...inner,
      width: inner.width + pad * 2,
      ascent: inner.ascent + pad,
      descent: inner.descent + pad,
      children: inner.children.map((child) => ({ ...child, x: child.x + pad })),
    };
  }
  if (node.kind === 'limLow' || node.kind === 'limUpp') {
    const base = boxes[0] ?? textBox('', size);
    const limit = boxes[1];
    if (!limit) return base;
    return {
      width: Math.max(base.width, limit.width),
      ascent: base.ascent + (node.kind === 'limUpp' ? limit.ascent : 0),
      descent: base.descent + (node.kind === 'limLow' ? limit.descent : 0),
      axisOffset: base.axisOffset,
      italicCorrection: base.italicCorrection,
      children: [
        { box: base, x: 0, y: 0 },
        {
          box: limit,
          x: (base.width - limit.width) / 2,
          y: node.kind === 'limUpp' ? -limit.ascent : limit.descent,
        },
      ],
    };
  }
  return horizontal(boxes, size * 0.12, display);
}
