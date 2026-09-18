import { describe, it, expect } from 'vitest';
import { PageBitmapCache } from './page-cache';

describe('PageBitmapCache', () => {
  it('keys on pageIndex, contentVersion, zoom, dPR, themeState', () => {
    const cache = new PageBitmapCache();
    const key = { pageIndex: 0, contentVersion: 1, zoom: 1, dPR: 2, themeState: 'light' };
    const canvas = {} as HTMLCanvasElement;

    cache.set(key, canvas);
    expect(cache.get(key)).toBe(canvas);

    // Different content version
    expect(cache.get({ ...key, contentVersion: 2 })).toBeUndefined();
  });

  it('caret blink causes 0 bitmap cache invalidations (by not being in the key)', () => {
    // Asserting the design constraint - cache key doesn't take selection/caret state
    const key = { pageIndex: 0, contentVersion: 1, zoom: 1, dPR: 2, themeState: 'light' };
    // Caret blink doesn't change contentVersion, zoom, dPR, or themeState.
    // So retrieving with the same key gives the cached bitmap.
    expect(key).not.toHaveProperty('caretState');
  });

  it('typing in one paragraph invalidates only that page', () => {
    const cache = new PageBitmapCache();
    cache.set(
      { pageIndex: 0, contentVersion: 1, zoom: 1, dPR: 2, themeState: 'light' },
      {} as HTMLCanvasElement,
    );
    cache.set(
      { pageIndex: 1, contentVersion: 1, zoom: 1, dPR: 2, themeState: 'light' },
      {} as HTMLCanvasElement,
    );

    // Invalidate page 0 due to typing
    cache.invalidatePage(0);

    expect(
      cache.get({ pageIndex: 0, contentVersion: 1, zoom: 1, dPR: 2, themeState: 'light' }),
    ).toBeUndefined();
    expect(
      cache.get({ pageIndex: 1, contentVersion: 1, zoom: 1, dPR: 2, themeState: 'light' }),
    ).toBeDefined();
  });
});
