import { describe, it, expect } from 'vitest';
import {
  createCompositionState,
  onCompositionStart,
  onCompositionUpdate,
  onCompositionEnd,
  cancelComposition
} from './ime.js';
import { createCaret } from '../position/types.js';
import { IdTable } from '@ooxml/wml';

describe('IME Composition', () => {
  it('Composition start records anchor position', () => {
    const table = new IdTable();
    const id = table.mint('paragraph');
    const state = createCompositionState();
    const caret = createCaret({ node: id, offset: 5 });
    
    const newState = onCompositionStart(state, caret);
    
    expect(newState.active).toBe(true);
    expect(newState.anchorNode).toBe(id);
    expect(newState.anchorOffset).toBe(5);
  });

  it('Composition update replaces provisional text', () => {
    const table = new IdTable();
    const id = table.mint('paragraph');
    let state = createCompositionState();
    state = onCompositionStart(state, createCaret({ node: id, offset: 5 }));
    
    state = onCompositionUpdate(state, 'h');
    expect(state.text).toBe('h');
    
    // Should replace, not append
    state = onCompositionUpdate(state, 'he');
    expect(state.text).toBe('he');
  });

  it('Composition end returns commit text for single undo step', () => {
    const table = new IdTable();
    const id = table.mint('paragraph');
    let state = createCompositionState();
    state = onCompositionStart(state, createCaret({ node: id, offset: 5 }));
    state = onCompositionUpdate(state, 'hello');
    
    const result = onCompositionEnd(state, 'hello');
    
    expect(result.commitText).toBe('hello');
    expect(result.state.active).toBe(false);
    expect(result.state.anchorNode).toBeNull();
  });

  it('Cancel composition resets state', () => {
    const table = new IdTable();
    const id = table.mint('paragraph');
    let state = createCompositionState();
    state = onCompositionStart(state, createCaret({ node: id, offset: 5 }));
    state = onCompositionUpdate(state, 'hello');
    
    state = cancelComposition(state);
    
    expect(state.active).toBe(false);
    expect(state.anchorNode).toBeNull();
    expect(state.text).toBe('');
  });
});
