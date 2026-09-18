import { describe, expect, it } from 'vitest';
import { buildCacheKey, hashDirectProps, ResolvedPropertyCache } from './cache.js';
import type { ResolvedProperties } from './cascade.js';

describe('P3-11 Resolved-property cache', () => {
  function makeDummyResolved(bVal: string): ResolvedProperties {
    return {
      values: new Map([['b', bVal]]),
      provenance: new Map([['b', { layer: 'direct', value: bVal }]]),
    };
  }

  it('10,000 runs sharing a style produce exactly one cache entry with observable hit rate', () => {
    const cache = new ResolvedPropertyCache();
    const styleId = 'Normal';
    const directPropsHash = hashDirectProps(undefined);
    const contextHash = cache.computeContextHash();
    const key = buildCacheKey(styleId, directPropsHash, contextHash);

    // First access: miss and store
    let res = cache.get(key);
    expect(res).toBeUndefined();
    cache.set(key, makeDummyResolved('false'));

    // Next 9,999 accesses: hits
    for (let i = 0; i < 9999; i++) {
      res = cache.get(key);
      expect(res).toBeDefined();
    }

    const stats = cache.stats;
    expect(stats.size).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(9999);
    expect(stats.hitRate).toBeCloseTo(9999 / 10000, 4);
  });

  it('Trigger 1: styles.xml edited clears all cache entries and bumps stylesGen', () => {
    const cache = new ResolvedPropertyCache();
    const k1 = buildCacheKey('Normal', '0', cache.computeContextHash());
    const k2 = buildCacheKey('Heading1', '0', cache.computeContextHash());

    cache.set(k1, makeDummyResolved('false'));
    cache.set(k2, makeDummyResolved('true'));
    expect(cache.stats.size).toBe(2);

    cache.invalidateStyles();
    expect(cache.stats.size).toBe(0);
    expect(cache.generations.stylesGen).toBe(2);
    expect(cache.get(k1)).toBeUndefined();
  });

  it('Trigger 2: theme edited clears all cache entries and bumps themeGen', () => {
    const cache = new ResolvedPropertyCache();
    const k1 = buildCacheKey('Normal', '0', cache.computeContextHash());
    cache.set(k1, makeDummyResolved('false'));
    expect(cache.stats.size).toBe(1);

    cache.invalidateTheme();
    expect(cache.stats.size).toBe(0);
    expect(cache.generations.themeGen).toBe(2);
  });

  it('Trigger 3: numbering edited clears only numbering-dependent entries', () => {
    const cache = new ResolvedPropertyCache();
    const nonNumContext = cache.computeContextHash();
    const numContext = cache.computeContextHash({ numberingKey: 'num1_lvl0' });

    const kNonNum = buildCacheKey('Normal', '0', nonNumContext);
    const kNum = buildCacheKey('ListBullet', '0', numContext);

    cache.set(kNonNum, makeDummyResolved('false'));
    cache.set(kNum, makeDummyResolved('true'), { hasNumbering: true });

    expect(cache.stats.size).toBe(2);

    cache.invalidateNumbering();
    expect(cache.generations.numberingGen).toBe(2);

    // Non-numbering entry survives
    expect(cache.get(kNonNum)).toBeDefined();
    // Numbering entry was cleared
    expect(cache.get(kNum)).toBeUndefined();
  });

  it('Trigger 4: docDefaults edited clears all cache entries', () => {
    const cache = new ResolvedPropertyCache();
    const k = buildCacheKey('Normal', '0', cache.computeContextHash());
    cache.set(k, makeDummyResolved('false'));
    expect(cache.stats.size).toBe(1);

    cache.invalidateDocDefaults();
    expect(cache.stats.size).toBe(0);
    expect(cache.generations.docDefaultsGen).toBe(2);
  });

  it('Trigger 5: table structure changed invalidates table subtree conditions', () => {
    const cache = new ResolvedPropertyCache();
    const tableId = 'tbl_1';

    // Cell at row 0 (firstRow)
    const ctxFirstRow = cache.computeContextHash({
      tableId,
      tableConditions: 'firstRow',
    });
    const kFirstRow = buildCacheKey('TableGrid', '0', ctxFirstRow);

    // Cell at row 1 (lastRow before insertion)
    const ctxLastRow = cache.computeContextHash({
      tableId,
      tableConditions: 'lastRow',
    });
    const kLastRow = buildCacheKey('TableGrid', '0', ctxLastRow);

    cache.set(kFirstRow, makeDummyResolved('true'), { tableId });
    cache.set(kLastRow, makeDummyResolved('true'), { tableId });

    // An unrelated document-level entry
    const kOther = buildCacheKey('Normal', '0', cache.computeContextHash());
    cache.set(kOther, makeDummyResolved('false'));

    expect(cache.stats.size).toBe(3);

    // Insert row: table structure changed
    cache.invalidateTable(tableId);

    // Table entries cleared
    expect(cache.get(kFirstRow)).toBeUndefined();
    expect(cache.get(kLastRow)).toBeUndefined();
    // Unrelated document entry intact
    expect(cache.get(kOther)).toBeDefined();
  });
});
