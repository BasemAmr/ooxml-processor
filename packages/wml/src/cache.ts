/**
 * Resolved-property cache with exact generation-based invalidation (P3-11).
 *
 * ## Principles
 * 1. Cache key MUST NOT be NodeId. Keying by node gives one entry per run and zero reuse.
 *    Key is (styleId, directPropsHash, contextHash).
 * 2. 10,000 runs sharing a style produce exactly ONE entry in the cache.
 * 3. Exact invalidation via generation counters on styleTable, theme, numbering, and docDefaults.
 * 4. Table structure changes invalidate conditions on rows/cells (e.g. lastRow movement).
 */

import type { ResolvedProperties } from './cascade.js';

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
  readonly hitRate: number;
}

export interface InvalidationGenerations {
  stylesGen: number;
  themeGen: number;
  numberingGen: number;
  docDefaultsGen: number;
}

/**
 * Deterministic hash for direct property bag or AST.
 */
export function hashDirectProps(props: unknown): string {
  if (props === undefined || props === null) return '0';
  if (typeof props !== 'object') return String(props);
  const keys = Object.keys(props as object).sort();
  if (keys.length === 0) return '0';

  // Fast stringification with sorted keys for canonical representation
  const entries: string[] = [];
  for (const k of keys) {
    const val = (props as Record<string, any>)[k];
    if (val !== undefined) {
      entries.push(`${k}:${typeof val === 'object' ? hashDirectProps(val) : String(val)}`);
    }
  }
  return entries.length === 0 ? '0' : entries.join(';');
}

/**
 * Composite cache key for resolved run or paragraph properties.
 */
export function buildCacheKey(
  styleId: string | undefined,
  directPropsHash: string,
  contextHash: string,
): string {
  return `${styleId ?? ''}|${directPropsHash}|${contextHash}`;
}

export class ResolvedPropertyCache {
  private readonly _cache = new Map<string, ResolvedProperties>();
  private readonly _tableKeys = new Map<string, Set<string>>(); // tableId -> Set<cacheKey>
  private readonly _numberingKeys = new Set<string>(); // cacheKeys dependent on numbering

  private _hits = 0;
  private _misses = 0;

  private _stylesGen = 1;
  private _themeGen = 1;
  private _numberingGen = 1;
  private _docDefaultsGen = 1;
  private _tableGenerations = new Map<string, number>();

  get generations(): Readonly<InvalidationGenerations> {
    return {
      stylesGen: this._stylesGen,
      themeGen: this._themeGen,
      numberingGen: this._numberingGen,
      docDefaultsGen: this._docDefaultsGen,
    };
  }

  get stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      size: this._cache.size,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  /**
   * Produce a context hash folding in current subsystem generation counters.
   */
  computeContextHash(opts?: {
    tableId?: string;
    tableConditions?: string;
    numberingKey?: string;
    compatHash?: string;
  }): string {
    const tableGen = opts?.tableId ? (this._tableGenerations.get(opts.tableId) ?? 1) : 0;
    return (
      `s${this._stylesGen}` +
      `_t${this._themeGen}` +
      `_n${this._numberingGen}` +
      `_d${this._docDefaultsGen}` +
      (opts?.tableId ? `_tbl${opts.tableId}:g${tableGen}:c${opts.tableConditions ?? ''}` : '') +
      (opts?.numberingKey ? `_num:${opts.numberingKey}` : '') +
      (opts?.compatHash ? `_c:${opts.compatHash}` : '')
    );
  }

  /**
   * Look up a cached resolved property bag.
   */
  get(key: string): ResolvedProperties | undefined {
    const hit = this._cache.get(key);
    if (hit !== undefined) {
      this._hits++;
      return hit;
    }
    this._misses++;
    return undefined;
  }

  /**
   * Store a resolved property bag in the cache.
   */
  set(
    key: string,
    resolved: ResolvedProperties,
    tracking?: { tableId?: string; hasNumbering?: boolean },
  ): void {
    this._cache.set(key, resolved);
    if (tracking?.tableId !== undefined) {
      let set = this._tableKeys.get(tracking.tableId);
      if (set === undefined) {
        set = new Set<string>();
        this._tableKeys.set(tracking.tableId, set);
      }
      set.add(key);
    }
    if (tracking?.hasNumbering) {
      this._numberingKeys.add(key);
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Invalidation triggers (5 triggers from P3-11)                             */
  /* -------------------------------------------------------------------------- */

  /**
   * Trigger 1: styles.xml edited -> clear all.
   */
  invalidateStyles(): void {
    this._stylesGen++;
    this.clear();
  }

  /**
   * Trigger 2: theme edited -> clear all.
   */
  invalidateTheme(): void {
    this._themeGen++;
    this.clear();
  }

  /**
   * Trigger 3: numbering edited -> clear entries whose contextHash includes numbering.
   */
  invalidateNumbering(): void {
    this._numberingGen++;
    for (const key of this._numberingKeys) {
      this._cache.delete(key);
    }
    this._numberingKeys.clear();
  }

  /**
   * Trigger 4: docDefaults edited -> clear all.
   */
  invalidateDocDefaults(): void {
    this._docDefaultsGen++;
    this.clear();
  }

  /**
   * Trigger 5: table structure changed (e.g. row inserted/deleted) -> invalidate table subtree.
   * Moving conditions (like lastRow) invalidates cells whose coordinates changed role.
   */
  invalidateTable(tableId: string): void {
    const current = this._tableGenerations.get(tableId) ?? 1;
    this._tableGenerations.set(tableId, current + 1);

    const keys = this._tableKeys.get(tableId);
    if (keys !== undefined) {
      for (const key of keys) {
        this._cache.delete(key);
      }
      keys.clear();
    }
  }

  /**
   * Completely clear the cache.
   */
  clear(): void {
    this._cache.clear();
    this._tableKeys.clear();
    this._numberingKeys.clear();
  }

  /**
   * Reset stats counters.
   */
  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
  }
}
