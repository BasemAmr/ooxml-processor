import { describe, it, expect } from 'vitest';
import { adjustCharMetrics, isKerningEnabled } from './char-metrics';

describe('char-metrics', () => {
  it('w:w scales advances', () => {
    // 200% width
    const adv = adjustCharMetrics(100, 24, { w: 200, spacing: 0, kern: 0 });
    expect(adv).toBe(200);
  });

  it('w:spacing adds to advance', () => {
    const adv = adjustCharMetrics(100, 24, { w: 100, spacing: -20, kern: 0 });
    expect(adv).toBe(80);
  });

  it('w:kern is a threshold, not a boolean', () => {
    // Font size 24 (12pt), kern threshold 30 (15pt) -> false
    expect(isKerningEnabled(24, 30)).toBe(false);

    // Font size 24 (12pt), kern threshold 16 (8pt) -> true
    expect(isKerningEnabled(24, 16)).toBe(true);

    // No threshold -> false
    expect(isKerningEnabled(24)).toBe(false);
  });

  it('combines w:w and spacing correctly', () => {
    // scales first, then adds spacing
    const adv = adjustCharMetrics(100, 24, { w: 150, spacing: 10, kern: 0 });
    expect(adv).toBe(160); // 100 * 1.5 = 150 + 10 = 160
  });
});
