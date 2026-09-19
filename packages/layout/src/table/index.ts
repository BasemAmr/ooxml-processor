import type {
  CT_Border,
  CT_Row,
  CT_Tbl,
  CT_TblBorders,
  CT_TblCellMar,
  CT_TblPr,
  CT_TblWidth,
  CT_Tc,
  CT_TcBorders,
  CT_TcMar,
  CT_TrPr_Content,
  CT_OnOff,
  ST_Border,
  ST_TextDirection,
  CT_Cnf,
} from '@ooxml/schema';
import { parseCnfConditions } from '@ooxml/wml';
import { runtime } from '@ooxml/schema';
import { cellsOf, tableRows, type CellGridPosition, type Grid, buildGrid } from './grid.js';

export { buildGrid, buildGridResult, cellsOf, tableRows } from './grid.js';
export type { CellGridPosition, Grid, GridBuildResult, GridDiagnostic } from './grid.js';

export type ResolvedWidth =
  | { readonly kind: 'twips'; readonly value: number }
  | { readonly kind: 'auto' }
  | { readonly kind: 'nil' };

/** Resolves every CT_TblWidth site without applying absent schema defaults. */
export function resolveWidth(
  width: CT_TblWidth | undefined,
  containerWidth: number,
): ResolvedWidth {
  if (width === undefined || width.type === undefined || width.type === 'auto')
    return { kind: 'auto' };
  if (width.type === 'nil') return { kind: 'nil' };
  const raw = width.w;
  if (raw === undefined) return { kind: 'auto' };
  if (width.type === 'dxa')
    return { kind: 'twips', value: Number(runtime.parseTwipsMeasure(String(raw))) };
  if (width.type === 'pct') {
    const pct = runtime.parseTablePercent(String(raw));
    return {
      kind: 'twips',
      value: Number(runtime.twip((Number(containerWidth) * Number(pct)) / 5000)),
    };
  }
  return { kind: 'auto' };
}

export interface MergeSpan {
  readonly gridStart: number;
  readonly startRow: number;
  readonly endRow: number;
  readonly cell: CT_Tc;
}

export interface MergeDiagnostic {
  readonly code: 'orphan-vmerge-continue';
  readonly rowIndex: number;
  readonly gridStart: number;
}

function mergeValue(cell: CT_Tc): string | undefined {
  const merge = cell.tcPr?.vMerge;
  return merge === undefined ? undefined : (merge.val ?? 'continue');
}

/** Resolves vMerge by grid coordinate; absent val is the continue form. */
export function resolveVMerge(
  rows: readonly CT_Row[],
  grid: Grid,
): { spans: readonly MergeSpan[]; diagnostics: readonly MergeDiagnostic[] } {
  const open = new Map<number, MergeSpan>();
  const spans: MergeSpan[] = [];
  const diagnostics: MergeDiagnostic[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const occupied = new Set<number>();
    for (const position of cellsOf(row, grid)) {
      occupied.add(position.gridStart);
      const value = mergeValue(position.cell);
      const current = open.get(position.gridStart);
      if (value === undefined) {
        if (current !== undefined) {
          spans.push({ ...current, endRow: rowIndex - 1 });
          open.delete(position.gridStart);
        }
      } else if (value === 'restart') {
        if (current !== undefined) spans.push({ ...current, endRow: rowIndex - 1 });
        open.set(position.gridStart, {
          gridStart: position.gridStart,
          startRow: rowIndex,
          endRow: rowIndex,
          cell: position.cell,
        });
      } else {
        if (current === undefined) {
          diagnostics.push({
            code: 'orphan-vmerge-continue',
            rowIndex,
            gridStart: position.gridStart,
          });
          open.set(position.gridStart, {
            gridStart: position.gridStart,
            startRow: rowIndex,
            endRow: rowIndex,
            cell: position.cell,
          });
        } else {
          open.set(position.gridStart, { ...current, endRow: rowIndex });
        }
      }
    }
    for (const [start, span] of open) {
      if (!occupied.has(start)) {
        spans.push({ ...span, endRow: rowIndex - 1 });
        open.delete(start);
      }
    }
  }
  for (const span of open.values()) spans.push(span);
  return { spans, diagnostics };
}

/** Adds merged-cell overflow to the final covered row, matching Word's growth rule. */
export function distributeMergedHeight(
  rowHeights: readonly number[],
  span: MergeSpan,
  contentHeight: number,
): readonly number[] {
  const result = [...rowHeights];
  const start = Math.max(0, span.startRow);
  const end = Math.min(result.length - 1, span.endRow);
  if (end < start) return result;
  const covered = result.slice(start, end + 1).reduce((sumValue, value) => sumValue + value, 0);
  if (contentHeight > covered && result[end] !== undefined) result[end] += contentHeight - covered;
  return result;
}

export interface ContentWidthMeasure {
  readonly minContent: number;
  readonly maxContent: number;
}
export interface AutofitCell {
  readonly start: number;
  readonly end: number;
  readonly measure: ContentWidthMeasure;
  readonly preferred?: ResolvedWidth;
  readonly noWrap?: boolean;
}
export interface AutofitOptions {
  readonly tblWidth?: ResolvedWidth;
  readonly available: number;
  readonly preferred?: readonly (ResolvedWidth | undefined)[];
}

/**
 * SPEC-GAP: OOXML specifies autofit intent but no distribution procedure. This
 * uses linear interpolation between min/max widths, based on common Word table
 * shapes; it is UNVERIFIABLE-HERE because Word/LibreOffice are unavailable.
 */
export function autofitColumns(
  columnCount: number,
  cells: readonly AutofitCell[],
  options: AutofitOptions,
): readonly number[] {
  const min = new Array<number>(columnCount).fill(0);
  const max = new Array<number>(columnCount).fill(0);
  for (const cell of cells) {
    const lo = cell.noWrap ? cell.measure.maxContent : cell.measure.minContent;
    if (cell.end - cell.start === 1) {
      min[cell.start] = Math.max(min[cell.start] ?? 0, lo);
      max[cell.start] = Math.max(max[cell.start] ?? 0, cell.measure.maxContent);
    }
  }
  for (const cell of cells) {
    if (cell.end - cell.start <= 1) continue;
    const lo = cell.noWrap ? cell.measure.maxContent : cell.measure.minContent;
    const hi = cell.measure.maxContent;
    const currentLo = sum(min, cell.start, cell.end);
    const currentHi = sum(max, cell.start, cell.end);
    distribute(min, cell.start, cell.end, Math.max(0, lo - currentLo));
    distribute(max, cell.start, cell.end, Math.max(0, hi - currentHi));
  }
  const minTotal = min.reduce((a, b) => a + b, 0);
  const maxTotal = max.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (maxTotal <= options.available) widths = [...max];
  else if (minTotal <= options.available && maxTotal > minTotal) {
    const ratio = (options.available - minTotal) / (maxTotal - minTotal);
    widths = min.map((value, i) => value + ((max[i] ?? value) - value) * ratio);
  } else widths = [...min];
  if (options.tblWidth?.kind === 'twips') {
    const target = Number(options.tblWidth.value);
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > 0 && target > total) widths = widths.map((value) => (value * target) / total);
  }
  return widths.map((value, i) => Math.max(value, preferredAt(options.preferred, i)));
}

function preferredAt(
  preferred: readonly (ResolvedWidth | undefined)[] | undefined,
  index: number,
): number {
  const value = preferred?.[index];
  return value?.kind === 'twips' ? Number(value.value) : 0;
}
function sum(values: readonly number[], start: number, end: number): number {
  return values.slice(start, end).reduce((a, b) => a + b, 0);
}
function distribute(values: number[], start: number, end: number, amount: number): void {
  const current = values.slice(start, end);
  const total = current.reduce((sumValue, value) => sumValue + value, 0);
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i += 1) {
    const share = total > 0 ? ((values[i] ?? 0) / total) * amount : amount / count;
    values[i] = (values[i] ?? 0) + share;
  }
}

export function fixedColumns(grid: Grid, cells: readonly AutofitCell[] = []): readonly number[] {
  const widths = [...grid.colWidths].map(Number);
  const firstRow = cells.filter((cell) => cell.start >= 0 && cell.end === cell.start + 1);
  for (const cell of firstRow)
    if (cell.preferred?.kind === 'twips') widths[cell.start] = Number(cell.preferred.value);
  return widths;
}

export interface CellMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
const DEFAULT_MARGINS: CellMargins = { top: 0, right: 108, bottom: 0, left: 108 };
function marginValue(width: CT_TblWidth | undefined, fallback: number): number {
  const resolved = resolveWidth(width, 0);
  return resolved.kind === 'twips' ? Number(resolved.value) : fallback;
}
export function resolveCellMargins(
  cell: CT_Tc,
  table: CT_TblPr | undefined,
  style?: CT_TblCellMar,
): CellMargins {
  const tc = cell.tcPr?.tcMar;
  const tableMar = table?.tblCellMar;
  const pick = (side: 'top' | 'right' | 'bottom' | 'left'): number => {
    const own =
      tc?.[side] ?? (side === 'left' ? tc?.start : side === 'right' ? tc?.end : undefined);
    const inherited =
      style?.[side] ??
      (side === 'left' ? style?.start : side === 'right' ? style?.end : undefined) ??
      tableMar?.[side] ??
      (side === 'left' ? tableMar?.start : side === 'right' ? tableMar?.end : undefined);
    return marginValue(own ?? inherited, DEFAULT_MARGINS[side]);
  };
  return { top: pick('top'), right: pick('right'), bottom: pick('bottom'), left: pick('left') };
}
export function tableIndent(
  table: CT_TblPr | undefined,
  containerWidth: number,
  bidiVisual = false,
): { readonly side: 'left' | 'right'; readonly value: ResolvedWidth } {
  return {
    side: bidiVisual ? 'right' : 'left',
    value: resolveWidth(table?.tblInd, containerWidth),
  };
}
export function cellContentWidth(
  columnWidths: readonly number[],
  position: CellGridPosition,
  margins: CellMargins,
  borderWidth = 0,
  spacing = 0,
): number {
  const gridWidth = columnWidths
    .slice(position.gridStart, position.gridEnd)
    .reduce((a, b) => a + Number(b), 0);
  return Math.max(
    0,
    gridWidth - margins.left - margins.right - borderWidth - (spacing > 0 ? spacing * 2 : 0),
  );
}

export type BorderEdge = 'top' | 'left' | 'bottom' | 'right' | 'insideH' | 'insideV';
export interface BorderCandidate {
  readonly border?: CT_Border | undefined;
  readonly precedence: number;
  readonly side: 'left' | 'right' | 'top' | 'bottom';
}
export interface ResolvedBorder {
  readonly border: CT_Border;
  readonly candidate: BorderCandidate;
}
const STYLE_RANK: Partial<Record<ST_Border, number>> = {
  double: 7,
  single: 6,
  dashed: 4,
  dotted: 3,
  dotDash: 2,
  nil: 0,
  none: 0,
};
function visible(border: CT_Border | undefined): border is CT_Border {
  return border !== undefined && border.val !== 'nil' && border.val !== 'none';
}
function borderScore(candidate: BorderCandidate): readonly number[] {
  const border = candidate.border;
  return [
    candidate.precedence,
    visible(border) ? 1 : 0,
    Number(border?.sz ?? 0),
    STYLE_RANK[border?.val ?? 'nil'] ?? 1,
    candidate.side === 'left' || candidate.side === 'top' ? 1 : 0,
  ];
}
export function resolveBorder(
  candidates: readonly BorderCandidate[],
  spacing = 0,
): ResolvedBorder | undefined {
  if (spacing !== 0) return undefined;
  const visibleCandidates = candidates.filter((candidate) => visible(candidate.border));
  const winner = [...visibleCandidates].sort((a, b) =>
    compareScores(borderScore(b), borderScore(a)),
  )[0];
  return winner?.border === undefined ? undefined : { border: winner.border, candidate: winner };
}
function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}
export function borderAt(
  table: CT_TblBorders | undefined,
  cell: CT_TcBorders | undefined,
  edge: BorderEdge,
  spacing = 0,
): CT_Border | undefined {
  const direct = cell?.[edge];
  const tableBorder = table?.[edge];
  return resolveBorder(
    [
      { border: direct, precedence: 4, side: 'left' },
      { border: tableBorder, precedence: 2, side: 'right' },
    ],
    spacing,
  )?.border;
}

export interface RowHeight {
  readonly value: number;
  readonly rule: 'auto' | 'exact' | 'atLeast';
  readonly clips: boolean;
}
function rowProp(row: CT_Row, kind: CT_TrPr_Content['kind']): CT_TrPr_Content | undefined {
  return row.trPr?.content.find((entry) => entry.kind === kind);
}
export function resolveRowHeight(row: CT_Row, contentHeight: number): RowHeight {
  const height = rowProp(row, 'trHeight');
  if (height?.kind !== 'trHeight') return { value: contentHeight, rule: 'auto', clips: false };
  const rule = height.value.hRule ?? 'auto';
  const requested =
    height.value.val === undefined
      ? contentHeight
      : Number(runtime.parseTwipsMeasure(String(height.value.val)));
  if (rule === 'exact') return { value: requested, rule, clips: requested < contentHeight };
  if (rule === 'atLeast') return { value: Math.max(requested, contentHeight), rule, clips: false };
  return { value: contentHeight, rule, clips: false };
}

export interface RowFragmentable {
  readonly canSplit: boolean;
  readonly splitPoints: readonly number[];
  readonly minFirstHeight: number;
  readonly isHeader: boolean;
}
export function rowFragmentable(
  row: CT_Row,
  splitPoints: readonly number[] = [],
  minFirstHeight = 0,
  vMergeOpen = false,
): RowFragmentable {
  const cantSplit = row.trPr?.content.find(
    (entry): entry is Extract<CT_TrPr_Content, { kind: 'cantSplit' }> => entry.kind === 'cantSplit',
  );
  const header = row.trPr?.content.find(
    (entry): entry is Extract<CT_TrPr_Content, { kind: 'tblHeader' }> => entry.kind === 'tblHeader',
  );
  const onOffTrue = (value: CT_OnOff['val']): boolean =>
    value === undefined || value === true || value === 'on';
  return {
    canSplit: !vMergeOpen && !(cantSplit?.kind === 'cantSplit' && onOffTrue(cantSplit.value.val)),
    splitPoints,
    minFirstHeight,
    isHeader: header?.kind === 'tblHeader' && onOffTrue(header.value.val),
  };
}
export function headerRowCount(rows: readonly CT_Row[]): number {
  let count = 0;
  for (const row of rows) {
    if (!rowFragmentable(row).isHeader) break;
    count += 1;
  }
  return count;
}

export interface TextDirection {
  readonly flowAxis: 'horizontal' | 'vertical';
  readonly glyphRotation: 0 | 90 | 180 | 270;
}
const DIRECTIONS: Record<ST_TextDirection, TextDirection> = {
  tb: { flowAxis: 'vertical', glyphRotation: 0 },
  rl: { flowAxis: 'vertical', glyphRotation: 180 },
  lr: { flowAxis: 'horizontal', glyphRotation: 0 },
  tbV: { flowAxis: 'vertical', glyphRotation: 270 },
  rlV: { flowAxis: 'vertical', glyphRotation: 90 },
  lrV: { flowAxis: 'horizontal', glyphRotation: 0 },
  btLr: { flowAxis: 'horizontal', glyphRotation: 180 },
  lrTb: { flowAxis: 'horizontal', glyphRotation: 0 },
  lrTbV: { flowAxis: 'horizontal', glyphRotation: 270 },
  tbLrV: { flowAxis: 'vertical', glyphRotation: 270 },
  tbRl: { flowAxis: 'vertical', glyphRotation: 0 },
  tbRlV: { flowAxis: 'vertical', glyphRotation: 90 },
};
export function normalizeTextDirection(direction: ST_TextDirection | undefined): TextDirection {
  return DIRECTIONS[direction ?? 'lr'] ?? DIRECTIONS.lr;
}

export interface TableCellConditions {
  readonly row: number;
  readonly col: number;
  readonly rowCount: number;
  readonly colCount: number;
  readonly headerRows?: number;
  readonly rowBandSize?: number;
  readonly colBandSize?: number;
}
export type TableCondition =
  | 'firstRow'
  | 'lastRow'
  | 'firstCol'
  | 'lastCol'
  | 'band1Horz'
  | 'band2Horz'
  | 'band1Vert'
  | 'band2Vert'
  | 'nwCell'
  | 'neCell'
  | 'swCell'
  | 'seCell';
export function tableConditions(
  position: TableCellConditions,
  look?: CT_TblPr['tblLook'],
): readonly TableCondition[] {
  const headerRows = position.headerRows ?? 0;
  // firstRow is the physical first row; tblHeader is a separate repeating-row concept.
  const firstRow = position.row === 0;
  const lastRow = position.row === position.rowCount - 1;
  const firstCol = position.col === 0;
  const lastCol = position.col === position.colCount - 1;
  const disabled = (
    name: 'firstRow' | 'lastRow' | 'firstColumn' | 'lastColumn' | 'noHBand' | 'noVBand',
  ): boolean => look?.[name] === false || look?.[name] === 'off';
  const result: TableCondition[] = [];
  if (firstRow && !disabled('firstRow')) result.push('firstRow');
  if (lastRow && !disabled('lastRow')) result.push('lastRow');
  if (firstCol && !disabled('firstColumn')) result.push('firstCol');
  if (lastCol && !disabled('lastColumn')) result.push('lastCol');
  if (firstRow && firstCol) result.push('nwCell');
  if (firstRow && lastCol) result.push('neCell');
  if (lastRow && firstCol) result.push('swCell');
  if (lastRow && lastCol) result.push('seCell');
  const skipFirstForBand = firstRow && headerRows === 0;
  const rowBand = Math.floor(
    Math.max(0, position.row - headerRows - (skipFirstForBand ? 1 : 0)) /
      Math.max(1, position.rowBandSize ?? 1),
  );
  const colBand = Math.floor(position.col / Math.max(1, position.colBandSize ?? 1));
  if (position.row >= headerRows && !lastRow && !disabled('noHBand'))
    result.push(rowBand % 2 === 0 ? 'band1Horz' : 'band2Horz');
  if (!disabled('noVBand')) result.push(colBand % 2 === 0 ? 'band1Vert' : 'band2Vert');
  return result;
}

/** Applies an explicit row/cell cnfStyle override over geometry-derived slots. */
export function applyConditionalFormatting(
  position: TableCellConditions,
  look?: CT_TblPr['tblLook'],
  cnf?: CT_Cnf,
): readonly TableCondition[] {
  if (cnf === undefined) return tableConditions(position, look);
  const active = parseCnfConditions(cnf);
  return [...active].filter((condition): condition is TableCondition => condition !== 'wholeTable');
}

export function effectiveVerticalOffset(
  vAlign: 'top' | 'center' | 'bottom' | undefined,
  cellHeight: number,
  contentHeight: number,
): number {
  if (vAlign === 'center') return Math.max(0, (cellHeight - contentHeight) / 2);
  if (vAlign === 'bottom') return Math.max(0, cellHeight - contentHeight);
  return 0;
}
export function fitTextScale(textAdvance: number, cellWidth: number): number {
  return textAdvance <= 0 ? 1 : cellWidth / textAdvance;
}

export interface PaintCommand {
  readonly kind: 'table-shading' | 'row-shading' | 'cell-shading' | 'content' | 'borders';
  readonly row?: number;
  readonly col?: number;
}
export function tablePaintOrder(rowCount: number, colCount: number): readonly PaintCommand[] {
  const commands: PaintCommand[] = [{ kind: 'table-shading' }];
  for (let row = 0; row < rowCount; row += 1) commands.push({ kind: 'row-shading', row });
  for (let row = 0; row < rowCount; row += 1)
    for (let col = 0; col < colCount; col += 1) commands.push({ kind: 'cell-shading', row, col });
  for (let row = 0; row < rowCount; row += 1)
    for (let col = 0; col < colCount; col += 1) commands.push({ kind: 'content', row, col });
  commands.push({ kind: 'borders' });
  return commands;
}

export const MAX_NESTED_TABLE_DEPTH = 8;
export interface NestedTableResult {
  readonly allowed: boolean;
  readonly placeholder?: string;
  readonly diagnostic?: string;
}
export function checkNestedTableDepth(
  depth: number,
  maxDepth = MAX_NESTED_TABLE_DEPTH,
): NestedTableResult {
  return depth > maxDepth
    ? {
        allowed: false,
        placeholder: '[Nested table depth limit]',
        diagnostic: 'nested-table-depth-exceeded',
      }
    : { allowed: true };
}

export interface FloatingTableRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly leftFromText: number;
  readonly rightFromText: number;
  readonly topFromText: number;
  readonly bottomFromText: number;
}
export function inflateFloatingTable(rect: FloatingTableRect): FloatingTableRect {
  return {
    ...rect,
    x: rect.x - rect.leftFromText,
    y: rect.y - rect.topFromText,
    width: rect.width + rect.leftFromText + rect.rightFromText,
    height: rect.height + rect.topFromText + rect.bottomFromText,
  };
}
