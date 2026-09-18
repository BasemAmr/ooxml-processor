import { describe, expect, it } from 'vitest';
import {
  formatOnOff,
  formatOnOffPreserving,
  isOnOffLexical,
  ON_OFF_LEXICAL_FORMS,
  ON_OFF_TRANSITIONAL_ONLY_FORMS,
  OnOffValueError,
  parseOnOff,
  parseOnOffAttr,
  parseOnOffOr,
} from './onoff.js';

describe('ST_OnOff lexical space', () => {
  const truthy = ['1', 'true', 'on'];
  const falsy = ['0', 'false', 'off'];

  it.each(truthy)('%s is true', (value) => {
    expect(parseOnOff(value)).toBe(true);
  });

  it.each(falsy)('%s is false', (value) => {
    expect(parseOnOff(value)).toBe(false);
  });

  it('covers exactly the six forms the schema union allows', () => {
    expect([...ON_OFF_LEXICAL_FORMS]).toEqual(['1', '0', 'true', 'false', 'on', 'off']);
    for (const form of ON_OFF_LEXICAL_FORMS) expect(isOnOffLexical(form)).toBe(true);
  });

  it('names on/off as the Transitional-only members', () => {
    expect([...ON_OFF_TRANSITIONAL_ONLY_FORMS]).toEqual(['on', 'off']);
  });

  // Inherited from xsd:boolean, which carries the `collapse` whitespace facet.
  it.each([
    [' true ', true],
    ['\ttrue\n', true],
    ['\r\n0  ', false],
    ['  on', true],
  ])('collapses whitespace in %j', (value, expected) => {
    expect(parseOnOff(value)).toBe(expected);
  });

  // xsd:boolean is case-sensitive. Word never writes these; guessing would make
  // us accept documents no other consumer accepts.
  it.each(['True', 'FALSE', 'On', 'yes', 'no', 'y', 'n', '', '2', '-1', 'tru e'])(
    'rejects %j',
    (value) => {
      expect(() => parseOnOff(value)).toThrow(OnOffValueError);
      expect(isOnOffLexical(value)).toBe(false);
    },
  );

  it('reports the offending value on the error', () => {
    const err = (() => {
      try {
        parseOnOff('yes');
        return undefined;
      } catch (e) {
        return e as OnOffValueError;
      }
    })();
    expect(err).toBeInstanceOf(OnOffValueError);
    expect(err?.value).toBe('yes');
    expect(err?.message).toContain('"yes"');
  });
});

describe('the absent-attribute rule', () => {
  // The single most consequential line in this file: <w:b/> is bold ON.
  it('treats an absent val on a present element as true', () => {
    expect(parseOnOff(undefined)).toBe(true);
  });

  it('does not conflate an absent attribute with an absent element', () => {
    // parseOnOffAttr answers "what did the source say", parseOnOff answers
    // "what does the element mean". They differ precisely when val is absent.
    expect(parseOnOffAttr(undefined)).toBeUndefined();
    expect(parseOnOff(undefined)).toBe(true);
  });

  it('reports the literal value when the attribute is present', () => {
    expect(parseOnOffAttr('0')).toBe(false);
    expect(parseOnOffAttr('off')).toBe(false);
    expect(parseOnOffAttr('1')).toBe(true);
  });

  it('validates a present attribute even in the presence-reporting form', () => {
    expect(() => parseOnOffAttr('maybe')).toThrow(OnOffValueError);
  });

  // DrawingML's CT_Boolean declares default="0" on the same s:ST_OnOff type.
  it('lets a caller name a different default', () => {
    expect(parseOnOffOr(undefined, false)).toBe(false);
    expect(parseOnOffOr(undefined, true)).toBe(true);
    expect(parseOnOffOr('1', false)).toBe(true);
    expect(parseOnOffOr('off', true)).toBe(false);
  });
});

describe('formatting', () => {
  it('writes the dialect-neutral spelling', () => {
    expect(formatOnOff(true)).toBe('true');
    expect(formatOnOff(false)).toBe('false');
  });

  it('round-trips through parse', () => {
    for (const value of [true, false]) {
      expect(parseOnOff(formatOnOff(value))).toBe(value);
    }
  });

  it('never writes the Transitional-only forms', () => {
    const written = [formatOnOff(true), formatOnOff(false)];
    for (const form of ON_OFF_TRANSITIONAL_ONLY_FORMS) {
      expect(written).not.toContain(form);
    }
  });
});

describe('formatOnOffPreserving', () => {
  // The round-trip cases: an unchanged value keeps the source's spelling, so a
  // save that changed nothing produces no diff.
  it.each([
    ['1', true],
    ['0', false],
    ['true', true],
    ['false', false],
    ['on', true],
    ['off', false],
  ] as const)('echoes %j when the value is unchanged', (original, value) => {
    expect(formatOnOffPreserving(value, original)).toBe(original);
  });

  it('keeps an absent attribute absent when the value is still true', () => {
    // <w:b/> stays <w:b/> rather than becoming <w:b w:val="true"/>.
    expect(formatOnOffPreserving(true, undefined)).toBeUndefined();
  });

  it('writes an attribute when an absent one can no longer express the value', () => {
    expect(formatOnOffPreserving(false, undefined)).toBe('false');
  });

  it('authors a fresh value when the value changed', () => {
    expect(formatOnOffPreserving(true, '0')).toBe('true');
    expect(formatOnOffPreserving(false, 'on')).toBe('false');
    expect(formatOnOffPreserving(true, 'off')).toBe('true');
  });

  it('does not preserve a spelling it cannot parse', () => {
    expect(formatOnOffPreserving(true, 'yes')).toBe('true');
    expect(formatOnOffPreserving(false, '')).toBe('false');
  });

  it('never introduces on/off into a document that did not have it', () => {
    // The Strict schema drops the ST_OnOff1 union member entirely, so writing
    // "on" into a Strict package would be invalid. We only ever echo it back.
    for (const original of [undefined, '1', '0', 'true', 'false']) {
      for (const value of [true, false]) {
        const out = formatOnOffPreserving(value, original);
        expect(out === 'on' || out === 'off').toBe(false);
      }
    }
  });

  it('preserved output still parses to the value it was given', () => {
    for (const original of [undefined, '1', '0', 'true', 'false', 'on', 'off', 'bogus']) {
      for (const value of [true, false]) {
        expect(parseOnOff(formatOnOffPreserving(value, original))).toBe(value);
      }
    }
  });
});
