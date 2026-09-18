import type { NodeId } from '@ooxml/wml';
import type { Caret } from '../position/types.js';

export interface AccessibilityMirror {
  // Create the hidden DOM tree
  attach(container: HTMLElement): void;
  
  // Update mirror to reflect changed paragraphs
  update(dirtyParagraphs: Set<NodeId>, paragraphTexts: Map<NodeId, string>, visibleRange?: { first: number; last: number }): void;
  
  // Update the DOM selection to track the editor caret
  syncCaret(caret: Caret): void;
  
  // Clean up
  detach(): void;
}

export function createAccessibilityMirror(): AccessibilityMirror {
  let root: HTMLElement | null = null;
  let region: HTMLElement | null = null;
  const paragraphElements = new Map<NodeId, HTMLParagraphElement>();

  return {
    attach(container: HTMLElement) {
      if (root) return;

      root = document.createElement('div');
      // Hidden DOM tree with role="document", NOT aria-hidden
      root.setAttribute('role', 'document');
      // Position offscreen but NOT display:none because SRs need to read it
      Object.assign(root.style, {
        position: 'absolute',
        left: '-9999px',
        top: '0',
        width: '1px',
        height: '1px',
        overflow: 'hidden'
      });
      
      // Live region for announcements
      region = document.createElement('div');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      root.appendChild(region);

      container.appendChild(root);
    },

    update(dirtyParagraphs: Set<NodeId>, paragraphTexts: Map<NodeId, string>, visibleRange?: { first: number; last: number }) {
      if (!root) return;

      // In a real implementation we would respect visibleRange to only mirror what's near the viewport
      // For this simplified version we update dirty nodes that are provided in the texts map

      // Process removals
      for (const [id, pElem] of paragraphElements.entries()) {
        if (!paragraphTexts.has(id)) {
          // No longer visible or deleted
          pElem.remove();
          paragraphElements.delete(id);
        }
      }

      // Process additions and updates
      for (const id of dirtyParagraphs) {
        const text = paragraphTexts.get(id);
        if (text === undefined) continue; // Not in visible range perhaps

        let pElem = paragraphElements.get(id);
        if (!pElem) {
          pElem = document.createElement('p');
          // Paragraphs keyed by n_<NodeId>
          pElem.id = `n_${id}`;
          root.appendChild(pElem);
          paragraphElements.set(id, pElem);
        }

        if (pElem.textContent !== text) {
          pElem.textContent = text;
        }
      }
    },

    syncCaret(caret: Caret) {
      if (!root) return;
      
      const pElem = paragraphElements.get(caret.pos.node);
      if (!pElem || !pElem.firstChild) return;

      const selection = window.getSelection();
      if (!selection) return;

      try {
        const range = document.createRange();
        // Fallback to text length if offset is out of bounds
        const textLength = pElem.firstChild.textContent?.length || 0;
        const offset = Math.min(caret.pos.offset, textLength);
        
        range.setStart(pElem.firstChild, offset);
        range.setEnd(pElem.firstChild, offset);
        
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (e) {
        // Ignore selection errors (e.g. invalid offset for text node)
        // because SR syncing is a best-effort enhancement
      }
    },

    detach() {
      if (root) {
        root.remove();
        root = null;
        region = null;
        paragraphElements.clear();
      }
    }
  };
}
