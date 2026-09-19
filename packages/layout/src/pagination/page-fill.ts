export interface PageState {
  readonly blockIndex: number;
  readonly intraBlock: number;
  readonly columnIndex: number;
  readonly pendingFloats: readonly string[];
  readonly footnoteCarry: readonly string[];
  readonly keepBacklog: readonly string[];
  readonly pageNumber: number;
  readonly sectionIndex: number;
}

export interface BlockFragment {
  readonly blockIndex: number;
  readonly height: number;
  readonly nextIntraBlock?: number | undefined;
  readonly complete: boolean;
  readonly footnoteIds?: readonly string[] | undefined;
  readonly keepNext?: boolean | undefined;
  readonly keepLines?: boolean | undefined;
  readonly pageBreakBefore?: boolean | undefined;
  readonly widowControl?: boolean | undefined;
}

export interface PageContent {
  readonly fragments: readonly BlockFragment[];
  readonly height: number;
  readonly forced: boolean;
  readonly diagnostics: readonly string[];
}

export interface PageFillOptions {
  readonly availableHeight: number;
  readonly blocks: readonly unknown[];
  readonly fragment: (
    block: unknown,
    index: number,
    availableHeight: number,
    intraBlock: number,
  ) => BlockFragment | undefined;
  readonly reservedFootnoteHeight?: number;
  readonly applyKeeps?: boolean;
}

function copyState(state: PageState, patch: Partial<PageState>): PageState {
  return {
    ...state,
    ...patch,
    pendingFloats: [...(patch.pendingFloats ?? state.pendingFloats)],
    footnoteCarry: [...(patch.footnoteCarry ?? state.footnoteCarry)],
    keepBacklog: [...(patch.keepBacklog ?? state.keepBacklog)],
  };
}

/** Pure page fold. A non-fitting first block is forced to guarantee progress. */
export function fillPage(
  start: PageState,
  options: PageFillOptions,
): { readonly content: PageContent; readonly endState: PageState } {
  const limit = Math.max(0, options.availableHeight - (options.reservedFootnoteHeight ?? 0));
  const fragments: BlockFragment[] = [];
  const diagnostics: string[] = [];
  let height = 0;
  let index = start.blockIndex;
  let intra = start.intraBlock;
  let forced = false;
  while (index < options.blocks.length) {
    const candidate = options.fragment(
      options.blocks[index],
      index,
      Math.max(0, limit - height),
      intra,
    );
    if (!candidate) break;
    const pageBreakBefore = candidate.pageBreakBefore === true && fragments.length > 0;
    if (pageBreakBefore || (height + candidate.height > limit && fragments.length > 0)) break;
    if (height + candidate.height > limit && fragments.length === 0) {
      forced = true;
      diagnostics.push('block-forced-to-page');
    }
    fragments.push(candidate);
    height += candidate.height;
    if (candidate.complete) {
      index += 1;
      intra = 0;
    } else {
      intra = candidate.nextIntraBlock ?? intra + 1;
      break;
    }
    if (forced) break;
  }
  if (options.applyKeeps !== false) {
    const kept = applyKeepConstraints(fragments, options.availableHeight);
    fragments.splice(0, fragments.length, ...kept.fragments);
    height = fragments.reduce((sum, fragment) => sum + fragment.height, 0);
    diagnostics.push(...kept.diagnostics);
    index =
      fragments.length > 0
        ? fragments[fragments.length - 1]!.blockIndex +
          (fragments[fragments.length - 1]!.complete ? 1 : 0)
        : start.blockIndex;
  }
  const footnoteIds = fragments.flatMap((item) => item.footnoteIds ?? []);
  const endState = copyState(start, {
    blockIndex: index,
    intraBlock:
      fragments.length > 0 && !fragments[fragments.length - 1]!.complete
        ? (fragments[fragments.length - 1]!.nextIntraBlock ?? intra)
        : 0,
    footnoteCarry: [...start.footnoteCarry, ...footnoteIds],
  });
  return { content: { fragments, height, forced, diagnostics }, endState };
}

export function applyKeepConstraints(
  fragments: readonly BlockFragment[],
  _pageHeight: number,
): { readonly fragments: readonly BlockFragment[]; readonly diagnostics: readonly string[] } {
  const out = [...fragments];
  const diagnostics: string[] = [];
  // The final placed block cannot satisfy keepNext when its successor did not
  // fit. Backtrack the chain from the end, but always leave one block so a
  // pathological keepNext chain cannot produce an empty page.
  while (out.length > 1 && out[out.length - 1]!.keepNext === true) {
    out.pop();
  }
  if (out.length < fragments.length) diagnostics.push('keep-next-backtracked');
  if (out.length === 0 && fragments.length > 0) {
    out.push(fragments[0]!);
    diagnostics.push('keep-constraint-broken');
  }
  const last = out[out.length - 1];
  if (last?.keepLines === true && !last.complete) {
    out.pop();
    if (out.length === 0) {
      out.push(last);
      diagnostics.push('keep-constraint-broken');
    }
  }
  return { fragments: out, diagnostics };
}
