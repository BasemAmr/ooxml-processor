import type { NodeId } from '@ooxml/wml';
import type { Caret } from '../position/types.js';

export interface CompositionState {
  active: boolean;
  anchorNode: NodeId | null;     // where composition began (from DocPos.node)
  anchorOffset: number;           // where composition began (from DocPos.offset)
  text: string;                   // current provisional text
  committedLength: number;        // length of text already committed
}

export function createCompositionState(): CompositionState {
  return {
    active: false,
    anchorNode: null,
    anchorOffset: 0,
    text: '',
    committedLength: 0
  };
}

export function onCompositionStart(state: CompositionState, caret: Caret): CompositionState {
  return {
    ...state,
    active: true,
    anchorNode: caret.pos.node,
    anchorOffset: caret.pos.offset,
    text: '',
    committedLength: 0
  };
}

export function onCompositionUpdate(state: CompositionState, text: string): CompositionState {
  // Each update REPLACES the provisional text wholesale
  return {
    ...state,
    text
  };
}

export function onCompositionEnd(state: CompositionState, text: string): { state: CompositionState; commitText: string | null } {
  return {
    state: {
      ...state,
      active: false,
      anchorNode: null,
      anchorOffset: 0,
      text: '',
      committedLength: 0
    },
    commitText: text
  };
}

export function cancelComposition(state: CompositionState): CompositionState {
  return {
    ...state,
    active: false,
    anchorNode: null,
    anchorOffset: 0,
    text: '',
    committedLength: 0
  };
}
