import { describe, it, expect } from 'vitest';
import { resolveIndentation } from './indent';

describe('resolveIndentation', () => {
  it('resolves physical left/right when no logical values provided', () => {
    const res = resolveIndentation({ left: 100, right: 200 }, 'ltr');
    expect(res.physicalLeft).toBe(100);
    expect(res.physicalRight).toBe(200);
  });

  it('flips logical start/end under RTL', () => {
    const res = resolveIndentation({ start: 100, end: 200 }, 'rtl');
    expect(res.physicalLeft).toBe(200); // end maps to left in RTL
    expect(res.physicalRight).toBe(100); // start maps to right in RTL
  });

  it('logical values take precedence over physical ones', () => {
    const res = resolveIndentation({ left: 10, start: 100 }, 'ltr');
    expect(res.physicalLeft).toBe(100);
  });

  it('computes hanging indent as negative first line offset', () => {
    const res = resolveIndentation({ start: 500, hanging: 200 }, 'ltr');
    expect(res.firstLineIndent).toBe(-200);
  });

  it('computes firstLine indent as positive offset', () => {
    const res = resolveIndentation({ start: 500, firstLine: 200 }, 'ltr');
    expect(res.firstLineIndent).toBe(200);
  });
});
