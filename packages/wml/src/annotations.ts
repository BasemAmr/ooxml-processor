/**
 * Range Annotations store and AST round-trip preservation for WordprocessingML.
 *
 * Implements Ticket P3-03 (Range Annotations).
 *
 * In WordprocessingML, bookmarks, comments, permissions, and tracked move/customXml
 * ranges are paired markers that do NOT nest with the element tree.
 * A bookmark can start inside paragraph 1 and end inside a table cell in paragraph 3.
 *
 * Key architectural invariants:
 *   1. Keyed by `(kind, w:id)` to prevent collisions between independent ID spaces
 *      (e.g. bookmark id="1" vs comment id="1").
 *   2. Strict preservation of coincident-marker order via monotonic `sourceOrder`.
 *   3. Robust handling of malformed documents:
 *      - Orphaned start (no end): extends to end-of-document for queries, preserved as orphan for write, emits diagnostic.
 *      - Orphaned end (no start): recorded positionally, ignored for queries, emits diagnostic.
 *      - Crossed pairs (end precedes start): normalized for query, preserved as-authored for write, emits diagnostic.
 *   4. Diagnostics capped at `DIAGNOSTIC_CAP` (100).
 *   5. Filtering of Word's internal `_GoBack` bookmark from public queries while preserving in serialization.
 *   6. Range-preserving text deletion operations.
 */

import type { DocPos } from './pos.js';
import type { NodeId } from './id.js';
import type { CT_P, CT_P_PContent, CT_Body, CT_Body_BlockLevelElts } from '@ooxml/schema';

export type AnnotationKind =
  | 'bookmark'
  | 'comment'
  | 'moveFrom'
  | 'moveTo'
  | 'permission'
  | 'customXmlIns'
  | 'customXmlDel'
  | 'customXmlMoveFrom'
  | 'customXmlMoveTo';

export type AnnotationKey = `${AnnotationKind}:${string}`;

/**
 * Creates a unique annotation key scoped by kind and ID.
 */
export function makeAnnotationKey(kind: AnnotationKind, id: string | number): AnnotationKey {
  return `${kind}:${String(id)}` as AnnotationKey;
}

/**
 * Parsed range annotation model.
 */
export interface Annotation {
  readonly kind: AnnotationKind;
  readonly id: string;
  readonly name?: string | undefined;
  readonly from: DocPos;
  readonly to: DocPos;
  readonly sourceOrder: number;
  readonly payload?: unknown;
  readonly orphaned?: 'start' | 'end' | undefined;
}

export const DIAGNOSTIC_CAP = 100;

export type DiagnosticCode =
  'orphan-start' | 'orphan-end' | 'crossed-pair' | 'diagnostic-cap-reached';

export interface AnnotationDiagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly kind: AnnotationKind;
  readonly id: string;
}

/**
 * Raw positional marker recorded during document parsing or injection.
 */
export interface PositionalMarker {
  readonly kind: AnnotationKind;
  readonly id: string;
  readonly endpoint: 'start' | 'end';
  readonly pos: DocPos;
  readonly sourceOrder: number;
  readonly rawElement: CT_P_PContent | CT_Body_BlockLevelElts;
  readonly name?: string | undefined;
}

/**
 * In-memory store managing range annotations, coincident marker ordering,
 * malformed range normalization, and diagnostic reporting.
 */
export class AnnotationStore {
  private readonly _annotations: Map<AnnotationKey, Annotation> = new Map();
  private readonly _startMarkers: Map<AnnotationKey, PositionalMarker> = new Map();
  private readonly _endMarkers: Map<AnnotationKey, PositionalMarker> = new Map();
  private readonly _orphanedEnds: PositionalMarker[] = [];
  private readonly _diagnostics: AnnotationDiagnostic[] = [];
  private _nextSourceOrder = 0;
  private _lastSeenPos: DocPos | null = null;

  /**
   * Diagnostic messages emitted during ingestion and validation.
   */
  get diagnostics(): readonly AnnotationDiagnostic[] {
    return this._diagnostics;
  }

  /**
   * Total number of registered annotations (excluding orphan ends).
   */
  get size(): number {
    return this._annotations.size;
  }

  /**
   * Mints the next monotonic source order counter for newly created markers.
   */
  mintSourceOrder(): number {
    return this._nextSourceOrder++;
  }

  /**
   * Records a raw positional marker into the store.
   *
   * Automatically pairs starts with ends, detects crossed markers, and tracks orphans.
   */
  recordMarker(marker: PositionalMarker): void {
    this._lastSeenPos = marker.pos;
    if (marker.sourceOrder >= this._nextSourceOrder) {
      this._nextSourceOrder = marker.sourceOrder + 1;
    }

    const key = makeAnnotationKey(marker.kind, marker.id);

    if (marker.endpoint === 'start') {
      // Check if an unclosed start already exists
      if (this._startMarkers.has(key)) {
        this._addDiagnostic({
          code: 'orphan-start',
          message: `Duplicate start marker for ${key}; preceding start is orphaned.`,
          kind: marker.kind,
          id: marker.id,
        });
      }

      // Check if an orphaned end was already encountered before this start (crossed pair)
      const existingEnd = this._endMarkers.get(key);
      if (existingEnd) {
        this._addDiagnostic({
          code: 'crossed-pair',
          message: `Crossed pair for ${key}: end marker at sourceOrder ${existingEnd.sourceOrder} precedes start marker at ${marker.sourceOrder}.`,
          kind: marker.kind,
          id: marker.id,
        });

        // For query: normalized with earlier pos as 'from' and later pos as 'to'
        const fromPos = existingEnd.pos;
        const toPos = marker.pos;
        this._annotations.set(key, {
          kind: marker.kind,
          id: marker.id,
          name: marker.name,
          from: fromPos,
          to: toPos,
          sourceOrder: marker.sourceOrder,
          payload: { startRaw: marker.rawElement, endRaw: existingEnd.rawElement, crossed: true },
        });
        this._startMarkers.set(key, marker);
        return;
      }

      this._startMarkers.set(key, marker);
    } else {
      // Endpoint is 'end'
      const start = this._startMarkers.get(key);
      if (!start) {
        // End with no preceding start
        this._endMarkers.set(key, marker);
        this._orphanedEnds.push(marker);
        this._addDiagnostic({
          code: 'orphan-end',
          message: `Orphaned end marker for ${key} at sourceOrder ${marker.sourceOrder} with no matching start.`,
          kind: marker.kind,
          id: marker.id,
        });
        return;
      }

      // Well-formed pair (start preceded end)
      this._endMarkers.set(key, marker);
      this._annotations.set(key, {
        kind: marker.kind,
        id: marker.id,
        name: start.name,
        from: start.pos,
        to: marker.pos,
        sourceOrder: start.sourceOrder,
        payload: { startRaw: start.rawElement, endRaw: marker.rawElement },
      });
    }
  }

  /**
   * Finalizes the store after document parsing completes.
   *
   * Any start marker without a matching end marker is marked as an orphaned start,
   * extends its `to` position to the end of the document for queries, and emits a diagnostic.
   */
  finalize(endOfDocPos?: DocPos): void {
    const docEnd = endOfDocPos ?? this._lastSeenPos ?? { node: 0 as NodeId, offset: 0 };

    for (const [key, start] of this._startMarkers.entries()) {
      if (!this._endMarkers.has(key)) {
        // Orphaned start
        this._addDiagnostic({
          code: 'orphan-start',
          message: `Orphaned start marker for ${key} at sourceOrder ${start.sourceOrder} with no matching end.`,
          kind: start.kind,
          id: start.id,
        });

        this._annotations.set(key, {
          kind: start.kind,
          id: start.id,
          name: start.name,
          from: start.pos,
          to: docEnd,
          sourceOrder: start.sourceOrder,
          payload: { startRaw: start.rawElement },
          orphaned: 'start',
        });
      }
    }
  }

  /**
   * Directly adds an annotation to the store.
   */
  add(annotation: Annotation): void {
    const key = makeAnnotationKey(annotation.kind, annotation.id);
    this._annotations.set(key, annotation);
    if (annotation.sourceOrder >= this._nextSourceOrder) {
      this._nextSourceOrder = annotation.sourceOrder + 1;
    }
  }

  /**
   * Retrieves an annotation by its kind and ID.
   */
  get(kind: AnnotationKind, id: string | number): Annotation | undefined {
    return this._annotations.get(makeAnnotationKey(kind, id));
  }

  /**
   * Returns true if the store contains an annotation for the given kind and ID.
   */
  has(kind: AnnotationKind, id: string | number): boolean {
    return this._annotations.has(makeAnnotationKey(kind, id));
  }

  /**
   * Removes an annotation from the store.
   */
  remove(kind: AnnotationKind, id: string | number): boolean {
    const key = makeAnnotationKey(kind, id);
    this._startMarkers.delete(key);
    this._endMarkers.delete(key);
    return this._annotations.delete(key);
  }

  /**
   * Returns all annotations.
   *
   * By default, filters out the internal `_GoBack` bookmark created by Microsoft Word.
   * Pass `includeInternal: true` to include it.
   */
  getAll(options?: { includeInternal?: boolean }): Annotation[] {
    const result: Annotation[] = [];
    const includeInternal = options?.includeInternal ?? false;

    for (const ann of this._annotations.values()) {
      if (!includeInternal && ann.kind === 'bookmark' && ann.name === '_GoBack') {
        continue;
      }
      result.push(ann);
    }
    return result;
  }

  /**
   * Returns all user-visible bookmark annotations, explicitly excluding `_GoBack`.
   */
  getUserBookmarks(): Annotation[] {
    return this.getAll({ includeInternal: false }).filter((a) => a.kind === 'bookmark');
  }

  /**
   * Returns all markers recorded at a specific node, sorted by position offset and sourceOrder.
   * Used when re-injecting markers into the AST.
   */
  getMarkersForNode(node: NodeId): PositionalMarker[] {
    const markers: PositionalMarker[] = [];

    // Starts
    for (const start of this._startMarkers.values()) {
      if (start.pos.node === node) {
        markers.push(start);
      }
    }

    // Ends
    for (const end of this._endMarkers.values()) {
      if (end.pos.node === node) {
        markers.push(end);
      }
    }

    // Orphaned ends
    for (const orphanEnd of this._orphanedEnds) {
      if (orphanEnd.pos.node === node && !markers.includes(orphanEnd)) {
        markers.push(orphanEnd);
      }
    }

    // Sort primarily by offset, then by original sourceOrder to preserve coincident order
    markers.sort((a, b) => {
      if (a.pos.offset !== b.pos.offset) {
        return a.pos.offset - b.pos.offset;
      }
      return a.sourceOrder - b.sourceOrder;
    });

    return markers;
  }

  /**
   * Updates annotation endpoints when a text range within `node` is deleted.
   *
   * Invariant: Deleting text containing an endpoint leaves the annotation well-formed.
   * Endpoints inside [delStart, delEnd) collapse to `delStart`.
   * Endpoints >= delEnd shift left by (delEnd - delStart).
   */
  deleteRange(node: NodeId, delStart: number, delEnd: number): void {
    if (delStart >= delEnd) return;
    const delLen = delEnd - delStart;

    for (const [key, ann] of this._annotations.entries()) {
      let from = ann.from;
      let to = ann.to;
      let changed = false;

      if (from.node === node) {
        if (from.offset > delStart && from.offset < delEnd) {
          from = { node, offset: delStart };
          changed = true;
        } else if (from.offset >= delEnd) {
          from = { node, offset: from.offset - delLen };
          changed = true;
        }
      }

      if (to.node === node) {
        if (to.offset > delStart && to.offset <= delEnd) {
          to = { node, offset: delStart };
          changed = true;
        } else if (to.offset > delEnd) {
          to = { node, offset: to.offset - delLen };
          changed = true;
        }
      }

      if (changed) {
        this._annotations.set(key, {
          ...ann,
          from,
          to,
        });

        // Also update tracked start/end markers
        const start = this._startMarkers.get(key);
        if (start && start.pos.node === node) {
          (start as { pos: DocPos }).pos = from;
        }
        const end = this._endMarkers.get(key);
        if (end && end.pos.node === node) {
          (end as { pos: DocPos }).pos = to;
        }
      }
    }
  }

  private _addDiagnostic(diag: AnnotationDiagnostic): void {
    if (this._diagnostics.length < DIAGNOSTIC_CAP) {
      this._diagnostics.push(diag);
      if (this._diagnostics.length === DIAGNOSTIC_CAP) {
        this._diagnostics.push({
          code: 'diagnostic-cap-reached',
          message: `Diagnostic cap of ${DIAGNOSTIC_CAP} reached; further diagnostics suppressed.`,
          kind: diag.kind,
          id: diag.id,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AST Schema Extraction and Injection Functions
// ---------------------------------------------------------------------------

const START_MARKER_KINDS = new Set([
  'bookmarkStart',
  'commentRangeStart',
  'moveFromRangeStart',
  'moveToRangeStart',
  'permStart',
  'customXmlInsRangeStart',
  'customXmlDelRangeStart',
  'customXmlMoveFromRangeStart',
  'customXmlMoveToRangeStart',
]);

const END_MARKER_KINDS = new Set([
  'bookmarkEnd',
  'commentRangeEnd',
  'moveFromRangeEnd',
  'moveToRangeEnd',
  'permEnd',
  'customXmlInsRangeEnd',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeEnd',
]);

function toAnnotationKind(markerKind: string): AnnotationKind {
  switch (markerKind) {
    case 'bookmarkStart':
    case 'bookmarkEnd':
      return 'bookmark';
    case 'commentRangeStart':
    case 'commentRangeEnd':
      return 'comment';
    case 'moveFromRangeStart':
    case 'moveFromRangeEnd':
      return 'moveFrom';
    case 'moveToRangeStart':
    case 'moveToRangeEnd':
      return 'moveTo';
    case 'permStart':
    case 'permEnd':
      return 'permission';
    case 'customXmlInsRangeStart':
    case 'customXmlInsRangeEnd':
      return 'customXmlIns';
    case 'customXmlDelRangeStart':
    case 'customXmlDelRangeEnd':
      return 'customXmlDel';
    case 'customXmlMoveFromRangeStart':
    case 'customXmlMoveFromRangeEnd':
      return 'customXmlMoveFrom';
    case 'customXmlMoveToRangeStart':
    case 'customXmlMoveToRangeEnd':
      return 'customXmlMoveTo';
    default:
      throw new Error(`Unrecognized marker kind: ${markerKind}`);
  }
}

/**
 * Extracts range markers from a paragraph AST element into an AnnotationStore.
 *
 * Returns a new CT_P whose pContent has all range markers lifted into the store,
 * leaving only inline content (runs, hyperlinks, fields, etc.).
 */
export function extractParagraphAnnotations(p: CT_P, paraId: NodeId, store: AnnotationStore): CT_P {
  const strippedContent: CT_P_PContent[] = [];

  for (const item of p.pContent) {
    const isStart = START_MARKER_KINDS.has(item.kind);
    const isEnd = END_MARKER_KINDS.has(item.kind);

    if (isStart || isEnd) {
      const kind = toAnnotationKind(item.kind);
      const val = (item as { value: { id?: string | number; name?: string } }).value;
      const id = String(val.id ?? '');
      const name = val.name;
      const sourceOrder = store.mintSourceOrder();
      const pos: DocPos = { node: paraId, offset: strippedContent.length };

      store.recordMarker({
        kind,
        id,
        endpoint: isStart ? 'start' : 'end',
        pos,
        sourceOrder,
        rawElement: item,
        name,
      });
    } else {
      strippedContent.push(item);
    }
  }

  return {
    ...p,
    pContent: strippedContent,
  };
}

/**
 * Injects range markers from an AnnotationStore back into a paragraph AST element.
 *
 * Preserves the exact positions and relative coincident order (via sourceOrder)
 * of all markers.
 */
export function injectParagraphAnnotations(p: CT_P, paraId: NodeId, store: AnnotationStore): CT_P {
  const markers = store.getMarkersForNode(paraId);
  if (markers.length === 0) {
    return p;
  }

  // Group markers by offset
  const markersByOffset = new Map<number, PositionalMarker[]>();
  for (const m of markers) {
    const list = markersByOffset.get(m.pos.offset) ?? [];
    list.push(m);
    markersByOffset.set(m.pos.offset, list);
  }

  const newContent: CT_P_PContent[] = [];
  const origContent = p.pContent;

  for (let i = 0; i <= origContent.length; i++) {
    const atThisOffset = markersByOffset.get(i);
    if (atThisOffset) {
      // Coincident markers at the same offset are ordered by sourceOrder
      atThisOffset.sort((a, b) => a.sourceOrder - b.sourceOrder);
      for (const m of atThisOffset) {
        newContent.push(m.rawElement as CT_P_PContent);
      }
    }
    if (i < origContent.length) {
      const item = origContent[i];
      if (item) {
        newContent.push(item);
      }
    }
  }

  return {
    ...p,
    pContent: newContent,
  };
}

/**
 * Extracts range markers from body-level elements into an AnnotationStore.
 */
export function extractBodyAnnotations(
  body: CT_Body,
  bodyId: NodeId,
  store: AnnotationStore,
): CT_Body {
  const strippedBlocks: CT_Body_BlockLevelElts[] = [];

  for (const block of body.blockLevelElts) {
    const isStart = START_MARKER_KINDS.has(block.kind);
    const isEnd = END_MARKER_KINDS.has(block.kind);

    if (isStart || isEnd) {
      const kind = toAnnotationKind(block.kind);
      const val = (block as { value: { id?: string | number; name?: string } }).value;
      const id = String(val.id ?? '');
      const name = val.name;
      const sourceOrder = store.mintSourceOrder();
      const pos: DocPos = { node: bodyId, offset: strippedBlocks.length };

      store.recordMarker({
        kind,
        id,
        endpoint: isStart ? 'start' : 'end',
        pos,
        sourceOrder,
        rawElement: block,
        name,
      });
    } else {
      strippedBlocks.push(block);
    }
  }

  return {
    ...body,
    blockLevelElts: strippedBlocks,
  };
}

/**
 * Injects range markers from an AnnotationStore back into body-level elements.
 */
export function injectBodyAnnotations(
  body: CT_Body,
  bodyId: NodeId,
  store: AnnotationStore,
): CT_Body {
  const markers = store.getMarkersForNode(bodyId);
  if (markers.length === 0) {
    return body;
  }

  const markersByOffset = new Map<number, PositionalMarker[]>();
  for (const m of markers) {
    const list = markersByOffset.get(m.pos.offset) ?? [];
    list.push(m);
    markersByOffset.set(m.pos.offset, list);
  }

  const newBlocks: CT_Body_BlockLevelElts[] = [];
  const origBlocks = body.blockLevelElts;

  for (let i = 0; i <= origBlocks.length; i++) {
    const atThisOffset = markersByOffset.get(i);
    if (atThisOffset) {
      atThisOffset.sort((a, b) => a.sourceOrder - b.sourceOrder);
      for (const m of atThisOffset) {
        newBlocks.push(m.rawElement as CT_Body_BlockLevelElts);
      }
    }
    if (i < origBlocks.length) {
      const block = origBlocks[i];
      if (block) {
        newBlocks.push(block);
      }
    }
  }

  return {
    ...body,
    blockLevelElts: newBlocks,
  };
}
