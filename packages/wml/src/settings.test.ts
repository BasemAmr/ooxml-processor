import { describe, it, expect } from 'vitest';
import type { CT_Settings } from '@ooxml/schema';
import { parseSettings, parseSettingsXml } from './settings.js';

describe('P3-13 settings.xml and compatibility flags', () => {
  it('supplies defaults when settings are empty or absent', () => {
    const layout = parseSettings(undefined);

    expect(layout.defaultTabStop).toBe(720);
    expect(layout.evenAndOddHeaders).toBe(false);
    expect(layout.displayBackgroundShape).toBe(false);
    expect(layout.mirrorMargins).toBe(false);
    expect(layout.gutterAtTop).toBe(false);
    expect(layout.bookFoldPrinting).toBe(false);
    expect(layout.compat.legacyFlags.size).toBe(0);
    expect(layout.compat.compatSettings.size).toBe(0);

    const hash = layout.settingsHash();
    expect(typeof hash).toBe('number');
  });

  it('reads layout settings from CT_Settings', () => {
    const raw: CT_Settings = {
      defaultTabStop: { val: 1440 }, // 1 inch
      evenAndOddHeaders: {},
      mirrorMargins: { val: true },
      gutterAtTop: { val: false },
      activeWritingStyle: [],
      attachedSchema: [],
      smartTagType: [],
    };

    const layout = parseSettings(raw);

    expect(layout.defaultTabStop).toBe(1440);
    expect(layout.evenAndOddHeaders).toBe(true);
    expect(layout.mirrorMargins).toBe(true);
    expect(layout.gutterAtTop).toBe(false);
  });

  it('reads both legacy w:compat flags and modern w:compatSetting triples', () => {
    const raw: CT_Settings = {
      activeWritingStyle: [],
      attachedSchema: [],
      smartTagType: [],
      compat: {
        useWord97LineBreakRules: {},
        noTabHangInd: { val: false },
        compatSetting: [
          {
            name: 'compatibilityMode',
            uri: 'http://schemas.microsoft.com/office/word',
            val: '15',
          },
          {
            name: 'overrideTableStyleFontSizeAndJustification',
            uri: 'http://schemas.microsoft.com/office/word',
            val: '1',
          },
        ],
      },
    };

    const layout = parseSettings(raw);
    const compat = layout.compat;

    // Legacy flags
    expect(compat.legacyFlags.get('useWord97LineBreakRules')).toBe(true);
    expect(compat.legacyFlags.get('noTabHangInd')).toBe(false);

    // Modern triples
    expect(compat.compatSettings.get('compatibilityMode')?.val).toBe('15');
    expect(compat.compatSettings.get('compatibilityMode')?.uri).toBe(
      'http://schemas.microsoft.com/office/word',
    );

    // Unified lookup
    expect(compat.get('compatibilityMode')).toBe('15');
    expect(compat.get('useWord97LineBreakRules')).toBe(true);
    expect(compat.get('nonExistent')).toBeUndefined();
  });

  it('computes deterministic settingsHash that varies with settings changes', () => {
    const s1 = parseSettings({
      defaultTabStop: { val: 720 },
      evenAndOddHeaders: {},
      activeWritingStyle: [],
      attachedSchema: [],
      smartTagType: [],
    });

    const s2 = parseSettings({
      defaultTabStop: { val: 720 },
      evenAndOddHeaders: {},
      activeWritingStyle: [],
      attachedSchema: [],
      smartTagType: [],
    });

    const s3 = parseSettings({
      defaultTabStop: { val: 720 },
      evenAndOddHeaders: { val: false }, // different!
      activeWritingStyle: [],
      attachedSchema: [],
      smartTagType: [],
    });

    const s4 = parseSettings({
      defaultTabStop: { val: 1080 }, // different!
      evenAndOddHeaders: {},
      activeWritingStyle: [],
      attachedSchema: [],
      smartTagType: [],
    });

    expect(s1.settingsHash()).toBe(s2.settingsHash());
    expect(s1.settingsHash()).not.toBe(s3.settingsHash());
    expect(s1.settingsHash()).not.toBe(s4.settingsHash());
  });

  it('parses settings.xml from raw XML string', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
  <w:evenAndOddHeaders/>
  <w:displayBackgroundShape w:val="true"/>
  <w:compat>
    <w:useWord97LineBreakRules/>
    <w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/>
  </w:compat>
</w:settings>`;

    const layout = parseSettingsXml(xml);

    expect(layout.defaultTabStop).toBe(720);
    expect(layout.evenAndOddHeaders).toBe(true);
    expect(layout.displayBackgroundShape).toBe(true);
    expect(layout.compat.legacyFlags.get('useWord97LineBreakRules')).toBe(true);
    expect(layout.compat.compatSettings.get('compatibilityMode')?.val).toBe('14');
  });
});
