/** DrawingML affine transforms (P9-08). Matrices use Canvas's [a,b,c,d,e,f]. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Extent {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [A, B, C, D, E, F] = right;
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}
export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}
export function scale(x: number, y: number): Matrix {
  return [x, 0, 0, y, 0, 0];
}
export function rotateRadians(angle: number): Matrix {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, 0, 0];
}
export function apply(matrix: Matrix, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}
export function shapeTransform(
  extent: Extent,
  rotation60k = 0,
  flipH = false,
  flipV = false,
): Matrix {
  const angle = ((rotation60k / 60000) * Math.PI) / 180;
  const centerX = extent.x + extent.cx / 2;
  const centerY = extent.y + extent.cy / 2;
  return multiply(
    translate(centerX, centerY),
    multiply(
      rotateRadians(angle),
      multiply(scale(flipH ? -1 : 1, flipV ? -1 : 1), translate(-centerX, -centerY)),
    ),
  );
}
export function groupTransform(group: {
  offX: number;
  offY: number;
  extCx: number;
  extCy: number;
  chOffX: number;
  chOffY: number;
  chExtCx: number;
  chExtCy: number;
}): Matrix {
  // A zero child extent is malformed input; preserving a finite transform lets
  // the caller paint a visible placeholder instead of crashing the frame.
  const sx = group.chExtCx === 0 ? 1 : group.extCx / group.chExtCx;
  const sy = group.chExtCy === 0 ? 1 : group.extCy / group.chExtCy;
  return multiply(
    translate(group.offX, group.offY),
    multiply(scale(sx, sy), translate(-group.chOffX, -group.chOffY)),
  );
}
