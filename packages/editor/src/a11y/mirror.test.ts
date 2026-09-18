/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createAccessibilityMirror } from './mirror.js';
import { IdTable } from '@ooxml/wml';

describe('Accessibility Mirror', () => {
  it('attach creates role="document" div', () => {
    const container = document.createElement('div');
    const mirror = createAccessibilityMirror();
    
    mirror.attach(container);
    
    const root = container.querySelector('div[role="document"]');
    expect(root).not.toBeNull();
    
    mirror.detach();
  });

  it('update adds paragraph elements with matching text', () => {
    const table = new IdTable();
    const id1 = table.mint('paragraph');
    const id2 = table.mint('paragraph');

    const container = document.createElement('div');
    const mirror = createAccessibilityMirror();
    mirror.attach(container);
    
    mirror.update(new Set([id1, id2]), new Map([[id1, 'Hello'], [id2, 'World']]));
    
    const root = container.querySelector('div[role="document"]');
    const paragraphs = root!.querySelectorAll('p');
    
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0]!.textContent).toBe('Hello');
    expect(paragraphs[1]!.textContent).toBe('World');
    
    mirror.detach();
  });

  it('update removes paragraphs no longer in text map', () => {
    const table = new IdTable();
    const id1 = table.mint('paragraph');
    const id2 = table.mint('paragraph');

    const container = document.createElement('div');
    const mirror = createAccessibilityMirror();
    mirror.attach(container);
    
    mirror.update(new Set([id1, id2]), new Map([[id1, 'Hello'], [id2, 'World']]));
    mirror.update(new Set([id1]), new Map([[id1, 'Hello']]));
    
    const root = container.querySelector('div[role="document"]');
    const paragraphs = root!.querySelectorAll('p');
    
    expect(paragraphs.length).toBe(1);
    
    mirror.detach();
  });

  it('detach removes the mirror from the DOM', () => {
    const container = document.createElement('div');
    const mirror = createAccessibilityMirror();
    mirror.attach(container);
    
    expect(container.childNodes.length).toBe(1);
    
    mirror.detach();
    
    expect(container.childNodes.length).toBe(0);
  });
});
