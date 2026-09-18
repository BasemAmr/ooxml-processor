/**
 * Numbering definition resolution and cascade contributions (P3-08).
 *
 * ## Numbering in the Cascade
 *
 * Numbering contributes to the cascade at two distinct, non-adjacent levels:
 * 1. Cascade level 3: The numbering STYLE (`w:numStyleLink` or `w:styleLink`) contributes `pPr` and `rPr`.
 * 2. Cascade level 5: The numbering LEVEL's own `pPr` contributes indentation (`w:ind`) and justification (`w:jc`).
 *
 * The numbering LEVEL's own `rPr` formats the number GLYPH only, NEVER the paragraph text.
 * It is exposed on a separate channel for glyph rendering (Phase 10), not fed into the run cascade.
 *
 * `numId="0"` is an explicit sentinel meaning "no numbering", which clears numbering inherited from a style.
 */

import {
  createCursor,
  createReadContext,
  wmlReader,
  type CT_AbstractNum,
  type CT_Lvl,
  type CT_Num,
  type CT_Numbering,
  type CT_NumPr,
  type CT_PPrGeneral,
  type CT_RPr,
} from '@ooxml/schema';
import type { Style, StyleTable } from './styles.js';

export interface NumberingTable {
  readonly abstractNums: ReadonlyMap<number, CT_AbstractNum>;
  readonly nums: ReadonlyMap<number, CT_Num>;
}

export interface ResolvedNumbering {
  readonly numId: number;
  readonly ilvl: number;
  readonly level: CT_Lvl;
  /** Numbering style contributing at cascade level 3 */
  readonly numberingStyle: Style | undefined;
  /** Indentation and justification contributing at cascade level 5 */
  readonly levelPPr: CT_PPrGeneral | undefined;
  /** Formats the number glyph ONLY, never paragraph text */
  readonly glyphRPr: CT_RPr | undefined;
}

/**
 * Parse a `CT_Numbering` element into an in-memory `NumberingTable`.
 */
export function parseNumbering(ctNumbering: CT_Numbering): NumberingTable {
  const abstractNums = new Map<number, CT_AbstractNum>();
  const nums = new Map<number, CT_Num>();

  for (const an of ctNumbering.abstractNum ?? []) {
    if (an.abstractNumId !== undefined) {
      abstractNums.set(Number(an.abstractNumId), an);
    }
  }

  for (const num of ctNumbering.num ?? []) {
    if (num.numId !== undefined) {
      nums.set(Number(num.numId), num);
    }
  }

  return { abstractNums, nums };
}

/**
 * Parse a raw `numbering.xml` string into a `NumberingTable`.
 */
export function parseNumberingXml(xml: string): NumberingTable {
  const cursor = createCursor(xml);
  while (cursor.current && cursor.current.type !== 'startElement') {
    cursor.next();
  }
  const readCtx = createReadContext('transitional', {
    wml: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  });
  const ct = wmlReader.readCT_Numbering(cursor, readCtx);
  return parseNumbering(ct);
}

/**
 * Resolve numbering definitions and cascade contributions for a paragraph's `w:numPr`.
 */
export function resolveNumbering(
  numPr: CT_NumPr | undefined,
  numberingTable: NumberingTable,
  styleTable?: StyleTable,
): ResolvedNumbering | undefined {
  if (numPr === undefined || numPr.numId === undefined) return undefined;

  const numId = Number(numPr.numId.val);
  // Trap: numId="0" explicitly means "no numbering", removing numbering from a style
  if (numId === 0 || isNaN(numId)) return undefined;

  const ilvl = numPr.ilvl !== undefined ? Number(numPr.ilvl.val) : 0;

  const num = numberingTable.nums.get(numId);
  if (num === undefined || num.abstractNumId === undefined) return undefined;

  let abstractNumId = Number(num.abstractNumId.val);
  let abstractNum = numberingTable.abstractNums.get(abstractNumId);
  if (abstractNum === undefined) return undefined;

  let numberingStyle: Style | undefined;

  // Handle w:numStyleLink indirection (defers to numbering style)
  if (abstractNum.numStyleLink !== undefined && styleTable !== undefined) {
    const styleId = String(abstractNum.numStyleLink.val);
    const style = styleTable.byId.get(styleId);
    if (style !== undefined && style.type === 'numbering') {
      numberingStyle = style;
    }
  }

  // Handle w:styleLink on abstractNum (points to numbering style)
  if (
    abstractNum.styleLink !== undefined &&
    styleTable !== undefined &&
    numberingStyle === undefined
  ) {
    const styleId = String(abstractNum.styleLink.val);
    const style = styleTable.byId.get(styleId);
    if (style !== undefined && style.type === 'numbering') {
      numberingStyle = style;
    }
  }

  // Level resolution: lvlOverride beats base lvl
  let level: CT_Lvl | undefined;
  const override = num.lvlOverride?.find((o) => Number(o.ilvl) === ilvl);
  if (override !== undefined && override.lvl !== undefined) {
    level = override.lvl;
  } else {
    level = abstractNum.lvl?.find((l) => Number(l.ilvl) === ilvl);
  }

  if (level === undefined) return undefined;

  return {
    numId,
    ilvl,
    level,
    numberingStyle,
    levelPPr: level.pPr,
    glyphRPr: level.rPr,
  };
}
