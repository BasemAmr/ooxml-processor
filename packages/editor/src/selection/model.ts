import type { DocPos, NodeId } from '@ooxml/wml';
import type { Caret, Affinity } from '../position/types.js';
import { createCaret, caretEquals } from '../position/types.js';
import { docPosEquals } from '@ooxml/wml';

export type Selection =
  | { kind: 'collapsed'; caret: Caret }
  | { kind: 'range'; anchor: DocPos; focus: DocPos; affinity: Affinity }
  | { kind: 'tableRect'; table: NodeId; r0: number; c0: number; r1: number; c1: number }
  | { kind: 'multi'; ranges: { anchor: DocPos; focus: DocPos }[] };

export function createCollapsed(caret: Caret): Selection {
  return { kind: 'collapsed', caret };
}

export function createRange(anchor: DocPos, focus: DocPos, affinity: Affinity = 'downstream'): Selection {
  return { kind: 'range', anchor, focus, affinity };
}

export function createTableRect(table: NodeId, r0: number, c0: number, r1: number, c1: number): Selection {
  return { kind: 'tableRect', table, r0, c0, r1, c1 };
}

export function normalizeSelection(sel: Selection): Selection {
  if (sel.kind === 'range') {
    if (docPosEquals(sel.anchor, sel.focus)) {
      return {
        kind: 'collapsed',
        caret: createCaret(sel.anchor, sel.affinity, null)
      };
    }
    return sel;
  }
  if (sel.kind === 'multi') {
    if (sel.ranges.length === 0) return sel;
    const ranges = sel.ranges.map(r => {
      if (r.anchor.node === r.focus.node && r.anchor.offset > r.focus.offset) {
        return { anchor: r.focus, focus: r.anchor };
      }
      return { ...r };
    });

    ranges.sort((a, b) => {
      if (a.anchor.node !== b.anchor.node) return (a.anchor.node as number) - (b.anchor.node as number);
      return a.anchor.offset - b.anchor.offset;
    });

    const merged: { anchor: DocPos; focus: DocPos }[] = [];
    for (const r of ranges) {
      if (merged.length === 0) {
        merged.push(r);
        continue;
      }
      const last = merged[merged.length - 1]!;
      if (last.anchor.node === r.anchor.node && last.focus.node === r.anchor.node) {
        if (r.anchor.offset <= last.focus.offset) {
          if (r.focus.node === last.focus.node) {
            last.focus = { node: last.focus.node, offset: Math.max(last.focus.offset, r.focus.offset) };
          }
        } else {
          merged.push(r);
        }
      } else {
        merged.push(r);
      }
    }
    return { kind: 'multi', ranges: merged };
  }
  return sel;
}

export function selectionEquals(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'collapsed' && b.kind === 'collapsed') {
    return caretEquals(a.caret, b.caret);
  }
  if (a.kind === 'range' && b.kind === 'range') {
    return docPosEquals(a.anchor, b.anchor) && docPosEquals(a.focus, b.focus) && a.affinity === b.affinity;
  }
  if (a.kind === 'tableRect' && b.kind === 'tableRect') {
    return a.table === b.table && a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1;
  }
  if (a.kind === 'multi' && b.kind === 'multi') {
    if (a.ranges.length !== b.ranges.length) return false;
    for (let i = 0; i < a.ranges.length; i++) {
      if (!docPosEquals(a.ranges[i]!.anchor, b.ranges[i]!.anchor) || !docPosEquals(a.ranges[i]!.focus, b.ranges[i]!.focus)) return false;
    }
    return true;
  }
  return false;
}

export function isCollapsed(sel: Selection): boolean {
  return sel.kind === 'collapsed';
}

export function selectionContains(sel: Selection, pos: DocPos): boolean {
  if (sel.kind === 'range') {
    if (sel.anchor.node === pos.node && sel.focus.node === pos.node) {
      const min = Math.min(sel.anchor.offset, sel.focus.offset);
      const max = Math.max(sel.anchor.offset, sel.focus.offset);
      return pos.offset >= min && pos.offset < max;
    }
    return false;
  }
  return false;
}

export function selectionStartEnd(sel: Selection): { start: DocPos; end: DocPos } | null {
  if (sel.kind === 'collapsed') {
    return { start: sel.caret.pos, end: sel.caret.pos };
  }
  if (sel.kind === 'range') {
    if (sel.anchor.node === sel.focus.node) {
      if (sel.anchor.offset <= sel.focus.offset) {
        return { start: sel.anchor, end: sel.focus };
      } else {
        return { start: sel.focus, end: sel.anchor };
      }
    }
    return { start: sel.anchor, end: sel.focus };
  }
  return null;
}
