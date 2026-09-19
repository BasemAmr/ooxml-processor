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

export interface HyperlinkNavigation {
  readonly href: string;
  readonly external: boolean;
  readonly fragment?: string;
  readonly tooltip?: string;
  readonly prefetch: false;
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

/** Resolves a click target without fetching external relationships (SSRF boundary). */
export function hyperlinkNavigation(input: {
  readonly relationshipTarget?: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}): HyperlinkNavigation | undefined {
  const target = resolveHyperlink(input);
  if (!target) return undefined;
  return {
    href: target.href,
    external: target.kind === 'external',
    ...(target.fragment === undefined ? {} : { fragment: target.fragment }),
    ...(target.tooltip === undefined ? {} : { tooltip: target.tooltip }),
    prefetch: false,
  };
}

export function bookmarkHref(
  name: string,
  bookmarks: readonly BookmarkRange[],
): string | undefined {
  return resolveBookmark(name, bookmarks) ? `#${name}` : undefined;
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
  readonly kind:
    | 'insert'
    | 'delete'
    | 'moveFrom'
    | 'moveTo'
    | 'rPrChange'
    | 'pPrChange'
    | 'tblPrChange'
    | 'trPrChange'
    | 'tcPrChange'
    | 'sectPrChange'
    | 'tblGridChange'
    | 'numberingChange'
    | 'paragraphMarkInsert'
    | 'paragraphMarkDelete';
  readonly text: string;
  /** Previous property value carried by *Change records. */
  readonly previousText?: string;
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
          ? r.kind !== 'delete' && r.kind !== 'moveFrom' && r.kind !== 'paragraphMarkDelete'
          : r.kind !== 'insert' && r.kind !== 'moveTo' && r.kind !== 'paragraphMarkInsert'),
    )
    .map((r) => r.text)
    .join('');
}
export function applyRevisions(revisions: readonly RevisionLike[], accept: boolean): string {
  return displayRevisions(revisions, accept ? 'final' : 'original');
}

export type RevisionDecision = 'accept' | 'reject';
export type RevisionEdit =
  | { readonly kind: 'unwrap'; readonly id: string; readonly text: string }
  | { readonly kind: 'delete'; readonly id: string; readonly text: string }
  | { readonly kind: 'restore'; readonly id: string; readonly text: string };

/** Produces command-log friendly edits; callers apply them in reverse document order. */
export function revisionEdits(
  revision: RevisionLike,
  decision: RevisionDecision,
): readonly RevisionEdit[] {
  if (revision.kind.endsWith('Change')) {
    if (decision === 'reject' && revision.previousText !== undefined)
      return [{ kind: 'restore', id: revision.id, text: revision.previousText }];
    return [{ kind: 'unwrap', id: revision.id, text: revision.text }];
  }
  if (revision.kind === 'paragraphMarkDelete') {
    return decision === 'accept'
      ? [{ kind: 'delete', id: revision.id, text: revision.text }]
      : [{ kind: 'restore', id: revision.id, text: revision.text }];
  }
  if (revision.kind === 'paragraphMarkInsert') {
    return decision === 'accept'
      ? [{ kind: 'unwrap', id: revision.id, text: revision.text }]
      : [{ kind: 'delete', id: revision.id, text: revision.text }];
  }
  const keepOnAccept = revision.kind === 'insert' || revision.kind === 'moveTo';
  const keepOnReject = revision.kind === 'delete' || revision.kind === 'moveFrom';
  const keep = decision === 'accept' ? keepOnAccept : keepOnReject;
  if (keep)
    return [
      { kind: decision === 'reject' ? 'restore' : 'unwrap', id: revision.id, text: revision.text },
    ];
  return [{ kind: 'delete', id: revision.id, text: revision.text }];
}

export function applyRevisionBatch(
  revisions: readonly RevisionLike[],
  decision: RevisionDecision,
): readonly RevisionEdit[] {
  return [...revisions].reverse().flatMap((revision) => revisionEdits(revision, decision));
}

export interface CrossReferenceContext {
  readonly bookmarks?: ReadonlyMap<string, string>;
  readonly pages?: ReadonlyMap<string, number>;
  readonly notes?: ReadonlyMap<string, number>;
  readonly styles?: ReadonlyMap<string, string>;
  readonly sequence?: ReadonlyMap<string, number>;
}

/** Resolves REF/PAGEREF/NOTEREF/STYLEREF/SEQ with Word's visible broken-reference text. */
export function resolveCrossReference(
  instruction: string,
  context: CrossReferenceContext = {},
): string {
  const tokens = instruction.trim().split(/\s+/);
  const name = (tokens.shift() ?? '').toUpperCase();
  const key = tokens.find((token) => !token.startsWith('\\')) ?? '';
  let result: string | undefined;
  switch (name) {
    case 'REF':
      result = context.bookmarks?.get(key);
      break;
    case 'PAGEREF':
      result = context.pages?.get(key)?.toString();
      break;
    case 'NOTEREF':
      result = context.notes?.get(key)?.toString();
      break;
    case 'STYLEREF':
      result = context.styles?.get(key);
      break;
    case 'SEQ':
      result = String((context.sequence?.get(key) ?? 0) + 1);
      break;
    default:
      result = undefined;
  }
  return result ?? 'Error! Reference source not found.';
}

export interface TocOptions {
  readonly outlineRange?: readonly [number, number];
  readonly styles?: ReadonlySet<string>;
  readonly hyperlinks?: boolean;
  readonly noPageNumbers?: boolean;
  readonly hideTabLeader?: boolean;
}

export function parseTocSwitches(instruction: string): TocOptions {
  const outline = /\\o\s+"(\d+)\s*-\s*(\d+)"/i.exec(instruction);
  const styles = /\\t\s+"([^"]+)"/i
    .exec(instruction)?.[1]
    ?.split(';')
    .map((v) => v.split(',')[0]?.trim())
    .filter((v): v is string => Boolean(v));
  return {
    ...(outline ? { outlineRange: [Number(outline[1]), Number(outline[2])] as const } : {}),
    ...(styles ? { styles: new Set(styles) } : {}),
    hyperlinks: /\\h\b/i.test(instruction),
    noPageNumbers: /\\n\b/i.test(instruction),
    hideTabLeader: /\\z\b/i.test(instruction),
  };
}

export interface TocEntry {
  readonly title: string;
  readonly page?: number;
  readonly bookmark?: string;
}
export function renderTocEntries(entries: readonly TocEntry[], options: TocOptions = {}): string {
  return entries
    .map((entry) => {
      const title =
        options.hyperlinks && entry.bookmark ? `[${entry.title}](#${entry.bookmark})` : entry.title;
      if (options.noPageNumbers || entry.page === undefined) return title;
      return `${title}${options.hideTabLeader ? ' ' : ' … '}${entry.page}`;
    })
    .join('\n');
}

export type NoteKind = 'normal' | 'separator' | 'continuationSeparator' | 'continuationNotice';
export interface NoteContent {
  readonly id: number;
  readonly type?: NoteKind;
  readonly text: string;
}
export function filterRenderableNotes(notes: readonly NoteContent[]): readonly NoteContent[] {
  return notes.filter((note) => (note.type ?? 'normal') === 'normal');
}
export function noteNumber(
  id: number,
  orderedIds: readonly number[],
  mode: 'continuous' | 'eachSect' | 'eachPage' = 'continuous',
  boundary = 0,
): number {
  if (mode === 'continuous') return Math.max(1, orderedIds.indexOf(id) + 1);
  const index = orderedIds.indexOf(id);
  return Math.max(1, index - (boundary <= index ? boundary : 0) + 1);
}
export function renderFootnoteReference(input: {
  readonly id: number;
  readonly customMarkFollows?: boolean;
  readonly customMark?: string;
  readonly orderedIds: readonly number[];
  readonly restart?: 'continuous' | 'eachSect' | 'eachPage';
  readonly boundary?: number;
}): string {
  if (input.customMarkFollows) return input.customMark ?? '';
  return String(noteNumber(input.id, input.orderedIds, input.restart, input.boundary));
}

export interface CommentContent {
  readonly id: number;
  readonly author?: string;
  readonly initials?: string;
  readonly text: string;
}
export function resolveComment(
  id: number,
  comments: readonly CommentContent[],
): CommentContent | undefined {
  return comments.find((comment) => comment.id === id);
}

export type SdtLock = 'sdtLocked' | 'contentLocked' | 'sdtContentLocked' | 'unlocked';
export interface SdtPolicy {
  readonly canDelete: boolean;
  readonly canEditContent: boolean;
  readonly readOnlyReason?: string;
}
export function sdtPolicy(lock: SdtLock | undefined, dataBound = false): SdtPolicy {
  if (dataBound)
    return {
      canDelete: false,
      canEditContent: false,
      readOnlyReason: 'dataBinding is read-only until custom XML synchronization is implemented',
    };
  switch (lock) {
    case 'sdtLocked':
      return { canDelete: false, canEditContent: true };
    case 'contentLocked':
      return { canDelete: true, canEditContent: false };
    case 'sdtContentLocked':
      return { canDelete: false, canEditContent: false };
    default:
      return { canDelete: true, canEditContent: true };
  }
}

export interface ArtBorderTile {
  readonly src: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface ArtBorderTiles {
  readonly top: ArtBorderTile;
  readonly bottom: ArtBorderTile;
  readonly left: ArtBorderTile;
  readonly right: ArtBorderTile;
  readonly topLeft: ArtBorderTile;
  readonly topRight: ArtBorderTile;
  readonly bottomLeft: ArtBorderTile;
  readonly bottomRight: ArtBorderTile;
}
/** Places corners exactly once and repeats edge tiles at natural size. */
export function tileArtBorderPieces(
  width: number,
  height: number,
  tiles: {
    readonly top: { readonly src: string; readonly width: number; readonly height: number };
    readonly bottom: { readonly src: string; readonly width: number; readonly height: number };
    readonly left: { readonly src: string; readonly width: number; readonly height: number };
    readonly right: { readonly src: string; readonly width: number; readonly height: number };
    readonly topLeft: { readonly src: string; readonly width: number; readonly height: number };
    readonly topRight: { readonly src: string; readonly width: number; readonly height: number };
    readonly bottomLeft: { readonly src: string; readonly width: number; readonly height: number };
    readonly bottomRight: { readonly src: string; readonly width: number; readonly height: number };
  },
): readonly ArtBorderTile[] {
  const out: ArtBorderTile[] = [];
  const put = (
    src: { readonly src: string; readonly width: number; readonly height: number },
    x: number,
    y: number,
  ) => out.push({ src: src.src, x, y, width: src.width, height: src.height });
  put(tiles.topLeft, 0, 0);
  put(tiles.topRight, Math.max(0, width - tiles.topRight.width), 0);
  put(tiles.bottomLeft, 0, Math.max(0, height - tiles.bottomLeft.height));
  put(
    tiles.bottomRight,
    Math.max(0, width - tiles.bottomRight.width),
    Math.max(0, height - tiles.bottomRight.height),
  );
  for (let x = tiles.topLeft.width; x < width - tiles.topRight.width; x += tiles.top.width) {
    put(tiles.top, x, 0);
    put(tiles.bottom, x, Math.max(0, height - tiles.bottom.height));
  }
  for (let y = tiles.topLeft.height; y < height - tiles.bottomLeft.height; y += tiles.left.height) {
    put(tiles.left, 0, y);
    put(tiles.right, Math.max(0, width - tiles.right.width), y);
  }
  return out;
}
export function tileArtBorder(
  width: number,
  height: number,
  tile: { readonly width: number; readonly height: number; readonly src: string },
): readonly ArtBorderTile[] {
  const out: ArtBorderTile[] = [];
  for (let x = 0; x < width; x += tile.width)
    out.push({
      src: tile.src,
      x,
      y: 0,
      width: Math.min(tile.width, width - x),
      height: tile.height,
    });
  for (let x = 0; x < width; x += tile.width)
    out.push({
      src: tile.src,
      x,
      y: Math.max(0, height - tile.height),
      width: Math.min(tile.width, width - x),
      height: tile.height,
    });
  for (let y = tile.height; y < height - tile.height; y += tile.height) {
    out.push({
      src: tile.src,
      x: 0,
      y,
      width: tile.width,
      height: Math.min(tile.height, height - tile.height - y),
    });
    out.push({
      src: tile.src,
      x: Math.max(0, width - tile.width),
      y,
      width: tile.width,
      height: Math.min(tile.height, height - tile.height - y),
    });
  }
  return out;
}

export interface PageDecoration {
  readonly background?: string;
  readonly displayBackgroundShape: boolean;
  readonly printBackground: boolean;
  readonly watermarkBehindText: boolean;
}
export function resolvePageDecoration(input: {
  readonly background?: string;
  readonly displayBackgroundShape?: boolean;
  readonly printBackground?: boolean;
  readonly watermarkBehindText?: boolean;
}): PageDecoration {
  return {
    ...(input.background === undefined ? {} : { background: input.background }),
    displayBackgroundShape: input.displayBackgroundShape === true,
    printBackground: input.printBackground === true,
    watermarkBehindText: input.watermarkBehindText !== false,
  };
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
