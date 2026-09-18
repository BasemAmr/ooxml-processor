import { describe, expect, it } from 'vitest';
import {
  CONDITIONAL_PRECEDENCE,
  deriveGeometryConditions,
  parseCnfConditions,
  resolveTableConditionalLayers,
  TABLE_CONDITION_MAPPINGS,
} from './table-style.js';
import type { Style } from './styles.js';
import type { CT_TblStylePr } from '@ooxml/schema';

describe('P3-09 Table conditional formatting and w:cnfStyle', () => {
  it('maps all 12 conditions bi-directionally', () => {
    expect(TABLE_CONDITION_MAPPINGS.length).toBe(12);
    expect(CONDITIONAL_PRECEDENCE.length).toBe(13); // 12 + wholeTable
  });

  it('parses named attributes with higher priority than val string', () => {
    // Named attr firstRow=true, but string says firstRow=0 (all zeros)
    const cnf = {
      firstRow: true,
      val: '000000000000',
    };
    const active = parseCnfConditions(cnf);
    expect(active.has('firstRow')).toBe(true);
    expect(active.has('lastRow')).toBe(false);
  });

  it('falls back to val string when no named attributes are present', () => {
    const cnf = {
      val: '100000000000', // bit 0 = firstRow
    };
    const active = parseCnfConditions(cnf);
    expect(active.has('firstRow')).toBe(true);
    expect(active.has('lastRow')).toBe(false);
  });

  it('resolves conditional layers in exact ascending precedence order', () => {
    const wholeTablePr: CT_TblStylePr = { type: 'wholeTable' };
    const firstRowPr: CT_TblStylePr = { type: 'firstRow' };
    const nwCellPr: CT_TblStylePr = { type: 'nwCell' };

    const tblStyle: Style = {
      id: 'TestTableStyle',
      type: 'table',
      name: 'Test Table Style',
      tblStylePr: [firstRowPr, nwCellPr, wholeTablePr], // unordered
      flags: {},
    };

    const cnf = {
      firstRow: true,
      firstRowFirstColumn: true, // nwCell
    };

    const layers = resolveTableConditionalLayers(tblStyle, cnf);
    expect(layers.length).toBe(3);
    // Order must be: wholeTable -> firstRow -> nwCell
    expect(layers[0]?.type).toBe('wholeTable');
    expect(layers[1]?.type).toBe('firstRow');
    expect(layers[2]?.type).toBe('nwCell');
  });

  it('derives geometry conditions when cnfStyle is absent', () => {
    const active = deriveGeometryConditions({
      isFirstRow: true,
      isFirstCol: true,
      isLastRow: false,
      isLastCol: false,
    });
    expect(active.has('nwCell')).toBe(true);
  });
});
