import { describe, it, expect } from 'vitest';
import { DisplayList } from './displaylist.js';
import { paintDecorations } from './decorations.js';

describe('Text Decoration Painting (P5-18)', () => {
  it('enumerates all underline styles correctly and skips words on whitespace', () => {
    const dl = new DisplayList();

    // Words underline on whitespace
    paintDecorations(dl, { underline: 'words' }, 0, 10, 50, 12, 10, true);
    // Should be skipped
    expect(dl.items.length).toBe(0);

    // Words underline on non-whitespace
    paintDecorations(dl, { underline: 'words' }, 0, 10, 50, 12, 10, false);
    expect(dl.items.length).toBe(1);
    expect(dl.items[0]?.type).toBe('line');

    // Asymmetric names
    paintDecorations(dl, { underline: 'dashDotHeavy' }, 0, 10, 50, 12, 10, false);
    expect(dl.items.length).toBe(2);
    expect(dl.items[1]?.type).toBe('line');
    // Ensure stroke width is doubled
    expect((dl.items[1] as any).width).toBe(2);
  });

  it('renders standard highlights', () => {
    const dl = new DisplayList();
    paintDecorations(dl, { highlight: 'yellow' }, 0, 10, 50, 12, 10, false);
    expect(dl.items.length).toBe(1);
    expect(dl.items[0]?.type).toBe('rect');
    expect((dl.items[0] as any).fill).toBe('#FFFF00');
  });

  it('renders text effects as static approximations', () => {
    const dl = new DisplayList();
    paintDecorations(dl, { effect: 'antsRed' }, 0, 10, 50, 12, 10, false);
    expect(dl.items.length).toBe(1);
    // Rendered statically as a marker line
    expect(dl.items[0]?.type).toBe('line');
  });
});
