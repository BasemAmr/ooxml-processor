/**
 * Document defaults (w:docDefaults) parsing and application fallback table.
 *
 * Implements Ticket P3-05 (w:docDefaults).
 *
 * Key architectural invariants:
 *   1. `CT_DocDefaults` has two wrapper levels:
 *      `docDefaults/rPrDefault/rPr` and `docDefaults/pPrDefault/pPr`.
 *      Direct `docDefaults/rPr` does not exist in OOXML.
 *   2. Absent `docDefaults` is NOT "no defaults". The application's built-in
 *      defaults apply, documented with SPEC-GAP provenance in `BUILTIN_DOC_DEFAULTS`.
 *   3. Do not scatter arbitrary `?? 20` fallbacks across the cascade; all fallback
 *      typography stems from this single exported table.
 *   4. `CT_RPr` stores properties in its `rPrBase` choice array (`EG_RPrBase`),
 *      while `CT_PPrGeneral` flattens paragraph property slots directly.
 */

import type { CT_DocDefaults, CT_RPr, CT_RPr_RPrBase, CT_PPrGeneral } from '@ooxml/schema';
import { wmlReader, createCursor, createReadContext } from '@ooxml/schema';

export interface DocDefaults {
  readonly rPr?: CT_RPr | undefined;
  readonly pPr?: CT_PPrGeneral | undefined;
}

export type RPrBaseMap = {
  [E in CT_RPr_RPrBase as E['kind']]: E['value'];
};

/**
 * Extracts a specific property value from a `CT_RPr`'s `rPrBase` choice list.
 * If multiple instances are present, the last in document order wins.
 */
export function getRPrBaseProperty<K extends keyof RPrBaseMap>(
  rPr: CT_RPr | undefined,
  kind: K,
): RPrBaseMap[K] | undefined {
  if (!rPr) return undefined;
  for (let i = rPr.rPrBase.length - 1; i >= 0; i--) {
    const item = rPr.rPrBase[i];
    if (item && item.kind === kind) {
      return item.value as unknown as RPrBaseMap[K];
    }
  }
  return undefined;
}

/**
 * Built-in application default properties applied when `w:docDefaults` is absent
 * or when individual default wrappers (`rPrDefault`/`pPrDefault`) are missing.
 *
 * SPEC-GAP / UNVERIFIABLE-HERE:
 * ECMA-376 Part 1 §17.7.5.1 does not specify the normative fallback values when
 * `w:docDefaults` is completely absent or empty in `styles.xml`.
 * In Microsoft Word (Word 2007 through Word 2021/365), a document without `docDefaults`
 * falls back to standard application typography defaults:
 *   - Font Size: 11pt (22 half-points, w:sz val="22" and w:szCs val="22")
 *   - Font Family:
 *       ascii / hAnsi: "Calibri"
 *       cs: "Times New Roman"
 *       eastAsia: "SimSun"
 *   - Font Color: "000000" (default text)
 *   - Language: "en-US"
 *   - Line Spacing: 240 twips (single spacing, lineRule "auto")
 *   - Space After: 160 twips (8pt, standard Word default spacing)
 *
 * This table records those defaults as a single authoritative constant with provenance.
 */
export const BUILTIN_DOC_DEFAULTS: Readonly<DocDefaults> = Object.freeze({
  rPr: Object.freeze({
    rPrBase: Object.freeze([
      Object.freeze({
        kind: 'rFonts',
        value: Object.freeze({
          ascii: 'Calibri',
          hAnsi: 'Calibri',
          cs: 'Times New Roman',
          eastAsia: 'SimSun',
        }),
      }),
      Object.freeze({
        kind: 'sz',
        value: Object.freeze({ val: 22 }),
      }),
      Object.freeze({
        kind: 'szCs',
        value: Object.freeze({ val: 22 }),
      }),
      Object.freeze({
        kind: 'color',
        value: Object.freeze({ val: '000000' }),
      }),
      Object.freeze({
        kind: 'lang',
        value: Object.freeze({ val: 'en-US' }),
      }),
    ]),
  }),
  pPr: Object.freeze({
    spacing: Object.freeze({
      after: 160,
      line: 240,
      lineRule: 'auto',
    }),
  }),
});

/**
 * Parse `CT_DocDefaults` by traversing the two wrapper elements:
 *   `docDefaults/rPrDefault/rPr`
 *   `docDefaults/pPrDefault/pPr`
 *
 * Returns a `DocDefaults` structure containing whatever properties were defined.
 */
export function parseDocDefaults(ctDocDefaults?: CT_DocDefaults): DocDefaults {
  if (!ctDocDefaults) {
    return {};
  }
  const rPr = ctDocDefaults.rPrDefault?.rPr;
  const pPr = ctDocDefaults.pPrDefault?.pPr;

  const result: { rPr?: CT_RPr | undefined; pPr?: CT_PPrGeneral | undefined } = {};
  if (rPr !== undefined) result.rPr = rPr;
  if (pPr !== undefined) result.pPr = pPr;
  return result;
}

/**
 * Resolves document defaults from `CT_DocDefaults`, filling in absent sections
 * with `BUILTIN_DOC_DEFAULTS`.
 */
export function resolveDocDefaults(ctDocDefaults?: CT_DocDefaults): DocDefaults {
  const parsed = parseDocDefaults(ctDocDefaults);
  return {
    rPr: parsed.rPr ?? BUILTIN_DOC_DEFAULTS.rPr,
    pPr: parsed.pPr ?? BUILTIN_DOC_DEFAULTS.pPr,
  };
}

/**
 * Parses `CT_DocDefaults` from raw XML string containing `<w:docDefaults>`.
 */
export function parseDocDefaultsXml(xml: string): DocDefaults {
  const readCtx = createReadContext('transitional', {
    wml: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  });
  const cursor = createCursor(xml);
  while (cursor.current && cursor.current.type !== 'startElement') {
    cursor.next();
  }
  const ctDocDefaults = wmlReader.readCT_DocDefaults(cursor, readCtx);
  return parseDocDefaults(ctDocDefaults);
}
