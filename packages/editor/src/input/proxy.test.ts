/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { InputProxy } from './proxy.js';

describe('InputProxy', () => {
  it('creates a textarea element in the container', () => {
    const container = document.createElement('div');
    const proxy = new InputProxy({
      container,
      onInput: vi.fn(),
      onKeyDown: vi.fn(),
      onCompositionStart: vi.fn(),
      onCompositionUpdate: vi.fn(),
      onCompositionEnd: vi.fn(),
      onPaste: vi.fn(),
      onCopy: vi.fn(),
      onCut: vi.fn()
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    
    // textarea has correct attributes
    expect(textarea!.style.opacity).toBe('0');
    expect(textarea!.style.position).toBe('absolute');
    expect(textarea!.getAttribute('autocomplete')).toBe('off');
    expect(textarea!.getAttribute('spellcheck')).toBe('false');

    proxy.dispose();
  });

  it('positionAt updates the textarea left/top style', () => {
    const container = document.createElement('div');
    const proxy = new InputProxy({
      container,
      onInput: vi.fn(),
      onKeyDown: vi.fn(),
      onCompositionStart: vi.fn(),
      onCompositionUpdate: vi.fn(),
      onCompositionEnd: vi.fn(),
      onPaste: vi.fn(),
      onCopy: vi.fn(),
      onCut: vi.fn()
    });

    proxy.positionAt({ x: 100, y: 200, w: 1, h: 20 });
    
    const textarea = container.querySelector('textarea');
    expect(textarea!.style.left).toBe('100px');
    expect(textarea!.style.top).toBe('200px');
    expect(textarea!.style.height).toBe('20px');

    proxy.dispose();
  });

  it('focus calls focus({ preventScroll: true }) on the textarea', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    
    const proxy = new InputProxy({
      container,
      onInput: vi.fn(),
      onKeyDown: vi.fn(),
      onCompositionStart: vi.fn(),
      onCompositionUpdate: vi.fn(),
      onCompositionEnd: vi.fn(),
      onPaste: vi.fn(),
      onCopy: vi.fn(),
      onCut: vi.fn()
    });

    const textarea = container.querySelector('textarea');
    const focusSpy = vi.spyOn(textarea!, 'focus');

    proxy.focus();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    proxy.dispose();
    document.body.removeChild(container);
  });

  it('dispose removes the textarea from the DOM', () => {
    const container = document.createElement('div');
    const proxy = new InputProxy({
      container,
      onInput: vi.fn(),
      onKeyDown: vi.fn(),
      onCompositionStart: vi.fn(),
      onCompositionUpdate: vi.fn(),
      onCompositionEnd: vi.fn(),
      onPaste: vi.fn(),
      onCopy: vi.fn(),
      onCut: vi.fn()
    });

    expect(container.childNodes.length).toBe(1);
    proxy.dispose();
    expect(container.childNodes.length).toBe(0);
  });
});
