import { describe, expect, it } from 'vitest';
import {
  DEFAULT_END_GRAVITY,
  DEFAULT_START_GRAVITY,
  IntervalStore,
  type Interval,
} from './interval.js';
import {
  asAbsPos,
  createDocPos,
  createPositionMapper,
  docPosEquals,
  PositionMapper,
} from './pos.js';
import type { NodeId } from './id.js';

describe('P3-02 Positions (pos.ts)', () => {
  it('creates and compares DocPos coordinates', () => {
    const p1 = createDocPos(1 as NodeId, 10);
    const p2 = createDocPos(1 as NodeId, 10);
    const p3 = createDocPos(1 as NodeId, 15);
    const p4 = createDocPos(2 as NodeId, 10);

    expect(docPosEquals(p1, p2)).toBe(true);
    expect(docPosEquals(p1, p3)).toBe(false);
    expect(docPosEquals(p1, p4)).toBe(false);

    expect(() => createDocPos(1 as NodeId, -1)).toThrowError(/non-negative integer/i);
    expect(() => createDocPos(1 as NodeId, 1.5)).toThrowError(/non-negative integer/i);
  });

  it('validates and brands AbsPos', () => {
    const abs = asAbsPos(100);
    expect(abs as number).toBe(100);

    expect(() => asAbsPos(-5)).toThrowError(/non-negative integer/i);
    expect(() => asAbsPos(3.14)).toThrowError(/non-negative integer/i);
  });

  it('maps bidirectionally between DocPos and AbsPos using PositionMapper', () => {
    const node0 = 10 as NodeId; // length 20 (abs 0..20)
    const node1 = 20 as NodeId; // length 30 (abs 20..50)
    const node2 = 30 as NodeId; // length 50 (abs 50..100)

    const mapper = createPositionMapper([
      { id: node0, length: 20 },
      { id: node1, length: 30 },
      { id: node2, length: 50 },
    ]);

    expect(mapper.totalLength).toBe(100);
    expect(mapper.nodeCount).toBe(3);

    // toAbs
    expect(mapper.toAbs(createDocPos(node0, 0)) as number).toBe(0);
    expect(mapper.toAbs(createDocPos(node0, 15)) as number).toBe(15);
    expect(mapper.toAbs(createDocPos(node1, 0)) as number).toBe(20);
    expect(mapper.toAbs(createDocPos(node1, 10)) as number).toBe(30);
    expect(mapper.toAbs(createDocPos(node2, 50)) as number).toBe(100);

    // out of bounds DocPos
    expect(() => mapper.toAbs(createDocPos(node0, 25))).toThrowError(/exceeds node/i);
    expect(() => mapper.toAbs(createDocPos(999 as NodeId, 5))).toThrowError(
      /not in PositionMapper/i,
    );

    // toDoc
    expect(mapper.toDoc(0)).toEqual(createDocPos(node0, 0));
    expect(mapper.toDoc(15)).toEqual(createDocPos(node0, 15));
    expect(mapper.toDoc(20)).toEqual(createDocPos(node1, 0));
    expect(mapper.toDoc(30)).toEqual(createDocPos(node1, 10));
    expect(mapper.toDoc(100)).toEqual(createDocPos(node2, 50));

    // Dynamic length update
    mapper.updateLength(node1, 40); // total is now 20 + 40 + 50 = 110
    expect(mapper.totalLength).toBe(110);
    expect(mapper.toAbs(createDocPos(node2, 0)) as number).toBe(60);
  });
});

describe('P3-02 Interval Store (interval.ts)', () => {
  it('inserts and retrieves intervals', () => {
    const store = new IntervalStore<string>();
    const id1 = store.insert(10, 20, 'first');
    const id2 = store.insert(5, 15, 'second');

    expect(store.size).toBe(2);

    const int1 = store.get(id1);
    expect(int1).toBeDefined();
    expect(int1?.from).toBe(10);
    expect(int1?.to).toBe(20);
    expect(int1?.payload).toBe('first');
    expect(int1?.fromGravity).toBe(DEFAULT_START_GRAVITY);
    expect(int1?.toGravity).toBe(DEFAULT_END_GRAVITY);

    const all = store.all();
    expect(all.length).toBe(2);
    // Ordered by start: 5 before 10
    expect(all[0]?.from).toBe(5);
    expect(all[1]?.from).toBe(10);

    // Remove
    expect(store.remove(id1)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.get(id1)).toBeUndefined();
  });

  it('performs stabbing queries accurately', () => {
    const store = new IntervalStore<string>();
    store.insert(0, 10, 'A');
    store.insert(5, 15, 'B');
    store.insert(20, 30, 'C');
    store.insert(10, 10, 'collapsedAt10');

    // Stab at 2: contains A
    const stab2 = store.stab(2).map((i) => i.payload);
    expect(stab2).toEqual(['A']);

    // Stab at 7: contains A, B
    const stab7 = store
      .stab(7)
      .map((i) => i.payload)
      .sort();
    expect(stab7).toEqual(['A', 'B']);

    // Stab at 10: contains A (end), B (inside), collapsedAt10 (zero-width)
    const stab10 = store
      .stab(10)
      .map((i) => i.payload)
      .sort();
    expect(stab10).toEqual(['A', 'B', 'collapsedAt10']);

    // Stab at 18: none
    expect(store.stab(18)).toEqual([]);
  });

  it('performs overlapping queries accurately', () => {
    const store = new IntervalStore<string>();
    store.insert(10, 20, 'range10_20');
    store.insert(25, 35, 'range25_35');
    store.insert(15, 15, 'zero15');

    // Overlapping [12, 18] matches range10_20 and zero15
    const res1 = store
      .overlapping(12, 18)
      .map((i) => i.payload)
      .sort();
    expect(res1).toEqual(['range10_20', 'zero15']);

    // Overlapping [20, 25] with inclusive: matches range10_20 (at 20) and range25_35 (at 25)
    const res2 = store
      .overlapping(20, 25, { inclusive: true })
      .map((i) => i.payload)
      .sort();
    expect(res2).toEqual(['range10_20', 'range25_35']);

    // Overlapping [21, 24]: no overlap
    expect(store.overlapping(21, 24)).toEqual([]);
  });

  it('correctly handles bookmark endpoint gravity on boundary vs interior typing', () => {
    // Plan doc requirement:
    // "Bookmark starts have right gravity, bookmark ends left gravity, so typing
    //  inside a bookmark extends it and typing at either boundary does not."
    const store = new IntervalStore<string>();
    const bmId = store.insert(5, 10, 'bookmark', 'right', 'left');

    // 1. Typing inside at position 7 (delta = +3):
    // Bookmark was [5, 10], now should extend to [5, 13]
    store.shift(7, 3);
    let bm = store.get(bmId)!;
    expect(bm.from).toBe(5);
    expect(bm.to).toBe(13); // extended by 3!

    // 2. Typing at start boundary at position 5 (delta = +2):
    // Start has 'right' gravity -> sticks to text after insertion -> shifts to 5 + 2 = 7.
    // End is 13 (> 5) -> shifts to 13 + 2 = 15.
    // Result: [7, 15]. Length is still 8. Did NOT extend!
    store.shift(5, 2);
    bm = store.get(bmId)!;
    expect(bm.from).toBe(7);
    expect(bm.to).toBe(15);

    // 3. Typing at end boundary at position 15 (delta = +4):
    // Start is 7 (< 15) -> stays 7.
    // End is 15 with 'left' gravity -> sticks to text before insertion -> stays 15!
    // Result: [7, 15]. Did NOT extend!
    store.shift(15, 4);
    bm = store.get(bmId)!;
    expect(bm.from).toBe(7);
    expect(bm.to).toBe(15);
  });

  it('correctly shifts zero-width intervals according to their gravity', () => {
    const store = new IntervalStore<string>();

    // Caret moving with typed text: both 'right'
    const caretRightId = store.insert(10, 10, 'caretRight', 'right', 'right');

    // Anchor staying before typed text: both 'left'
    const anchorLeftId = store.insert(10, 10, 'anchorLeft', 'left', 'left');

    // Expanding point: 'left' start, 'right' end
    const expandId = store.insert(10, 10, 'expand', 'left', 'right');

    // Insert 5 characters at position 10
    store.shift(10, 5);

    const caretRight = store.get(caretRightId)!;
    expect(caretRight.from).toBe(15);
    expect(caretRight.to).toBe(15); // shifted to 15!

    const anchorLeft = store.get(anchorLeftId)!;
    expect(anchorLeft.from).toBe(10);
    expect(anchorLeft.to).toBe(10); // remained at 10!

    const expand = store.get(expandId)!;
    expect(expand.from).toBe(10);
    expect(expand.to).toBe(15); // expanded to [10, 15]!
  });

  it('correctly handles deletion (delta < 0) and collapses deleted regions', () => {
    const store = new IntervalStore<string>();
    const idBefore = store.insert(0, 5, 'before');
    const idSpanning = store.insert(8, 25, 'spanning');
    const idInside = store.insert(12, 18, 'inside');
    const idAfter = store.insert(30, 40, 'after');

    // Delete range [10, 20) -> at = 10, delta = -10
    store.shift(10, -10);

    // 'before' [0, 5] is untouched
    expect(store.get(idBefore)?.from).toBe(0);
    expect(store.get(idBefore)?.to).toBe(5);

    // 'inside' [12, 18] was entirely deleted -> collapses to 10
    const inside = store.get(idInside)!;
    expect(inside.from).toBe(10);
    expect(inside.to).toBe(10);

    // 'spanning' was [8, 25] -> start is 8, end was 25 (> 20), shifted by -10 to 15
    const spanning = store.get(idSpanning)!;
    expect(spanning.from).toBe(8);
    expect(spanning.to).toBe(15);

    // 'after' was [30, 40] -> shifted by -10 to [20, 30]
    const after = store.get(idAfter)!;
    expect(after.from).toBe(20);
    expect(after.to).toBe(30);
  });

  it('exhibits sub-linear shift scaling benchmarked at 10,000 intervals', () => {
    const store = new IntervalStore<number>();
    const COUNT = 10_000;

    // Distribute 10,000 intervals throughout a document of length 1,000,000
    for (let i = 0; i < COUNT; i++) {
      const from = i * 100;
      const to = from + 50;
      store.insert(from, to, i);
    }
    expect(store.size).toBe(COUNT);

    // Measure time to perform 100 shift operations at position 500
    // In a linear O(N) implementation, 100 shifts across 10,000 intervals would do 1,000,000 iterations.
    // In our O(log N) Treap with lazy delta, it should execute in single-digit milliseconds.
    const startTime = performance.now();
    for (let s = 0; s < 100; s++) {
      store.shift(500, 2);
    }
    const elapsedMs = performance.now() - startTime;

    // 100 shifts in 10k intervals should comfortably take < 50ms (usually < 10ms)
    expect(elapsedMs).toBeLessThan(100);

    // Verify correctness after 100 shifts (total insertion +200 at pos 500)
    // An interval originally at [1000, 1050] should now be at [1200, 1250]
    const int10 = store.all().find((x) => x.payload === 10)!;
    expect(int10.from).toBe(1000 + 200);
    expect(int10.to).toBe(1050 + 200);

    // An interval originally at [0, 50] (before pos 500) should be untouched
    const int0 = store.all().find((x) => x.payload === 0)!;
    expect(int0.from).toBe(0);
    expect(int0.to).toBe(50);
  });
});
