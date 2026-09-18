# 0003 — Document model representation

**Status:** **ACCEPTED**
**Date opened:** 2026-09-16
**Date resolved:** 2026-09-18 (Ticket P3-00 Spike)

The plan called this "the decision hardest to reverse later — treat it as a Phase 0 spike, not a guess." This file states the problem, records the empirical spike measurements, and declares the architectural decision and downstream consequences.

## The problem

We need one representation that satisfies four requirements which pull against each other:

1. **Lossless round-trip.** Every element, attribute, unknown extension and whitespace nuance that arrived must be writable back in document order. This argues for keeping the parsed tree essentially as-is.
2. **Fast text editing.** Typing a character must not copy a megabyte. This argues for a piece table or gap buffer over text, not a tree of run nodes.
3. **Stable identity for range annotations.** Bookmarks, comment ranges, moves and permissions are _intervals that do not nest with the element tree_. A `w:bookmarkStart` can sit inside one paragraph and its `w:bookmarkEnd` inside a table cell three paragraphs later. Edits must not corrupt them. The caret anchors to the same identities.
4. **Cheap invalidation for incremental layout.** Layout must know precisely which paragraphs changed, without diffing the whole document.

## Candidates

**A. Piece table over a flat text buffer, formatting in an interval tree.**
Text lives in one immutable original buffer plus an append-only add buffer; runs, paragraph marks and annotations are intervals over it. Editing is O(log n) and allocation-light.
_Risk:_ OOXML content is not a flat character sequence. Tables, drawings, fields and SDTs are structural, not textual. Flattening them requires placeholder characters and a parallel structure map — which is where this design historically gets complicated, leaky, and loses unknown XML nodes and attributes.

**B. Immutable persistent tree (structural sharing).**
Every edit produces a new root sharing untouched subtrees. Undo is free (keep the old root), and invalidation is a cheap identity comparison.
_Risk:_ Memory churn on character-by-character typing; every path from root to the edited run is copied — deep nesting (table in table in SDT) makes that path long, leading to high GC sweep pressure.

**C. Mutable generated tree + interval store for annotations (hybrid).**
Keep the `@ooxml/schema` codegen AST as the authoritative structural model, mutate in place for localized text typing, and maintain a layered interval store for non-nesting ranges.
_Risk:_ Undo requires explicit inverse commands rather than free snapshot roots; mutation requires explicit dirty-flag propagation.

## Benchmark Results (Ticket P3-00 Spike)

Benchmark executed on a realistic synthetic document fixture containing 500 paragraphs, styled runs (plain, bold, italic), tables with multiple rows/cells, interleaved bookmark ranges, unknown vendor attributes (`$unknownAttrs`), and unknown raw extension blocks (`$unknown` raw nodes).

Tested operations:

- **10k Inserts:** 10,000 single-character insertions at mid-document position.
- **Peak RSS Delta:** Process memory delta before and after 10,000 insertions.
- **Serialize:** Wall-clock duration to serialize back to WordprocessingML XML.
- **Round-Trip Gate:** Verification that unknown attributes (`customMetaTag`), unknown raw elements (`customBlockExtension`), and table structures round-trip with zero loss.
- **LOC:** Clean implementation lines of code excluding comments/blanks.

| Candidate                                           | 10k Inserts (ms) | Peak RSS Delta (MB) | Serialize (ms) | Unknown Preservation | Round-Trip Gate | LOC | Verdict        |
| :-------------------------------------------------- | :--------------- | :------------------ | :------------- | :------------------- | :-------------- | :-- | :------------- |
| **Candidate A** (Piece table + intervals)           | 316.87 ms        | +13.6 MB            | 17.39 ms       | LOST (dropped)       | **FAILED**      | 273 | **ELIMINATED** |
| **Candidate B** (Immutable persistent tree)         | 110.75 ms        | +8.1 MB             | 2.38 ms        | LOST (dropped)       | **FAILED**      | 352 | **ELIMINATED** |
| **Candidate C** (Mutable generated AST + intervals) | **13.27 ms**     | **+1.0 MB**         | 24.38 ms       | **Lossless (100%)**  | **GATE PASS**   | 286 | **ADOPTED**    |

## Decision

**Adopt Candidate C (Mutable Generated AST + Layered Interval Store).**

Rationale against the predetermined decision criterion:

1. **Round-trip fidelity is a gate, not a score.** Candidate A was eliminated immediately: flattening WordprocessingML into character buffers discards unknown XML extensions (`$unknown`) and arbitrary unknown attributes (`$unknownAttrs`). Re-creating them requires maintaining a secondary DOM in parallel, doubling memory and introducing desynchronization bugs. Candidate B fails because persistent structural trees require custom wrappers over the schema AST that either duplicate generated models or compromise schema fidelity.
2. **Typing performance among survivors.** Candidate C achieves **13.27 ms for 10,000 single-character inserts** (~1.3 microseconds per keystroke) with a negligible RSS delta (+1.0 MB). Localized run in-place mutation avoids intermediate object allocation, avoiding GC sweeps entirely during continuous typing.
3. **Architectural coherence.** Candidate C uses the generated `@ooxml/schema` types (`CT_Document`, `CT_Body`, `CT_P`, `CT_R`, `CT_Text`) directly. It leverages the validated `wmlReader` and `wmlWriter` generated in Phase 1, eliminating hundreds of lines of fragile hand-written XML serialisation code.

## Consequences & Downstream Assumptions

By closing ADR 0003 in favor of Candidate C, the architecture guarantees the following invariants for subsequent tickets and phases:

- **P3-01 (Stable Node Identity):** Every addressable entity (paragraphs, runs, tables, rows, cells, range endpoints) holds a dense, opaque `NodeId` (`u32`). The `IdTable` allocates monotonically without recycling (no freelist), and bumps generation counters on retirement to catch use-after-free bugs.
- **P3-02 (Text Storage and Interval Store):** Position queries must speak in logical `DocPos { node: NodeId, offset: u32 }`. Flat integer offsets (`AbsPos`) are ephemeral algorithm-local caches, never persisted in bookmarks, undo logs, or carets. The interval store provides sub-linear shifts and endpoint gravity for zero-width boundaries.
- **P3-03 (Range Annotations):** Range annotations (bookmarks, comment ranges, moves, permissions) are stored in the layered interval store keyed by `(kind, w:id)`. They do not constrain tree hierarchy, but serialize back into exact source document positions preserving `sourceOrder` on coincident boundaries.
- **P5-16 (Incremental Layout Invalidation):** Incremental relayout does not require whole-document AST diffing. Mutating a paragraph marks its `NodeId` dirty in the layout engine.
- **P6-01 (Caret Navigation & Selection):** Carets anchor to `(NodeId, offset)` logical positions. Typing inside a run does not invalidate carets or selections elsewhere in the document.
- **P6-11 (Command-Based Undo/Redo):** Because the document model is mutable, undo is implemented via command-pair inversion (`InsertTextCommand` inverted by `DeleteRangeCommand`) rather than whole-document immutable snapshot trees, keeping memory footprint low even during hours of active editing.
