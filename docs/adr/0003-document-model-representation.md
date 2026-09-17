# 0003 — Document model representation

**Status:** **OPEN — spike required before Phase 3**
**Date opened:** 2026-09-16

The plan calls this "the decision hardest to reverse later — treat it as a Phase 0 spike, not
a guess." This file states the problem and the spike that resolves it. It deliberately does
**not** record a decision yet.

## The problem

We need one representation that satisfies four requirements which pull against each other:

1. **Lossless round-trip.** Every element, attribute, unknown extension and whitespace
   nuance that arrived must be writable back in document order. This argues for keeping the
   parsed tree essentially as-is.
2. **Fast text editing.** Typing a character must not copy a megabyte. This argues for a
   piece table or gap buffer over text, not a tree of run nodes.
3. **Stable identity for range annotations.** Bookmarks, comment ranges, moves and
   permissions are _intervals that do not nest with the element tree_. A `w:bookmarkStart`
   can sit inside one paragraph and its `w:bookmarkEnd` inside a table cell three paragraphs
   later. Edits must not corrupt them. The caret anchors to the same identities.
4. **Cheap invalidation for incremental layout.** Layout must know precisely which paragraphs
   changed, without diffing the whole document.

## Candidates

**A. Piece table over a flat text buffer, formatting in an interval tree.**
Text lives in one immutable original buffer plus an append-only add buffer; runs, paragraph
marks and annotations are intervals over it. Editing is O(log n) and allocation-light.
_Risk:_ OOXML content is not a flat character sequence. Tables, drawings, fields and SDTs are
structural, not textual. Flattening them requires placeholder characters and a parallel
structure map — which is where this design historically gets complicated and leaky.

**B. Immutable persistent tree (structural sharing).**
Every edit produces a new root sharing untouched subtrees. Undo is free (keep the old root),
and invalidation is a cheap identity comparison. _Risk:_ memory churn on character-by-character
typing, and every path from root to the edited run is copied — deep nesting (table in table in
SDT) makes that path long.

**C. Mutable generated tree + interval tree for annotations.** _(plan's leaning)_
Keep the codegen output as the model, mutate in place, layer intervals for ranges.
_Risk:_ undo requires explicit inverse commands (which we want anyway — see Phase 6), and
mutation makes "what changed?" harder to answer than identity comparison does.

## The spike

`packages/wml/spike/` — not shipped, deleted or promoted once decided.

Implement the **same three operations** against all three candidates:

1. Insert one character mid-paragraph in a 500-paragraph document.
2. Apply bold to a selection spanning 3 paragraphs and a table cell boundary.
3. Insert a paragraph inside a bookmark range, then delete it, and assert the bookmark still
   spans what it spanned.

Measure: p95 operation time, allocation per keystroke, and — weighted most heavily —
**lines of code required for operation 3**, because range-annotation correctness under
editing is where all three designs actually differ, and it is the one that silently corrupts
documents when wrong.

## Gate

This spike blocks Phase 3. Phases 1 and 2 (codegen, OPC) are unaffected: they produce and
consume the parsed tree without depending on how it is mutated. Work proceeds there first,
which also means the spike runs against a _real_ generated tree rather than a sketch.
