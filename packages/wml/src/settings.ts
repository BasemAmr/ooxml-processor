/**
 * settings.xml and layout-relevant compatibility flags.
 *
 * Implements Ticket P3-13 (settings.xml and compatibility flags).
 *
 * Key architectural invariants:
 *   1. A small, explicit, typed struct of settings that affect layout:
 *      defaultTabStop (default 720 twips), evenAndOddHeaders, displayBackgroundShape,
 *      mirrorMargins, gutterAtTop, bookFoldPrinting, compat flags.
 *   2. Dual compat representation: both legacy `w:compat` boolean elements and
 *      modern `w:compatSetting` name/uri/val triples are read, preserved, and enumerable.
 *   3. `settingsHash()`: deterministic 32-bit integer hash for inclusion in
 *      cache `contextHash` (P3-11).
 *   4. Raw `CT_Settings` and `CT_Compat` preserved for round-trip serialization.
 */

import type { CT_Settings, CT_Compat, CT_OnOff } from '@ooxml/schema';
import { runtime, wmlReader, createCursor, createReadContext } from '@ooxml/schema';

const { parseOnOff } = runtime;

export interface CompatSettingTriple {
  readonly name: string;
  readonly uri?: string | undefined;
  readonly val: string;
}

export interface CompatSettings {
  /**
   * Legacy w:compat boolean flags (e.g. useWord97LineBreakRules -> true).
   */
  readonly legacyFlags: ReadonlyMap<string, boolean>;

  /**
   * Modern w:compatSetting triples (e.g. compatibilityMode -> { name, uri, val: '15' }).
   */
  readonly compatSettings: ReadonlyMap<string, CompatSettingTriple>;

  /**
   * Preserved raw CT_Compat object for serialization round-tripping.
   */
  readonly raw?: CT_Compat | undefined;

  /**
   * Retrieves a compat setting by name. Checks modern triples first, then legacy boolean flags.
   */
  get(name: string): boolean | string | undefined;
}

export interface LayoutSettings {
  readonly defaultTabStop: number;
  readonly evenAndOddHeaders: boolean;
  readonly displayBackgroundShape: boolean;
  readonly mirrorMargins: boolean;
  readonly gutterAtTop: boolean;
  readonly bookFoldPrinting: boolean;
  readonly compat: CompatSettings;
  readonly raw?: CT_Settings | undefined;

  /**
   * Computes a deterministic 32-bit integer hash of layout-affecting settings
   * and compat flags for inclusion in cache contextHash (P3-11).
   */
  settingsHash(): number;
}

function coerceOnOff(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return parseOnOff(val);
  return false;
}

function parseOnOffElement(elem?: CT_OnOff): boolean | undefined {
  if (!elem) return undefined;
  if (elem.val === undefined) return true;
  return coerceOnOff(elem.val);
}

function computeSettingsHash(data: {
  defaultTabStop: number;
  evenAndOddHeaders: boolean;
  displayBackgroundShape: boolean;
  mirrorMargins: boolean;
  gutterAtTop: boolean;
  bookFoldPrinting: boolean;
  compat: CompatSettings;
}): number {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  const prime = 0x01000193; // FNV-1a prime

  function hashString(str: string): void {
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, prime);
    }
  }

  function hashNum(n: number): void {
    hashString(String(n));
  }

  function hashBool(b: boolean): void {
    hashString(b ? '1' : '0');
  }

  hashNum(data.defaultTabStop);
  hashBool(data.evenAndOddHeaders);
  hashBool(data.displayBackgroundShape);
  hashBool(data.mirrorMargins);
  hashBool(data.gutterAtTop);
  hashBool(data.bookFoldPrinting);

  // Sort legacy flags for determinism
  const legacyKeys = Array.from(data.compat.legacyFlags.keys()).sort();
  for (const k of legacyKeys) {
    hashString(k);
    hashBool(data.compat.legacyFlags.get(k) ?? false);
  }

  // Sort modern compat setting triples for determinism
  const compatKeys = Array.from(data.compat.compatSettings.keys()).sort();
  for (const k of compatKeys) {
    const triple = data.compat.compatSettings.get(k);
    if (triple) {
      hashString(triple.name);
      hashString(triple.uri ?? '');
      hashString(triple.val);
    }
  }

  return hash >>> 0;
}

function parseCompat(ctCompat?: CT_Compat): CompatSettings {
  const legacyFlags = new Map<string, boolean>();
  const compatSettings = new Map<string, CompatSettingTriple>();

  if (!ctCompat) {
    return {
      legacyFlags,
      compatSettings,
      get(_name: string) {
        return undefined;
      },
    };
  }

  // 1. Read modern w:compatSetting triples
  if (ctCompat.compatSetting) {
    for (const cs of ctCompat.compatSetting) {
      const name = cs.name;
      const val = cs.val;
      if (name !== undefined && val !== undefined) {
        const triple: CompatSettingTriple = {
          name,
          val,
        };
        if (cs.uri !== undefined) {
          (triple as { uri?: string }).uri = cs.uri;
        }
        compatSettings.set(name, triple);
      }
    }
  }

  // 2. Read legacy w:compat elements
  for (const [key, value] of Object.entries(ctCompat)) {
    if (key === 'compatSetting' || key === '$unknown' || key === '$unknownAttrs') {
      continue;
    }
    if (value && typeof value === 'object') {
      const boolVal = parseOnOffElement(value as CT_OnOff);
      if (boolVal !== undefined) {
        legacyFlags.set(key, boolVal);
      }
    }
  }

  return {
    legacyFlags,
    compatSettings,
    raw: ctCompat,
    get(name: string): boolean | string | undefined {
      if (compatSettings.has(name)) {
        return compatSettings.get(name)?.val;
      }
      return legacyFlags.get(name);
    },
  };
}

/**
 * Parses a `CT_Settings` object into normalized `LayoutSettings`.
 */
export function parseSettings(ctSettings?: CT_Settings): LayoutSettings {
  let defaultTabStop = 720; // Schema default: 720 twips (0.5 inch)
  if (ctSettings?.defaultTabStop?.val !== undefined) {
    const v = ctSettings.defaultTabStop.val;
    defaultTabStop = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (isNaN(defaultTabStop)) {
      defaultTabStop = 720;
    }
  }

  const evenAndOddHeaders = parseOnOffElement(ctSettings?.evenAndOddHeaders) ?? false;
  const displayBackgroundShape = parseOnOffElement(ctSettings?.displayBackgroundShape) ?? false;
  const mirrorMargins = parseOnOffElement(ctSettings?.mirrorMargins) ?? false;
  const gutterAtTop = parseOnOffElement(ctSettings?.gutterAtTop) ?? false;
  const bookFoldPrinting = parseOnOffElement(ctSettings?.bookFoldPrinting) ?? false;
  const compat = parseCompat(ctSettings?.compat);

  const settings: LayoutSettings = {
    defaultTabStop,
    evenAndOddHeaders,
    displayBackgroundShape,
    mirrorMargins,
    gutterAtTop,
    bookFoldPrinting,
    compat,
    raw: ctSettings,
    settingsHash(): number {
      return computeSettingsHash({
        defaultTabStop,
        evenAndOddHeaders,
        displayBackgroundShape,
        mirrorMargins,
        gutterAtTop,
        bookFoldPrinting,
        compat,
      });
    },
  };

  return settings;
}

/**
 * Parses raw XML string of `settings.xml` into `LayoutSettings`.
 */
export function parseSettingsXml(xml: string): LayoutSettings {
  const readCtx = createReadContext('transitional', {
    wml: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  });
  const cursor = createCursor(xml);
  while (cursor.current && cursor.current.type !== 'startElement') {
    cursor.next();
  }
  const ctSettings = wmlReader.readCT_Settings(cursor, readCtx);
  return parseSettings(ctSettings);
}
