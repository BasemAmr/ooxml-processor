import { describe, expect, it } from 'vitest';
import {
  AnnotationStore,
  DIAGNOSTIC_CAP,
  extractParagraphAnnotations,
  injectParagraphAnnotations,
  makeAnnotationKey,
  type AnnotationKind,
} from './annotations.js';
import type { NodeId } from './id.js';
import type { CT_P, CT_P_PContent } from '@ooxml/schema';

describe('P3-03 Range Annotations (annotations.ts)', () => {
  it('handles non-nesting, interleaved bookmark and comment ranges across nodes', () => {
    // Bookmark 1 starts in paragraph 1, ends in paragraph 2
    // Comment 10 starts inside bookmark 1 (in para 1), ends in paragraph 3
    const store = new AnnotationStore();
    const para1 = 1 as NodeId;
    const para2 = 2 as NodeId;
    const para3 = 3 as NodeId;

    // Para 1: bookmarkStart(1), commentRangeStart(10)
    store.recordMarker({
      kind: 'bookmark',
      id: '1',
      endpoint: 'start',
      pos: { node: para1, offset: 0 },
      sourceOrder: 0,
      rawElement: { kind: 'bookmarkStart', value: { id: 1, name: 'BookmarkAcross' } },
      name: 'BookmarkAcross',
    });
    store.recordMarker({
      kind: 'comment',
      id: '10',
      endpoint: 'start',
      pos: { node: para1, offset: 1 },
      sourceOrder: 1,
      rawElement: { kind: 'commentRangeStart', value: { id: 10 } },
    });

    // Para 2: bookmarkEnd(1)
    store.recordMarker({
      kind: 'bookmark',
      id: '1',
      endpoint: 'end',
      pos: { node: para2, offset: 2 },
      sourceOrder: 2,
      rawElement: { kind: 'bookmarkEnd', value: { id: 1 } },
    });

    // Para 3: commentRangeEnd(10)
    store.recordMarker({
      kind: 'comment',
      id: '10',
      endpoint: 'end',
      pos: { node: para3, offset: 0 },
      sourceOrder: 3,
      rawElement: { kind: 'commentRangeEnd', value: { id: 10 } },
    });

    store.finalize();

    // Query both annotations
    const bm = store.get('bookmark', '1');
    expect(bm).toBeDefined();
    expect(bm?.name).toBe('BookmarkAcross');
    expect(bm?.from).toEqual({ node: para1, offset: 0 });
    expect(bm?.to).toEqual({ node: para2, offset: 2 });

    const comment = store.get('comment', '10');
    expect(comment).toBeDefined();
    expect(comment?.from).toEqual({ node: para1, offset: 1 });
    expect(comment?.to).toEqual({ node: para3, offset: 0 });

    // Ensure key separation: bookmark id 1 does not collide with comment id 1
    expect(makeAnnotationKey('bookmark', 1)).toBe('bookmark:1');
    expect(makeAnnotationKey('comment', 1)).toBe('comment:1');
    expect(store.diagnostics.length).toBe(0);
  });

  it('preserves relative coincident marker order via sourceOrder during AST extraction and re-injection', () => {
    const store = new AnnotationStore();
    const paraId = 42 as NodeId;

    // A paragraph containing:
    // offset 0: bookmarkStart(1), commentRangeStart(5), permStart(p1) [COINCIDENT]
    // content 0: run 'Hello'
    // offset 1: bookmarkEnd(1), commentRangeEnd(5) [COINCIDENT]
    // content 1: run ' World'
    const originalP: CT_P = {
      pContent: [
        { kind: 'bookmarkStart', value: { id: 1, name: 'bm1' } },
        { kind: 'commentRangeStart', value: { id: 5 } },
        { kind: 'permStart', value: { id: 'p1' } },
        {
          kind: 'r',
          value: {
            runInnerContent: [{ kind: 't', value: { $value: 'Hello' } }],
          },
        },
        { kind: 'bookmarkEnd', value: { id: 1 } },
        { kind: 'commentRangeEnd', value: { id: 5 } },
        {
          kind: 'r',
          value: {
            runInnerContent: [{ kind: 't', value: { $value: ' World' } }],
          },
        },
      ],
    };

    // Extract
    const strippedP = extractParagraphAnnotations(originalP, paraId, store);
    store.finalize();

    // Stripped paragraph should contain ONLY the two runs
    expect(strippedP.pContent.length).toBe(2);
    expect(strippedP.pContent[0]?.kind).toBe('r');
    expect(strippedP.pContent[1]?.kind).toBe('r');

    // Re-inject
    const reconstitutedP = injectParagraphAnnotations(strippedP, paraId, store);

    // Reconstituted paragraph must match the original element order character-for-character
    expect(reconstitutedP.pContent.length).toBe(7);
    expect(reconstitutedP.pContent[0]?.kind).toBe('bookmarkStart');
    expect(reconstitutedP.pContent[1]?.kind).toBe('commentRangeStart');
    expect(reconstitutedP.pContent[2]?.kind).toBe('permStart');
    expect(reconstitutedP.pContent[3]?.kind).toBe('r');
    expect(reconstitutedP.pContent[4]?.kind).toBe('bookmarkEnd');
    expect(reconstitutedP.pContent[5]?.kind).toBe('commentRangeEnd');
    expect(reconstitutedP.pContent[6]?.kind).toBe('r');
  });

  it('handles orphaned start, orphaned end, and crossed pairs with proper diagnostics', () => {
    const store = new AnnotationStore();
    const paraId = 5 as NodeId;

    // 1. Orphaned start: bookmarkStart(99) with no end
    store.recordMarker({
      kind: 'bookmark',
      id: '99',
      endpoint: 'start',
      pos: { node: paraId, offset: 0 },
      sourceOrder: 0,
      rawElement: { kind: 'bookmarkStart', value: { id: 99, name: 'orphanStart' } },
      name: 'orphanStart',
    });

    // 2. Orphaned end: commentRangeEnd(55) with no preceding start
    store.recordMarker({
      kind: 'comment',
      id: '55',
      endpoint: 'end',
      pos: { node: paraId, offset: 2 },
      sourceOrder: 1,
      rawElement: { kind: 'commentRangeEnd', value: { id: 55 } },
    });

    // 3. Crossed pair: bookmarkEnd(7) at sourceOrder 2, followed by bookmarkStart(7) at sourceOrder 3
    store.recordMarker({
      kind: 'bookmark',
      id: '7',
      endpoint: 'end',
      pos: { node: paraId, offset: 1 },
      sourceOrder: 2,
      rawElement: { kind: 'bookmarkEnd', value: { id: 7 } },
    });
    store.recordMarker({
      kind: 'bookmark',
      id: '7',
      endpoint: 'start',
      pos: { node: paraId, offset: 4 },
      sourceOrder: 3,
      rawElement: { kind: 'bookmarkStart', value: { id: 7, name: 'crossed' } },
      name: 'crossed',
    });

    store.finalize({ node: paraId, offset: 10 });

    // Diagnostics should report orphan-end, crossed-pair, and orphan-start
    const codes = store.diagnostics.map((d) => d.code);
    expect(codes).toContain('orphan-end');
    expect(codes).toContain('crossed-pair');
    expect(codes).toContain('orphan-start');

    // Orphaned start extends to end-of-document for query
    const orphanStart = store.get('bookmark', '99');
    expect(orphanStart).toBeDefined();
    expect(orphanStart?.orphaned).toBe('start');
    expect(orphanStart?.to).toEqual({ node: paraId, offset: 10 });

    // Orphaned end is ignored for query
    const orphanEnd = store.get('comment', '55');
    expect(orphanEnd).toBeUndefined();

    // Crossed pair is normalized for query: from is earlier (offset 1), to is later (offset 4)
    const crossed = store.get('bookmark', '7');
    expect(crossed).toBeDefined();
    expect(crossed?.from).toEqual({ node: paraId, offset: 1 });
    expect(crossed?.to).toEqual({ node: paraId, offset: 4 });

    // In serialization, crossed markers preserve authored order (end at offset 1, start at offset 4)
    const markers = store.getMarkersForNode(paraId);
    const crossedEndMarker = markers.find(
      (m) => m.kind === 'bookmark' && m.id === '7' && m.endpoint === 'end',
    );
    const crossedStartMarker = markers.find(
      (m) => m.kind === 'bookmark' && m.id === '7' && m.endpoint === 'start',
    );
    expect(crossedEndMarker?.pos.offset).toBe(1);
    expect(crossedStartMarker?.pos.offset).toBe(4);
  });

  it('caps diagnostics at DIAGNOSTIC_CAP (100)', () => {
    const store = new AnnotationStore();
    const paraId = 1 as NodeId;

    // Trigger 150 orphaned ends
    for (let i = 0; i < 150; i++) {
      store.recordMarker({
        kind: 'comment',
        id: `orphan_${i}`,
        endpoint: 'end',
        pos: { node: paraId, offset: i },
        sourceOrder: i,
        rawElement: { kind: 'commentRangeEnd', value: { id: i } },
      });
    }

    // Diagnostics should be capped at 100 (+ 1 cap notification = 101)
    expect(store.diagnostics.length).toBeLessThanOrEqual(DIAGNOSTIC_CAP + 1);
    const capNotice = store.diagnostics.find((d) => d.code === 'diagnostic-cap-reached');
    expect(capNotice).toBeDefined();
  });

  it('filters Word internal _GoBack bookmark from user queries while preserving in serialization', () => {
    const store = new AnnotationStore();
    const paraId = 10 as NodeId;

    store.recordMarker({
      kind: 'bookmark',
      id: '0',
      endpoint: 'start',
      pos: { node: paraId, offset: 0 },
      sourceOrder: 0,
      rawElement: { kind: 'bookmarkStart', value: { id: 0, name: '_GoBack' } },
      name: '_GoBack',
    });
    store.recordMarker({
      kind: 'bookmark',
      id: '0',
      endpoint: 'end',
      pos: { node: paraId, offset: 0 },
      sourceOrder: 1,
      rawElement: { kind: 'bookmarkEnd', value: { id: 0 } },
    });

    store.recordMarker({
      kind: 'bookmark',
      id: '1',
      endpoint: 'start',
      pos: { node: paraId, offset: 2 },
      sourceOrder: 2,
      rawElement: { kind: 'bookmarkStart', value: { id: 1, name: 'UserBookmark' } },
      name: 'UserBookmark',
    });
    store.recordMarker({
      kind: 'bookmark',
      id: '1',
      endpoint: 'end',
      pos: { node: paraId, offset: 5 },
      sourceOrder: 3,
      rawElement: { kind: 'bookmarkEnd', value: { id: 1 } },
    });

    store.finalize();

    // getUserBookmarks filters out _GoBack
    const userBookmarks = store.getUserBookmarks();
    expect(userBookmarks.length).toBe(1);
    expect(userBookmarks[0]?.name).toBe('UserBookmark');

    // getAll() without includeInternal filters out _GoBack
    expect(store.getAll().length).toBe(1);

    // getAll({ includeInternal: true }) includes _GoBack
    expect(store.getAll({ includeInternal: true }).length).toBe(2);

    // getMarkersForNode preserves _GoBack for AST serialization
    const markers = store.getMarkersForNode(paraId);
    const goBackMarker = markers.find((m) => m.name === '_GoBack');
    expect(goBackMarker).toBeDefined();
  });

  it('leaves range well-formed when deleting text containing an endpoint', () => {
    const store = new AnnotationStore();
    const paraId = 7 as NodeId;

    // Bookmark initially [5, 15]
    store.add({
      kind: 'bookmark',
      id: '1',
      name: 'MyBookmark',
      from: { node: paraId, offset: 5 },
      to: { node: paraId, offset: 15 },
      sourceOrder: 0,
    });

    // 1. Delete text inside the range [7, 10) -> length 3
    store.deleteRange(paraId, 7, 10);
    let bm = store.get('bookmark', '1')!;
    expect(bm.from.offset).toBe(5);
    expect(bm.to.offset).toBe(12); // shifted left by 3

    // 2. Delete range containing start endpoint: [3, 8)
    // from (5) is inside [3, 8) -> collapses to 3
    // to (12) is after 8 -> shifts left by (8 - 3) = 5 -> becomes 7
    store.deleteRange(paraId, 3, 8);
    bm = store.get('bookmark', '1')!;
    expect(bm.from.offset).toBe(3);
    expect(bm.to.offset).toBe(7);

    // 3. Delete range containing end endpoint: [5, 10)
    // from (3) is before 5 -> stays 3
    // to (7) is inside [5, 10) -> collapses to 5
    store.deleteRange(paraId, 5, 10);
    bm = store.get('bookmark', '1')!;
    expect(bm.from.offset).toBe(3);
    expect(bm.to.offset).toBe(5);

    // 4. Delete entire range: [0, 20)
    // both endpoints collapse to 0 (well-formed zero-width range at cut point)
    store.deleteRange(paraId, 0, 20);
    bm = store.get('bookmark', '1')!;
    expect(bm.from.offset).toBe(0);
    expect(bm.to.offset).toBe(0);
    expect(bm.from.offset <= bm.to.offset).toBe(true);
  });
});
