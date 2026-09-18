# Phase 8 — Sections, pagination, footnotes, fields

> **Difficulty rank 2 of 11.**
>
> **Depends on** Phase 5 (line layout) and Phase 7 (tables, for row splitting). Phase 9 reuses this
> phase's fixpoint driver for the anchor⇄wrap cycle.
>
> **Owns** `packages/layout/src/pagination/`, `packages/layout/src/fixpoint.ts`,
> `packages/wml/src/fields/`.

## Why this phase ranks here

Pagination is the only part of the system with **genuine circular dependencies**, and circularity is
the failure mode you cannot test your way out of after the fact:

- A footnote is placed on the page where its reference falls. Placing it shrinks the body text area.
  Shrinking the text area can push the reference itself onto the next page — where the footnote must
  now go too, growing the previous page's text area back, which may pull the reference back. This
  oscillates.
- `NUMPAGES` depends on the page count. The page count depends on the rendered width of `NUMPAGES`
  ("9" and "10" are different widths, and a TOC entry's leader dots reflow).
- A TOC field's content depends on the page numbers of the headings it lists, which depend on how
  many pages the TOC itself occupies.
- `w:keepNext` requires **backtracking**: discovering on page 4 that a paragraph must move means
  re-deciding page 3's content.

None of these produce a wrong pixel when handled badly. They produce a **hang**, or a layout that
differs between two runs on the same input. Both are far worse than a visual defect, and both escape
unit tests that use small documents.

---

## Ticket index

| ID    | Title                                     | Size | Escalate |
| ----- | ----------------------------------------- | ---- | -------- |
| P8-01 | Section model and iteration               | M    | no       |
| P8-02 | Page geometry from `CT_SectPr`            | S    | no       |
| P8-03 | Headers and footers, with height feedback | L    | yes      |
| P8-04 | Section break types and section start     | M    | no       |
| P8-05 | Columns: `w:cols`, balancing              | L    | no       |
| P8-06 | **The fixpoint driver**                   | XL   | **yes**  |
| P8-07 | Page-fill algorithm                       | L    | **yes**  |
| P8-08 | Keep constraints and backtracking         | L    | **yes**  |
| P8-09 | Footnotes                                 | XL   | **yes**  |
| P8-10 | Endnotes                                  | M    | no       |
| P8-11 | Page numbering                            | M    | no       |
| P8-12 | Line numbering                            | S    | no       |
| P8-13 | Vertical alignment (`w:vAlign`)           | S    | no       |
| P8-14 | Simple fields (`CT_SimpleField`)          | S    | no       |
| P8-15 | Complex field state machine               | L    | no       |
| P8-16 | Field instruction parser                  | M    | no       |
| P8-17 | Field evaluators                          | L    | no       |
| P8-18 | Field recalculation policy                | M    | **yes**  |

---

### P8-01 — Section model and iteration

**Size** M · **Depends** P3-* · **Escalate** no

**Goal.** Enumerate a document's sections and the block content belonging to each.

**Trap — the single most commonly inverted fact in WordprocessingML.** **`w:sectPr` lives on the LAST
paragraph of its section**, inside that paragraph's `w:pPr`. It is not a header, it is a terminator.
The final section's `sectPr` is different again: it hangs directly off `w:body`, after all content.

Reading `sectPr` as a section _opener_ puts every section boundary one section off — every page size,
every margin, every column count applies to the wrong range. The document still renders, which is why
this survives casual testing.

**Design.**

```pseudo
fn sections(body) -> Section[]
    out <- []; start <- 0
    for i, block in body.blocks:
        if block is Paragraph and block.pPr?.sectPr exists:
            out.push({ blocks: body.blocks[start..i],   # INCLUSIVE of block i
                       sectPr: block.pPr.sectPr })
            start <- i + 1
    # trailing content belongs to the body-level sectPr
    out.push({ blocks: body.blocks[start..], sectPr: body.sectPr })
    return out

# Round-trip note (ROUND-TRIP, A1): the sectPr must be written back onto the
# same paragraph it came from. Do not normalise it to a synthetic trailing
# paragraph - that changes the document.
```

**Done when.** A three-section fixture yields three sections with the correct block ranges; the
terminator paragraph is included in its own section, not the next; round-tripping the fixture is
byte-idempotent.

---

### P8-02 — Page geometry from `CT_SectPr`

**Size** S · **Depends** P8-01 · **Escalate** no

**Goal.** Page box, margins, and the resulting body text area for a section.

**Design.**

```pseudo
PageGeometry = {
    size:    { w: Twip, h: Twip, orient: portrait|landscape },
    margins: { top, right, bottom, left, header, footer, gutter: Twip },
    mirror:  bool,                 # w:mirrorMargins in settings.xml
    pgBorders, pgNumType, ...
}

# w:pgSz@w/@h are the ACTUAL dimensions. @orient is informational and may
# disagree with w/h; w/h win. Do not swap w/h based on @orient.

# Gutter is added to the binding edge:
#   mirror off -> left margin on every page (or top, if w:gutterAtTop)
#   mirror on  -> left on odd pages, right on even
# textArea.width = size.w - margins.left - margins.right - gutter
# textArea.height is NOT computed here - it depends on header/footer extent (P8-03)
```

**Done when.** Letter portrait, A4 landscape, and a mirrored-margin fixture produce the expected text
area widths in twips; a `sectPr` whose `@orient` contradicts `@w`/`@h` uses `@w`/`@h`.

---

### P8-03 — Headers and footers, with height feedback

**Size** L · **Depends** P8-02 · **Escalate** yes

**Goal.** Resolve which header/footer applies to each page and lay it out, feeding its height back
into the body text area.

**Trap.** Treating header height as a constant taken from `w:header` (the margin). It is not. The
header's _content_ can be taller than the header margin, and when it is, **it pushes the body text
area down**. That makes body height a function of header layout — which is a dependency that must be
resolved before the page can be filled, and is the first place the fixpoint driver is needed.

Second trap: the reference resolution table. There are three types (`default`, `first`, `even`) gated
by two flags (`w:titlePg` on the section, `w:evenAndOddHeaders` in `settings.xml`), and sections
inherit references from the previous section unless they declare their own.

**Design.**

```pseudo
fn headerFor(page, section, settings) -> HeaderRef | NONE
    if section.titlePg and page.isFirstOfSection:  try 'first'
    if settings.evenAndOddHeaders and page.number is even: try 'even'
    try 'default'
    # "try" falls through to the next candidate when absent, and finally to
    # the PREVIOUS section's resolved header unless this section suppresses
    # inheritance. An absent reference is not an empty header.

fn bodyTextArea(page, geom, hdr, ftr) -> Rect
    hdrH <- hdr ? layoutHeader(hdr, geom).height : 0
    ftrH <- ftr ? layoutFooter(ftr, geom).height : 0
    top    <- max(geom.margins.top,    geom.margins.header + hdrH)
    bottom <- max(geom.margins.bottom, geom.margins.footer + ftrH)
    return { x: ..., y: top, w: ..., h: geom.size.h - top - bottom }

# FIXPOINT: a header containing a PAGE field renders "9" vs "10" at different
# widths, which can rewrap the header, which changes hdrH, which changes the
# body area, which can change the page count, which changes PAGE. Headers
# therefore participate in the P8-06 loop rather than being resolved once.
```

**Done when.** A fixture with `titlePg` shows the first-page header only on page 1; a header taller
than its margin visibly reduces the body area (asserted in twips); a header containing `NUMPAGES`
converges.

---

### P8-04 — Section break types and section start

**Size** M · **Depends** P8-01, P8-02 · **Escalate** no

**Design.**

```pseudo
# w:type: nextPage | continuous | evenPage | oddPage | nextColumn
#
# nextPage    new page.
# continuous  NO page break. The new section starts on the same page.
#             Its page geometry is IGNORED for that page except column layout -
#             you cannot change paper size mid-page. Word silently keeps the
#             previous geometry; match that.
# evenPage    break to the next even-numbered page, inserting a blank if needed.
# oddPage     likewise odd.
# nextColumn  break to the next column; if in the last column, next page.
#
# The inserted blank page for even/odd IS a page: it gets headers/footers,
# counts toward NUMPAGES, and is painted. It is not a layout artefact.
```

**Done when.** Each of the five types produces the expected page sequence on a fixture; an `oddPage`
break from an odd page inserts exactly one blank; a `continuous` break does not change paper size
mid-page.

---

### P8-05 — Columns

**Size** L · **Depends** P8-04 · **Escalate** no

**Design.**

```pseudo
# w:cols@num + @space  -> equal columns
# w:cols@equalWidth=0 + <w:col w= space=/>*  -> explicit per-column widths
# @sep -> a vertical rule painted between columns
#
# Column fill order: fill column 1 to the bottom, then column 2, ...
# EXCEPT the last section content, which Word BALANCES: content is distributed
# so columns end at roughly equal heights.
#
# Balancing algorithm (SPEC-GAP - the standard does not give one):
#   binary search on a target column height H:
#     lo <- totalHeight / numCols ; hi <- totalHeight
#     find the smallest H for which greedy fill uses <= numCols columns
#   deterministic tie-break: prefer the EARLIER break when two heights tie,
#   so the result does not depend on search order.
# Mark this SPEC-GAP in the source. It is an approximation of Word's behaviour
# calibrated on nothing, because no Word is available here (F6).
```

**Trap.** Balancing is only applied to the _final_ stretch of a section (before a `continuous` break or
the section end), never to columns that are simply full. Balancing everything makes every multi-column
page look wrong.

**Done when.** A three-column fixture fills left-to-right; the last page of a balanced section has
columns within one line-height of each other; the balance search is deterministic across 100 runs.

---

### P8-06 — The fixpoint driver

**Size** XL · **Depends** — · **Escalate** **yes** · **Owns** `packages/layout/src/fixpoint.ts`

**Goal.** One reusable, bounded, deterministic convergence loop. Phase 9 reuses it for anchor⇄wrap.

**Trap 1.** `while (changed) { recompute() }`. It does not terminate on an oscillating input — and
oscillation is the _normal_ case here, not a pathological one (the footnote cycle in P8-09 oscillates
on ordinary documents).

**Trap 2.** Comparing floating-point geometry for equality to detect convergence. Two layout passes
can differ by a sub-twip rounding and loop forever. Compare **quantised** state.

**Trap 3.** Non-determinism. If the loop's result depends on iteration order over a `Set` or a `Map`,
two runs on the same document produce different output and the layout goldens flake. This is `C1` at
the layout layer.

**Design.**

```pseudo
FixpointResult<S> = { state: S, iterations: int, converged: bool, oscillated: bool }

fn fixpoint(initial: S, step: S -> S, key: S -> string, maxIters: int) -> FixpointResult<S>
    seen  <- Map<string, int>()          # quantised key -> iteration first seen
    state <- initial
    for i in 0..maxIters:
        k <- key(state)                  # QUANTISED: twips as ints, no floats
        if seen.has(k):
            # We have been here before -> a cycle. Do NOT keep looping.
            # Deterministic tie-break: return the state with the LOWEST key in
            # the cycle, so the choice does not depend on where we entered it.
            return { state: lowestKeyInCycle(seen, k), iterations: i,
                     converged: false, oscillated: true }
        seen.set(k, i)
        next <- step(state)
        if key(next) == k:
            return { state: next, iterations: i, converged: true, oscillated: false }
        state <- next
    return { state, iterations: maxIters, converged: false, oscillated: false }

# On !converged: LOG IT (document id, page range, iteration count, the cycle
# keys) and proceed with the returned state. Never throw, never loop.
# A document that does not converge must still open - see B4.
#
# maxIters default 8. Rationale: real documents converge in 1-3. A cap of 8
# bounds worst-case pagination cost at 8x, which is acceptable for a one-time
# open and is never hit during incremental relayout (P6-13 resynchronises
# instead of re-running the fixpoint).
```

**Why cycle detection and not just a cap.** A cap alone makes the output depend on where the loop was
cut, so the same document can paginate differently after an unrelated change. Detecting the cycle and
picking its lowest key makes the result a **function of the document**, which is what the layout
goldens require.

**Done when.** A synthetic oscillating `step` is detected as `oscillated: true` and returns the same
state regardless of the starting point within the cycle; a converging `step` reports the exact
iteration count; non-convergence produces a log entry and no exception; 100 runs on the same input
produce identical output.

---

### P8-07 — Page-fill algorithm

**Size** L · **Depends** P8-03, P8-06 · **Escalate** **yes**

**Goal.** `fillPage(startState) -> { content, endState }` — the fold that pagination iterates.

**Trap.** An incomplete `endState`. P6-13's incremental early-stop is sound **only** if `endState`
captures everything the next page can observe. Anything omitted — a pending float, a footnote
continuation, a keep-with-next backlog — produces rare, irreproducible stale pages after an edit. This
ticket and `P6-13` must agree on the tuple exactly.

**Design.**

```pseudo
PageState = {
    blockIndex:   int,            # next block to place
    intraBlock:   BlockOffset,    # line index within a split paragraph, row within a split table
    columnIndex:  int,
    pendingFloats:      FloatId[],        # anchored but not yet placed (Phase 9)
    footnoteCarry:      FootnoteId[],     # continued from the previous page
    keepBacklog:        NodeId[],         # blocks held by keepNext (P8-08)
    pageNumber:   int,
    sectionIndex: int,
}

fn fillPage(s: PageState) -> { content: PageContent, endState: PageState }
    area <- bodyTextArea(...)                        # P8-03, may shrink below
    area <- area minus reservedFootnoteHeight(s)     # P8-09
    y <- area.top
    loop over blocks from s.blockIndex:
        frag <- fragmentBlock(block, area, y)        # paragraph -> lines, table -> rows (P7-11)
        if frag is empty and y == area.top:
            forcePlaceAtLeastOne(block)              # never emit an empty page
        if frag does not fit: break
        place(frag); y <- y + frag.height
        collectFootnoteRefs(frag) -> may shrink `area` -> RE-CHECK the last placed
                                     fragment still fits; if not, unplace it
    applyKeepConstraints()                            # P8-08, may unplace trailing blocks
    return { content, endState }

# endState must be VALUE-COMPARABLE (structural equality on the quantised
# tuple). No object identity, no NodeId arrays that differ only in order.
```

**Done when.** `endState` is a documented, value-comparable tuple; `fillPage` is pure given
`(startState, model, geometry)`; running it twice on the same input yields structurally equal results;
a page whose first block does not fit still emits that block rather than an empty page.

---

### P8-08 — Keep constraints and backtracking

**Size** L · **Depends** P8-07 · **Escalate** **yes**

**Goal.** `w:keepNext`, `w:keepLines`, `w:pageBreakBefore`, `w:widowControl`.

**Trap.** Applying keeps greedily while filling. `keepNext` is only decidable _after_ you know where
the next block lands, so it is inherently a backtracking constraint: placing block N may have to be
undone because block N+1 did not fit.

Second trap: unbounded backtracking. A chain of twenty `keepNext` paragraphs, or a `keepNext` on a
paragraph taller than a page, will move the entire page's content to the next page — and then the next
page has the same problem. Word breaks the constraint rather than looping. So must we.

**Design.**

```pseudo
fn applyKeepConstraints(page):
    # Walk placed blocks from the END backwards
    i <- last placed index
    while i > 0:
        if block[i-1].keepNext and block[i] was NOT placed on this page:
            unplace(block[i-1]); i <- i - 1; continue
        break
    # widow/orphan: a paragraph split across pages must leave >= 2 lines on each
    # side unless w:widowControl is off
    if lastBlock was split and linesOnThisPage < 2: unplace the whole paragraph
    if lastBlock was split and linesOnNextPage < 2: pull one more line forward

    # ESCAPE HATCH - mandatory:
    if nothing remains placed on this page:
        # the constraint chain cannot be satisfied. Break it: place the first
        # block unconditionally and record a diagnostic.
        forcePlaceFirst(); report('keep-constraint-broken', page)
```

**`keepLines`** prevents a paragraph splitting at all — move it whole. **`pageBreakBefore`** is
unconditional and is applied _before_ filling, not as a keep.

**Done when.** A heading with `keepNext` followed by an unsplittable table moves to the next page with
it; a chain of 30 `keepNext` paragraphs that cannot fit on one page breaks the chain and reports a
diagnostic instead of emptying pages forever; widow/orphan leaves ≥2 lines on both sides.

---

### P8-09 — Footnotes

**Size** XL · **Depends** P8-06, P8-07 · **Escalate** **yes**

**Goal.** Footnotes appear on the page their reference falls on, above the footer, separated by the
separator mark, continuing onto the next page when they do not fit.

**Trap — the cycle.** Placing a footnote shrinks the body area. Shrinking the body area can push the
last paragraph — and its footnote reference — to the next page. The footnote then leaves this page,
the area grows back, and the paragraph returns. This oscillates on **ordinary documents**, not
pathological ones. It is the primary customer of P8-06.

**Design.**

```pseudo
# Per page, iterate to a fixpoint on the reserved footnote height:
fn paginatePage(startState) -> Page
    step = (reserved) ->
        page <- fillPage(startState, footnoteReserve = reserved)
        notes <- footnotesReferencedBy(page.content)
        return layoutFootnoteArea(notes).height        # quantised to twips
    r <- fixpoint(initial = carryOverHeight(startState), step,
                  key = h -> str(h), maxIters = 8)
    if not r.converged:
        # Deterministic fallback: take the LARGER reserve of the cycle.
        # A slightly short page is a cosmetic defect; a footnote with no room
        # is a lost footnote (A1).
        reserved <- max over cycle
    return fillPage(startState, footnoteReserve = reserved)

# Footnote area composition, top to bottom:
#   w:separator          (for the first footnote on a page)
#   w:continuationSeparator (when continuing from the previous page)
#   footnote paragraphs
#   w:continuationNotice (when this page's footnotes continue onto the next)
# These live in footnotes.xml as special CT_FtnEdn with @type.
#
# A footnote that does not fit SPLITS: as many lines as fit stay, the rest
# carries in endState.footnoteCarry. A footnote is never dropped.
#
# w:footnotePr: numFmt, numStart, numRestart (continuous|eachSect|eachPage),
# and w:pos (pageBottom|beneathText|sectEnd|docEnd).
# 'beneathText' places the area directly under the last line, not at the page
# bottom - it is a different layout, not a variant of the same one.
```

**Done when.** A page whose footnote pushes its own reference to the next page converges and produces
a stable golden across 100 runs; a footnote longer than the remaining page continues onto the next
page with the continuation separator; `numRestart=eachPage` restarts correctly; no footnote is ever
absent from the output.

---

### P8-10 — Endnotes

**Size** M · **Depends** P8-09 · **Escalate** no

**Goal.** Endnotes at section end or document end. Simpler than footnotes — no per-page cycle, because
placement does not affect the body area of the pages holding the references.

**Done when.** `w:endnotePr@pos` of `sectEnd` and `docEnd` both place correctly; numbering restart
options behave; endnote content paginates as ordinary flow.

---

### P8-11 — Page numbering

**Size** M · **Depends** P8-04 · **Escalate** no

**Design.**

```pseudo
# w:pgNumType@start   restart at a value for this section
#             @fmt    decimal | upperRoman | lowerRoman | upperLetter | lowerLetter | ...
#             @chapStyle/@chapSep  chapter-prefixed numbering ("2-14")
#
# The displayed number is a PROPERTY OF THE PAGE, resolved during pagination,
# not a field evaluation. The PAGE field reads it. Getting this backwards makes
# PAGE unresolvable inside a header, which is where it almost always appears.
```

**Done when.** A section restarting at 1 with lowerRoman renders `i, ii, iii`; chapter numbering
renders with the separator; `NUMPAGES` reflects the true total including blank even/odd pages.

---

### P8-12 — Line numbering

**Size** S · **Depends** P8-07 · **Escalate** no

`w:lnNumType` — `@countBy`, `@start`, `@restart` (`newPage`|`newSection`|`continuous`), `@distance`.
Lines in paragraphs with `w:suppressLineNumbers` are skipped but still occupy space.

**Done when.** `countBy=5` numbers every fifth line; `restart=newPage` restarts; suppressed paragraphs
are not counted.

---

### P8-13 — Vertical alignment

**Size** S · **Depends** P8-07 · **Escalate** no

`w:vAlign` — `top`|`center`|`both`|`bottom`. `both` (justified) distributes extra space between
paragraphs, not within them. Applies to the section's last page only in the `both` case, per Word's
observed behaviour — `SPEC-GAP`, mark it.

---

### P8-14 — Simple fields

**Size** S · **Depends** P8-17 · **Escalate** no

`CT_SimpleField` — `w:fldSimple@w:instr` holds the instruction; the child run holds the cached result.
Read the instruction, evaluate or use the cache per P8-18, and `ROUND-TRIP` the cached result
unchanged when not recalculating.

---

### P8-15 — Complex field state machine

**Size** L · **Depends** P3-* · **Escalate** no

**Goal.** Recognise complex fields spread across runs.

**Trap.** Treating the three `fldChar` types as a flat sequence. Fields **nest** — `{ IF { PAGE } > 1
"a" "b" }` — so this is a stack machine, not a flag. A flat implementation mis-associates the inner
field's result with the outer field.

**Design.**

```pseudo
# Runs carry: <w:fldChar w:fldCharType="begin|separate|end"/> and <w:instrText>
#
# stack <- []
# for each run in paragraph order:
#     on fldChar 'begin'    : stack.push(new FieldFrame(startRun))
#     on instrText          : stack.top.instr += text        # may span many runs
#     on fldChar 'separate' : stack.top.inResult <- true
#     on fldChar 'end'      : f <- stack.pop()
#                             f.resultRange <- [separateRun+1 .. thisRun-1]
#                             if stack is non-empty: stack.top.instr += f.resultText
#                             emit f
#
# An unbalanced 'end' with an empty stack, or EOF with a non-empty stack, is a
# document defect: report a diagnostic, preserve the runs verbatim, do not
# throw (B4).
# A field with no 'separate' has no cached result - it must be evaluated.
```

**Done when.** A nested `IF`/`PAGE` fixture parses to the correct tree; instruction text split across
five runs is reassembled; an unbalanced field produces a diagnostic and round-trips unchanged.

---

### P8-16 — Field instruction parser

**Size** M · **Depends** P8-15 · **Escalate** no

**Design.**

```pseudo
# Grammar (informal):
#   instruction := name argument* switch*
#   argument    := bareword | quoted        # quotes are " with \" escaping
#   switch      := '\' letter argument?
#
# Traps:
#   - whitespace inside quotes is significant
#   - a nested field's RESULT is substituted into the instruction before parsing
#     (done by P8-15), so the parser never sees nesting
#   - switch letters are case-sensitive: \* is formatting, \# is numeric picture,
#     \@ is date picture, \! is lock-result
#   - unknown switches are PRESERVED, not dropped (ROUND-TRIP)
```

**Done when.** `PAGEREF _Ref123 \h`, `SEQ Figure \* ARABIC`, and `DATE \@ "dd MMMM yyyy"` all parse
with switches intact; an unknown switch survives round-trip.

---

### P8-17 — Field evaluators

**Size** L · **Depends** P8-16, P8-11 · **Escalate** no

| Field                                    | Notes                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PAGE`, `NUMPAGES`, `SECTIONPAGES`       | Read from pagination (P8-11). `FIXPOINT` — width changes can reflow.                                                                    |
| `REF`, `PAGEREF`                         | Resolve a bookmark (P3-03). `PAGEREF` is `FIXPOINT`.                                                                                    |
| `SEQ`                                    | Per-identifier counters in document order, with `\r` reset and `\c` repeat.                                                             |
| `DATE`, `TIME`, `CREATEDATE`, `SAVEDATE` | Picture strings via `\@`. Date pictures are **not** `Intl.DateTimeFormat` patterns; write a converter.                                  |
| `STYLEREF`                               | Nearest paragraph of a given style, searching **backwards from the top of the current page** — so it depends on pagination. `FIXPOINT`. |
| `HYPERLINK`                              | Result is display text; the target lives in the field. External targets are blocked by default (Phase 2 SSRF rule).                     |
| `MERGEFIELD`                             | No data source in v1 — render the cached result or the field name.                                                                      |
| `TOC`                                    | Collect headings by style or outline level, emit entries with `PAGEREF`. `FIXPOINT` — the TOC's own length shifts the pages it lists.   |
| `IF`, `=` (formula)                      | Needed because they nest around the above. Minimal evaluator.                                                                           |

Unknown field types: render the **cached result** if present, otherwise the instruction text greyed —
never blank (`G3`).

**Done when.** Each listed field evaluates on a fixture; a TOC whose length changes the page numbers
it lists converges; an unknown field renders its cached result and round-trips.

---

### P8-18 — Field recalculation policy

**Size** M · **Depends** P8-17 · **Escalate** **yes**

**Goal.** Decide, per field, whether to show the cached result or recalculate — and never silently
destroy a cached result we cannot reproduce. `ROUND-TRIP`.

**Trap.** Recalculating everything on open. `MERGEFIELD` with no data source, `DOCPROPERTY` for a
property we do not model, a field type we do not implement — recalculating these replaces a correct
cached result with a blank or an error, and then **saves it**. That is silent data destruction, `A1`.

**Design.**

```pseudo
FieldPolicy = per field type:
    ALWAYS   : recalc on every layout pass   (PAGE, NUMPAGES, PAGEREF, STYLEREF)
    ON_OPEN  : recalc once when the document loads   (DATE with \@, SEQ)
    NEVER    : always show the cached result         (MERGEFIELD, unknown types,
                                                      anything with the \! lock switch)
    DIRTY    : recalc only if w:fldSimple@w:dirty or settings' updateFields is set

# Hard rule: if a field's policy is ALWAYS or ON_OPEN but evaluation FAILS,
# fall back to the cached result and report a diagnostic. Never write a failed
# evaluation back over a good cache.
#
# w:settings/w:updateFields=true means Word was told to refresh on open.
# Honour it for ALWAYS/ON_OPEN fields only; it does not license overwriting
# NEVER fields.
```

**Done when.** A document with a `MERGEFIELD` round-trips with its cached result intact; a `PAGE` field
updates when pagination changes; a deliberately-broken `PAGEREF` (dangling bookmark) keeps its cached
result and reports a diagnostic rather than rendering "Error!".

---

## Phase 8 exit criteria

1. All tickets closed per their **Done when** clauses.
2. `pnpm vitest run packages/layout/src` green, including the footnote-cycle golden.
3. The fixpoint driver reports zero non-convergence across the whole corpus; any non-convergence is
   logged with the document and page range, and is treated as a bug to investigate, not as noise.
4. Layout goldens exist for: a footnote pushing its own reference, a `keepNext` chain that must break,
   a balanced multi-column final page, and a TOC that shifts its own page numbers.
5. 100 consecutive runs over the corpus produce byte-identical goldens (determinism, `C1`).
