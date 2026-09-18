import { describe, expect, it } from 'vitest';
import { createWriteContext, uriFor } from './write.js';

describe('writer context', () => {
  it('refuses to emit a namespace absent from the selected dialect', () => {
    const ctx = createWriteContext('strict', { wml: 'urn:strict:wml' });
    expect(() => uriFor(ctx, 'vml')).toThrow(
      "WriteContext has no URI for namespace token 'vml' (dialect: strict)",
    );
  });

  it('resolves known namespace tokens through the dialect URI table', () => {
    const ctx = createWriteContext('strict', { wml: 'urn:strict:wml' });
    expect(uriFor(ctx, 'wml')).toBe('urn:strict:wml');
  });
});
