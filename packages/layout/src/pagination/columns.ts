import type { CT_Columns } from '@ooxml/schema';

export interface ColumnBox {
  readonly x: number;
  readonly width: number;
}

export function resolveColumns(
  columns: CT_Columns | undefined,
  area: { readonly x: number; readonly width: number },
): readonly ColumnBox[] {
  const count = Math.max(1, Number(columns?.num ?? columns?.col.length ?? 1));
  const equal =
    columns?.equalWidth === undefined || columns.equalWidth === true || columns.equalWidth === 'on';
  const gap = Number(columns?.space ?? 720);
  if (equal) {
    const width = Math.max(0, (area.width - gap * (count - 1)) / count);
    return Array.from({ length: count }, (_, i) => ({ x: area.x + i * (width + gap), width }));
  }
  let x = area.x;
  return Array.from({ length: count }, (_, i) => {
    const column = columns?.col[i];
    const width = Number(column?.w ?? Math.max(0, (area.width - gap * (count - 1)) / count));
    const box = { x, width };
    x += width + Number(column?.space ?? gap);
    return box;
  });
}

/** SPEC-GAP: binary-search balance approximation; Word's exact heuristic is undocumented. */
export function balanceColumnHeights(
  heights: readonly number[],
  columns: number,
): readonly number[] {
  if (columns <= 1 || heights.length === 0) return [...heights];
  const total = heights.reduce((sum, value) => sum + value, 0);
  let lo = Math.max(...heights);
  let hi = total;
  while (lo < hi) {
    const target = Math.floor((lo + hi) / 2);
    let used = 1;
    let current = 0;
    for (const height of heights) {
      if (current > 0 && current + height > target) {
        used += 1;
        current = 0;
      }
      current += height;
    }
    if (used <= columns) hi = target;
    else lo = target + 1;
  }
  const out: number[] = [];
  let current = 0;
  for (const height of heights) {
    if (current > 0 && current + height > lo && out.length < columns - 1) {
      out.push(current);
      current = 0;
    }
    current += height;
  }
  out.push(current);
  return out;
}
