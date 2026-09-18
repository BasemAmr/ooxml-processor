import { describe, it, expect } from 'vitest';
import { resolveJustification } from './justify';

describe('resolveJustification', () => {
  it('handles logical start/end for LTR', () => {
    expect(resolveJustification('start', 'ltr', false, false).alignment).toBe('left');
    expect(resolveJustification('end', 'ltr', false, false).alignment).toBe('right');
  });

  it('handles logical start/end for RTL', () => {
    expect(resolveJustification('start', 'rtl', false, false).alignment).toBe('right');
    expect(resolveJustification('end', 'rtl', false, false).alignment).toBe('left');
  });

  it('both justifies spaces but not on the last line', () => {
    expect(resolveJustification('both', 'ltr', false, false)).toEqual({
      alignment: 'justify',
      justifyType: 'spaces',
      isFallback: false,
    });
    // Last line asymmetry:
    expect(resolveJustification('both', 'ltr', true, false)).toEqual({
      alignment: 'left', // falls back to start alignment
    });
  });

  it('distribute justifies spaces on the last line too', () => {
    expect(resolveJustification('distribute', 'ltr', true, false)).toEqual({
      alignment: 'justify',
      justifyType: 'distribute',
      isFallback: false,
    });
  });

  it('kashida falls back if not supported', () => {
    expect(resolveJustification('highKashida', 'ltr', false, false)).toEqual({
      alignment: 'justify',
      justifyType: 'spaces',
      isFallback: true,
    });

    expect(resolveJustification('highKashida', 'ltr', false, true)).toEqual({
      alignment: 'justify',
      justifyType: 'kashida',
      isFallback: false,
    });
  });
});
