/**
 * Inline Item Stream (P5-02)
 */

import type { NodeId } from '@ooxml/wml';
import type { PackedShapedRun } from '@ooxml/text';

export interface TextItem {
  kind: 'text';
  srcNode: NodeId;
  shapedRun: PackedShapedRun;
  /** Break opportunities aligned with clusters */
  breakOpportunities: Uint8Array;
}

export interface TabItem {
  kind: 'tab';
  srcNode: NodeId;
  pos?: number;
  leader?: string;
}

export interface BreakItem {
  kind: 'break';
  srcNode: NodeId;
  breakKind: 'line' | 'page' | 'column';
  clear: 'none' | 'left' | 'right' | 'all';
}

export interface DrawingItem {
  kind: 'drawing';
  srcNode: NodeId;
  inline: boolean;
  width: number;
  height: number;
}

export interface FieldMarkItem {
  kind: 'fieldMark';
  srcNode: NodeId;
  type: 'begin' | 'separate' | 'end';
}

export interface AnnotationItem {
  kind: 'annotation';
  srcNode: NodeId;
  marker: any;
}

export interface NoteRefItem {
  kind: 'noteRef';
  srcNode: NodeId;
  type: 'footnote' | 'endnote';
}

/**
 * Union type for all elements in the inline layout stream.
 */
export type InlineItem =
  TextItem | TabItem | BreakItem | DrawingItem | FieldMarkItem | AnnotationItem | NoteRefItem;

/**
 * Flattens runs, drawings, annotations, and break elements into an ordered array of InlineItems.
 *
 * @param elements Heterogeneous tree/array of inline content blocks or items.
 * @returns Ordered flat array of inline items suitable for line breaking.
 */
export function buildInlineStream(elements: (InlineItem | InlineItem[])[]): InlineItem[] {
  const stream: InlineItem[] = [];

  // Recursively flatten the element tree into a single stream.
  // This maintains exact relative positioning for zero-width items like annotations.
  function flatten(items: (InlineItem | InlineItem[])[]) {
    for (const item of items) {
      if (Array.isArray(item)) {
        flatten(item);
      } else {
        stream.push(item);
      }
    }
  }

  flatten(elements);
  return stream;
}
