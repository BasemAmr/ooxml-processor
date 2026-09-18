export type DropCapType = 'drop' | 'margin';

export interface DropCapPr {
  dropCap: DropCapType;
  lines: number;
}

export interface ExclusionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  isMargin: boolean;
}

/**
 * Creates an exclusion box for a drop cap.
 * Drop caps are implemented purely as float exclusions (P9-02) that the segment
 * machinery wraps around. There is no bespoke first-line logic for them.
 *
 * @param pr The w:framePr properties
 * @param containerX The X start of the text container
 * @param containerY The Y start of the paragraph
 * @param width The calculated width of the drop cap character frame
 * @param lineHeight The standard line height used to calculate total exclusion height based on @lines
 */
export function createDropCapExclusion(
  pr: DropCapPr,
  containerX: number,
  containerY: number,
  width: number,
  lineHeight: number,
): ExclusionBox {
  // @lines controls how many lines the drop cap spans.
  // The exclusion height is simply lines * standard line height.
  const height = pr.lines * lineHeight;

  // 'margin' places it outside the text area (to the left in LTR).
  // 'drop' places it inside the text area, displacing text to the right.
  const isMargin = pr.dropCap === 'margin';

  const x = isMargin ? containerX - width : containerX;

  return {
    x,
    y: containerY,
    width,
    height,
    isMargin,
  };
}
