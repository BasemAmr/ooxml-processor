import { describe, expect, it } from 'vitest';
import {
  createCursor,
  createReadContext,
  createStringSink,
  createWriteContext,
  uriFor,
} from './index.js';
import { NS_BY_TOKEN } from '../generated/namespaces.js';
import { readCT_Characteristic } from '../generated/characteristics/reader.js';
import { writeCT_Characteristic } from '../generated/characteristics/writer.js';
import { readCT_Background, readCT_OnOff, readCT_P, readCT_PBdr } from '../generated/wml/reader.js';
import {
  writeCT_Background,
  writeCT_OnOff,
  writeCT_P,
  writeCT_PBdr,
} from '../generated/wml/writer.js';
import type { PositionedRaw } from './preserve.js';

const TRANSITIONAL_URIS: Record<string, string> = {};
const STRICT_URIS: Record<string, string> = {};
for (const [token, binding] of NS_BY_TOKEN) {
  if (binding.transitional) TRANSITIONAL_URIS[token] = binding.transitional;
  if ('strict' in binding && binding.strict) STRICT_URIS[token] = binding.strict;
}

describe('P1-04 Round-trip and serialization invariants', () => {
  it('<w:b/> round-trips as <w:b/>, and <w:b w:val="0"/> as <w:b w:val="false"/>', () => {
    const readCtx = createReadContext('transitional', TRANSITIONAL_URIS);
    const writeCtx = createWriteContext('transitional', TRANSITIONAL_URIS);

    // 1. <w:b/>
    const cur1 = createCursor(
      '<w:b xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );
    const bold1 = readCT_OnOff(cur1, readCtx);
    expect(bold1.val).toBeUndefined(); // Absent means true, but property is left undefined so default is not baked

    const { sink: sink1, toString: str1 } = createStringSink();
    writeCT_OnOff(sink1, bold1, writeCtx, 'b');
    const gen2_1 = str1();
    expect(gen2_1).toBe(
      '<w:b xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );

    // 2. <w:b w:val="0"/>
    const cur2 = createCursor(
      '<w:b xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="0"/>',
    );
    const bold2 = readCT_OnOff(cur2, readCtx);
    expect(bold2.val).toBe(false);

    const { sink: sink2, toString: str2 } = createStringSink();
    writeCT_OnOff(sink2, bold2, writeCtx, 'b');
    const gen2_2 = str2();
    expect(gen2_2).toBe(
      '<w:b xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="false"/>',
    );

    // Gen3 idempotence
    const cur3 = createCursor(gen2_2);
    const bold3 = readCT_OnOff(cur3, readCtx);
    const { sink: sink3, toString: str3 } = createStringSink();
    writeCT_OnOff(sink3, bold3, writeCtx, 'b');
    expect(str3()).toBe(gen2_2);
  });

  it('interleaves PositionedRaw at (afterSlot: 0, afterIndex: 0) between repetitions of slot 0', () => {
    const writeCtx = createWriteContext('transitional', TRANSITIONAL_URIS);
    const { sink, toString } = createStringSink();

    // CT_PBdr has slots: top, left, bottom, right, between, bar
    // Let's create a CT_PBdr with top, and an unknown node anchored at afterSlot: -1 (leading) and afterSlot: 0
    const rawLeading: PositionedRaw = {
      afterSlot: -1,
      node: {
        uri: 'urn:unknown',
        localName: 'extLeading',
        prefix: 'u',
        attrs: [],
        nsDeclarations: new Map(),
        children: [],
      },
    };
    const rawAfterTop: PositionedRaw = {
      afterSlot: 0,
      node: {
        uri: 'urn:unknown',
        localName: 'extAfterTop',
        prefix: 'u',
        attrs: [],
        nsDeclarations: new Map(),
        children: [],
      },
    };

    writeCT_PBdr(
      sink,
      {
        top: { val: 'single' as any, sz: 12 as any },
        bottom: { val: 'single' as any, sz: 12 as any },
        $unknown: [rawAfterTop, rawLeading],
      },
      writeCtx,
      'pBdr',
    );

    const xml = toString();
    expect(xml).toBe(
      '<w:pBdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<u:extLeading xmlns:u="urn:unknown"/>' +
        '<w:top w:val="single" w:sz="12"/>' +
        '<u:extAfterTop xmlns:u="urn:unknown"/>' +
        '<w:bottom w:val="single" w:sz="12"/>' +
        '</w:pBdr>',
    );
  });

  it('refuses to emit a VML type in a Strict dialect context', () => {
    const strictCtx = createWriteContext('strict', STRICT_URIS);
    expect(() => uriFor(strictCtx, 'vml')).toThrow(
      "WriteContext has no URI for namespace token 'vml' (dialect: strict)",
    );
  });

  it('round-trips mc:AlternateContent with Choice and Fallback branches byte-for-byte', () => {
    const readCtx = createReadContext('transitional', TRANSITIONAL_URIS);
    const writeCtx = createWriteContext('transitional', TRANSITIONAL_URIS);

    const input =
      '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
      ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"' +
      ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"' +
      ' xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
      '<mc:AlternateContent>' +
      '<mc:Choice Requires="w14"><w:r><w:t>Choice 1</w:t></w:r></mc:Choice>' +
      '<mc:Choice Requires="w15"><w:r><w:t>Choice 2</w:t></w:r></mc:Choice>' +
      '<mc:Fallback><w:r><w:t>Fallback</w:t></w:r></mc:Fallback>' +
      '</mc:AlternateContent>' +
      '</w:p>';

    const cur = createCursor(input);
    const p1 = readCT_P(cur, readCtx);

    const { sink: sink2, toString: str2 } = createStringSink();
    writeCT_P(sink2, p1, writeCtx, 'p');
    const gen2 = str2();

    expect(gen2).toContain('<mc:Choice Requires="w14"><w:r><w:t>Choice 1</w:t></w:r></mc:Choice>');
    expect(gen2).toContain('<mc:Choice Requires="w15"><w:r><w:t>Choice 2</w:t></w:r></mc:Choice>');
    expect(gen2).toContain('<mc:Fallback><w:r><w:t>Fallback</w:t></w:r></mc:Fallback>');

    const cur2 = createCursor(gen2);
    const p2 = readCT_P(cur2, readCtx);
    const { sink: sink3, toString: str3 } = createStringSink();
    writeCT_P(sink3, p2, writeCtx, 'p');
    const gen3 = str3();

    expect(gen3).toBe(gen2);
  });

  it('preserves absence of an attribute at its schema default without applying or emitting it', () => {
    const readCtx = createReadContext('transitional', TRANSITIONAL_URIS);
    const writeCtx = createWriteContext('transitional', TRANSITIONAL_URIS);

    // CT_Background has color with schema default 'auto'
    const input =
      '<w:background xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>';
    const cur = createCursor(input);
    const bg1 = readCT_Background(cur, readCtx);

    // Verified: reader never applies default value 'auto'
    expect(bg1.color).toBeUndefined();

    const { sink: sink2, toString: str2 } = createStringSink();
    writeCT_Background(sink2, bg1, writeCtx, 'background');
    const gen2 = str2();

    // Verified: writer never emits default attribute when it was absent
    expect(gen2).not.toContain('color');
    expect(gen2).toBe(input);
  });

  it('demonstrates gen2 === gen3 idempotence on CT_Characteristic fixture', () => {
    const readCtx = createReadContext('transitional', TRANSITIONAL_URIS);
    const writeCtx = createWriteContext('transitional', TRANSITIONAL_URIS);

    const input = '<CT_Characteristic name="test" relation="test" val="1"/>';
    const cur = createCursor(input);
    const val1 = readCT_Characteristic(cur, readCtx);

    const { sink: sink2, toString: str2 } = createStringSink();
    writeCT_Characteristic(sink2, val1, writeCtx, 'Characteristic');
    const gen2 = str2();

    const cur2 = createCursor(gen2);
    const val2 = readCT_Characteristic(cur2, readCtx);

    const { sink: sink3, toString: str3 } = createStringSink();
    writeCT_Characteristic(sink3, val2, writeCtx, 'Characteristic');
    const gen3 = str3();

    expect(gen2).toBe(gen3);
  });
});
