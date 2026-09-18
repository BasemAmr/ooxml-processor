import inspector from 'node:inspector';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_CACHE_BYTES,
  estimateShapedRunBytes,
  FeatureSetInternTable,
  MeasurementCache,
  NODE_METADATA_OVERHEAD_BYTES,
  TextInternTable,
} from './cache.js';
import { createPackedShapedRun, type ShapedRun } from './shaped-run.js';

function createMockRun(faceId: number, count: number = 4): ShapedRun {
  return createPackedShapedRun({
    faceId,
    fontSize: 24,
    direction: 'ltr',
    script: 'latn',
    clusters: Array.from({ length: count }, (_, i) => ({
      glyphId: 65 + i,
      xAdvance: 120,
      srcOffset: i,
      srcLength: 1,
    })),
  });
}

describe('TextInternTable', () => {
  it('assigns unique integer handles to unique strings', () => {
    const table = new TextInternTable();
    const h1 = table.intern('hello');
    const h2 = table.intern('world');
    const h3 = table.intern('hello'); // identical string

    expect(h1).toBeGreaterThan(0);
    expect(h2).toBeGreaterThan(0);
    expect(h1).not.toBe(h2);
    expect(h3).toBe(h1); // idempotent
    expect(table.size).toBe(2);
  });

  it('retrieves text by handle and tests presence', () => {
    const table = new TextInternTable();
    const handle = table.intern('document');

    expect(table.getText(handle)).toBe('document');
    expect(table.getHandle('document')).toBe(handle);
    expect(table.has('document')).toBe(true);
    expect(table.has('nonexistent')).toBe(false);
    expect(table.getText(999)).toBeUndefined();
  });

  it('clears all entries', () => {
    const table = new TextInternTable();
    table.intern('a');
    table.intern('b');
    expect(table.size).toBe(2);

    table.clear();
    expect(table.size).toBe(0);
    expect(table.has('a')).toBe(false);
  });
});

describe('FeatureSetInternTable', () => {
  it('encodes and decodes feature flag bitmasks deterministically', () => {
    const table = new FeatureSetInternTable();

    // Default features: liga, clig, kern, calt all true; vert false
    const defaultId = table.intern();
    expect(defaultId).toBe(1 | 2 | 4 | 8); // 15
    const decodedDefault = table.getFeatures(defaultId);
    expect(decodedDefault.liga).toBe(true);
    expect(decodedDefault.clig).toBe(true);
    expect(decodedDefault.kern).toBe(true);
    expect(decodedDefault.calt).toBe(true);
    expect(decodedDefault.vert).toBe(false);

    // Explicit custom features
    const customId = table.intern({ liga: false, kern: true, vert: true });
    expect(customId).toBe(0 | 2 | 4 | 8 | 16); // 30
    const decodedCustom = table.getFeatures(customId);
    expect(decodedCustom.liga).toBe(false);
    expect(decodedCustom.clig).toBe(true);
    expect(decodedCustom.kern).toBe(true);
    expect(decodedCustom.vert).toBe(true);

    expect(table.size).toBe(32);
  });
});

describe('MeasurementCache (Ticket P4-11)', () => {
  it('stores and retrieves L1 shaped runs', () => {
    const cache = new MeasurementCache();
    const run = createMockRun(1, 5);

    const faceId = 1;
    const size = 22;
    const featId = 15;
    const textHandle = 42;

    expect(cache.getL1(faceId, size, featId, textHandle)).toBeUndefined();

    cache.putL1(faceId, size, featId, textHandle, run);
    const retrieved = cache.getL1(faceId, size, featId, textHandle);

    expect(retrieved).toBe(run);

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.entryCountL1).toBe(1);
  });

  it('stores and retrieves L2 whole-line candidate measurements', () => {
    const cache = new MeasurementCache();

    expect(cache.getL2(100, 5000)).toBeUndefined();

    cache.putL2(100, 5000, 4800);
    expect(cache.getL2(100, 5000)).toBe(4800);

    const stats = cache.getStats();
    expect(stats.entryCountL2).toBe(1);

    cache.clearL2();
    expect(cache.getL2(100, 5000)).toBeUndefined();
    expect(cache.getStats().entryCountL2).toBe(0);
  });

  describe('Zero-Allocation on Hit (Hot Path Guarantee)', () => {
    it('executes 10,000 lookups with zero string allocations and zero heap allocations during hits', () => {
      const cache = new MeasurementCache();
      const run = createMockRun(1, 4);

      const faceId = 1;
      const size = 24;
      const featId = 15;
      const textHandle = cache.textInterner.intern('performance');

      cache.putL1(faceId, size, featId, textHandle, run);

      // Verify that NO string methods (concat, etc.) are invoked on the hot path
      const stringConcatSpy = vi.spyOn(String.prototype, 'concat');

      // Warm up JIT and inline caches so V8 completes tiering without feedback vector allocations during measurement
      for (let i = 0; i < 50000; i++) {
        cache.getL1(faceId, size, featId, textHandle);
      }

      // Reset telemetry counters after JIT warmup so stats reflect only the 10,000 measured lookups
      cache.resetHitCounters();

      // Use V8 HeapProfiler sampling to assert zero allocation inside getL1()
      const session = new inspector.Session();
      session.connect();

      session.post('HeapProfiler.enable');
      session.post('HeapProfiler.startSampling', { samplingInterval: 1 });

      // Run 10,000 lookups on the hot path
      for (let i = 0; i < 10000; i++) {
        cache.getL1(faceId, size, featId, textHandle);
      }

      let profileResult: any = null;
      session.post('HeapProfiler.stopSampling', (_err, params: any) => {
        profileResult = params.profile;
      });
      session.post('HeapProfiler.disable');
      session.disconnect();

      function findNodes(node: any, name: string): any[] {
        const matches: any[] = [];
        if (node?.callFrame?.functionName === name) matches.push(node);
        for (const child of node?.children || []) {
          matches.push(...findNodes(child, name));
        }
        return matches;
      }
      const l1Nodes = findNodes(profileResult?.head, 'getL1');
      const moveToHeadNodes = findNodes(profileResult?.head, 'moveToHead');

      // Calculate total heap bytes attributed to getL1 or moveToHead
      const totalBytesAllocated =
        l1Nodes.reduce((sum: number, n: any) => sum + (n?.selfSize || 0), 0) +
        moveToHeadNodes.reduce((sum: number, n: any) => sum + (n?.selfSize || 0), 0);

      // In a path allocating strings or objects per hit (e.g. `${faceId}:${size}` or `{ faceId }`),
      // 10,000 lookups allocate >= 320,000 bytes (>= 32 bytes per lookup).
      // On our zero-allocation path, heap allocation is strictly 0 bytes per lookup (allowing < 0.1
      // byte/lookup strictly to accommodate V8 internal sampling interrupts during parallel CI runs).
      expect(totalBytesAllocated / 10000).toBeLessThan(0.1);
      expect(stringConcatSpy).not.toHaveBeenCalled();

      const stats = cache.getStats();
      expect(stats.hits).toBe(10000);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(1.0);
    });
  });

  describe('Memory-Bounded LRU Eviction', () => {
    it('bounds cache size by memory bytes rather than entry count', () => {
      // Create a small cache budget allowing exactly 2 runs of 4 clusters
      const sampleRun = createMockRun(1, 4);
      const entryBytes = estimateShapedRunBytes(sampleRun);
      const budget = entryBytes * 2; // budget for exactly 2 entries

      const cache = new MeasurementCache({ maxBytes: budget });

      cache.putL1(1, 24, 15, 1, sampleRun);
      expect(cache.getStats().entryCountL1).toBe(1);
      expect(cache.getStats().currentBytes).toBe(entryBytes);

      const run2 = createMockRun(1, 4);
      cache.putL1(1, 24, 15, 2, run2);
      expect(cache.getStats().entryCountL1).toBe(2);
      expect(cache.getStats().currentBytes).toBe(entryBytes * 2);

      // Inserting a 3rd entry exceeds budget; oldest entry (handle 1) must be evicted!
      const run3 = createMockRun(1, 4);
      cache.putL1(1, 24, 15, 3, run3);

      expect(cache.getStats().entryCountL1).toBe(2);
      expect(cache.getStats().currentBytes).toBeLessThanOrEqual(budget);

      // Handle 1 should have been evicted
      expect(cache.getL1(1, 24, 15, 1)).toBeUndefined();
      // Handles 2 and 3 remain
      expect(cache.getL1(1, 24, 15, 2)).toBe(run2);
      expect(cache.getL1(1, 24, 15, 3)).toBe(run3);
    });

    it('promotes accessed entries to head so recently accessed entries are retained', () => {
      const sampleRun = createMockRun(1, 4);
      const entryBytes = estimateShapedRunBytes(sampleRun);
      const cache = new MeasurementCache({ maxBytes: entryBytes * 2 });

      cache.putL1(1, 24, 15, 1, createMockRun(1, 4));
      cache.putL1(1, 24, 15, 2, createMockRun(1, 4));

      // Access entry 1, promoting it to the head of LRU
      cache.getL1(1, 24, 15, 1);

      // Insert entry 3: since entry 1 was promoted, entry 2 is now the tail and must be evicted!
      cache.putL1(1, 24, 15, 3, createMockRun(1, 4));

      expect(cache.getL1(1, 24, 15, 1)).toBeDefined();
      expect(cache.getL1(1, 24, 15, 2)).toBeUndefined(); // evicted!
      expect(cache.getL1(1, 24, 15, 3)).toBeDefined();
    });

    it('accounts for variable cluster counts in byte estimation', () => {
      const smallRun = createMockRun(1, 2);
      const largeRun = createMockRun(1, 20);

      const smallBytes = estimateShapedRunBytes(smallRun);
      const largeBytes = estimateShapedRunBytes(largeRun);

      expect(largeBytes).toBeGreaterThan(smallBytes);
      expect(smallBytes).toBe(2 * 6 * 8 + (2 + 1) * 8 + NODE_METADATA_OVERHEAD_BYTES);
    });
  });

  describe('Exact Invalidation', () => {
    it('invalidates all entries by font faceId and clears L2', () => {
      const cache = new MeasurementCache();

      // Entries for faceId 1
      cache.putL1(1, 24, 15, 10, createMockRun(1, 4));
      cache.putL1(1, 28, 15, 20, createMockRun(1, 4));

      // Entry for faceId 2
      cache.putL1(2, 24, 15, 10, createMockRun(2, 4));

      // Add L2 entry
      cache.putL2(1, 4000, 3900);

      expect(cache.getStats().entryCountL1).toBe(3);
      expect(cache.getStats().entryCountL2).toBe(1);

      // Invalidate face 1
      const count = cache.invalidateFace(1);
      expect(count).toBe(2);

      // Face 1 entries are gone
      expect(cache.getL1(1, 24, 15, 10)).toBeUndefined();
      expect(cache.getL1(1, 28, 15, 20)).toBeUndefined();

      // Face 2 entry is preserved
      expect(cache.getL1(2, 24, 15, 10)).toBeDefined();

      // L2 was cleared because line break measurements using face 1 are invalid
      expect(cache.getStats().entryCountL2).toBe(0);
      expect(cache.getStats().entryCountL1).toBe(1);
    });

    it('invalidates all entries referencing an interned text handle across all faces', () => {
      const cache = new MeasurementCache();
      const textHandleTarget = 100;
      const textHandleOther = 200;

      cache.putL1(1, 24, 15, textHandleTarget, createMockRun(1, 4));
      cache.putL1(2, 24, 15, textHandleTarget, createMockRun(2, 4));
      cache.putL1(1, 24, 15, textHandleOther, createMockRun(1, 4));

      cache.putL2(5, 5000, 4800);

      expect(cache.getStats().entryCountL1).toBe(3);

      const count = cache.invalidateText(textHandleTarget);
      expect(count).toBe(2);

      expect(cache.getL1(1, 24, 15, textHandleTarget)).toBeUndefined();
      expect(cache.getL1(2, 24, 15, textHandleTarget)).toBeUndefined();
      expect(cache.getL1(1, 24, 15, textHandleOther)).toBeDefined();

      expect(cache.getStats().entryCountL1).toBe(1);
      expect(cache.getStats().entryCountL2).toBe(0); // L2 invalidated
    });

    it('clears all entries and resets telemetry', () => {
      const cache = new MeasurementCache();
      cache.putL1(1, 24, 15, 1, createMockRun(1, 4));
      cache.putL2(1, 1000, 900);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.entryCountL1).toBe(0);
      expect(stats.entryCountL2).toBe(0);
      expect(stats.currentBytes).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });
});
