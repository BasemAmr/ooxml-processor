/** Per-page float exclusion bands (P9-02/P9-03).
 *
 * Bands are kept sorted and queried with a lower-bound search. The common case
 * (no floats) stays allocation-free, while overlapping bands are unioned only
 * for the requested line band.
 */

export type WrapMode = 'none' | 'square' | 'tight' | 'through' | 'topAndBottom';
export type WrapText = 'bothSides' | 'left' | 'right' | 'largest';

export interface FloatRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly distTop?: number;
  readonly distBottom?: number;
  readonly distLeft?: number;
  readonly distRight?: number;
  readonly wrap?: WrapMode;
  readonly wrapText?: WrapText;
  readonly behindDoc?: boolean;
  readonly allowOverlap?: boolean;
  readonly relativeHeight?: number;
  readonly anchorPos?: number;
}

export interface AvailableSegment {
  readonly x: number;
  readonly width: number;
}
interface Band {
  top: number;
  bottom: number;
  intervals: Array<[number, number]>;
  fullWidth?: boolean;
}

function inflate(rect: FloatRect): [number, number, number, number] {
  const l = rect.distLeft ?? 0;
  const r = rect.distRight ?? 0;
  const t = rect.distTop ?? 0;
  const b = rect.distBottom ?? 0;
  return [rect.x - l, rect.y - t, rect.x + rect.width + r, rect.y + rect.height + b];
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const interval of intervals) {
    const last = out[out.length - 1];
    if (!last || interval[0] > last[1]) out.push([...interval]);
    else if (interval[1] > last[1]) last[1] = interval[1];
  }
  return out;
}

export class ExclusionStore {
  private bands: Band[] = [];

  clear(): void {
    this.bands.length = 0;
  }

  add(rect: FloatRect): void {
    if (rect.behindDoc || rect.wrap === undefined || rect.wrap === 'none') return;
    const [left, top, right, bottom] = inflate(rect);
    if (!(right > left && bottom > top)) return;
    const fullWidth = rect.wrap === 'topAndBottom';
    this.insertBand(top, bottom, [[left, right]], fullWidth);
  }

  /** Adds a polygon's per-band occupied intervals, used for tight/through wrapping. */
  addIntervals(top: number, bottom: number, intervals: Array<[number, number]>): void {
    if (bottom <= top || intervals.length === 0) return;
    this.insertBand(top, bottom, intervals, false);
  }

  private insertBand(
    top: number,
    bottom: number,
    intervals: Array<[number, number]>,
    fullWidth: boolean,
  ): void {
    const existing = this.bands.find((b) => b.top === top && b.bottom === bottom);
    if (existing) {
      existing.intervals.push(...intervals);
      existing.intervals = mergeIntervals(existing.intervals);
      existing.fullWidth = existing.fullWidth || fullWidth;
      return;
    }
    this.bands.push({ top, bottom, intervals: mergeIntervals(intervals), fullWidth });
    this.bands.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  }

  availableSegments(
    y: number,
    height: number,
    container: { x: number; width: number },
  ): AvailableSegment[] {
    const end = y + Math.max(0, height);
    if (this.bands.length === 0) return [{ x: container.x, width: container.width }];
    const occupied: Array<[number, number]> = [];
    // Lower-bound by band bottom; only subsequent bands can overlap the query.
    let i = 0;
    while (i < this.bands.length && this.bands[i]!.bottom <= y) i++;
    for (; i < this.bands.length; i++) {
      const band = this.bands[i]!;
      if (band.top >= end) break;
      if (band.fullWidth) occupied.push([container.x, container.x + container.width]);
      else occupied.push(...band.intervals);
    }
    const merged = mergeIntervals(
      occupied.map(([a, b]) => [
        Math.max(a, container.x),
        Math.min(b, container.x + container.width),
      ]),
    );
    const result: AvailableSegment[] = [];
    let cursor = container.x;
    for (const [left, right] of merged) {
      if (right <= left) continue;
      if (left > cursor) result.push({ x: cursor, width: left - cursor });
      cursor = Math.max(cursor, right);
    }
    if (cursor < container.x + container.width)
      result.push({ x: cursor, width: container.x + container.width - cursor });
    return result;
  }

  get size(): number {
    return this.bands.length;
  }

  /** Rebuilds a page deterministically and pushes non-overlapping floats down. */
  rebuild(rects: readonly FloatRect[]): void {
    this.clear();
    const placed: FloatRect[] = [];
    for (const input of resolveFloatOrder(rects)) {
      let rect = input;
      if (input.allowOverlap === false) {
        const step = Math.max(1, input.height + (input.distTop ?? 0) + (input.distBottom ?? 0));
        while (placed.some((other) => overlaps(rect, other))) rect = { ...rect, y: rect.y + step };
      }
      placed.push(rect);
      this.add(rect);
    }
  }
}

function overlaps(a: FloatRect, b: FloatRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function resolveFloatOrder(rects: readonly FloatRect[]): FloatRect[] {
  return [...rects].sort(
    (a, b) =>
      (a.relativeHeight ?? 0) - (b.relativeHeight ?? 0) || (a.anchorPos ?? 0) - (b.anchorPos ?? 0),
  );
}
