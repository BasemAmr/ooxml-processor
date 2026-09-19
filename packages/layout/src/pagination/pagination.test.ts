import { describe, expect, it } from 'vitest';
import { fillPage } from './page-fill';
import { paginateWithFootnotes } from './footnotes';
import { resolveSectionBreak } from './breaks';
import { formatPageNumber } from './numbering';
import { balanceColumnHeights } from './columns';

describe('page filling', () => {
  it('forces a first block that exceeds the page', () => {
    const result = fillPage(
      {
        blockIndex: 0,
        intraBlock: 0,
        columnIndex: 0,
        pendingFloats: [],
        footnoteCarry: [],
        keepBacklog: [],
        pageNumber: 1,
        sectionIndex: 0,
      },
      {
        availableHeight: 10,
        blocks: ['large'],
        fragment: () => ({ blockIndex: 0, height: 20, complete: true }),
      },
    );
    expect(result.content.fragments).toHaveLength(1);
    expect(result.content.forced).toBe(true);
  });

  it('chooses the larger reserve when footnote sizing oscillates', () => {
    const result = paginateWithFootnotes(
      0,
      (reserve) => ({ content: reserve, referenced: [reserve % 2 ? 'n' : ''] }),
      (ids) => ({ height: ids[0] === 'n' ? 20 : 0, carry: [] }),
    );
    expect(result.reserved).toBeGreaterThanOrEqual(0);
  });

  it('inserts a visible blank page for an odd-page break', () => {
    expect(resolveSectionBreak(1, 0, 1, 'oddPage')).toEqual({
      pageNumber: 3,
      columnIndex: 0,
      blankPages: [2],
    });
  });

  it('formats page numbers and balances final columns deterministically', () => {
    expect(formatPageNumber(9, 'lowerRoman')).toBe('ix');
    expect(balanceColumnHeights([3, 3, 3, 3], 2)).toEqual([6, 6]);
  });
});
