/** Scanline intersections for wp:wrapPolygon coordinates (P9-04). */
export interface PolygonPoint {
  readonly x: number;
  readonly y: number;
}
export function scaleWrapPolygon(
  points: readonly PolygonPoint[],
  width: number,
  height: number,
): PolygonPoint[] {
  return points.map((p) => ({ x: (p.x * width) / 21600, y: (p.y * height) / 21600 }));
}

export function polygonIntervalsForBand(
  points: readonly PolygonPoint[],
  yTop: number,
  yBottom: number,
  through = false,
): Array<[number, number]> {
  if (points.length < 2 || yBottom <= yTop) return [];
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (a.y >= yTop && a.y <= yBottom) xs.push(a.x);
    if ((a.y < yTop && b.y >= yTop) || (b.y < yTop && a.y >= yTop))
      xs.push(a.x + ((b.x - a.x) * (yTop - a.y)) / (b.y - a.y));
    if ((a.y < yBottom && b.y >= yBottom) || (b.y < yBottom && a.y >= yBottom))
      xs.push(a.x + ((b.x - a.x) * (yBottom - a.y)) / (b.y - a.y));
  }
  xs.sort((a, b) => a - b);
  if (xs.length < 2) return [];
  const unique = xs.filter((value, index) => index === 0 || value !== xs[index - 1]);
  if (through && unique.length === 2) return [[unique[0]!, unique[1]!]];
  if (!through) return [[xs[0]!, xs[xs.length - 1]!]];
  const spans: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i]!, xs[i + 1]!]);
  return spans;
}
