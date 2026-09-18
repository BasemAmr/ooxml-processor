import { nextGraphemeBreak, prevGraphemeBreak, findWordAt } from '@ooxml/text';
import type { Caret } from '../position/types.js';
import { createCaret } from '../position/types.js';
import type { LayoutIndex } from '../position/map.js';
import { toLayout } from '../position/map.js';
import type { Selection } from '../selection/model.js';
import { createRange } from '../selection/model.js';
import { caretRect } from '../caret.js';
import { hitTestLine } from '@ooxml/layout';

export type NavigationPolicy = { bidi: 'logical' | 'visual' };

export function moveHorizontal(caret: Caret, dir: 'left' | 'right', text: string, policy: NavigationPolicy = { bidi: 'logical' }): Caret {
  const newOffset = dir === 'right' ? nextGraphemeBreak(text, caret.pos.offset) : prevGraphemeBreak(text, caret.pos.offset);
  return createCaret({ node: caret.pos.node, offset: newOffset }, 'downstream', null);
}

export function moveVertical(caret: Caret, dir: 'up' | 'down', index: LayoutIndex): Caret {
  const lp = toLayout(caret, index);
  if (lp === 'NOT_LAID_OUT') return caret;

  let goalX = caret.preferredX;
  if (goalX === null) {
    const rect = caretRect(caret, index);
    goalX = rect ? rect.x : 0;
  }

  const page = index.pages[lp.page];
  if (!page) return caret;

  let targetLineIdx = lp.lineIndex + (dir === 'down' ? 1 : -1);
  if (targetLineIdx < 0 || targetLineIdx >= page.lines.length) return { ...caret, preferredX: goalX };

  const targetLine = page.lines[targetLineIdx]!;
  const hit = hitTestLine(targetLine, goalX);
  if (!hit) return { ...caret, preferredX: goalX };

  const affinity = hit.affinity === 'left' ? 'downstream' : 'upstream'; // rough approximation
  return createCaret({ node: hit.srcNode, offset: hit.srcOffset }, affinity, goalX);
}

export function moveByWord(caret: Caret, dir: 'left' | 'right', text: string): Caret {
  if (dir === 'left') {
    let off = caret.pos.offset - 1;
    if (off < 0) off = 0;
    const word = findWordAt(text, off);
    if (!word) return caret;
    return createCaret({ node: caret.pos.node, offset: word.index }, 'downstream', null);
  } else {
    const word = findWordAt(text, caret.pos.offset);
    if (!word) return caret;
    // jump to end of word
    const end = word.index + word.length;
    // If we are already at the end, find the next word
    if (caret.pos.offset >= end) {
       const nextWord = findWordAt(text, end + 1);
       if (nextWord) return createCaret({ node: caret.pos.node, offset: nextWord.index + nextWord.length }, 'downstream', null);
    }
    return createCaret({ node: caret.pos.node, offset: end }, 'downstream', null);
  }
}

export function moveToLineEdge(caret: Caret, edge: 'home' | 'end', index: LayoutIndex): Caret {
  const lp = toLayout(caret, index);
  if (lp === 'NOT_LAID_OUT') return caret;

  const page = index.pages[lp.page];
  if (!page) return caret;
  const line = page.lines[lp.lineIndex];
  if (!line) return caret;

  if (line.segments.length === 0) return caret;

  if (edge === 'home') {
    const firstSeg = line.segments[0]!;
    if (firstSeg.runs.length === 0) return caret;
    const firstRun = firstSeg.runs[0]!;
    const offset = firstRun.clusters.clusterCount > 0 ? firstRun.clusters.srcOffset(0) : 0;
    return createCaret({ node: firstRun.srcNode, offset }, 'downstream', null);
  } else {
    const lastSeg = line.segments[line.segments.length - 1]!;
    if (lastSeg.runs.length === 0) return caret;
    const lastRun = lastSeg.runs[lastSeg.runs.length - 1]!;
    const lastCluster = Math.max(0, lastRun.clusters.clusterCount - 1);
    const offset = lastRun.clusters.clusterCount > 0 ? lastRun.clusters.srcOffset(lastCluster) + lastRun.clusters.srcLength(lastCluster) : 0;
    return createCaret({ node: lastRun.srcNode, offset }, 'upstream', null);
  }
}

export function moveToDocumentEdge(edge: 'start' | 'end', index: LayoutIndex): Caret {
  // Rough implementation
  if (index.pages.length === 0) throw new Error('No pages');
  if (edge === 'start') {
    const page = index.pages[0]!;
    const line = page.lines[0]!;
    const seg = line.segments[0]!;
    const run = seg.runs[0]!;
    return createCaret({ node: run.srcNode, offset: 0 }, 'downstream', null);
  } else {
    const page = index.pages[index.pages.length - 1]!;
    const line = page.lines[page.lines.length - 1]!;
    const seg = line.segments[line.segments.length - 1]!;
    const run = seg.runs[seg.runs.length - 1]!;
    const cl = Math.max(0, run.clusters.clusterCount - 1);
    return createCaret({ node: run.srcNode, offset: run.clusters.srcOffset(cl) + run.clusters.srcLength(cl) }, 'upstream', null);
  }
}

export function extendSelection(sel: Selection, target: Caret): Selection {
  if (sel.kind === 'collapsed') {
    return createRange(sel.caret.pos, target.pos, target.affinity);
  } else if (sel.kind === 'range') {
    return createRange(sel.anchor, target.pos, target.affinity);
  }
  return sel;
}
