import type { ExclusionStore, AvailableSegment } from './exclusions.js';

export interface SegmentItem<T = unknown> {
  readonly value: T;
  readonly width: number;
}

export interface PlacedSegmentItem<T = unknown> {
  readonly value: T;
  readonly x: number;
  readonly width: number;
}

export interface LaidOutSegment<T = unknown> extends AvailableSegment {
  items: PlacedSegmentItem<T>[];
  extraSpace: number;
}

export interface SegmentedLine<T = unknown> {
  readonly y: number;
  readonly height: number;
  readonly segments: readonly LaidOutSegment<T>[];
  readonly skipped: boolean;
  readonly retried: boolean;
  readonly diagnostic?: 'height-crossed-exclusion-band';
}

export interface SegmentedLineOptions {
  readonly justify?: boolean;
  readonly measureHeight?: (segments: readonly LaidOutSegment<unknown>[]) => number;
}

/**
 * Greedily places inline items into the free intervals for one line band.
 * Items are never dropped: an item wider than an empty interval is placed there
 * and the caller can decide how to shape/overflow it. This guarantees that a
 * fully excluded band advances instead of spinning on the same y coordinate.
 */
export function layoutLineAcrossSegments<T>(
  y: number,
  provisionalHeight: number,
  items: readonly SegmentItem<T>[],
  exclusions: ExclusionStore,
  container: { readonly x: number; readonly width: number },
  options: SegmentedLineOptions = {},
): SegmentedLine<T> {
  const first = exclusions.availableSegments(y, provisionalHeight, container);
  if (first.length === 0) {
    return { y, height: provisionalHeight, segments: [], skipped: true, retried: false };
  }

  const place = (available: readonly AvailableSegment[]): LaidOutSegment<T>[] => {
    const out = available.map((segment) => ({
      ...segment,
      items: [] as PlacedSegmentItem<T>[],
      extraSpace: 0,
    }));
    let itemIndex = 0;
    for (const segment of out) {
      let cursor = segment.x;
      while (itemIndex < items.length) {
        const item = items[itemIndex]!;
        if (!(Number.isFinite(item.width) && item.width >= 0)) {
          throw new RangeError('line item width must be a finite non-negative number');
        }
        const used = cursor - segment.x;
        if (used > 0 && used + item.width > segment.width) break;
        segment.items.push({ value: item.value, x: cursor, width: item.width });
        cursor += item.width;
        itemIndex += 1;
        if (cursor >= segment.x + segment.width) break;
      }
      segment.extraSpace = Math.max(0, segment.width - (cursor - segment.x));
    }
    if (itemIndex !== items.length) {
      // Remaining items are kept in the final segment. A line breaker can turn
      // this into a new line; keeping them here makes this helper lossless.
      const last = out[out.length - 1]!;
      let cursor =
        last.items.length === 0
          ? last.x
          : last.items[last.items.length - 1]!.x + last.items[last.items.length - 1]!.width;
      for (; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex]!;
        last.items.push({ value: item.value, x: cursor, width: item.width });
        cursor += item.width;
      }
      last.extraSpace = Math.max(0, last.width - (cursor - last.x));
    }
    return out;
  };

  const firstPlaced = place(first);
  const measured =
    options.measureHeight?.(firstPlaced as readonly LaidOutSegment<unknown>[]) ?? provisionalHeight;
  const second =
    measured !== provisionalHeight ? exclusions.availableSegments(y, measured, container) : first;
  const retried = second !== first;
  const segments = retried ? place(second) : firstPlaced;
  const diagnostic =
    retried && exclusions.availableSegments(y, measured, container).length !== first.length
      ? ('height-crossed-exclusion-band' as const)
      : undefined;

  if (options.justify) justifySegments(segments);
  return diagnostic === undefined
    ? { y, height: measured, segments, skipped: false, retried }
    : { y, height: measured, segments, skipped: false, retried, diagnostic };
}

/** Distributes leftover width independently inside every free segment. */
export function justifySegments<T>(segments: LaidOutSegment<T>[]): void {
  for (const segment of segments) {
    if (segment.items.length < 2 || segment.extraSpace <= 0) continue;
    const gap = segment.extraSpace / (segment.items.length - 1);
    let cursor = segment.x;
    for (let index = 0; index < segment.items.length; index += 1) {
      const item = segment.items[index]!;
      segment.items[index] = { ...item, x: cursor };
      cursor += item.width + (index + 1 < segment.items.length ? gap : 0);
    }
    segment.extraSpace = 0;
  }
}

export const integrateLineSegments = layoutLineAcrossSegments;
