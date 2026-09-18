/**
 * Table conditional formatting and `w:cnfStyle` resolution (P3-09).
 *
 * ## The Two Vocabularies
 *
 * `ST_TblStyleOverrideType` (used in table styles) and `CT_Cnf` (used on cells/rows)
 * name the same conditions differently:
 *
 * | ST_TblStyleOverrideType | CT_Cnf attribute        | ST_Cnf bit |
 * | :---------------------- | :---------------------- | :--------- |
 * | firstRow                | firstRow                | 0          |
 * | lastRow                 | lastRow                 | 1          |
 * | firstCol                | firstColumn             | 2          |
 * | lastCol                 | lastColumn              | 3          |
 * | band1Vert               | oddVBand                | 4          |
 * | band2Vert               | evenVBand               | 5          |
 * | band1Horz               | oddHBand                | 6          |
 * | band2Horz               | evenHBand               | 7          |
 * | neCell                  | firstRowLastColumn      | 8          |
 * | nwCell                  | firstRowFirstColumn     | 9          |
 * | seCell                  | lastRowLastColumn       | 10         |
 * | swCell                  | lastRowFirstColumn      | 11         |
 * | wholeTable              | (always applies)        | —          |
 */

import type { CT_Cnf, CT_TblStylePr, ST_TblStyleOverrideType } from '@ooxml/schema';
import type { Style } from './styles.js';

export interface TableConditionMapping {
  readonly overrideType: ST_TblStyleOverrideType;
  readonly cnfAttr: keyof CnfAttributes;
  readonly bitIndex: number;
}

export interface CnfAttributes {
  readonly firstRow?: boolean;
  readonly lastRow?: boolean;
  readonly firstColumn?: boolean;
  readonly lastColumn?: boolean;
  readonly oddVBand?: boolean;
  readonly evenVBand?: boolean;
  readonly oddHBand?: boolean;
  readonly evenHBand?: boolean;
  readonly firstRowLastColumn?: boolean;
  readonly firstRowFirstColumn?: boolean;
  readonly lastRowLastColumn?: boolean;
  readonly lastRowFirstColumn?: boolean;
}

/**
 * Bi-directional vocabulary lookup table.
 */
export const TABLE_CONDITION_MAPPINGS: readonly TableConditionMapping[] = [
  { overrideType: 'firstRow', cnfAttr: 'firstRow', bitIndex: 0 },
  { overrideType: 'lastRow', cnfAttr: 'lastRow', bitIndex: 1 },
  { overrideType: 'firstCol', cnfAttr: 'firstColumn', bitIndex: 2 },
  { overrideType: 'lastCol', cnfAttr: 'lastColumn', bitIndex: 3 },
  { overrideType: 'band1Vert', cnfAttr: 'oddVBand', bitIndex: 4 },
  { overrideType: 'band2Vert', cnfAttr: 'evenVBand', bitIndex: 5 },
  { overrideType: 'band1Horz', cnfAttr: 'oddHBand', bitIndex: 6 },
  { overrideType: 'band2Horz', cnfAttr: 'evenHBand', bitIndex: 7 },
  { overrideType: 'neCell', cnfAttr: 'firstRowLastColumn', bitIndex: 8 },
  { overrideType: 'nwCell', cnfAttr: 'firstRowFirstColumn', bitIndex: 9 },
  { overrideType: 'seCell', cnfAttr: 'lastRowLastColumn', bitIndex: 10 },
  { overrideType: 'swCell', cnfAttr: 'lastRowFirstColumn', bitIndex: 11 },
];

/**
 * SPEC-GAP / UNVERIFIABLE-HERE:
 * ST_Cnf is an xsd:string with length=12 and pattern [01]*.
 * The bit order follows the declaration order of attributes in CT_Cnf.
 */
export const CNF_BIT_ORDER: readonly (keyof CnfAttributes)[] = [
  'firstRow',
  'lastRow',
  'firstColumn',
  'lastColumn',
  'oddVBand',
  'evenVBand',
  'oddHBand',
  'evenHBand',
  'firstRowLastColumn',
  'firstRowFirstColumn',
  'lastRowLastColumn',
  'lastRowFirstColumn',
];

/**
 * Application order from lowest to highest precedence.
 * Corners win over edges; edges win over banding; banding wins over wholeTable.
 */
export const CONDITIONAL_PRECEDENCE: readonly ST_TblStyleOverrideType[] = [
  'wholeTable',
  'band1Horz',
  'band2Horz',
  'band1Vert',
  'band2Vert',
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
];

export interface TableCellPosition {
  readonly isFirstRow: boolean;
  readonly isLastRow: boolean;
  readonly isFirstCol: boolean;
  readonly isLastCol: boolean;
  readonly isOddHBand?: boolean;
  readonly isEvenHBand?: boolean;
  readonly isOddVBand?: boolean;
  readonly isEvenVBand?: boolean;
}

/**
 * Parse a `CT_Cnf` into an active set of conditions.
 * Named attributes take precedence over `@val`.
 */
export function parseCnfConditions(cnf: CT_Cnf | undefined): Set<ST_TblStyleOverrideType> {
  const active = new Set<ST_TblStyleOverrideType>();
  if (cnf === undefined) return active;

  // Check if any named attribute is explicitly set
  let hasNamedAttr = false;
  for (const m of TABLE_CONDITION_MAPPINGS) {
    const val = (cnf as Record<string, any>)[m.cnfAttr];
    if (val !== undefined) {
      hasNamedAttr = true;
      if (val === true || val === 1 || val === '1' || val === 'true') {
        active.add(m.overrideType);
      }
    }
  }

  // Fallback to val 12-bit string if no named attributes were present
  if (!hasNamedAttr && typeof cnf.val === 'string' && cnf.val.length === 12) {
    for (const m of TABLE_CONDITION_MAPPINGS) {
      if (cnf.val[m.bitIndex] === '1') {
        active.add(m.overrideType);
      }
    }
  }

  return active;
}

/**
 * Derive active conditions from computed table geometry when `w:cnfStyle` is absent.
 */
export function deriveGeometryConditions(pos: TableCellPosition): Set<ST_TblStyleOverrideType> {
  const active = new Set<ST_TblStyleOverrideType>();

  if (pos.isFirstRow && pos.isFirstCol) active.add('nwCell');
  else if (pos.isFirstRow && pos.isLastCol) active.add('neCell');
  else if (pos.isLastRow && pos.isFirstCol) active.add('swCell');
  else if (pos.isLastRow && pos.isLastCol) active.add('seCell');
  else {
    if (pos.isFirstRow) active.add('firstRow');
    if (pos.isLastRow) active.add('lastRow');
    if (pos.isFirstCol) active.add('firstCol');
    if (pos.isLastCol) active.add('lastCol');
  }

  if (pos.isOddHBand) active.add('band1Horz');
  if (pos.isEvenHBand) active.add('band2Horz');
  if (pos.isOddVBand) active.add('band1Vert');
  if (pos.isEvenVBand) active.add('band2Vert');

  return active;
}

/**
 * Resolve the sequence of active `CT_TblStylePr` layers from a table style for a given cell.
 * Returned in ascending order of precedence (lowest first: wholeTable ... highest: corners).
 */
export function resolveTableConditionalLayers(
  tblStyle: Style | undefined,
  cnf: CT_Cnf | undefined,
  computedPos?: TableCellPosition,
): readonly CT_TblStylePr[] {
  if (tblStyle === undefined || tblStyle.type !== 'table' || tblStyle.tblStylePr.length === 0) {
    return [];
  }

  // Trap: w:cnfStyle beats computed position
  const activeConditions =
    cnf !== undefined
      ? parseCnfConditions(cnf)
      : computedPos !== undefined
        ? deriveGeometryConditions(computedPos)
        : new Set<ST_TblStyleOverrideType>();

  const overridesByType = new Map<ST_TblStyleOverrideType, CT_TblStylePr>();
  for (const pr of tblStyle.tblStylePr) {
    if (pr.type !== undefined) {
      overridesByType.set(pr.type, pr);
    }
  }

  const layers: CT_TblStylePr[] = [];

  // Iterate strictly in defined precedence order
  for (const type of CONDITIONAL_PRECEDENCE) {
    if (type === 'wholeTable' || activeConditions.has(type)) {
      const pr = overridesByType.get(type);
      if (pr !== undefined) {
        layers.push(pr);
      }
    }
  }

  return layers;
}
