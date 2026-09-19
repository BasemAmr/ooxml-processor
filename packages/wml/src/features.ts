/** Small, dependency-free helpers for Phase 10 document features. */
export interface BookmarkRange {
  readonly name: string;
  readonly start: number;
  readonly end?: number;
}
export interface HyperlinkTarget {
  readonly kind: 'internal' | 'external';
  readonly href: string;
  readonly fragment?: string;
  readonly tooltip?: string;
}
export function resolveHyperlink(input: {
  readonly relationshipTarget?: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}): HyperlinkTarget | undefined {
  if (input.relationshipTarget !== undefined) {
    const result: { kind: 'external'; href: string; fragment?: string; tooltip?: string } = {
      kind: 'external',
      href: input.relationshipTarget,
    };
    if (input.anchor !== undefined) result.fragment = input.anchor;
    if (input.tooltip !== undefined) result.tooltip = input.tooltip;
    return result;
  }
  if (input.anchor !== undefined) {
    const result: { kind: 'internal'; href: string; tooltip?: string } = {
      kind: 'internal',
      href: `#${input.anchor}`,
    };
    if (input.tooltip !== undefined) result.tooltip = input.tooltip;
    return result;
  }
  return undefined;
}
export function resolveBookmark(
  name: string,
  bookmarks: readonly BookmarkRange[],
): BookmarkRange | undefined {
  return bookmarks.find((b) => b.name === name);
}
export interface RevisionLike {
  readonly id: string;
  readonly author?: string;
  readonly kind: 'insert' | 'delete' | 'moveFrom' | 'moveTo';
  readonly text: string;
}
export function displayRevisions(
  revisions: readonly RevisionLike[],
  mode: 'original' | 'final' | 'all' = 'final',
): string {
  return revisions
    .filter(
      (r) =>
        mode === 'all' ||
        (mode === 'final'
          ? r.kind !== 'delete' && r.kind !== 'moveFrom'
          : r.kind !== 'insert' && r.kind !== 'moveTo'),
    )
    .map((r) => r.text)
    .join('');
}
export function applyRevisions(revisions: readonly RevisionLike[], accept: boolean): string {
  return displayRevisions(revisions, accept ? 'final' : 'original');
}
export interface ContentControlLike {
  readonly kind: string;
  readonly tag?: string;
  readonly alias?: string;
  readonly placeholder?: string;
  readonly content?: string;
}
export function contentControlText(control: ContentControlLike): string {
  return control.content ?? control.placeholder ?? '';
}
export function isUnsupportedContentControlKind(kind: string): boolean {
  return !new Set([
    'equation',
    'comboBox',
    'date',
    'docPartObj',
    'docPartList',
    'dropDownList',
    'picture',
    'richText',
    'text',
    'citation',
    'group',
    'bibliography',
  ]).has(kind);
}
