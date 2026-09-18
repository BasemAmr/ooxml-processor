import { describe, it, expect } from 'vitest';
import { findBreakOpportunities } from './breaks.js';

describe('Line Breaking (UAX#14 & Kinsoku)', () => {
  it('identifies word boundaries with spaces', () => {
    const text = 'Hello world';
    const breaks = findBreakOpportunities(text);
    // H e l l o   w o r l d
    // 0 0 0 0 0 1 0 0 0 0 1
    expect(breaks[5]).toBe(1); // after space
    expect(breaks[4]).toBe(0); // mid-word
  });

  it('honours kinsoku rules by default', () => {
    const text = 'テスト（カッコ）';
    // テ ス ト （ カ ッ コ ）
    // CJK characters can normally break between each other.
    const breaks = findBreakOpportunities(text);
    // Before （ is index 2, after ト. However （ is an opening bracket, so it can't END a line? No, opening bracket can't end a line, meaning we can't break AFTER it. So index 3 (after （) is 0.
    // Index 2 is after ト, next is （. Kinsoku doesn't strictly prevent breaking before opening bracket.
    // Index 6 is after コ, next is ）. ） cannot begin a line, so we can't break BEFORE ）. Thus index 6 is 0.

    expect(breaks[3]).toBe(0); // Cannot break after （
    expect(breaks[6]).toBe(0); // Cannot break before ）
  });

  it('allows word wrap bypass when wordWrap is false', () => {
    const text = 'HelloWorld';
    const noWrap = findBreakOpportunities(text, { wordWrap: false });
    expect(noWrap[4]).toBe(1); // can break mid-word
  });

  it('prevents breaking around NBSP', () => {
    const text = 'A\u00A0B';
    const breaks = findBreakOpportunities(text);
    expect(breaks[1]).toBe(0); // no break after NBSP
  });
});
