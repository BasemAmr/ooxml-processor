import { describe, expect, it } from 'vitest';
import { applyColorTransforms, resolveSchemeColor } from './color.js';

describe('DrawingML colour pipeline', () => {
  it('applies lumMod then shade in linear light', () => {
    const out = applyColorTransforms({ r: 0.8, g: 0.4, b: 0.2 }, { lumMod: 60000, shade: 50000 });
    expect(out.r).toBeCloseTo(0.463, 2);
    expect(out.g).toBeGreaterThan(0);
  });
  it('resolves scheme colours through caller-provided map', () => {
    expect(resolveSchemeColor('tx1', { tx1: { r: 0.1, g: 0.2, b: 0.3 } }).r).toBeCloseTo(0.1);
  });
});
