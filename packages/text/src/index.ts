/**
 * @ooxml/text — Font resolution, shaping, segmentation, bidi, measurement cache.
 */

// P4-02: Script classification & font slot selection
export type { FontSlot, ScriptSlot, ScriptRange, ScriptSlotOptions } from './script.js';
export { UNICODE_SCRIPT_RANGES, getFontSlotForCodepoint, getFontSlotForChar } from './script.js';

// P4-01: rFonts resolution & theme font binding
export type { ResolvedRFonts } from './rfonts.js';
export { DEFAULT_SLOT_FONTS, fontForChar } from './rfonts.js';

// P4-03: Font Table, PANOSE distance, and Substitution Ladder
export type {
  FontTable,
  SubstitutionStep,
  AvailableFontInfo,
  SubstitutionResult,
  ParsedFontSig,
} from './fonts.js';
export {
  METRIC_COMPATIBLE_FONTS,
  PANOSE_WEIGHTS,
  parseFontSig,
  checkFontCoverage,
  parsePanose,
  panoseDistance,
  getGenericFamily,
  createFontTable,
  parseFontTableXml,
  substituteFont,
} from './fonts.js';

// P4-04: Embedded font de-obfuscation (ODTTF)
export {
  SFNT_TAG_TRUETYPE,
  SFNT_TAG_OTTO,
  SFNT_TAG_TRUE,
  SFNT_TAG_TYP1,
  VALID_SFNT_TAGS,
  isValidSfntTag,
  parseFontKeyGuid,
  readSfntVersion,
  deobfuscateFont,
  obfuscateFont,
} from './odttf.js';
