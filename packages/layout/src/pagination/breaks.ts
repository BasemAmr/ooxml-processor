import type { CT_SectPr } from '@ooxml/schema';

export type SectionBreakType = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn';

export interface BreakResult {
  readonly pageNumber: number;
  readonly columnIndex: number;
  readonly blankPages: readonly number[];
}

/** Resolves section starts, including visible blank even/odd pages. */
export function resolveSectionBreak(
  currentPage: number,
  currentColumn: number,
  columnCount: number,
  type: SectionBreakType,
): BreakResult {
  if (type === 'continuous')
    return { pageNumber: currentPage, columnIndex: currentColumn, blankPages: [] };
  if (type === 'nextColumn') {
    return currentColumn + 1 < columnCount
      ? { pageNumber: currentPage, columnIndex: currentColumn + 1, blankPages: [] }
      : { pageNumber: currentPage + 1, columnIndex: 0, blankPages: [] };
  }
  let page = currentPage + 1;
  const blankPages: number[] = [];
  if (type === 'evenPage' && page % 2 !== 0) {
    blankPages.push(page);
    page += 1;
  }
  if (type === 'oddPage' && page % 2 !== 1) {
    blankPages.push(page);
    page += 1;
  }
  return { pageNumber: page, columnIndex: 0, blankPages };
}

export function sectionBreakType(sectPr: CT_SectPr | undefined): SectionBreakType {
  return sectPr?.type?.val ?? 'nextPage';
}
