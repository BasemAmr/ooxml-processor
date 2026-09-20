import { describe, expect, it, vi } from 'vitest';
import { InteractionManager } from './interaction';
import type { LayoutIndex } from '@ooxml/editor';

function canvasMock(): HTMLCanvasElement & { fire(type: string, event: Partial<MouseEvent>): void } {
  const listeners = new Map<string, EventListener[]>();
  const canvas = {
    addEventListener(type: string, listener: EventListener): void {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(): void {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200, right: 310, bottom: 220, x: 10, y: 20, toJSON: () => ({}) }),
    fire(type: string, event: Partial<MouseEvent>): void {
      for (const listener of listeners.get(type) ?? []) listener(event as MouseEvent);
    },
  } as unknown as HTMLCanvasElement & { fire(type: string, event: Partial<MouseEvent>): void };
  return canvas;
}

const emptyIndex: LayoutIndex = { pages: [], paragraphs: new Map() };

describe('InteractionManager', () => {
  it('converts client coordinates using the canvas origin and zoom without requiring layout', () => {
    const canvas = canvasMock();
    const onCaret = vi.fn();
    const manager = new InteractionManager({ canvas, layoutIndex: emptyIndex, zoom: 2, onCaret });
    canvas.fire('mousedown', { clientX: 30, clientY: 60, detail: 1 });
    expect(onCaret).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('does not retain or invalidate page-cache state while a drag has no hit', () => {
    const canvas = canvasMock();
    const pointer = vi.fn();
    const manager = new InteractionManager({ canvas, layoutIndex: emptyIndex, onPointerState: pointer });
    canvas.fire('mousedown', { clientX: 10, clientY: 20, detail: 1 });
    canvas.fire('mousemove', { clientX: 100, clientY: 100, detail: 1 });
    canvas.fire('mouseup', { clientX: 100, clientY: 100, detail: 1 });
    expect(pointer).not.toHaveBeenCalled();
    manager.dispose();
  });
});
