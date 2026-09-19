import { describe, expect, it } from 'vitest';
import { auditMathTable, layoutMath } from './index.js';

describe('OMML fallback layout', () => {
  it('records the MATH-table access gap explicitly', () => {
    expect(auditMathTable().available).toBe(false);
    expect(auditMathTable().glyphAssemblies).toBe(false);
  });
  it('lays out fractions and scripts bottom-up', () => {
    const diagnostics: string[] = [];
    const box = layoutMath(
      {
        kind: 'f',
        children: [
          { kind: 'r', text: 'a' },
          {
            kind: 'sSup',
            children: [
              { kind: 'r', text: 'b' },
              { kind: 'r', text: '2' },
            ],
          },
        ],
      },
      { fontSize: 16, mathTableAvailable: false, diagnostics },
    );
    expect(box.width).toBeGreaterThan(0);
    expect(box.children.length).toBe(2);
    expect(diagnostics).toContain('math-math-table-unavailable');
  });
});
