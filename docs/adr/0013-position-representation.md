# ADR 0013: Position Representation

**Status:** Accepted  
**Date:** 2026-09-18  
**Deciders:** Architecture review (P6-01)

## Context

The editor needs a canonical vocabulary for "where in the document" that:
- Survives edits elsewhere in the document (selections, bookmarks, undo records)
- Can address positions inside empty paragraphs distinct from neighbours
- Expresses affinity at soft-wrap and bidi direction boundaries
- Is compatible with a future collaborative editing layer (rebasable commands)

Four representations were evaluated.

## Options Considered

### 1. Flat integer offset into concatenated text (REJECTED)

A single number representing position in a flattened text buffer.

**Why rejected:**
- Renumbers on every edit. Inserting a character at offset 10 invalidates every stored position ≥ 10.
- Corrupts range annotations (bookmarks, comment ranges) silently — the positions drift without notification.
- Cannot address a position inside an empty paragraph: two adjacent empty paragraphs have the same flat offset.
- Cannot be rebased against concurrent edits (no structural anchoring).

### 2. XPath-style path string, e.g. `/body/p[3]/r[2]:offset(5)` (REJECTED)

**Why rejected:**
- String allocation on every caret move, selection extension, and frame during drag-select.
- `p[3]` renumbers when a paragraph is inserted before it — same instability as flat offsets, just slower.
- Parsing overhead for every position comparison.

### 3. Persistent balanced tree zipper (REJECTED)

A functional data structure where position is a path through an immutable tree.

**Why rejected:**
- Significant implementation complexity (persistent red-black tree or finger tree).
- Memory overhead: each position is a path object, not a pair of numbers.
- Disproportionate to v1 single-user constraints — this pays for itself only in a CRDT/OT system.
- We can adopt this later if the collaborative layer requires it; the `DocPos` interface is narrow enough to swap the backing store.

### 4. `{ node: NodeId, offset: number }` (CHOSEN)

Position is a pair: which node, and where within it.

**Why chosen:**
- `NodeId` is stable across edits (P3-01): monotonic allocation, no recycling, no renumbering.
- Edits in other nodes do not affect this position at all.
- An empty paragraph has a valid position `{ node: paraId, offset: 0 }` distinct from its neighbours.
- Commands addressing positions by `NodeId` can be rebased against concurrent edits in a future OT/CRDT layer, because the address is structural, not ordinal.
- Two numbers (a 32-bit ID and an offset) — minimal allocation, trivial equality check.

**Limitation:** An edit that deletes the node itself invalidates the position. This is detectable via `IdTable.isLive(id)` and is the only case that requires explicit handling.

## Decision

Use `DocPos = { node: NodeId, offset: number }` from `@ooxml/wml` as the single document-side coordinate. Pair it with `Affinity` (`'upstream' | 'downstream'`) to resolve the ambiguity at soft-wrap and bidi boundaries. Store the pair as `Caret = { pos: DocPos, affinity: Affinity, preferredX: number | null }`.

`LayoutPos` (the screen-side coordinate) is derived from `Caret` on demand and NEVER stored across a frame boundary or async turn.

## Consequences

- Selections, bookmarks, undo records, and commands all use `DocPos`. They survive arbitrary edits to other parts of the document.
- Hit-testing and caret rendering derive `LayoutPos` transiently and discard it.
- The `Affinity` type must be threaded through every function that converts between coordinate systems. This is intentional — hiding it leads to the "caret on the wrong line" bug that every editor that discovers affinity late has to fix across forty functions.
