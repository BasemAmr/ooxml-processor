import { describe, it, expect } from 'vitest';
import { Hyphenator } from './hyphenation.js';

describe('Hyphenation tracking (P5-11)', () => {
  it('tracks consecutive hyphen limits', () => {
    const hyp = new Hyphenator({ consecutiveHyphenLimit: 2 });

    expect(hyp.canHyphenate()).toBe(true);
    hyp.recordHyphenBreak();
    expect(hyp.canHyphenate()).toBe(true);
    hyp.recordHyphenBreak();

    // Hit the limit
    expect(hyp.canHyphenate()).toBe(false);

    // Normal break resets
    hyp.recordNormalBreak();
    expect(hyp.canHyphenate()).toBe(true);
  });

  it('allows unlimited hyphens when limit is 0', () => {
    const hyp = new Hyphenator({ consecutiveHyphenLimit: 0 });

    expect(hyp.canHyphenate()).toBe(true);
    hyp.recordHyphenBreak();
    expect(hyp.canHyphenate()).toBe(true);
  });
});
