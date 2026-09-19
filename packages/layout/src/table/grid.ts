import type { CT_Row, CT_Tbl, CT_Tc, CT_TrPr_Content } from '@ooxml/schema';

export interface Grid {
  readonly colWidths: readonly number[];
  readonly colCount: number;
}

export interface CellGridPosition {
  readonly cell: CT_Tc;
  readonly gridStart: number;
  readonly gridEnd: number;
  readonly span: number;
}

export interface GridDiagnostic {
  readonly code: 'grid-span-overflow' | 'negative-grid-offset';
  readonly rowIndex?: number;
}

export interface GridBuildResult {
  readonly grid: Grid;
  readonly diagnostics: readonly GridDiagnostic[];
}

function rowContent(tbl: CT_Tbl): readonly CT_Row[] {
  return tbl.contentRowContent.flatMap((item) => (item.kind === 'tr' ? [item.value] : []));
}

function trNumber(row: CT_Row, kind: 'gridBefore' | 'gridAfter'): number {
  const item = row.trPr?.content.find(
    (entry): entry is Extract<CT_TrPr_Content, { kind: typeof kind }> => entry.kind === kind,
  );
  return Math.max(0, item?.value.val ?? 0);
}

/** Reconciles declared grid columns with the largest row footprint. */
export function buildGridResult(tbl: CT_Tbl): GridBuildResult {
  const declared = (tbl.tblGrid?.gridCol ?? []).map((column) => Number(column.w ?? 0));
  const diagnostics: GridDiagnostic[] = [];
  let maximum = declared.length;
  for (const [rowIndex, row] of rowContent(tbl).entries()) {
    const before = trNumber(row, 'gridBefore');
    const after = trNumber(row, 'gridAfter');
    if (
      row.trPr?.content.some((entry) => entry.kind === 'gridBefore' && (entry.value.val ?? 0) < 0)
    ) {
      diagnostics.push({ code: 'negative-grid-offset', rowIndex });
    }
    const used =
      before +
      row.contentCellContent.reduce((sum, entry) => {
        if (entry.kind !== 'tc') return sum;
        return sum + Math.max(1, entry.value.tcPr?.gridSpan?.val ?? 1);
      }, 0) +
      after;
    maximum = Math.max(maximum, used);
    if (used > declared.length) diagnostics.push({ code: 'grid-span-overflow', rowIndex });
  }
  while (declared.length < maximum) declared.push(0);
  return { grid: { colWidths: declared, colCount: declared.length }, diagnostics };
}

/** Public grid coordinate model; diagnostics are available from buildGridResult. */
export function buildGrid(tbl: CT_Tbl): Grid {
  return buildGridResult(tbl).grid;
}

/** The only supported path from row content to addressed cells. */
export function cellsOf(row: CT_Row, _grid: Grid): readonly CellGridPosition[] {
  let cursor = trNumber(row, 'gridBefore');
  const positions: CellGridPosition[] = [];
  for (const entry of row.contentCellContent) {
    if (entry.kind !== 'tc') continue;
    const span = Math.max(1, entry.value.tcPr?.gridSpan?.val ?? 1);
    positions.push({ cell: entry.value, gridStart: cursor, gridEnd: cursor + span, span });
    cursor += span;
  }
  return positions;
}

export function tableRows(tbl: CT_Tbl): readonly CT_Row[] {
  return rowContent(tbl);
}
