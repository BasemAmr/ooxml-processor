# Phase 6 — Editing core

> **Difficulty rank 1 of 11.** The v1 heartbeat.
>
> **Depends on** Phases 1–5 complete. Reads the line box defined in `P5-01`; mutates the model defined
> in `P3-*`. **Nothing in the repo may depend on `packages/editor`.**
>
> **Exit demo.** Open a `.docx`, click to place the caret mid-paragraph, type Latin text and CJK via
> IME, select across a paragraph boundary and a table cell boundary, undo and redo several times, save,
> reopen. `UNVERIFIABLE-HERE`: the final "reopen in Word without a repair prompt" gate cannot run on
> this machine (ADR 0007). Ship it marked unverified.

## Why this phase is the hardest

Four independently hard problems that must all agree with each other:

1. **Canvas has no text input.** Every keystroke, dead key, IME composition and Android soft-keyboard
   event has to be captured through a hidden DOM element that is never visible and never allowed to
   scroll the page.
2. **Canvas has no accessibility tree.** A parallel ARIA/DOM mirror is mandatory, not a nicety. A
   canvas editor without one is unusable by a screen reader and legally unshippable in most contexts.
3. **Bidi breaks the assumption that a text offset has one screen position.** At a soft wrap and at a
   direction boundary, one document offset has _two_ valid caret positions. Affinity is not an
   optimisation — without it, clicking at the end of a wrapped line puts the caret on the wrong line.
4. **Real-time means incremental.** A full relayout on every keystroke is 200ms on a 100-page document.
   The budget is 16ms at p95, keystroke to pixel.

Each of the four has a well-known correct answer. The difficulty is that they are coupled: affinity
affects hit-testing affects selection geometry affects what the relayout must repaint.

---

## Ticket index

| ID    | Title                                                        | Size | Escalate |
| ----- | ------------------------------------------------------------ | ---- | -------- |
| P6-01 | Position model: `DocPos`, `LayoutPos`, affinity              | L    | **yes**  |
| P6-02 | Position mapping: document ⇄ layout, both directions         | L    | yes      |
| P6-03 | Hit-testing: screen point → caret                            | M    | no       |
| P6-04 | Caret geometry and rendering, including bidi                 | M    | no       |
| P6-05 | Selection model                                              | M    | no       |
| P6-06 | Selection geometry: range → paint rectangles                 | M    | no       |
| P6-07 | Keyboard navigation: logical vs visual, word, line, document | L    | no       |
| P6-08 | Input proxy: the hidden DOM element                          | M    | no       |
| P6-09 | IME composition lifecycle                                    | L    | no       |
| P6-10 | Command model: command + inverse                             | L    | **yes**  |
| P6-11 | Undo/redo stack, coalescing, selection restore               | M    | no       |
| P6-12 | Mutation API — the only way the model changes                | M    | no       |
| P6-13 | Incremental relayout driver                                  | XL   | **yes**  |
| P6-14 | Repaint scheduling and dirty rects                           | M    | no       |
| P6-15 | Clipboard: copy, cut, paste                                  | L    | no       |
| P6-16 | Accessibility mirror                                         | L    | no       |
| P6-17 | Latency instrumentation                                      | S    | no       |

---

### P6-01 — Position model: `DocPos`, `LayoutPos`, affinity

**Size** L · **Depends** P3-01 (node identity), P5-01 (line box) · **Escalate** **yes** · **Owns** `packages/editor/src/position/`

**Goal.** One canonical vocabulary for "where in the document" and "where on the screen", with the
ambiguity between them made explicit rather than accidental.

**Trap.** Modelling a position as a single integer offset into a flattened text buffer. It reads
cleanly and it is wrong three ways: it cannot address a position inside an empty paragraph distinct
from its neighbours, it renumbers on every edit (so a stored selection or a bookmark silently drifts),
and it cannot express affinity. The second failure is the expensive one, because it corrupts range
annotations — see `A1`.

The other half of the trap: believing one document offset maps to one screen position. It does not,
at a soft wrap and at a bidi boundary. Implementations that discover this late bolt affinity on as a
boolean parameter threaded through forty functions.

**Design.**

```pseudo
# --- document side -------------------------------------------------------
NodeId  = opaque, stable across edits          # from P3-01, NOT an array index
DocPos  = { node: NodeId, offset: int }        # offset = UTF-16 code-unit index within node text
                                               # for a container node, offset = child index

# --- layout side ---------------------------------------------------------
LayoutPos = { page: int, lineRef: LineRef, cluster: int, leadingEdge: bool }
            # cluster indexes the line's VISUAL cluster array (P5-01), not logical order
            # leadingEdge distinguishes the two sides of one cluster

Affinity = UPSTREAM | DOWNSTREAM
           # UPSTREAM   = belongs to the text before it  -> end of line N
           # DOWNSTREAM = belongs to the text after it   -> start of line N+1
           # Only meaningful at a soft-wrap boundary or a bidi direction boundary.
           # Everywhere else both values map to the same LayoutPos.

Caret = {
    pos:        DocPos,
    affinity:   Affinity,
    preferredX: float | NONE     # "goal column" for vertical movement; see P6-07
}
```

**Affinity rules — the whole of it.**

```pseudo
# At a soft wrap, offset k is both "after the last cluster of line N"
# and "before the first cluster of line N+1".
    UPSTREAM   -> line N,   trailing edge of last cluster
    DOWNSTREAM -> line N+1, leading  edge of first cluster

# At a hard break (paragraph end, explicit <w:br/>) there is no ambiguity:
# the two offsets are genuinely different positions. Affinity is ignored.

# At an LTR|RTL direction boundary, offset k sits at the visual edge of the
# LTR run AND at the visual edge of the RTL run. Affinity selects which.

# Default when a caret is created without one: DOWNSTREAM.
# Rationale: typing at a fresh position should extend forward. Matches the
# behaviour of every mainstream editor and is the answer users cannot see.
```

**Invariants the rest of the phase relies on.**

- `DocPos` survives edits elsewhere in the document. Only an edit that deletes the node itself
  invalidates it, and that must be detectable (`isValid(pos)`), not silently wrong.
- `LayoutPos` is invalidated by _any_ relayout that touches its page. It is never stored across a
  frame boundary — it is derived, used, discarded.
- Selection and range annotations store `DocPos`. Never `LayoutPos`.

**Done when.** The types exist with doc comments stating the affinity rules verbatim; a unit test
constructs the soft-wrap case and asserts the two affinities produce different `LayoutPos`; an ADR
records the choice of `{node, offset}` over a flat integer with the three rejected alternatives.

---

### P6-02 — Position mapping: document ⇄ layout, both directions

**Size** L · **Depends** P6-01 · **Escalate** yes · **Owns** `packages/editor/src/position/map.ts`

**Goal.** `toLayout(Caret) -> LayoutPos` and `toDocument(LayoutPos) -> Caret`, exact inverses where
the mapping is unambiguous.

**Trap.** Building this as a linear scan over lines. It is called on every caret move, every selection
extension, every frame during a drag-select, and per selection rectangle. On a 500-page document a
linear scan is the frame budget. It needs an index.

Second trap: assuming the mapping is total. A `DocPos` inside a paragraph that has not been laid out
yet (page virtualization, P5-16) has no `LayoutPos`. The function must be able to say "not laid out",
and the caller must be able to force layout of that region.

**Design.**

```pseudo
# Index maintained by layout, not by the editor. Layout owns it because layout
# is what invalidates it.
    PageIndex:      page -> { firstDocPos, lastDocPos, lineRefs[] }
    ParagraphIndex: NodeId -> { page, lineRefs[] }        # updated incrementally by P6-13

fn toLayout(caret) -> LayoutPos | NOT_LAID_OUT
    entry <- ParagraphIndex[caret.pos.node]
    if entry is absent: return NOT_LAID_OUT
    # binary search the paragraph's lines by logical offset range
    line  <- binarySearchByLogicalRange(entry.lineRefs, caret.pos.offset)
    if caret.pos.offset is at a soft-wrap boundary and caret.affinity == UPSTREAM:
        line <- previousLine(line)
    cluster <- clusterForLogicalOffset(line, caret.pos.offset, caret.affinity)
    return { page: entry.page, lineRef: line, cluster, leadingEdge: ... }

fn toDocument(lp) -> Caret
    cl  <- lp.lineRef.clusters[lp.cluster]
    off <- lp.leadingEdge ? cl.logicalStart : cl.logicalEnd
    aff <- (lp.cluster is first of a soft-wrapped line and lp.leadingEdge)
             ? DOWNSTREAM : UPSTREAM
    return { pos: { node: cl.sourceNode, offset: off }, affinity: aff, preferredX: NONE }
```

**Round-trip property to test explicitly.** `toDocument(toLayout(c)) == c` for every caret in a
fixture paragraph, _including_ both affinities at each soft wrap. This property is where affinity bugs
surface; nothing else catches them.

**Done when.** Both functions exist; the round-trip property test passes over a fixture containing a
soft wrap, a bidi boundary, an empty paragraph, and a paragraph ending in a table cell; `NOT_LAID_OUT`
is returned (not thrown) for a virtualized page.

---

### P6-03 — Hit-testing: screen point → caret

**Size** M · **Depends** P6-02 · **Escalate** no · **Owns** `packages/editor/src/hit-test.ts`

**Goal.** Click and drag map to a caret, including in RTL text, inside table cells, and in the margin.

**Trap.** Searching clusters in _logical_ order. Hit-testing is a geometric question and must walk
**visual** order. In `abc‏מילה‎def` the cluster whose visual x-range contains the point is not found by
scanning logical indices.

Second trap: the midpoint rule. "Left half of the cluster ⇒ before it" is correct only for LTR. For an
RTL cluster the left half is _after_ it. Getting this backwards puts the caret one character off in
every Arabic and Hebrew document, which is the kind of bug that never gets reported by the people who
would notice.

**Design.**

```pseudo
fn hitTest(point) -> Caret
    page <- pageAtDeviceY(point.y)                 # may trigger on-demand layout (P5-16)
    if point is outside any text area:
        return nearestEdgeCaret(page, point)       # margin click -> start/end of nearest line

    line <- lineWhoseVerticalBandContains(page, point.y)
            ?? nearestLineVertically(page, point.y)

    # A line may be split into several horizontal segments by float exclusions (P9-05)
    seg  <- segmentContaining(line, point.x) ?? nearestSegment(line, point.x)

    cl   <- visualClusterAt(seg, point.x)          # binary search over visual x-ranges
    frac <- (point.x - cl.visualX) / cl.advance
    leadingEdge <- cl.isRTL ? (frac > 0.5) : (frac < 0.5)     # <- the RTL flip

    return toDocument({ page, lineRef: line, cluster: cl.index, leadingEdge })
```

**Extra rules.**

- Click past the end of a line's text ⇒ caret at line end with `UPSTREAM` affinity (so it renders on
  the line that was clicked, not the next one).
- Click inside a table cell resolves to that cell's content; clicks on cell borders resolve to the
  nearer cell, and a drag started on a border begins a column-resize gesture, not a selection.
- Double-click selects the word (`Intl.Segmenter`, `granularity: 'word'`); triple-click selects the
  paragraph.

**Done when.** A test grid of points over a fixture containing LTR, RTL, and mixed lines maps to the
expected carets; clicking the right half of an RTL cluster yields the _earlier_ logical offset;
clicking 200px past the end of a wrapped line yields `UPSTREAM` affinity.

---

### P6-04 — Caret geometry and rendering

**Size** M · **Depends** P6-02 · **Escalate** no · **Owns** `packages/editor/src/caret.ts`

**Goal.** A caret rectangle in device pixels, blinking, correct in bidi text and at mixed font sizes.

**Trap.** Deriving caret height from the run's font size. It must come from the **line box's** ascent
and descent, or the caret visibly shrinks when placed next to a small-font run — and at a position
between two runs of different sizes there is no single "the run".

**Design.**

```pseudo
fn caretRect(caret) -> Rect
    lp   <- toLayout(caret)
    line <- lp.lineRef
    x    <- lp.leadingEdge ? cluster.visualX : cluster.visualX + cluster.advance
    # For an RTL cluster the leading edge is on the RIGHT:
    if cluster.isRTL: x <- lp.leadingEdge ? cluster.visualX + cluster.advance : cluster.visualX
    return { x, y: line.top, w: caretWidthDevicePx(), h: line.ascent + line.descent }

# Bidi caret policy - RECORD AS ADR.
# Options: (a) single caret at the position implied by affinity;
#          (b) split caret - two half-height marks at both visual positions.
# Decision: (a). Word shows a single caret. (b) is what the standard bidi
# literature recommends and what users do not expect.
# SPEC-GAP / UNVERIFIABLE-HERE: cannot compare against Word on this machine.
```

Rendering: caret is painted **on top of** the page bitmap cache, never baked into it — otherwise every
blink invalidates a bitmap. Blink is `500ms` on/off, suspended during typing and during composition
(a blinking caret during IME composition is a known irritant).

**Done when.** Caret height equals line height across a fixture line mixing 8pt and 36pt runs; the
caret sits on the correct side of an RTL cluster; blinking does not invalidate any page bitmap
(assert the cache's invalidation counter is unchanged across 10 blink cycles).

---

### P6-05 — Selection model

**Size** M · **Depends** P6-01 · **Escalate** no · **Owns** `packages/editor/src/selection/`

**Goal.** Represent every selection shape Word supports, normalized so downstream code has one form
to handle.

**Trap.** Assuming a selection is `{anchor, focus}` over a linear document. Table rectangular selection
(drag across cells) is not expressible that way — it selects a _grid region_, and the cells in it are
not contiguous in document order.

**Design.**

```pseudo
Selection =
  | { kind: 'collapsed', caret: Caret }
  | { kind: 'range',     anchor: DocPos, focus: DocPos, affinity: Affinity }
  | { kind: 'tableRect', table: NodeId, r0: int, c0: int, r1: int, c1: int }
  | { kind: 'multi',     ranges: Range[] }        # ctrl-click; also used by find-all

# Normalization, applied on every mutation:
#   - ranges are ordered (start <= end) for iteration, but anchor/focus are
#     preserved so shift-extension knows which end is moving
#   - a 'range' whose endpoints are equal collapses to 'collapsed'
#   - 'multi' ranges are sorted and merged when they touch
#   - a 'range' that exactly spans whole cells of one table MAY be presented as
#     'tableRect' for UI purposes but is NOT rewritten - the two behave
#     differently on delete
```

**Behavioural differences that must not be flattened away.** Deleting a `range` that spans cells
removes cell _content_ and merges the paragraph structure; deleting a `tableRect` clears the cells but
preserves the grid. Word does this and users depend on it.

**Done when.** The four shapes exist; normalization is idempotent (`normalize(normalize(s)) == normalize(s)`,
asserted as a property test); a range spanning two cells and a `tableRect` over the same two cells
produce different results from the delete operation in P6-12.

---

### P6-06 — Selection geometry: range → paint rectangles

**Size** M · **Depends** P6-05, P6-02 · **Escalate** no · **Owns** `packages/editor/src/selection/geometry.ts`

**Goal.** The highlight rectangles for a selection, per page, ready for the display list.

**Trap.** Emitting one rectangle per line. A logically contiguous range in bidi text is **visually
discontiguous** — selecting across a direction boundary produces two or three separate rectangles on
a single line. Code that assumes one rect per line renders a highlight over text that is not selected,
which is worse than rendering nothing.

**Design.**

```pseudo
fn selectionRects(sel, page) -> Rect[]
    out <- []
    for line in linesOf(page) intersecting sel:
        # walk VISUAL runs; a run is selected iff its logical range
        # intersects the selection's logical range
        runs <- line.visualRuns
        span <- NONE
        for run in runs (visual order):
            if intersects(run.logicalRange, sel.logicalRange):
                r <- clipRunToSelection(run, sel)     # partial run at the ends
                span <- span==NONE ? r : mergeIfAdjacent(span, r)
                if span was not merged: out.push(flush(span)); span <- r
            else:
                if span != NONE: out.push(flush(span)); span <- NONE
        if span != NONE: out.push(flush(span))
    return out
```

Line-end extension: when a selection continues past the end of a line, Word extends the highlight a
fixed width past the last glyph to signal "the paragraph mark is selected". Implement it; it is how
users tell a trailing newline is included.

**Done when.** A selection across an LTR→RTL→LTR boundary on one line produces ≥2 rectangles and none
of them covers unselected text (asserted against explicit expected geometry); a selection ending at a
paragraph mark shows the end-extension.

---

### P6-07 — Keyboard navigation

**Size** L · **Depends** P6-02, P6-05 · **Escalate** no · **Owns** `packages/editor/src/navigation/`

**Goal.** Arrow keys, word jumps, Home/End, PageUp/PageDown, Ctrl+Home/End — with and without Shift.

**Trap 1 — the goal column.** Up/Down must remember the x the caret started from, or repeated Down
through a short line permanently loses the horizontal position. `preferredX` is set on the first
vertical move and cleared by any horizontal move or edit. Every editor that skips this has the same
bug report filed against it.

**Trap 2 — Home/End at a soft wrap.** They act on the _visual line_, not the paragraph. At a wrap
point, Home must produce `DOWNSTREAM` affinity and End `UPSTREAM`, or the caret jumps to the adjacent
line.

**Trap 3 — bidi movement mode.** Logical movement (Right = next logical character) and visual movement
(Right = next character to the right on screen) differ in mixed text. `SPEC-GAP` /
`UNVERIFIABLE-HERE`: which one Word uses cannot be confirmed on this machine.

**Design.**

```pseudo
# Decision: implement BOTH, behind a policy flag. Default to LOGICAL.
# Rationale: logical movement guarantees every character is reachable by
# repeated arrow presses, which visual movement does not (it can cycle).
# Record as ADR; revisit when a Word comparison becomes available.
NavigationPolicy = { bidi: LOGICAL | VISUAL }

fn moveHorizontal(caret, dir, policy) -> Caret
    if policy.bidi == LOGICAL:
        # move by GRAPHEME CLUSTER, not code unit - Intl.Segmenter
        # otherwise the caret lands inside an emoji or a combining sequence
        next <- segmenter.nextGraphemeBoundary(caret.pos, dir)
    else:
        lp   <- toLayout(caret); next <- visualNeighbourCluster(lp, dir)
    return { pos: next, affinity: DOWNSTREAM, preferredX: NONE }   # clears goal column

fn moveVertical(caret, dir) -> Caret
    x    <- caret.preferredX ?? caretRect(caret).x
    line <- adjacentLine(toLayout(caret).lineRef, dir)   # may cross page / table cell
    if line is NONE: return caret                        # top/bottom of document
    c    <- hitTestWithinLine(line, x)
    c.preferredX <- x                                    # PRESERVED across the move
    return c

# Word-granularity uses Intl.Segmenter granularity:'word'. Word's own
# definition differs at punctuation; SPEC-GAP, approximate and note it.
```

Shift+navigation moves `focus` and leaves `anchor`. Ctrl+Shift+arrow extends by word. Navigation into
and out of table cells follows the grid, not document order, for Up/Down.

**Done when.** Down-Down-Down through a short line and back Up returns to the original column;
Home/End at a soft wrap produce the correct affinity; arrow keys step over an emoji ZWJ sequence in
one press, not five.

---

### P6-08 — Input proxy: the hidden DOM element

**Size** M · **Depends** — · **Escalate** no · **Owns** `packages/editor/src/input/proxy.ts`

**Goal.** Capture all text input, key events and clipboard events for a canvas that cannot receive
them natively.

**Trap.** Hiding the element with `display:none`, `visibility:hidden`, or moving it off-screen. All
three break something: the first two make it unfocusable, and off-screen positioning makes the IME
candidate window appear in the wrong place (or in the corner of the screen), and on iOS causes the
page to scroll to it on focus.

**Design.**

```pseudo
# The element is VISIBLE to the browser but invisible to the user, and is
# positioned AT THE CARET so the IME candidate window lands correctly.
    <textarea> or contenteditable, with:
        position: absolute
        left/top: caret position in client coords     # updated on every caret move
        width/height: 1px
        opacity: 0
        outline: none, border: none, padding: 0, resize: none
        white-space: pre, overflow: hidden
        autocapitalize=off autocorrect=off autocomplete=off spellcheck=false

# Event routing:
#   keydown      -> navigation, shortcuts, Backspace/Delete. preventDefault for
#                   anything we handle; let the rest through so IME sees it.
#   beforeinput  -> primary insertion path where supported (gives inputType)
#   input        -> fallback insertion path
#   composition* -> P6-09, takes priority over everything
#   paste/copy/cut -> P6-15
#   blur         -> hide caret, keep selection; do NOT clear it
```

**Rules that are not obvious.**

- Never call `preventDefault()` on a key that could start a composition. Doing so kills IME on some
  platforms with no error.
- The proxy's `value` is kept empty _except_ during composition. Anything left in it gets re-read by
  screen readers and re-sent on some Android keyboards.
- Focus management: clicking the canvas must focus the proxy without scrolling the page
  (`focus({ preventScroll: true })`).

**Done when.** Typing, Backspace, arrow keys and Ctrl+A all reach the editor; the proxy is never
visible; focusing the canvas does not scroll the page; the proxy's bounding rect tracks the caret
within one frame.

---

### P6-09 — IME composition lifecycle

**Size** L · **Depends** P6-08, P6-12 · **Escalate** no · **Owns** `packages/editor/src/input/ime.ts`

**Goal.** CJK, Vietnamese, Indic and Android soft-keyboard input work, with the composition text
visible in the document, underlined, and the candidate window positioned at the caret.

**Trap 1.** Treating composition text as a normal insertion. It must be **provisional**: not in the
undo stack, not in the round-trip model, replaced wholesale on every `compositionupdate`. If each
update lands in the undo stack, one Japanese word becomes fifteen undo steps.

**Trap 2 — the one that wastes a day.** Writing to the proxy's `value` or moving its selection _during_
composition aborts the composition on most IMEs, silently. During composition the proxy is
read-only from our side.

**Trap 3.** Assuming composition only happens for CJK. Android soft keyboards (Gboard) fire
`composition*` for ordinary Latin typing with autocorrect on. If the editor only handles `input`, it
loses text on Android.

**Design.**

```pseudo
CompositionState = {
    active:    bool,
    anchor:    DocPos,        # where the composition began
    text:      string,        # current provisional text
    clauses:   Clause[],      # from compositionupdate, for underline styling
    caretInComposition: int
}

on compositionstart:
    if selection is a range: delete it as ONE committed transaction first
    state.anchor <- caret.pos; state.active <- true
    suspendCaretBlink(); suspendUndoCoalescing()

on compositionupdate(e):
    replaceProvisional(state.anchor, state.text, e.data)    # NOT a Command
    state.text <- e.data
    relayout(dirty = paragraphOf(state.anchor))             # provisional text is laid out
    positionProxyAtCaret()                                  # keeps candidate window correct

on compositionend(e):
    clearProvisional(state.anchor, state.text)
    state.active <- false
    if e.data is non-empty:
        commit as ONE transaction: insertText(state.anchor, e.data)   # single undo step
    resumeCaretBlink()

# Rendering: provisional text is painted with the composition underline
# (thin solid for unconverted clauses, thick or double for the active clause).
# It is a PAINT-LAYER concern - provisional text never enters the document
# model that the writer serializes. See A1: it is not "dropped content",
# it does not exist yet.
```

**Done when.** A Japanese word composed and committed produces exactly **one** undo step; `Escape`
during composition leaves the document unchanged; Android-style autocorrect composition inserts text
rather than losing it; the candidate window appears adjacent to the caret (verified manually, recorded
as `UNVERIFIABLE-HERE` for automation).

---

### P6-10 — Command model: command + inverse

**Size** L · **Depends** P3-02, P3-03 · **Escalate** **yes** · **Owns** `packages/editor/src/commands/`

**Goal.** Every model mutation is a command with an exact inverse, so undo is replay rather than
snapshot restore.

**Trap.** Inverses that are _approximately_ right. `insertText`'s inverse is `deleteRange` — but if the
insert split a run, merged formatting, or renumbered a list, the naive delete does not restore the
prior state. An inverse must be captured from the **actual effect**, not derived from the intent.

Second trap: choosing granularity for undo ergonomics rather than for correctness, then discovering
the log cannot be replayed by a future collaborative layer because commands carry positions that only
made sense at the time they were issued.

**Design.**

```pseudo
Command = {
    apply(model)  -> Effect          # mutates; returns what actually changed
    invert(effect) -> Command        # built FROM the effect, not from the intent
    dirty(effect) -> DirtySet        # which paragraphs/pages need relayout
}

Effect = {
    nodesAdded:    NodeId[],
    nodesRemoved:  { id, serialized }[],   # serialized form so it can be restored
    textEdits:     { node, start, removed, inserted }[],
    propEdits:     { node, before, after }[],
    annotationEdits: ...                    # bookmarks/comments - see A1, P3-03
}

Transaction = {
    commands:  Command[],
    label:     string,                # "Typing", "Paste", "Delete" - shown in UI
    selBefore: Selection,             # restored on undo
    selAfter:  Selection,             # restored on redo
    mergeKey:  string | NONE,         # see P6-11 coalescing
    seq:       int                    # monotonic; the future collab layer's ordering hook
}
```

**Design rules — these are what make a future collaborative layer possible.**

- Commands address positions by `NodeId`, never by absolute offset. An offset-addressed log cannot be
  rebased against a concurrent edit.
- `apply` is deterministic given the same model state. No `Date.now()`, no random ids generated inside
  `apply` — ids are allocated by the caller and carried in the command.
- Range annotations (bookmarks, comment ranges, moves) are adjusted **inside** the command, and the
  adjustment is part of the effect. An annotation fixed up outside the command is not undone by the
  inverse. This is `A1` at the editing layer.

**Why command+inverse over snapshots.** Snapshots of a 500-page document are tens of MB per undo step.
Over OT/CRDT: both impose a model representation on Phase 3 that we are not ready to commit to, and
v1 is single-user. The log shape above is the concession to the future — it is rebasable, we simply
do not rebase it yet.

**Done when.** Every command type has a property test: `apply` then `invert().apply()` restores the
model to a state that serializes byte-identically to the original (this reuses the Phase 1 round-trip
comparison); a bookmark spanning an edited range is restored exactly by undo.

---

### P6-11 — Undo/redo stack, coalescing, selection restore

**Size** M · **Depends** P6-10 · **Escalate** no · **Owns** `packages/editor/src/commands/history.ts`

**Goal.** Ctrl+Z / Ctrl+Y with the granularity users expect.

**Trap.** Coalescing by time alone. A 500ms window merges a paste into the preceding typing run. Merge
on `mergeKey` _and_ adjacency _and_ time — all three.

**Design.**

```pseudo
fn push(tx):
    redoStack.clear()                      # any new edit discards the redo branch
    top <- undoStack.peek()
    if top exists
       and top.mergeKey == tx.mergeKey and tx.mergeKey != NONE
       and isAdjacent(top.selAfter, tx.selBefore)
       and (tx.t - top.t) < COALESCE_WINDOW_MS:
        top.commands.append(tx.commands); top.selAfter <- tx.selAfter; top.t <- tx.t
    else:
        undoStack.push(tx)
    if undoStack.size > MAX_UNDO: undoStack.dropOldest()

# mergeKey assignment:
#   typing a character     -> "type"
#   Backspace              -> "delete-back"     (separate key: typing then
#                                                backspacing must not merge)
#   Delete                 -> "delete-fwd"
#   paste, drop, IME commit, format change, table op -> NONE (never merges)

fn undo():
    tx <- undoStack.pop(); if NONE: return
    for cmd in reverse(tx.commands): cmd.invert(cmd.lastEffect).apply(model)
    setSelection(tx.selBefore)             # selection restore is part of undo
    redoStack.push(tx)
```

**Done when.** Typing "hello" then undoing once removes all five characters; typing "hello", pressing
Backspace, then undoing restores the "o" as a separate step; a paste is never merged into adjacent
typing; undo restores the selection that existed before the edit.

---

### P6-12 — Mutation API

**Size** M · **Depends** P6-10 · **Escalate** no · **Owns** `packages/editor/src/mutate/`

**Goal.** The only sanctioned way the document model changes. `ROUND-TRIP`.

**Trap.** Leaving a back door. If any code path mutates the model outside this API, it is not in the
undo log and not in the dirty set — the document changes and the screen does not, or worse, undo
corrupts it. Enforce by making the model's mutation surface internal to `@ooxml/wml` and exported only
through command application.

**Design.** Operations, each producing a `Transaction`:

```pseudo
insertText(pos, text, rPr?)        splitParagraph(pos)        mergeParagraphs(a, b)
deleteRange(sel)                   applyRunProps(sel, delta)  applyParaProps(sel, delta)
insertParagraph(after)             setStyle(sel, styleId)     toggleListItem(sel, numId)
insertTable(pos, rows, cols)       insertBreak(pos, kind)     insertDrawing(pos, blip)
```

**Semantics that are easy to get wrong.**

- `insertText` inherits `rPr` from the character **before** the insertion point, except at the start
  of a paragraph where it inherits from the character after. Word does this; users notice immediately
  when it is wrong.
- `deleteRange` across a paragraph boundary keeps the **first** paragraph's `pPr` and discards the
  second's. Across a table boundary it must not delete the table structure.
- `applyRunProps` on a toggle property (`b`, `i`, …) computes the new value from the **resolved**
  value (P3-07), not the direct value, or Ctrl+B on text bolded by its style does nothing visible.
- Every operation splits and merges runs as needed and must leave no zero-length runs behind — they
  round-trip as empty `<w:r/>` elements, which is valid but noisy and drifts the file on every save.

**Done when.** Each operation has a round-trip test (apply → save → reload → compare); no zero-length
runs exist after any operation (asserted by a model invariant checker run after every test);
Ctrl+B on style-bolded text un-bolds it.

---

### P6-13 — Incremental relayout driver

**Size** XL · **Depends** P5-*, P6-10 · **Escalate** **yes** · **Owns** `packages/editor/src/relayout.ts`

**Goal.** Keystroke to pixel under 16ms at p95 on a 100-page document. This ticket is what makes the
editor real-time; without it everything else is a demo.

**Trap 1.** Relaying out from the edit to the end of the document. Correct, and O(document). On page 3
of 100 it is ~200ms and the editor feels broken.

**Trap 2 — the subtle one.** Early-stopping on "the paragraph's height did not change". Not sufficient:
the paragraph's _break positions_ can change while its height does not (text reflows between lines but
the count is the same), which changes where the next page starts. The stop condition must compare the
**outflow state**, not the height.

**Trap 3.** Fields. A document containing `NUMPAGES` has a global dependency — any change to page count
invalidates every page displaying it. An early-stop that ignores this shows stale page numbers.

**Design.**

```pseudo
DirtySet = { paragraphs: NodeId[], pages: int[], globalFields: bool }

fn relayout(dirty) -> RepaintSet
    repaint <- {}

    # ---- Stage 1: line-level, per dirty paragraph, in document order --------
    for para in dirty.paragraphs:
        old <- ParagraphIndex[para].lines
        new <- layoutParagraphLines(para, constraintsFor(para))
        ParagraphIndex[para].lines <- new

        if outflowState(new) == outflowState(old):
            repaint.add(para.bounds)          # EARLY STOP: no pagination work at all
            continue                          # <- the common case for ordinary typing
        dirty.pages.add(pageOf(para))

    if dirty.pages is empty and not dirty.globalFields:
        return repaint

    # ---- Stage 2: pagination, forward from the earliest dirty page ----------
    p      <- min(dirty.pages)
    cursor <- pageStartState(p)               # what flows INTO page p
    loop:
        newPage <- fillPage(cursor)           # Phase 8 owns fillPage
        repaint.add(pageBounds(p))
        if not dirty.globalFields
           and p < oldPages.length
           and newPage.endState == oldPages[p].endState:
               break                          # EARLY STOP: RESYNCHRONISED.
                                              # everything after page p is unchanged.
        cursor <- newPage.endState
        p      <- p + 1
        if p > HARD_PAGE_CAP: logNonConvergence(); break
    return repaint

# outflowState(lines) = (lastLineEndPos, totalHeight, trailingKeepConstraints,
#                        pendingFloatIds, footnoteRefsEmitted)
# NOT just height. This tuple is exactly "everything the next paragraph and the
# pagination loop can observe about this one".
```

**Why the resync condition is `endState` equality.** Pagination is a fold: `endState = fill(startState)`.
If a page produces the same end state it produced before, every subsequent page is a pure function of
unchanged input, so it is unchanged. That is the whole argument, and it is why `endState` must capture
_everything_ carried forward — pending floats, footnote continuation, column position, keep-with-next
backlog. An incomplete `endState` makes the early stop unsound in a way that shows as rare,
irreproducible stale pages.

**Interaction with the Phase 8 fixpoint.** Stage 2 is the _outer_ loop; `fillPage` may itself iterate
to a fixpoint internally (footnotes). The two must not be merged — the outer loop is incremental and
must terminate by resynchronisation; the inner one terminates by convergence with a hard cap.

**Done when.** Typing a character mid-paragraph on page 3 of a 100-page fixture triggers **zero**
pagination work (asserted by a counter, not by timing); an edit that adds a line triggers pagination
for exactly the pages up to the resync point, not to the end; a document containing `NUMPAGES` sets
`globalFields` and repaints all visible pages; the p95 keystroke-to-relayout time on the fixture is
under the budget recorded in P6-17.

---

### P6-14 — Repaint scheduling and dirty rects

**Size** M · **Depends** P6-13, P5-15 · **Escalate** no · **Owns** `packages/editor/src/paint-scheduler.ts`

**Goal.** One repaint per animation frame, touching only what changed.

**Trap.** Repainting synchronously from the input handler. Two keystrokes in one frame paint twice and
the second one is wasted; worse, painting inside `keydown` blocks the IME.

**Design.**

```pseudo
on modelChanged(repaintSet):
    pending.union(repaintSet)
    if not scheduled: scheduled <- true; requestAnimationFrame(flush)

fn flush():
    scheduled <- false
    rects <- coalesce(pending)                 # merge overlapping; cap count, then
                                               # fall back to full-page repaint
    for page in pagesTouchedBy(rects):
        invalidatePageBitmap(page)             # P5-15 cache
        redrawPageRegion(page, rects ∩ page)
    drawOverlays()                             # caret, selection, composition underline
    pending.clear()
```

Overlays (caret, selection highlight, composition underline) are drawn **after** and **outside** the
page bitmap cache, so caret blink and selection drag never invalidate a cached bitmap.

**Done when.** Ten synchronous model changes in one tick produce exactly one `flush`; a caret blink
invalidates no page bitmap; a selection drag across one page invalidates no page bitmap.

---

### P6-15 — Clipboard: copy, cut, paste

**Size** L · **Depends** P6-05, P6-12, Phase 2 · **Escalate** no · **Owns** `packages/editor/src/clipboard/`

**Goal.** Round-trip formatting through the system clipboard, and interoperate with Word and browsers.

**Trap.** Writing only `text/plain`. Copying formatted text out of the editor then pasting it back
loses everything, which users read as data loss.

Second trap: trusting pasted HTML. Clipboard HTML from a browser can carry arbitrary markup and, if
rendered into a DOM, script. It is parsed and mapped, never inserted.

**Design.**

```pseudo
# COPY - write three flavours, richest first:
#   application/x-ooxml-fragment  : a real WordprocessingML fragment (our own
#                                   paste path; lossless, includes styles used)
#   text/html                     : CF_HTML-shaped, for Word and browsers
#   text/plain                    : with tabs between cells, \n between paragraphs

# PASTE - pick the richest flavour we understand:
#   1. our fragment        -> read through the Phase 1 generated readers
#   2. text/html           -> map a sanitised subset to model operations
#   3. text/plain          -> split on \r?\n into paragraphs
#
# Style conflict on paste is a POLICY, record as ADR:
#   keepSource | mergeFormatting | plainText, default mergeFormatting
#   (matches Word's default and is the least surprising).
#   Pasted styleIds that collide with different definitions are renamed, not
#   overwritten - overwriting silently restyles the whole destination document.
```

**Done when.** Copy from the editor and paste back preserves bold, styles and a table; pasting Word's
HTML flavour produces the same structure as pasting our fragment for a fixture document; pasting HTML
containing `<script>` and `onerror=` inserts text only and executes nothing.

---

### P6-16 — Accessibility mirror

**Size** L · **Depends** P6-05, P5-01 · **Escalate** no · **Owns** `packages/editor/src/a11y/`

**Goal.** A screen reader can read the document, follow the caret, and hear selection changes.

**Trap.** Treating this as a late polish item. A canvas has _no_ accessible content — to assistive
technology the editor is a blank image. Retrofitting the mirror after the editor is built means
re-deriving structure that layout already knew and threw away. Build it alongside, not after.

**Design.**

```pseudo
# A DOM subtree, visually hidden but NOT aria-hidden, mirroring document structure:
#   <div role="document">
#     <p id="n_<NodeId>">…text…</p>          one element per paragraph
#     <table role="table"> … </table>
#   </div>
#
# Synchronisation:
#   - rebuilt incrementally from the same DirtySet that drives relayout (P6-13),
#     so it can never diverge from what is painted
#   - only VISIBLE pages plus a margin are mirrored; a 500-page DOM mirror is
#     itself a performance problem
#
# Caret/selection: mapped into a DOM Range on the mirror and applied via the
# Selection API, so the screen reader's virtual cursor tracks ours.
#
# CRITICAL: the mirror must never take focus. Focus stays on the input proxy
# (P6-08). Use aria-activedescendant / a live region for announcements rather
# than moving focus.
#
# Announcements (polite live region): caret line/paragraph on move, selection
# extent on change, style name on entering differently-styled text.
```

**Done when.** The mirror contains one element per visible paragraph with matching text; moving the
caret updates the mirror's DOM selection; the input proxy retains focus throughout; a fixture with a
table mirrors as a `role="table"` with correct row/column counts.

---

### P6-17 — Latency instrumentation

**Size** S · **Depends** P6-13, P6-14 · **Escalate** no · **Owns** `packages/editor/src/perf/`

**Goal.** Keystroke-to-pixel latency is measured continuously, not assessed by feel.

**Design.**

```pseudo
# Mark at four points, per keystroke:
#   t0 keydown/beforeinput received
#   t1 model mutation applied            (P6-12)
#   t2 relayout returned                 (P6-13)
#   t3 rAF flush completed               (P6-14)
# Record (t1-t0, t2-t1, t3-t2, t3-t0) in a ring buffer; expose p50/p95/p99.
# Budget: t3-t0 p95 < 16ms. Phase 11 turns this into a CI gate with a
# throttled CPU; here it is a dev overlay and a console API.
```

**Done when.** A dev overlay shows live p50/p95 for a typing burst; the four-stage breakdown makes it
possible to say _which_ stage blew the budget, which is the only reason to build this now rather than
in Phase 11.

---

## Phase 6 exit criteria

1. All tickets P6-01..P6-17 closed per their **Done when** clauses.
2. `pnpm vitest run packages/editor/src` green.
3. The exit demo performs end to end in the demo app.
4. P6-17 reports p95 keystroke-to-pixel under 16ms on the 100-page fixture, untrottled.
5. A written statement in the phase report that the Word-reopen gate has **not** run and why
   (ADR 0007, `F6`). Do not describe this phase as complete without it.
