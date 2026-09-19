import { describe, expect, it } from 'vitest';
import {
  createDeferredGraphicPlaceholder,
  deferredGraphicKind,
  placeholderCoverage,
} from './placeholders.js';
import type { RawNode } from '@ooxml/schema';

describe('deferred graphic placeholders', () => {
  it('identifies chart and reports visible placeholder coverage', () => {
    const node: RawNode = {
      uri: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
      localName: 'chart',
      prefix: 'c',
      attrs: [],
      nsDeclarations: new Map(),
      children: [],
    };
    expect(deferredGraphicKind(node)).toBe('chart');
    expect(
      createDeferredGraphicPlaceholder('chart', { x: 1, y: 2, width: 30, height: 40 }).label,
    ).toContain('Chart');
    expect(placeholderCoverage('chart').states.painted).toBe('placeholder');
  });
});
