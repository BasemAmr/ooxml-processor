import type { LayoutIndex } from '../position/map.js';
import type { Selection } from './model.js';
import type { Rect } from '../caret.js';

export function selectionRects(sel: Selection, index: LayoutIndex): Rect[] {
  if (sel.kind !== 'range') return [];
  
  let firstFound: 'anchor' | 'focus' | null = null;
  if (sel.anchor.node === sel.focus.node) {
    firstFound = sel.anchor.offset <= sel.focus.offset ? 'anchor' : 'focus';
  } else {
    outer: for (const page of index.pages) {
      for (const line of page.lines) {
        for (const segment of line.segments) {
          for (const run of segment.runs) {
            if (run.srcNode === sel.anchor.node) { firstFound = 'anchor'; break outer; }
            if (run.srcNode === sel.focus.node) { firstFound = 'focus'; break outer; }
          }
        }
      }
    }
  }
  
  if (!firstFound) return [];
  const startPos = firstFound === 'focus' ? sel.focus : sel.anchor;
  const endPos = firstFound === 'focus' ? sel.anchor : sel.focus;

  const rects: Rect[] = [];
  let inSelection = false;

  for (const page of index.pages) {
    for (const line of page.lines) {
      const lineRects: Rect[] = [];
      let currentRect: Rect | null = null;
      let lastGlyphX = line.segments.length > 0 ? line.segments[0]!.x : 0;

      for (const segment of line.segments) {
        let currentX = segment.x;
        for (const run of segment.runs) {
          for (let c = 0; c < run.clusters.clusterCount; c++) {
            const off = run.clusters.srcOffset(c);
            const len = run.clusters.srcLength(c);
            const advance = run.clusters.xAdvance(c);
            
            let clusterSelected = inSelection;

            if (run.srcNode === startPos.node && startPos.offset >= off && startPos.offset < off + len) {
              clusterSelected = true;
              inSelection = true;
            }
            if (run.srcNode === endPos.node && endPos.offset > off && endPos.offset <= off + len) {
               clusterSelected = true;
               inSelection = false;
            }
            if (run.srcNode === endPos.node && endPos.offset === off) {
               clusterSelected = false;
               inSelection = false;
            }

            if (startPos.node === endPos.node && run.srcNode === startPos.node) {
              if (startPos.offset >= off && startPos.offset < off + len && endPos.offset > off && endPos.offset <= off + len) {
                clusterSelected = true;
                inSelection = false;
              }
            }

            if (clusterSelected) {
              lastGlyphX = Math.max(lastGlyphX, currentX + advance);
              if (!currentRect) {
                currentRect = { x: currentX, y: line.top, w: advance, h: line.height };
              } else if (Math.abs((currentRect.x + currentRect.w) - currentX) < 0.1) {
                currentRect.w += advance;
              } else {
                lineRects.push(currentRect);
                currentRect = { x: currentX, y: line.top, w: advance, h: line.height };
              }
            }
            currentX += advance;
          }
        }
      }

      if (currentRect) {
        lineRects.push(currentRect);
      }

      if (inSelection) {
        const extRect: Rect = { x: lastGlyphX, y: line.top, w: 8, h: line.height };
        if (lineRects.length > 0) {
          const lastRect = lineRects[lineRects.length - 1]!;
          if (Math.abs((lastRect.x + lastRect.w) - lastGlyphX) < 0.1) {
            lastRect.w += 8;
          } else {
            lineRects.push(extRect);
          }
        } else {
          lineRects.push(extRect);
        }
      }

      rects.push(...lineRects);
    }
  }

  return rects;
}
