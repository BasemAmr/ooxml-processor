/**
 * Toggle property resolution and XOR combining (ECMA-376 Part 1 §17.7.3).
 *
 * ## The Toggle Rule
 *
 * Fourteen properties in `EG_RPrBase` have toggle behavior: when specified in both
 * an ancestor (such as a style) and a descendant (such as direct formatting),
 * they do not overwrite — they **XOR**.
 *
 * For example:
 * - Heading style has `<w:b/>` (true)
 * - Direct formatting on a run has `<w:b/>` (true)
 * - Result: **not bold** (true XOR true = false).
 *
 * This matches Word's behavior where selecting bold text and applying bold
 * removes the bold formatting.
 */

import type { CT_OnOff } from '@ooxml/schema';

/**
 * Three-state representation of an OnOff property:
 * - `'absent'`: property is omitted from this level (inherits from ancestor)
 * - `'true'`: element is present and represents true (e.g. `<w:b/>`, `<w:b w:val="1"/>`, `<w:b w:val="true"/>`)
 * - `'false'`: element is present and represents false (e.g. `<w:b w:val="0"/>`, `<w:b w:val="false"/>`)
 */
export type OnOffState = 'absent' | 'true' | 'false';

/**
 * The 14 toggle properties defined in `EG_RPrBase`.
 *
 * SPEC-GAP: The XSD schema types all 20 boolean properties identically as `CT_OnOff`.
 * The 14 toggle properties vs 6 non-toggle properties are defined in prose in
 * ECMA-376 Part 1 §17.7.3.
 */
export const TOGGLE_PROPERTIES: ReadonlySet<string> = new Set([
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'vanish',
  'webHidden',
]);

/**
 * The 6 `CT_OnOff` properties that do NOT toggle and overwrite normally.
 */
export const NON_TOGGLE_ONOFF_PROPERTIES: ReadonlySet<string> = new Set([
  'noProof',
  'snapToGrid',
  'rtl',
  'cs',
  'specVanish',
  'oMath',
]);

/**
 * Check if a property name belongs to the 14 toggle properties.
 */
export function isToggleProperty(name: string): boolean {
  return TOGGLE_PROPERTIES.has(name);
}

/**
 * Parse a `CT_OnOff` element or undefined into an `OnOffState`.
 */
export function toOnOffState(el: CT_OnOff | undefined | boolean): OnOffState {
  if (el === undefined) return 'absent';
  if (typeof el === 'boolean') return el ? 'true' : 'false';

  // In OOXML, an empty element like `<w:b/>` has val undefined, which means true!
  if (el.val === undefined) return 'true';

  const v: unknown = el.val;
  if (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') {
    return 'true';
  }
  return 'false';
}

/**
 * Combine two toggle property states across an inheritance boundary using XOR.
 *
 * @param inherited The state from the ancestor level (e.g., style)
 * @param direct The state from the descendant level (e.g., direct formatting)
 */
export function toggleCombine(
  inherited: OnOffState | undefined,
  direct: OnOffState | undefined,
): OnOffState {
  const inh = inherited ?? 'absent';
  const dir = direct ?? 'absent';

  if (dir === 'absent') return inh;
  if (inh === 'absent') return dir;

  // Both present across an inheritance boundary: XOR
  const inhBool = inh === 'true';
  const dirBool = dir === 'true';
  const result = inhBool !== dirBool;

  return result ? 'true' : 'false';
}
