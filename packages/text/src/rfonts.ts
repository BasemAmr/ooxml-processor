/**
 * Font family resolution for characters given rFonts and theme fontScheme (P4-01).
 *
 * Implements Ticket P4-01.
 *
 * Key architectural invariants:
 *   1. Font family is determined PER-CHARACTER, NOT per-run.
 *      A single run mixing Latin ("Hello") and CJK ("世界") or Arabic ("مرحبا")
 *      resolves to different font families for each character based on its font slot.
 *   2. The four slots in `w:rFonts`:
 *      - `ascii`: Basic Latin (U+0000..U+007F)
 *      - `hAnsi`: High ANSI (Latin-1, Latin Ext, Greek, Cyrillic)
 *      - `eastAsia`: CJK, Kana, Hangul, Bopomofo
 *      - `cs`: Complex Script (Arabic, Hebrew, Indic, Thai, etc.)
 *   3. Theme font bindings:
 *      - `asciiTheme` -> resolves through theme fontScheme
 *      - `hAnsiTheme` -> resolves through theme fontScheme
 *      - `eastAsiaTheme` -> resolves through theme fontScheme
 *      - `cstheme` -> resolves through theme fontScheme (CRITICAL TRAP: lowercase 't' in OOXML schema!)
 *   4. Ambiguous characters (general punctuation, quotes, dashes) consult `w:hint`.
 *   5. Run-level `w:cs` or `w:rtl` forces the `cs` slot unconditionally for all characters in the run.
 */

import type { CT_Fonts, ST_Hint, ST_Theme } from '@ooxml/schema';
import type { FontScheme } from '@ooxml/wml';
import { resolveThemeFont } from '@ooxml/wml';
import { getFontSlotForCodepoint, type FontSlot, type ScriptSlotOptions } from './script.js';

export interface ResolvedRFonts {
  readonly hint?: ST_Hint | undefined;
  readonly ascii?: string | undefined;
  readonly hAnsi?: string | undefined;
  readonly eastAsia?: string | undefined;
  readonly cs?: string | undefined;
  readonly asciiTheme?: ST_Theme | string | undefined;
  readonly hAnsiTheme?: ST_Theme | string | undefined;
  readonly eastAsiaTheme?: ST_Theme | string | undefined;
  /**
   * Note: OOXML schema Transitional wml.xsd defines this attribute as `cstheme` (lowercase 't').
   */
  readonly cstheme?: ST_Theme | string | undefined;
  /**
   * Defensive alias for camelCase callers. Canonical is `cstheme`.
   */
  readonly csTheme?: ST_Theme | string | undefined;
}

/**
 * Built-in typography defaults for font slots per ECMA-376 Part 1 §17.7.5.1
 * and Word built-in default styling.
 */
export const DEFAULT_SLOT_FONTS: Readonly<Record<FontSlot, string>> = Object.freeze({
  ascii: 'Calibri',
  hAnsi: 'Calibri',
  eastAsia: 'SimSun',
  cs: 'Times New Roman',
});

/**
 * Resolves the font family for a given character or codepoint according to OOXML rules.
 *
 * @param charOrCp The character (string) or codepoint (number) to resolve.
 * @param rFonts Resolved rFonts properties (or CT_Fonts AST node).
 * @param themeFontScheme Theme fontScheme (from @ooxml/wml theme.ts) for resolving *Theme bindings.
 * @param lang Optional ISO/BCP-47 language tag (e.g. "ja-JP", "ar-SA") for script-specific theme fonts.
 * @param options Run-level options such as cs or rtl flags forcing the cs slot.
 * @returns The resolved font family string (e.g. "Calibri", "SimSun", "Times New Roman").
 */
export function fontForChar(
  charOrCp: string | number,
  rFonts?: ResolvedRFonts | CT_Fonts | undefined,
  themeFontScheme?: FontScheme | undefined,
  lang?: string | undefined,
  options?: ScriptSlotOptions | undefined,
): string {
  const cp = typeof charOrCp === 'number' ? charOrCp : (charOrCp.codePointAt(0) ?? 0);

  // 1. Determine the target font slot (ascii | hAnsi | eastAsia | cs)
  const slot = getFontSlotForCodepoint(cp, rFonts?.hint, options);

  // 2. Resolve slot according to OOXML priority:
  //    Direct font name -> Theme binding -> Fallback slot / document default
  switch (slot) {
    case 'ascii': {
      if (rFonts?.ascii && rFonts.ascii.trim() !== '') {
        return rFonts.ascii;
      }
      if (rFonts?.asciiTheme) {
        const themeFace = resolveThemeFont(rFonts.asciiTheme, themeFontScheme, lang);
        if (themeFace && themeFace.trim() !== '') return themeFace;
      }
      // Latin fallback: if ascii is omitted, hAnsi takes precedence before built-in default
      if (rFonts?.hAnsi && rFonts.hAnsi.trim() !== '') {
        return rFonts.hAnsi;
      }
      return DEFAULT_SLOT_FONTS.ascii;
    }

    case 'hAnsi': {
      if (rFonts?.hAnsi && rFonts.hAnsi.trim() !== '') {
        return rFonts.hAnsi;
      }
      if (rFonts?.hAnsiTheme) {
        const themeFace = resolveThemeFont(rFonts.hAnsiTheme, themeFontScheme, lang);
        if (themeFace && themeFace.trim() !== '') return themeFace;
      }
      // Latin fallback: if hAnsi is omitted, ascii takes precedence before built-in default
      if (rFonts?.ascii && rFonts.ascii.trim() !== '') {
        return rFonts.ascii;
      }
      return DEFAULT_SLOT_FONTS.hAnsi;
    }

    case 'eastAsia': {
      if (rFonts?.eastAsia && rFonts.eastAsia.trim() !== '') {
        return rFonts.eastAsia;
      }
      if (rFonts?.eastAsiaTheme) {
        const themeFace = resolveThemeFont(rFonts.eastAsiaTheme, themeFontScheme, lang);
        if (themeFace && themeFace.trim() !== '') return themeFace;
      }
      return DEFAULT_SLOT_FONTS.eastAsia;
    }

    case 'cs': {
      if (rFonts?.cs && rFonts.cs.trim() !== '') {
        return rFonts.cs;
      }
      // CRITICAL: OOXML attribute is `cstheme` (lowercase 't') in CT_Fonts
      const csThemeVal =
        rFonts?.cstheme ?? (rFonts && 'csTheme' in rFonts ? (rFonts as any).csTheme : undefined);
      if (csThemeVal) {
        const themeFace = resolveThemeFont(csThemeVal, themeFontScheme, lang);
        if (themeFace && themeFace.trim() !== '') return themeFace;
      }
      return DEFAULT_SLOT_FONTS.cs;
    }
  }
}
