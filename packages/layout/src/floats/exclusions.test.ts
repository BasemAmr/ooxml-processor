import { describe, expect, it } from 'vitest';
import { ExclusionStore } from './exclusions.js';
import { polygonIntervalsForBand, scaleWrapPolygon } from './polygon.js';

describe('float exclusions', () => {
  it('leaves no exclusion for behind-document and none wraps', () => {
    const store = new ExclusionStore();
    store.add({ x: 20, y: 0, width: 30, height: 30, behindDoc: true, wrap: 'square' });
    store.add({ x: 20, y: 0, width: 30, height: 30, wrap: 'none' });
    expect(store.availableSegments(0, 10, { x: 0, width: 100 })).toEqual([{ x: 0, width: 100 }]);
  });
  it('unions overlapping bands into multiple free segments', () => {
    const store = new ExclusionStore();
    store.add({ x: 20, y: 0, width: 20, height: 30, wrap: 'square' });
    store.add({ x: 60, y: 0, width: 20, height: 30, wrap: 'square' });
    expect(store.availableSegments(5, 10, { x: 0, width: 100 })).toEqual([
      { x: 0, width: 20 },
      { x: 40, width: 20 },
      { x: 80, width: 20 },
    ]);
  });
  it('wrapTopAndBottom occupies the complete container width', () => {
    const store = new ExclusionStore();
    store.add({ x: 20, y: 0, width: 20, height: 30, wrap: 'topAndBottom' });
    expect(store.availableSegments(5, 10, { x: 0, width: 100 })).toEqual([]);
  });
  it('rebuilds overlap resolution in height then anchor order', () => {
    const store = new ExclusionStore();
    store.rebuild([
      {
        x: 0,
        y: 0,
        width: 20,
        height: 10,
        wrap: 'square',
        allowOverlap: false,
        relativeHeight: 2,
        anchorPos: 2,
      },
      {
        x: 0,
        y: 0,
        width: 20,
        height: 10,
        wrap: 'square',
        allowOverlap: false,
        relativeHeight: 1,
        anchorPos: 1,
      },
    ]);
    expect(store.availableSegments(0, 10, { x: 0, width: 30 })).toEqual([{ x: 20, width: 10 }]);
    expect(store.availableSegments(10, 10, { x: 0, width: 30 })).toEqual([{ x: 20, width: 10 }]);
  });
});

describe('wrap polygon', () => {
  it('scales the 21600 coordinate space and intersects a line band', () => {
    const triangle = scaleWrapPolygon(
      [
        { x: 0, y: 0 },
        { x: 21600, y: 0 },
        { x: 10800, y: 21600 },
      ],
      100,
      100,
    );
    expect(polygonIntervalsForBand(triangle, 0, 10)).toEqual([[0, 100]]);
    expect(polygonIntervalsForBand(triangle, 90, 100)).toEqual([[45, 55]]);
  });
  it('retains individual spans for through wrapping', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    expect(polygonIntervalsForBand(points, 10, 20, true)).toEqual([[0, 100]]);
  });
});
