import { describe, expect, it } from 'vitest';
import { mapVmlWrap, parseVmlLength, parseVmlPath, parseVmlStyle } from './vml.js';

describe('VML helpers', () => {
  it('converts CSS units and parses style declarations', () => {
    expect(parseVmlLength('1in')).toBe(72);
    expect(parseVmlLength('20twip')).toBe(1);
    expect(parseVmlStyle('left: 10pt; width: 1in; z-index: 3').width).toBe(72);
  });
  it('parses compact path commands and wrapping', () => {
    expect(parseVmlPath('m 0,0 l 10,10 x e')).toEqual([
      { op: 'moveTo', values: [0, 0] },
      { op: 'lineTo', values: [10, 10] },
      { op: 'close', values: [] },
      { op: 'end', values: [] },
    ]);
    expect(mapVmlWrap('through')).toBe('through');
  });
});
