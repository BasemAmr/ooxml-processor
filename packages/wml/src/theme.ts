/**
 * Theme resolution: Color scheme, font scheme, and font/color binding resolvers.
 *
 * Implements Ticket P3-10 (Theme Resolution).
 *
 * Key architectural invariants:
 *   1. Six theme-font bindings:
 *      majorAscii / majorHAnsi   -> major.latin
 *      majorEastAsia             -> major.ea
 *      majorBidi                 -> major.cs
 *      minorAscii / minorHAnsi   -> minor.latin
 *      minorEastAsia             -> minor.ea
 *      minorBidi                 -> minor.cs
 *   2. Empty `@typeface` on major/minor font collection falls through to
 *      script-specific `a:font` tags, then to application defaults. An empty string
 *      is NOT a font family name.
 *   3. Script-specific `a:font` entries (e.g. Jpan, Arab, Hang) are consulted for
 *      complex script and CJK typography rather than ignored.
 *   4. DrawingML / WML scheme color resolution: `resolveSchemeColor(token, scheme, clrMap)`
 *      maps `bg1`/`tx1`/`bg2`/`tx2` to `dk1`/`lt1`/`dk2`/`lt2` through `clrMap`.
 *   5. Themeless documents resolve theme references to application defaults with
 *      diagnostic (`THEME_MISSING`).
 */

import type { dmlMainTypes } from '@ooxml/schema';
import { dmlMainReader, createCursor, createReadContext } from '@ooxml/schema';

export type ThemeDiagnosticCode = 'THEME_MISSING' | 'THEME_FONT_EMPTY' | 'THEME_COLOR_NOT_FOUND';

export interface ThemeDiagnostic {
  readonly code: ThemeDiagnosticCode;
  readonly message: string;
  readonly token?: string | undefined;
}

export interface FontCollection {
  readonly latin: string;
  readonly ea: string;
  readonly cs: string;
  readonly fonts: ReadonlyMap<string, string>;
}

export interface FontScheme {
  readonly name: string;
  readonly major: FontCollection;
  readonly minor: FontCollection;
}

export interface ColorScheme {
  readonly name: string;
  readonly dk1: string;
  readonly lt1: string;
  readonly dk2: string;
  readonly lt2: string;
  readonly accent1: string;
  readonly accent2: string;
  readonly accent3: string;
  readonly accent4: string;
  readonly accent5: string;
  readonly accent6: string;
  readonly hlink: string;
  readonly folHlink: string;
}

export interface ColorMap {
  readonly bg1?: string | undefined;
  readonly tx1?: string | undefined;
  readonly bg2?: string | undefined;
  readonly tx2?: string | undefined;
  readonly accent1?: string | undefined;
  readonly accent2?: string | undefined;
  readonly accent3?: string | undefined;
  readonly accent4?: string | undefined;
  readonly accent5?: string | undefined;
  readonly accent6?: string | undefined;
  readonly hlink?: string | undefined;
  readonly folHlink?: string | undefined;
}

export interface Theme {
  readonly name: string;
  readonly colorScheme: ColorScheme;
  readonly fontScheme: FontScheme;
}

export type ThemeFontSlot =
  | 'majorAscii'
  | 'majorHAnsi'
  | 'majorEastAsia'
  | 'majorBidi'
  | 'minorAscii'
  | 'minorHAnsi'
  | 'minorEastAsia'
  | 'minorBidi';

/**
 * Fallback font scheme used when theme is absent or font properties fall through.
 */
export const FALLBACK_FONT_SCHEME: Readonly<FontScheme> = Object.freeze({
  name: 'Office Fallback',
  major: Object.freeze({
    latin: 'Calibri Light',
    ea: 'SimSun',
    cs: 'Times New Roman',
    fonts: new Map([
      ['Jpan', 'MS Gothic'],
      ['Hang', 'Gulim'],
      ['Arab', 'Arial'],
    ]),
  }),
  minor: Object.freeze({
    latin: 'Calibri',
    ea: 'SimSun',
    cs: 'Times New Roman',
    fonts: new Map([
      ['Jpan', 'MS Mincho'],
      ['Hang', 'Batang'],
      ['Arab', 'Arial'],
    ]),
  }),
});

/**
 * Fallback color scheme used when theme is absent or color tokens are unresolvable.
 */
export const FALLBACK_COLOR_SCHEME: Readonly<ColorScheme> = Object.freeze({
  name: 'Office Fallback',
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '1F497D',
  lt2: 'EEECE1',
  accent1: '4F81BD',
  accent2: 'C0504D',
  accent3: '9BBB59',
  accent4: '8064A2',
  accent5: '4BACC6',
  accent6: 'F79646',
  hlink: '0000FF',
  folHlink: '800080',
});

function extractColor(color?: dmlMainTypes.CT_Color, fallback = '000000'): string {
  if (!color?.colorChoice) return fallback;
  const choice = color.colorChoice;
  switch (choice.kind) {
    case 'srgbClr':
      return choice.value.val ?? fallback;
    case 'sysClr':
      return choice.value.lastClr ?? (choice.value.val === 'window' ? 'FFFFFF' : fallback);
    case 'scrgbClr': {
      const r = Math.min(255, Math.max(0, Math.round((Number(choice.value.r ?? 0) / 1000) * 2.55)));
      const g = Math.min(255, Math.max(0, Math.round((Number(choice.value.g ?? 0) / 1000) * 2.55)));
      const b = Math.min(255, Math.max(0, Math.round((Number(choice.value.b ?? 0) / 1000) * 2.55)));
      return [r, g, b]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    }
    case 'prstClr':
      if (choice.value.val === 'black') return '000000';
      if (choice.value.val === 'white') return 'FFFFFF';
      return choice.value.val ?? fallback;
    default:
      return fallback;
  }
}

function parseFontCollection(ctCollection?: dmlMainTypes.CT_FontCollection): FontCollection {
  const fonts = new Map<string, string>();
  if (ctCollection?.font) {
    for (const f of ctCollection.font) {
      if (f.script && f.typeface) {
        fonts.set(f.script, f.typeface);
      }
    }
  }

  return {
    latin: ctCollection?.latin?.typeface ?? '',
    ea: ctCollection?.ea?.typeface ?? '',
    cs: ctCollection?.cs?.typeface ?? '',
    fonts,
  };
}

/**
 * Parses a `CT_OfficeStyleSheet` into a normalized `Theme`.
 */
export function parseTheme(themeSheet: dmlMainTypes.CT_OfficeStyleSheet): Theme {
  const name = themeSheet.name ?? '';
  const elements = themeSheet.themeElements;

  // 1. Color Scheme
  const clrScheme = elements?.clrScheme;
  const colorScheme: ColorScheme = {
    name: clrScheme?.name ?? 'Office',
    dk1: extractColor(clrScheme?.dk1, FALLBACK_COLOR_SCHEME.dk1),
    lt1: extractColor(clrScheme?.lt1, FALLBACK_COLOR_SCHEME.lt1),
    dk2: extractColor(clrScheme?.dk2, FALLBACK_COLOR_SCHEME.dk2),
    lt2: extractColor(clrScheme?.lt2, FALLBACK_COLOR_SCHEME.lt2),
    accent1: extractColor(clrScheme?.accent1, FALLBACK_COLOR_SCHEME.accent1),
    accent2: extractColor(clrScheme?.accent2, FALLBACK_COLOR_SCHEME.accent2),
    accent3: extractColor(clrScheme?.accent3, FALLBACK_COLOR_SCHEME.accent3),
    accent4: extractColor(clrScheme?.accent4, FALLBACK_COLOR_SCHEME.accent4),
    accent5: extractColor(clrScheme?.accent5, FALLBACK_COLOR_SCHEME.accent5),
    accent6: extractColor(clrScheme?.accent6, FALLBACK_COLOR_SCHEME.accent6),
    hlink: extractColor(clrScheme?.hlink, FALLBACK_COLOR_SCHEME.hlink),
    folHlink: extractColor(clrScheme?.folHlink, FALLBACK_COLOR_SCHEME.folHlink),
  };

  // 2. Font Scheme
  const fontSchemeRaw = elements?.fontScheme;
  const fontScheme: FontScheme = {
    name: fontSchemeRaw?.name ?? 'Office',
    major: parseFontCollection(fontSchemeRaw?.majorFont),
    minor: parseFontCollection(fontSchemeRaw?.minorFont),
  };

  return {
    name,
    colorScheme,
    fontScheme,
  };
}

/**
 * Parses raw XML string of `theme1.xml` into a `Theme`.
 */
export function parseThemeXml(xml: string): Theme {
  const readCtx = createReadContext('transitional', {
    'dml-main': 'http://schemas.openxmlformats.org/drawingml/2006/main',
  });
  const cursor = createCursor(xml);
  while (cursor.current && cursor.current.type !== 'startElement') {
    cursor.next();
  }
  const ctTheme = dmlMainReader.readCT_OfficeStyleSheet(cursor, readCtx);
  return parseTheme(ctTheme);
}

/**
 * Resolves a theme font attribute value (e.g. `majorAscii`, `minorEastAsia`)
 * into a concrete typeface name.
 *
 * Implements the six theme-font bindings, fallback on empty typeface,
 * consultation of script-specific `a:font` tags, and diagnostic on themeless doc.
 */
export function resolveThemeFont(
  slot: ThemeFontSlot | string,
  fontScheme?: FontScheme | undefined,
  script?: string | undefined,
  onDiagnostic?: (diag: ThemeDiagnostic) => void,
): string {
  let activeScheme = fontScheme;
  if (!activeScheme) {
    onDiagnostic?.({
      code: 'THEME_MISSING',
      message: `Theme not found; resolving font slot "${slot}" to application fallback`,
      token: slot,
    });
    activeScheme = FALLBACK_FONT_SCHEME;
  }

  const isMajor = slot.startsWith('major');
  const collection = isMajor ? activeScheme.major : activeScheme.minor;
  const fallbackCollection = isMajor ? FALLBACK_FONT_SCHEME.major : FALLBACK_FONT_SCHEME.minor;

  // 1. Script-specific check: if script tag specified and present in theme fonts, use it
  if (script !== undefined && collection.fonts.has(script)) {
    const scriptFace = collection.fonts.get(script);
    if (scriptFace && scriptFace.trim() !== '') {
      return scriptFace;
    }
  }

  // 2. Standard slot binding
  let candidate = '';
  let slotType: 'latin' | 'ea' | 'cs' = 'latin';

  if (slot.endsWith('EastAsia')) {
    candidate = collection.ea;
    slotType = 'ea';
  } else if (slot.endsWith('Bidi')) {
    candidate = collection.cs;
    slotType = 'cs';
  } else {
    // majorAscii, majorHAnsi, minorAscii, minorHAnsi
    candidate = collection.latin;
    slotType = 'latin';
  }

  // 3. Fall through on empty typeface
  if (candidate.trim() !== '') {
    return candidate;
  }

  // Empty typeface in slot: consult script-specific fonts if script available
  if (script !== undefined && collection.fonts.has(script)) {
    const scriptFace = collection.fonts.get(script);
    if (scriptFace && scriptFace.trim() !== '') {
      return scriptFace;
    }
  }

  // Fall through to fallback font collection
  const fallbackFace = fallbackCollection[slotType];
  return fallbackFace;
}

/**
 * Normalizes color token aliases (e.g. `dark1` -> `dk1`, `light1` -> `lt1`).
 */
function normalizeColorToken(token: string): string {
  switch (token) {
    case 'dark1':
      return 'dk1';
    case 'light1':
      return 'lt1';
    case 'dark2':
      return 'dk2';
    case 'light2':
      return 'lt2';
    case 'hyperlink':
      return 'hlink';
    case 'followedHyperlink':
      return 'folHlink';
    default:
      return token;
  }
}

/**
 * Resolves a scheme color reference token (e.g. `bg1`, `tx1`, `accent1`, `dk1`)
 * to a 6-hex RGB color string, accounting for `clrMap` indirection.
 */
export function resolveSchemeColor(
  token: string,
  scheme?: ColorScheme | undefined,
  clrMap?: ColorMap | undefined,
  onDiagnostic?: (diag: ThemeDiagnostic) => void,
): string {
  let activeScheme = scheme;
  if (!activeScheme) {
    onDiagnostic?.({
      code: 'THEME_MISSING',
      message: `Theme not found; resolving color "${token}" to application fallback`,
      token,
    });
    activeScheme = FALLBACK_COLOR_SCHEME;
  }

  // Indirection mapping: DrawingML references bg1/tx1/bg2/tx2 map to dk/lt via clrMap
  let mappedToken = token;
  if (token === 'bg1') {
    mappedToken = clrMap?.bg1 ?? 'lt1';
  } else if (token === 'tx1' || token === 't1') {
    mappedToken = clrMap?.tx1 ?? 'dk1';
  } else if (token === 'bg2') {
    mappedToken = clrMap?.bg2 ?? 'lt2';
  } else if (token === 'tx2' || token === 't2') {
    mappedToken = clrMap?.tx2 ?? 'dk2';
  } else if (token === 'accent1' && clrMap?.accent1) {
    mappedToken = clrMap.accent1;
  } else if (token === 'accent2' && clrMap?.accent2) {
    mappedToken = clrMap.accent2;
  } else if (token === 'accent3' && clrMap?.accent3) {
    mappedToken = clrMap.accent3;
  } else if (token === 'accent4' && clrMap?.accent4) {
    mappedToken = clrMap.accent4;
  } else if (token === 'accent5' && clrMap?.accent5) {
    mappedToken = clrMap.accent5;
  } else if (token === 'accent6' && clrMap?.accent6) {
    mappedToken = clrMap.accent6;
  } else if ((token === 'hlink' || token === 'hyperlink') && clrMap?.hlink) {
    mappedToken = clrMap.hlink;
  } else if ((token === 'folHlink' || token === 'followedHyperlink') && clrMap?.folHlink) {
    mappedToken = clrMap.folHlink;
  }

  const normalized = normalizeColorToken(mappedToken);

  if (normalized in activeScheme) {
    const val = (activeScheme as unknown as Record<string, string>)[normalized];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }

  // Token not found in active scheme
  onDiagnostic?.({
    code: 'THEME_COLOR_NOT_FOUND',
    message: `Color token "${token}" (mapped to "${normalized}") not found in color scheme; using fallback`,
    token,
  });

  if (normalized in FALLBACK_COLOR_SCHEME) {
    return (FALLBACK_COLOR_SCHEME as unknown as Record<string, string>)[normalized] ?? '000000';
  }
  return '000000';
}
