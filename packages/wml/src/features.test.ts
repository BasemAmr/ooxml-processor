import { describe, expect, it } from 'vitest';
import {
  applyRevisionBatch,
  filterRenderableNotes,
  hyperlinkNavigation,
  parseTocSwitches,
  renderTocEntries,
  resolveCrossReference,
  resolvePageDecoration,
  sdtPolicy,
  tileArtBorder,
} from './features.js';

describe('phase 10 document features', () => {
  it('keeps external hyperlinks click-only and combines fragments', () => {
    expect(
      hyperlinkNavigation({
        relationshipTarget: 'https://example.test/a',
        anchor: 'part',
        tooltip: 'go',
      }),
    ).toEqual({
      href: 'https://example.test/a',
      external: true,
      fragment: 'part',
      tooltip: 'go',
      prefetch: false,
    });
  });
  it('resolves cross references and preserves visible broken-reference text', () => {
    expect(
      resolveCrossReference('REF heading', { bookmarks: new Map([['heading', 'Title']]) }),
    ).toBe('Title');
    expect(resolveCrossReference('REF missing')).toBe('Error! Reference source not found.');
  });
  it('parses TOC switches without regenerating the cached body', () => {
    const options = parseTocSwitches('TOC \\o "1-3" \\h \\n \\z');
    expect(options.outlineRange).toEqual([1, 3]);
    expect(options.hyperlinks).toBe(true);
    expect(options.noPageNumbers).toBe(true);
    expect(renderTocEntries([{ title: 'Heading', page: 4, bookmark: 'h' }], options)).toBe(
      '[Heading](#h)',
    );
  });
  it('filters structural footnote separators', () => {
    expect(
      filterRenderableNotes([
        { id: 0, type: 'separator', text: '-' },
        { id: 2, text: 'body' },
      ]),
    ).toEqual([{ id: 2, text: 'body' }]);
  });
  it('uses reverse edits for accept/reject batches', () => {
    expect(
      applyRevisionBatch(
        [
          { id: '1', kind: 'insert', text: 'new' },
          { id: '2', kind: 'delete', text: 'old' },
        ],
        'accept',
      ),
    ).toEqual([
      { kind: 'delete', id: '2', text: 'old' },
      { kind: 'unwrap', id: '1', text: 'new' },
    ]);
    expect(
      applyRevisionBatch(
        [{ id: 'p', kind: 'rPrChange', text: 'new', previousText: 'old' }],
        'reject',
      ),
    ).toEqual([{ kind: 'restore', id: 'p', text: 'old' }]);
  });
  it('honours SDT lock axes and data-binding read-only policy', () => {
    expect(sdtPolicy('contentLocked')).toEqual({ canDelete: true, canEditContent: false });
    expect(sdtPolicy(undefined, true).canEditContent).toBe(false);
  });
  it('tiles art borders by repeating natural-size tiles', () => {
    const tiles = tileArtBorder(25, 15, { src: 'tile', width: 10, height: 3 });
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.some((tile) => tile.width === 5)).toBe(true);
  });
  it('requires both displayBackgroundShape and print settings independently', () => {
    expect(resolvePageDecoration({ background: '#fff' })).toMatchObject({
      displayBackgroundShape: false,
      printBackground: false,
    });
  });
});
