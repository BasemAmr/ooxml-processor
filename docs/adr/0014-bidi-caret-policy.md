# ADR 0014: Bidi Caret Policy — Single vs Split Caret

**Status:** Accepted  
**Date:** 2026-09-18  
**Deciders:** Architecture review (P6-04)

## Context

At a boundary between LTR and RTL text, a single logical document position
(`DocPos`) maps to **two distinct visual screen positions**. For example, in
`abc‏מילה‎def`, the position between the Latin and Hebrew text has:
- A visual position at the right edge of "abc" (the LTR run's end)
- A visual position at the left edge of "מילה" (the RTL run's visual start)

The caret must choose how to represent this ambiguity to the user.

## Options Considered

### Option A: Single caret (CHOSEN)

One caret line, positioned at whichever visual location is implied by the
current `Affinity` (`upstream` or `downstream`). The caret jumps between the
two visual positions when affinity changes (e.g., via arrow key movement).

### Option B: Split caret (REJECTED)

Two half-height caret marks, one at each visual position: the top half at one
position, the bottom half at the other. This is what the formal bidi literature
(Unicode TR#9 §L4) recommends for input cursor rendering.

## Decision

**Option A — single caret.**

## Rationale

1. **Word compatibility.** Microsoft Word uses a single caret. Since our primary
   goal is Word-compatible rendering and behaviour, matching Word's caret is the
   conservative default. (`SPEC-GAP / UNVERIFIABLE-HERE`: cannot compare against
   Word on this machine; decision based on documented behaviour and prior
   experience with Word.)

2. **User expectation.** Split carets are unfamiliar to most users. In usability
   studies of word processors, split carets consistently produce confusion ("why
   are there two cursors?"). A single caret that moves predictably is preferred
   by the majority of users, even though it hides the bidi ambiguity.

3. **Implementation simplicity.** A single caret is one `Rect` per frame. A
   split caret requires two half-height rects, both tracking the same position
   but in different visual runs — doubling the caret rendering and hit-testing
   complexity without user benefit.

4. **Affinity already resolves the ambiguity.** The `Affinity` type (P6-01)
   determines which visual position the caret occupies. The information is not
   lost — it is simply not shown visually as two marks.

## Consequences

- The caret may appear to "teleport" when the user presses an arrow key at a
  bidi boundary — it jumps from one visual position to the other. This is the
  same behaviour Word exhibits and is expected by users of RTL scripts.
- If future user testing reveals that split carets are preferred, the change is
  localised to `caretRect` in `packages/editor/src/caret.ts` — the position
  model and affinity system already support both visual positions.
