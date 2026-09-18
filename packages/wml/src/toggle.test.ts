import { describe, expect, it } from 'vitest';
import {
  isToggleProperty,
  NON_TOGGLE_ONOFF_PROPERTIES,
  toOnOffState,
  toggleCombine,
  TOGGLE_PROPERTIES,
} from './toggle.js';

describe('P3-07 Toggle-property XOR', () => {
  it('identifies the exact 14 toggle properties and 6 non-toggle properties', () => {
    expect(TOGGLE_PROPERTIES.size).toBe(14);
    expect(NON_TOGGLE_ONOFF_PROPERTIES.size).toBe(6);

    for (const p of TOGGLE_PROPERTIES) {
      expect(isToggleProperty(p)).toBe(true);
      expect(NON_TOGGLE_ONOFF_PROPERTIES.has(p)).toBe(false);
    }

    for (const p of NON_TOGGLE_ONOFF_PROPERTIES) {
      expect(isToggleProperty(p)).toBe(false);
    }
  });

  it('correctly maps CT_OnOff elements to 3-state OnOffState', () => {
    expect(toOnOffState(undefined)).toBe('absent');
    expect(toOnOffState({})).toBe('true'); // <w:b/> -> val is undefined -> true
    expect(toOnOffState({ val: true })).toBe('true');
    expect(toOnOffState({ val: 1 as any })).toBe('true');
    expect(toOnOffState({ val: '1' as any })).toBe('true');
    expect(toOnOffState({ val: 'true' as any })).toBe('true');
    expect(toOnOffState({ val: 'on' })).toBe('true');

    expect(toOnOffState({ val: false })).toBe('false');
    expect(toOnOffState({ val: 0 as any })).toBe('false');
    expect(toOnOffState({ val: '0' as any })).toBe('false');
    expect(toOnOffState({ val: 'false' as any })).toBe('false');
    expect(toOnOffState({ val: 'off' })).toBe('false');
  });

  it('combines toggle properties with XOR: style-bold + direct-bold = not bold', () => {
    // Style has bold, direct has bold -> false
    expect(toggleCombine('true', 'true')).toBe('false');

    // Style has bold, direct has absent -> true
    expect(toggleCombine('true', 'absent')).toBe('true');

    // Style has absent, direct has bold -> true
    expect(toggleCombine('absent', 'true')).toBe('true');

    // Style has false, direct has bold -> true
    expect(toggleCombine('false', 'true')).toBe('true');

    // Style has bold, direct has false -> true
    expect(toggleCombine('true', 'false')).toBe('true');

    // Style has false, direct has false -> false
    expect(toggleCombine('false', 'false')).toBe('false');
  });

  it('bCs and iCs toggle independently from b and i', () => {
    // A run can be bold Latin and non-bold Complex Script
    const latinState = toggleCombine('true', 'true'); // false
    const csState = toggleCombine('true', 'absent'); // true

    expect(latinState).toBe('false');
    expect(csState).toBe('true');
  });
});
