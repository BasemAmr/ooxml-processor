import { describe, expect, it } from 'vitest';
import { NAMESPACES, NS_BY_TOKEN, NS_BY_URI, TRANSITIONAL_ONLY } from './namespaces.js';

describe('namespace binding table', () => {
  it('round-trips every dialect URI through NS_BY_URI', () => {
    for (const binding of NAMESPACES) {
      expect(NS_BY_TOKEN.get(binding.token)).toBe(binding);
      if (binding.transitional !== undefined) {
        expect(NS_BY_URI.get(binding.transitional)).toBe(binding.token);
      }
      if (binding.strict !== undefined) {
        expect(NS_BY_URI.get(binding.strict)).toBe(binding.token);
      }
    }
  });

  it('keeps Strict unavailable for exactly the Transitional-only namespaces', () => {
    expect([...TRANSITIONAL_ONLY].sort()).toEqual([
      'vml',
      'vml-excel',
      'vml-office',
      'vml-powerpoint',
      'vml-word',
      'w14',
      'w15',
      'w16',
      'wp14',
      'wpc',
      'wpg',
      'wps',
    ]);
    for (const binding of NAMESPACES) {
      expect(binding.strict === undefined).toBe(TRANSITIONAL_ONLY.has(binding.token));
    }
  });
});
