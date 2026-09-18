/**
 * Font Table, PANOSE Matching, and Font Substitution Ladder (P4-03).
 *
 * Implements Ticket P4-03.
 *
 * Architectural Invariants:
 *   1. On the web and non-Windows environments, the requested font family is
 *      frequently absent. Font substitution is the normal path, not an edge case.
 *   2. The Substitution Ladder order:
 *      1. Embedded font if present (P4-04) — always preferred as author-shipped.
 *      2. Locally available font matching `@name` exactly.
 *      2b. Known metric-compatible substitute (Liberation / Croscore / Carlito / Caladea)
 *          preserving advance widths and preventing line reflow.
 *      3. `w:altName` if specified on `CT_Font` and available.
 *      4. PANOSE distance among available fonts (weighted: family type & serif style dominate;
 *         weight & proportion next; candidates lacking script coverage via `w:sig` rejected).
 *      5. Generic CSS family from `CT_Font/family` + `pitch`.
 *   3. Every substitution outcome records the exact step taken and reasoning.
 */

import type {
  CT_Font,
  CT_FontsList,
  CT_FontSig,
  CT_Panose,
  ST_FontFamily,
  ST_Pitch,
} from '@ooxml/schema';
import { createCursor, createReadContext, wmlReader } from '@ooxml/schema';

/**
 * Metric-compatible mappings between proprietary core fonts and open-source equivalents.
 *
 * Provenance:
 *   - Liberation fonts (Red Hat / Ascender) are metrically compatible with Monotype/Microsoft
 *     core web fonts (Arial, Times New Roman, Courier New).
 *   - Croscore fonts (Google / Ascender: Arimo, Tinos, Cousine) are metric clones of
 *     Arial, Times New Roman, and Courier New.
 *   - Carlito and Caladea (Google / ChromeOS) are metrically compatible with Microsoft
 *     ClearType fonts Calibri and Cambria.
 *   - Gelasio is metrically compatible with Georgia.
 *   - OpenSymbol is metrically compatible with Symbol.
 */
export const METRIC_COMPATIBLE_FONTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  arial: Object.freeze(['Liberation Sans', 'Arimo']),
  'times new roman': Object.freeze(['Liberation Serif', 'Tinos']),
  'courier new': Object.freeze(['Liberation Mono', 'Cousine']),
  calibri: Object.freeze(['Carlito']),
  cambria: Object.freeze(['Caladea']),
  georgia: Object.freeze(['Gelasio']),
  symbol: Object.freeze(['OpenSymbol']),
  'comic sans ms': Object.freeze(['Comic Relief']),
});

/**
 * Standard PANOSE 1.0 digit weights for distance calculation.
 *
 * Family Kind (0) and Serif Style (1) dominate.
 * Weight (2) and Proportion (3) are next.
 * Decorative digits (4..9) have lower influence.
 */
export const PANOSE_WEIGHTS: readonly number[] = Object.freeze([
  50, // 0: Family Kind (Latin Text, Hand Written, Decorative, Symbol)
  20, // 1: Serif Style (Cove, Slab, Sans, etc.)
  10, // 2: Weight (Light, Book, Medium, Bold, etc.)
  10, // 3: Proportion (Modern, Even Width, Monospaced, etc.)
  3, // 4: Contrast
  2, // 5: Stroke Variation
  1, // 6: Arm Style
  1, // 7: Letterform
  1, // 8: Midline
  1, // 9: X-Height
]);

export interface ParsedFontSig {
  readonly usb: bigint;
  readonly csb: bigint;
}

/**
 * Parses OOXML `w:sig` (`CT_FontSig`) hex attributes into 128-bit Unicode Subrange Bitfield (USB)
 * and 64-bit Code Page Bitfield (CSB).
 */
export function parseFontSig(sig?: CT_FontSig | undefined): ParsedFontSig | undefined {
  if (!sig) return undefined;

  const parseHex = (hex?: string): bigint => {
    if (!hex) return 0n;
    try {
      return BigInt(`0x${hex}`);
    } catch {
      return 0n;
    }
  };

  const usb0 = parseHex(sig.usb0);
  const usb1 = parseHex(sig.usb1);
  const usb2 = parseHex(sig.usb2);
  const usb3 = parseHex(sig.usb3);
  const csb0 = parseHex(sig.csb0);
  const csb1 = parseHex(sig.csb1);

  const usb = (usb3 << 96n) | (usb2 << 64n) | (usb1 << 32n) | usb0;
  const csb = (csb1 << 32n) | csb0;

  return { usb, csb };
}

/**
 * Checks if a candidate font signature covers the critical scripts present in the required signature.
 * Focuses on major non-Latin script coverage bits (CJK, Arabic, Hebrew, Indic, Cyrillic, Greek).
 */
export function checkFontCoverage(
  candidateSig: ParsedFontSig,
  requiredSig: ParsedFontSig,
): boolean {
  // Critical script bits in Unicode Subrange Bitfield (USB):
  // Bit 7: Greek
  // Bit 9: Cyrillic
  // Bit 11: Hebrew
  // Bit 13: Arabic
  // Bit 15: Devanagari
  // Bit 24: Thai
  // Bit 49..50: Hiragana / Katakana
  // Bit 56: Hangul
  // Bit 59: CJK Unified Ideographs
  const criticalUsbMask =
    (1n << 7n) |
    (1n << 9n) |
    (1n << 11n) |
    (1n << 13n) |
    (1n << 15n) |
    (1n << 24n) |
    (1n << 49n) |
    (1n << 50n) |
    (1n << 56n) |
    (1n << 59n);

  const requiredCriticalUsb = requiredSig.usb & criticalUsbMask;
  if ((candidateSig.usb & requiredCriticalUsb) !== requiredCriticalUsb) {
    return false;
  }

  // Critical Code Page bits (CSB):
  // Bit 18: Simplified Chinese (PRC)
  // Bit 19: Korean (Wansung)
  // Bit 20: Traditional Chinese (Big5)
  // Bit 21: Korean (Johab)
  const criticalCsbMask = (1n << 18n) | (1n << 19n) | (1n << 20n) | (1n << 21n);
  const requiredCriticalCsb = requiredSig.csb & criticalCsbMask;
  if ((candidateSig.csb & requiredCriticalCsb) !== requiredCriticalCsb) {
    return false;
  }

  return true;
}

/**
 * Parses PANOSE digits from hex string, array of numbers, or CT_Panose object.
 * Returns a 10-element array of numbers or undefined if invalid.
 */
export function parsePanose(
  panose: string | readonly number[] | CT_Panose | undefined,
): readonly number[] | undefined {
  if (!panose) return undefined;

  if (typeof panose === 'object' && 'val' in panose && panose.val !== undefined) {
    return parsePanose(panose.val);
  }

  if (Array.isArray(panose)) {
    if (panose.length === 10) {
      return [...panose];
    }
    return undefined;
  }

  if (typeof panose === 'string') {
    const clean = panose.trim().replace(/^0x/i, '');
    // 20 hex characters representing 10 bytes
    if (clean.length === 20 && /^[0-9a-fA-F]{20}$/.test(clean)) {
      const result: number[] = [];
      for (let i = 0; i < 20; i += 2) {
        result.push(parseInt(clean.slice(i, i + 2), 16));
      }
      return result;
    }
    // Space-separated decimal digits
    const parts = clean.split(/\s+/).map((s) => parseInt(s, 10));
    if (parts.length === 10 && parts.every((n) => !Number.isNaN(n))) {
      return parts;
    }
  }

  return undefined;
}

/**
 * Computes weighted PANOSE distance between two 10-digit PANOSE vectors.
 *
 * Rules:
 *   - A value of 0 ("any") or 1 ("no fit") on either side is treated as match (0 distance).
 *   - If Family Kind (digit 0) mismatches (and neither is 0), applies a severe mismatch penalty.
 *   - Otherwise: sum(weight[i] * (p1[i] - p2[i])^2).
 */
export function panoseDistance(p1: readonly number[], p2: readonly number[]): number {
  if (p1.length !== 10 || p2.length !== 10) {
    return Number.POSITIVE_INFINITY;
  }

  // Family kind mismatch (Latin text vs Decorative vs Symbol)
  const family1 = p1[0] ?? 0;
  const family2 = p2[0] ?? 0;
  if (family1 !== 0 && family2 !== 0 && family1 !== 1 && family2 !== 1 && family1 !== family2) {
    // Severe penalty so cross-family is heavily disfavored
    return 100_000;
  }

  let total = 0;
  for (let i = 0; i < 10; i++) {
    const v1 = p1[i] ?? 0;
    const v2 = p2[i] ?? 0;
    const w = PANOSE_WEIGHTS[i] ?? 1;

    // 0 = Any, 1 = No Fit
    if (v1 === 0 || v2 === 0 || v1 === 1 || v2 === 1) {
      continue;
    }

    const diff = v1 - v2;
    total += w * diff * diff;
  }

  return total;
}

/**
 * Resolves generic fallback family string from CT_Font family and pitch attributes.
 */
export function getGenericFamily(
  family?: ST_FontFamily | string | undefined,
  pitch?: ST_Pitch | string | undefined,
): string {
  if (pitch === 'fixed' || family === 'modern') {
    return 'monospace';
  }
  switch (family) {
    case 'roman':
      return 'serif';
    case 'swiss':
      return 'sans-serif';
    case 'script':
      return 'cursive';
    case 'decorative':
      return 'fantasy';
    default:
      return 'sans-serif';
  }
}

/**
 * Normalized FontTable holding parsed CT_Font entries from `fontTable.xml`.
 */
export interface FontTable {
  readonly fonts: ReadonlyMap<string, CT_Font>;
  getFont(name: string): CT_Font | undefined;
}

/**
 * Creates a FontTable from an array of CT_Font entries.
 */
export function createFontTable(fonts: readonly CT_Font[]): FontTable {
  const map = new Map<string, CT_Font>();
  for (const font of fonts) {
    if (font.name) {
      map.set(font.name.toLowerCase(), font);
    }
  }
  return {
    fonts: map,
    getFont(name: string): CT_Font | undefined {
      return map.get(name.toLowerCase());
    },
  };
}

/**
 * Parses a `fontTable.xml` string into a FontTable instance.
 */
export function parseFontTableXml(xml: string): FontTable {
  const readCtx = createReadContext('transitional', {
    wml: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  });
  const cursor = createCursor(xml);
  while (cursor.current && cursor.current.type !== 'startElement') {
    cursor.next();
  }
  const fontsList: CT_FontsList = wmlReader.readCT_FontsList(cursor, readCtx);
  return createFontTable(fontsList.font);
}

export type SubstitutionStep =
  'embedded' | 'exact' | 'metric-compatible' | 'altName' | 'panose' | 'generic';

export interface AvailableFontInfo {
  readonly name: string;
  readonly panose?: string | readonly number[] | CT_Panose | undefined;
  readonly sig?: CT_FontSig | ParsedFontSig | undefined;
  readonly isEmbedded?: boolean | undefined;
}

export interface SubstitutionResult {
  readonly resolvedFont: string;
  readonly step: SubstitutionStep;
  readonly originalFont: string;
  readonly reason: string;
}

/**
 * Executes the OOXML font substitution ladder for a requested font name.
 *
 * Substitution order:
 *   1. Embedded font if present in fontTable or available list.
 *   2. Locally available font matching name exactly.
 *   2b. Metric-compatible substitute from available fonts.
 *   3. w:altName from CT_Font if available.
 *   4. Nearest PANOSE font among available candidates (rejecting candidates lacking script coverage via w:sig).
 *   5. Generic CSS family from CT_Font/family + pitch.
 */
export function substituteFont(
  requestedFontName: string,
  fontTable?: FontTable | undefined,
  availableFonts?: readonly (string | AvailableFontInfo)[] | undefined,
): SubstitutionResult {
  const reqNameClean = requestedFontName.trim();
  const reqKey = reqNameClean.toLowerCase();
  const fontEntry = fontTable?.getFont(reqKey);

  // Normalize available fonts to AvailableFontInfo
  const availableList: AvailableFontInfo[] = (availableFonts ?? []).map((f) => {
    if (typeof f === 'string') {
      return { name: f };
    }
    return f;
  });

  const availableMap = new Map<string, AvailableFontInfo>();
  for (const f of availableList) {
    availableMap.set(f.name.toLowerCase(), f);
  }

  // 1. Embedded font if present in fontTable or available list
  const hasEmbeddedTable =
    fontEntry &&
    (fontEntry.embedRegular ||
      fontEntry.embedBold ||
      fontEntry.embedItalic ||
      fontEntry.embedBoldItalic);

  const matchedAvailable = availableMap.get(reqKey);
  if (hasEmbeddedTable || matchedAvailable?.isEmbedded) {
    return {
      resolvedFont: reqNameClean,
      step: 'embedded',
      originalFont: reqNameClean,
      reason: `Using embedded font for "${reqNameClean}" shipped in document package.`,
    };
  }

  // 2. Locally available font matching requested name
  if (matchedAvailable) {
    return {
      resolvedFont: matchedAvailable.name,
      step: 'exact',
      originalFont: reqNameClean,
      reason: `Exact match found in available system fonts for "${reqNameClean}".`,
    };
  }

  // 2b. Metric-compatible substitute
  const metricCandidates = METRIC_COMPATIBLE_FONTS[reqKey];
  if (metricCandidates) {
    for (const cand of metricCandidates) {
      const found = availableMap.get(cand.toLowerCase());
      if (found) {
        return {
          resolvedFont: found.name,
          step: 'metric-compatible',
          originalFont: reqNameClean,
          reason: `Using metric-compatible substitute "${found.name}" for "${reqNameClean}" to preserve exact layout advances.`,
        };
      }
    }
  }

  // 3. w:altName
  if (fontEntry?.altName?.val) {
    const alt = fontEntry.altName.val.trim();
    const foundAlt = availableMap.get(alt.toLowerCase());
    if (foundAlt) {
      return {
        resolvedFont: foundAlt.name,
        step: 'altName',
        originalFont: reqNameClean,
        reason: `Using alternate font name "${foundAlt.name}" (w:altName) for "${reqNameClean}".`,
      };
    }
  }

  // 4. PANOSE distance among available fonts
  const reqPanose = parsePanose(fontEntry?.panose1);
  const reqSig = parseFontSig(fontEntry?.sig);

  if (reqPanose && availableList.length > 0) {
    let bestCandidate: AvailableFontInfo | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const cand of availableList) {
      // Script coverage rejection via w:sig
      if (reqSig && cand.sig) {
        const candSig = 'usb' in cand.sig ? cand.sig : parseFontSig(cand.sig);
        if (candSig && !checkFontCoverage(candSig, reqSig)) {
          // Reject substitute lacking required script coverage
          continue;
        }
      }

      const candPanose = parsePanose(cand.panose);
      if (!candPanose) continue;

      const dist = panoseDistance(reqPanose, candPanose);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestCandidate = cand;
      }
    }

    if (bestCandidate && bestDistance < 100_000) {
      return {
        resolvedFont: bestCandidate.name,
        step: 'panose',
        originalFont: reqNameClean,
        reason: `Selected PANOSE-nearest substitute "${bestCandidate.name}" (distance: ${bestDistance}) for "${reqNameClean}".`,
      };
    }
  }

  // 5. Generic family from CT_Font/family + pitch
  const generic = getGenericFamily(fontEntry?.family?.val, fontEntry?.pitch?.val);
  return {
    resolvedFont: generic,
    step: 'generic',
    originalFont: reqNameClean,
    reason: `Fell back to generic CSS family "${generic}" derived from font family/pitch metadata.`,
  };
}
