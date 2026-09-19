import { describe, expect, it } from 'vitest';
import type { CT_Row, CT_Tbl, CT_Tc } from '@ooxml/schema';
import {
  autofitColumns,
  buildGrid,
  cellsOf,
  normalizeTextDirection,
  resolveRowHeight,
  resolveVMerge,
  resolveWidth,
  tablePaintOrder,
} from './index.js';

const tc = (props: CT_Tc['tcPr'] = {}): CT_Tc => ({ tcPr: props, blockLevelElts: [] });
const row = (cells: readonly CT_Tc[], content: CT_Row['trPr'] = { content: [] }): CT_Row => ({
  contentCellContent: cells.map((value) => ({ kind: 'tc', value })),
  trPr: content,
});

describe('table geometry', () => {
  it('reconciles grid spans and gridBefore', () => {
    const value: CT_Tbl = {
      rangeMarkupElements: [],
      contentRowContent: [
        {
          kind: 'tr',
          value: row([tc({ gridSpan: { val: 3 } })], {
            content: [{ kind: 'gridBefore', value: { val: 1 } }],
          }),
        },
      ],
      tblGrid: { gridCol: [{ w: 100 }, { w: 100 }] },
    };
    const result = buildGrid(value);
    expect(result.colCount).toBe(4);
    expect(
      cellsOf((value.contentRowContent[0] as { kind: 'tr'; value: CT_Row }).value, result)[0]
        ?.gridStart,
    ).toBe(1);
  });

  it('distinguishes pct, nil, auto and absent widths', () => {
    expect(resolveWidth({ type: 'pct', w: '50%' }, 1000)).toEqual({ kind: 'twips', value: 500 });
    expect(resolveWidth({ type: 'pct', w: 2500 }, 1000)).toEqual({ kind: 'twips', value: 500 });
    expect(resolveWidth({ type: 'nil' }, 1000)).toEqual({ kind: 'nil' });
    expect(resolveWidth({ type: 'auto' }, 1000)).toEqual({ kind: 'auto' });
    expect(resolveWidth(undefined, 1000)).toEqual({ kind: 'auto' });
  });

  it('treats absent vMerge val as continue and reports orphan continues', () => {
    const rows = [
      row([tc({ vMerge: { val: 'restart' } })]),
      row([tc({ vMerge: {} })]),
      row([tc()]),
    ];
    const result = resolveVMerge(rows, { colCount: 1, colWidths: [100] });
    expect(result.spans[0]).toMatchObject({ startRow: 0, endRow: 1 });
    expect(
      resolveVMerge([row([tc({ vMerge: {} })])], { colCount: 1, colWidths: [100] }).diagnostics,
    ).toHaveLength(1);
  });

  it('uses exact row heights as clipping constraints', () => {
    expect(
      resolveRowHeight(
        row([], { content: [{ kind: 'trHeight', value: { val: 100, hRule: 'exact' } }] }),
        200,
      ),
    ).toMatchObject({ value: 100, clips: true });
    expect(
      resolveRowHeight(
        row([], { content: [{ kind: 'trHeight', value: { val: 100, hRule: 'atLeast' } }] }),
        200,
      ).value,
    ).toBe(200);
  });

  it('normalizes all text directions and paints borders last', () => {
    expect(normalizeTextDirection('tbRl')).toEqual({ flowAxis: 'vertical', glyphRotation: 0 });
    const order = tablePaintOrder(1, 1).map((entry) => entry.kind);
    expect(order).toEqual(['table-shading', 'row-shading', 'cell-shading', 'content', 'borders']);
  });

  it('autofits spans and no-wrap cells without line breaking', () => {
    expect(
      autofitColumns(
        2,
        [
          { start: 0, end: 1, measure: { minContent: 20, maxContent: 40 }, noWrap: true },
          { start: 0, end: 2, measure: { minContent: 100, maxContent: 120 } },
        ],
        { available: 200 },
      )[0],
    ).toBeGreaterThanOrEqual(50);
  });
});
