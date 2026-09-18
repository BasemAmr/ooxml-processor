import { describe, it, expect } from 'vitest';
import { resolveParagraphSpacing, applyLineSpacingRule } from './spacing';

describe('spacing', () => {
  it('suppresses before at page top', () => {
    const res = resolveParagraphSpacing(
      { before: 100, after: 100, line: 240, lineRule: 'auto' },
      null,
      false,
      true,
      false,
      false,
    );
    expect(res.before).toBe(0);
  });

  it('takes max for adjacent spacing (adjusts before to compensate for prev.after)', () => {
    const prev = { before: 0, after: 150, line: 240, lineRule: 'auto' as const };
    const current = { before: 100, after: 100, line: 240, lineRule: 'auto' as const };

    const res = resolveParagraphSpacing(current, prev, false, false, false, false);
    // Since prev.after (150) > current.before (100), additional before needed is 0
    expect(res.before).toBe(0);

    const currentLarger = { before: 200, after: 100, line: 240, lineRule: 'auto' as const };
    const resLarger = resolveParagraphSpacing(currentLarger, prev, false, false, false, false);
    // Since current.before (200) > prev.after (150), additional before is 50
    expect(resLarger.before).toBe(50);
  });

  it('applies contextual spacing suppression', () => {
    const current = {
      before: 100,
      after: 100,
      line: 240,
      lineRule: 'auto' as const,
      contextualSpacing: true,
    };
    const res = resolveParagraphSpacing(current, null, true, false, false, false);
    expect(res.before).toBe(0);
    expect(res.after).toBe(0);
  });

  it('exact line rule clips height', () => {
    expect(applyLineSpacingRule(500, 300, 'exact')).toBe(300);
    expect(applyLineSpacingRule(200, 300, 'exact')).toBe(300);
  });

  it('atLeast rule provides a floor', () => {
    expect(applyLineSpacingRule(500, 300, 'atLeast')).toBe(500);
    expect(applyLineSpacingRule(200, 300, 'atLeast')).toBe(300);
  });
});
