# Phase 7 — Tables

> **Difficulty rank 4 of 11.**
>
> **Depends on** Phase 5 (line layout — cell content is laid out by the same engine), Phase 8
> (pagination — row splitting), Phase 3 (conditional formatting resolution, `P3-09`).
>
> **Owns** `packages/layout/src/table/`.

## Why this phase ranks here

Two reasons, and neither is volume:

1. **The width algorithm is genuinely underspecified.** `w:tblLayout="autofit"` is described in the
   standard in terms of an outcome, not a procedure. Every implementation calibrates against observed
   Word behaviour — and per `F6` we cannot do that on this machine. So `P7-04` ships marked `SPEC-GAP`
   and `UNVERIFIABLE-HERE`, and the plan has to say what the approximation rests on rather than
   pretending the spec settled it (`G2`).
2. **Row splitting couples this phase to the hardest tickets in Phase 8.** A row that breaks across a
   page is simultaneously a table-layout problem and a pagination problem, and `w:cantSplit`,
   `w:tblHeader` and a `vMerge` span crossing the break each change what `P8-07` may do. This phase
   does not own the page-fill loop; it owns the contract it presents to it.

It ranks below Phases 6, 8 and 9 because everything else here is **finite and checkable**. The grid is
a coordinate system, border conflict is a precedence table, merges are an interval problem. Hard, but
none of it is a fixpoint and none of it is a new data structure.

---

## Verified against the schema

Read out of `assets/schema/transitional/wml.xsd` rather than from memory. Where these differ from
common assumption, the difference is the trap.

| Type | Values |
|---|---|
| `ST_TblWidth` | `nil` · `pct` · `dxa` · `auto` |
| `CT_TblWidth/@w` | **`ST_MeasurementOrPercent`** — a union, not an integer. See `P7-03`. |
| `ST_TblLayoutType` | `fixed` · `autofit` |
| `ST_Merge` | `continue` · `restart` |
| `ST_HeightRule` | `auto` · **`exact`** · `atLeast` — note `exact`, **not** `exactly` |
| `ST_TextDirection` | `tb` · `rl` · `lr` · `tbV` · `rlV` · `lrV` · `btLr` · `lrTb` · `lrTbV` · `tbLrV` · `tbRl` · `tbRlV` — **12 values, two overlapping naming generations** |

---

## Ticket index

| ID | Title | Size | Escalate |
|---|---|---|---|
| P7-01 | Grid model | L | **yes** |
| P7-02 | Vertical merge | M | no |
| P7-03 | Width resolution | M | no |
| P7-04 | Autofit: min/max content widths and distribution | L | **yes** |
| P7-05 | Fixed layout | S | no |
| P7-06 | Margins, cell spacing, table indent | M | no |
| P7-07 | Border conflict resolution | L | **yes** |
| P7-08 | Row height rules | S | no |
| P7-09 | Nested tables | M | no |
| P7-10 | Row splitting across pages | L | **yes** |
| P7-11 | Cell text direction | M | no |
| P7-12 | Floating tables | M | no |
| P7-13 | Conditional formatting application | M | no |
| P7-14 | Cell content layout | M | no |
| P7-15 | Table painting | M | no |

---

### P7-01 — Grid model

**Size** L · **Depends** — · **Escalate** **yes** · **Owns** `packages/layout/src/table/grid.ts`

**Goal.** One coordinate system that every later ticket addresses cells in.

**Trap.** Trusting `w:tblGrid`. In real documents the declared grid frequently disagrees with the
actual cell spans — a row whose `w:gridSpan` values sum to 7 in a 6-column grid, or a table whose
`w:gridCol` count does not match any row. **Word reconciles; it does not reject.** An implementation
that indexes cells by the declared grid produces off-by-one column assignments on exactly the
documents people complain about, and produces them silently.

Second trap: `w:gridBefore`/`w:gridAfter` are *skipped grid columns*, not cells. A row with
`gridBefore=2` starts at grid column 2 with no cell objects occupying 0 and 1. Iterating cells and
assuming cell index == grid index is wrong the first time a row is indented.

**Design.**

```pseudo
# Reconciliation pass, run once per table before any measurement:
fn buildGrid(tbl) -> Grid
    declared <- [gridCol.w for gridCol in tbl.tblGrid]
    for each row:
        used <- row.trPr.gridBefore + sum(cell.tcPr.gridSpan or 1) + row.trPr.gridAfter
        track max(used) across rows
    if max(used) > len(declared):
        # extend the declared grid with columns of width 0; autofit (P7-04) will
        # give them real widths. Do NOT drop the excess cells.
        append (max(used) - len(declared)) zero-width columns
    if max(used) < len(declared):
        # keep the extra declared columns; they are real and can be occupied by
        # a later row. Do not truncate.
    return Grid { colWidths: declared, colCount: len(declared) }

# Cell addressing - every later ticket uses this, nothing indexes cells directly:
fn cellsOf(row, grid) -> [{ cell, gridStart, gridEnd }]
    g <- row.trPr.gridBefore or 0
    for cell in row.tc:
        span <- cell.tcPr.gridSpan or 1
        yield { cell, gridStart: g, gridEnd: g + span }
        g <- g + span
    # row.trPr.gridAfter columns remain unoccupied at the end

# w:wBefore / w:wAfter give the WIDTH of the skipped region, which may disagree
# with the sum of the grid columns it spans. When it does, wBefore/wAfter wins
# for that row's geometry and the grid is left alone - the disagreement is
# per-row, not a grid defect.
```

**Done when.** A table whose `gridSpan` sum exceeds `tblGrid` lays out with every cell present; a table
with `gridBefore` places its first cell at the correct x; a row with fewer cells than grid columns does
not shift; `cellsOf` is the only path from a row to its cells (asserted by there being no other caller
of `row.tc` in the package).

---

### P7-02 — Vertical merge

**Size** M · **Depends** P7-01 · **Escalate** no

**Goal.** Resolve `w:vMerge` into vertical spans over the grid.

**Trap.** `w:vMerge` is `ST_Merge` = `continue | restart`, and **absent `@val` means `continue`**, not
`restart` — the opposite of the `ST_OnOff` habit (`B1`). A `<w:vMerge/>` with no attribute continues
the span above it. Reading it as `restart` breaks every merged table.

Second trap: a `continue` with no preceding `restart` in the same grid column. This occurs in real
documents. Treat the orphan as a `restart` (it becomes a one-row span) and emit a diagnostic — do not
throw (`B4`), and do not drop the cell.

**Design.**

```pseudo
fn resolveVMerge(rows, grid) -> spans
    open: Map<gridStart, {startRow, cell}>          # keyed by gridStart, not by cell index
    for r, row in rows:
        for {cell, gridStart} in cellsOf(row, grid):
            vm <- cell.tcPr.vMerge
            if vm is absent:
                close any open span at gridStart      # a normal cell ends the span above
            elif vm.val == 'restart' :
                close any open span at gridStart
                open[gridStart] <- {startRow: r, cell}
            else:                                     # 'continue', including absent @val
                if gridStart not in open:
                    report diagnostic 'orphan-vmerge-continue'
                    open[gridStart] <- {startRow: r, cell}    # treat as restart
                else: extend the open span to r
    # A span's content lives in the RESTART cell. Continue cells carry properties
    # (borders, shading) that still participate in P7-07, but no content.
```

**Height distribution.** A merged span's content height is measured once, on the restart cell, against
the **sum** of the heights of the rows it covers. If the content is taller, the extra height is added
to the **last** row of the span — matching Word, per `G1`. Distributing it evenly looks more principled
and is wrong.

**Done when.** `<w:vMerge/>` with no `@val` continues; an orphan `continue` renders as a one-row cell
with a diagnostic; a span taller than its rows grows the last row only; a `vMerge` column that is also
`gridSpan`-ed resolves by `gridStart`.

---

### P7-03 — Width resolution

**Size** M · **Depends** P7-01 · **Escalate** no

**Trap.** `CT_TblWidth/@w` is typed `ST_MeasurementOrPercent`, **not an integer**. It is a union that
admits two forms:

- the legacy unqualified integer — when `@type="pct"` this is **fiftieths of a percent**, so `5000`
  means 100%;
- the qualified string form `"50%"`.

An implementation that parses `@w` with `parseInt` reads `"50%"` as `50` and produces a table 1% wide.
This applies to `w:tblW`, `w:tcW`, `w:tblInd`, `w:tblCellSpacing`, `w:wBefore`, `w:wAfter` — every one
of them, because they all use `CT_TblWidth`.

**Design.**

```pseudo
fn resolveWidth(tblWidth, containerWidth) -> Twips | AUTO | NIL
    match tblWidth.type:
        'nil'  -> NIL              # explicitly zero-width, NOT 'unspecified'
        'auto' -> AUTO             # defer to P7-04
        'dxa'  -> twips(parseMeasurement(tblWidth.w))
        'pct'  -> containerWidth * parsePercent(tblWidth.w)
        absent -> AUTO             # per A3, absent is NOT the schema default

fn parsePercent(raw) -> fraction
    if raw ends with '%': return number(raw without '%') / 100
    else:                 return number(raw) / 5000        # fiftieths of a percent

# 'nil' and 'auto' are different and both are different from absent. A cell with
# type='nil' is a real zero-width cell; a cell with no tcW participates in
# autofit. Collapsing the three is the quiet version of this ticket's trap.
```

**Done when.** `@w="50%"` and `@w="2500"` with `type="pct"` both resolve to half the container; `nil`,
`auto` and absent are distinguishable in the resolved output; every `CT_TblWidth` site goes through
`resolveWidth` (no other caller parses `@w`).

---

### P7-04 — Autofit: min/max content widths and distribution

**Size** L · **Depends** P7-03, Phase 5 · **Escalate** **yes** · `SPEC-GAP` `UNVERIFIABLE-HERE`

**Goal.** Assign a width to every grid column when `w:tblLayout` is `autofit` or absent.

**Trap.** Believing the standard specifies this. It does not. It describes the intent — columns size to
content, subject to preferred widths — without giving the distribution procedure. Every real
implementation is a calibration. Per `G2` this must be marked `SPEC-GAP` **in the code**, with the
approximation and its evidence written down; per `F6`/ADR 0007 the phase report must say the algorithm
is unverified against Word, because it cannot be verified on this machine.

Second trap: measuring content width by laying out the cell. Min/max content width is a **property of
the shaped runs**, obtainable from Phase 4 without running the line breaker. Laying out every cell at
every candidate width is the difference between a table that lays out in 2 ms and one that takes 400 ms.

**Design.**

```pseudo
# Per cell, two numbers, both measured WITHOUT line breaking:
#   minContent = width of the widest unbreakable unit (longest word / CJK run /
#                inline drawing / a nowrap span), i.e. the narrowest the cell can
#                be without overflowing
#   maxContent = width with no wrapping at all
# Both include the cell's own margins (P7-06).
#
# For a cell spanning N columns, its min/max contribute to the SPAN, not to any
# single column. Resolve spans after single-column cells, distributing any
# shortfall across the spanned columns in proportion to their current widths.

fn autofit(grid, rows, available) -> colWidths
    for each column: min[c], max[c] <- max over single-column cells
    resolveSpans(min, max)                       # as above
    prefer[c] <- resolved w:tcW preferred widths, where consistent across the column

    if sum(max) <= available:
        widths <- max                            # everything fits unwrapped
        distribute the slack per the table's own w:tblW:
            tblW=auto -> leave the table narrow (do NOT stretch to the margin)
            tblW=pct/dxa -> stretch proportionally to reach the target
    elif sum(min) <= available:
        # interpolate between min and max on the shortfall
        widths[c] <- min[c] + (max[c]-min[c]) * (available-sum(min))/(sum(max)-sum(min))
    else:
        widths <- min                            # overflow; the table is wider than the column
        report diagnostic 'table-overflows-container'

    apply preferred widths as CONSTRAINTS, not overrides: a preferred width below
    min[c] is clamped to min[c]. Word does not let a preferred width cut a word in
    half, and neither do we (G1).

# SPEC-GAP: the linear interpolation in the middle branch is the calibration
# point. Word's real behaviour is closer to linear than to proportional-to-max,
# on the evidence of the shapes tables take in practice - but this is an
# inference, not a measurement, and it is recorded as one.
```

**Done when.** The `SPEC-GAP` comment exists in the source with the approximation and its stated
evidence; min/max are computed without invoking the line breaker (asserted by a counter); a spanned
cell widens its columns proportionally; a preferred width narrower than `minContent` is clamped; the
phase report carries the `UNVERIFIABLE-HERE` caveat verbatim.

---

### P7-05 — Fixed layout

**Size** S · **Depends** P7-03 · **Escalate** no

`w:tblLayout/@type="fixed"`: column widths come from `w:tblGrid` and `w:tcW`, content does not
influence them, and content that does not fit is clipped or overflows per `P7-14`'s `w:noWrap` rules.
The first row's cell widths take precedence over `tblGrid` where they disagree — verify this against
observed behaviour and mark `SPEC-GAP` if it cannot be settled here.

**Done when.** A fixed-layout table ignores content width entirely (asserted by laying the same table
out with short and long content and getting identical column widths).

---

### P7-06 — Margins, cell spacing, table indent

**Size** M · **Depends** P7-01 · **Escalate** no

**Trap.** `w:tblCellSpacing` changes the geometry the grid maps onto. With spacing, cells do not tile
the grid — each cell is inset within its grid slot and the borders separate rather than share. That
means `P7-07`'s border conflict resolution **does not apply** when spacing is non-zero: there is no
shared edge to resolve. Implementing conflict resolution unconditionally draws the wrong borders on
every spaced table.

```pseudo
# Precedence for cell margins, innermost wins:
#   w:tcMar (cell)  >  table style's tblCellMar  >  w:tblCellMar (table)  >  default
# Default is 0/108/0/108 twips (top/left/bottom/right) - verify against the
# schema's documented defaults and note that per A3 we do not apply them at read
# time; they are applied here, in resolution.
#
# w:tblInd indents the whole table from the text area's leading edge. Under RTL
# (w:bidiVisual) it indents from the other side.
#
# Effective content width of a cell:
#   sum(colWidths[gridStart..gridEnd]) - leftMar - rightMar - borderWidths
#   - (cellSpacing ? 2*cellSpacing : 0)
```

**Done when.** `tcMar` overrides `tblCellMar`; a table with `tblCellSpacing` renders separated borders
and skips conflict resolution; `tblInd` flips side under `bidiVisual`.

---

### P7-07 — Border conflict resolution

**Size** L · **Depends** P7-06, P3-09 · **Escalate** **yes**

**Goal.** Decide which border wins on every shared edge.

**Trap.** Getting the precedence order approximately right. The failure is invisible per cell — one
edge slightly the wrong colour or weight — and wrong across the entire document at once. It is also the
kind of bug that survives review because every individual case looks defensible.

**Design.**

```pseudo
# Only applies when tblCellSpacing == 0 (P7-06). Otherwise borders are separate.
#
# Each shared edge has two claimants: the cell on each side. Plus the table's own
# insideH/insideV, plus conditional formatting (P3-09), plus the outer table
# border on the table's perimeter.
#
# PRECEDENCE, highest first:
#   1. Direct w:tcBorders on either adjacent cell
#   2. Conditional-format borders from w:cnfStyle / the table style's conditional
#      slots (P7-13) - first/last row and column beat the banding slots
#   3. Table-level w:tblBorders insideH / insideV (for interior edges)
#      or top/left/bottom/right (for perimeter edges)
#   4. Table style's tblBorders
#   5. No border
#
# WITHIN a tie at the same precedence level, the winner is decided by weight, in
# this order - and this is the part that gets implemented as "thicker wins" and
# is not:
#   a. A 'nil' or 'none' border LOSES to any visible border. An explicit "no
#      border" does not erase the neighbour's border.
#   b. Wider w:sz wins.
#   c. Equal width: the style ranks (double > single > dashed > dotted), not the
#      colour.
#   d. Still equal: darker colour wins.
#   e. Still equal: the LEFT/TOP cell's border wins - a deterministic tie-break,
#      not an arbitrary one (C1 applies to layout too; the same document must
#      lay out identically every run).

fn resolveEdge(edge) -> Border | NONE
    candidates <- collect from both sides at every precedence level
    return highest-precedence non-empty level, tie-broken by (a)..(e)
```

**Done when.** Each of the five precedence levels is exercised by a fixture; `nil` loses to a visible
neighbour; a width tie resolves by style rank then colour then position; two runs over the same table
produce identical borders; spaced tables bypass the whole path.

---

### P7-08 — Row height rules

**Size** S · **Depends** P7-02 · **Escalate** no

`w:trHeight/@w:val` with `@w:hRule` — `ST_HeightRule` is `auto | exact | atLeast`. **The value is
`exact`, not `exactly`** (`w:spacing`'s `ST_LineSpacingRule` uses the same three tokens, likewise
`exact`). A string comparison against `"exactly"` silently falls through to the `auto` branch and the
row grows to fit, which looks correct on most documents.

`exact` clips content that does not fit. Clipping is the point — do not grow.

**Done when.** `exact` clips; `atLeast` grows; `auto` ignores `@val`; a fixture asserts the literal
token `exact` is matched.

---

### P7-09 — Nested tables

**Size** M · **Depends** P7-01 · **Escalate** no

A table inside a cell lays out against the cell's content width, recursively. Two things to pin down:

- **Depth limit.** Unbounded nesting is a denial-of-service surface (`P11-09`). Cap it, and render
  beyond the cap as a labelled placeholder (`G3`) rather than truncating silently.
- **The inheritance boundary.** A nested table does **not** inherit the outer table's `tblPr`; it does
  inherit paragraph and run properties through the normal cascade (`P3-06`), because the cell's
  paragraph context is its parent. Conflating the two inherits borders into nested tables, which is
  visible and wrong.

**Done when.** A three-deep nesting lays out; the depth cap produces a placeholder and a diagnostic;
a nested table does not inherit the outer `tblBorders` but does inherit the cell's run properties.

---

### P7-10 — Row splitting across pages

**Size** L · **Depends** P7-02, P7-08, P8-07, P8-08 · **Escalate** **yes**

**Goal.** Define the contract this phase presents to the page-fill loop.

**Trap.** Implementing splitting inside the table layout. Pagination owns where the break goes
(`P8-07`); the table owns what is splittable and what the fragments look like. An implementation that
decides its own page breaks fights `P8-08`'s backtracking and the two disagree on documents with both
`cantSplit` and `keepNext`.

**Design.**

```pseudo
# What the table hands to P8-07, per row:
RowFragmentable = {
    canSplit:       bool,      # false if w:cantSplit, or the row contains a
                               # nested table that cannot split, or any cell in
                               # the row is part of an open vMerge span (see below)
    splitPoints:    [y...],    # line boundaries within the row's tallest cell
    minFirstHeight: Twips,     # widow/orphan floor for the first fragment
    isHeader:       bool       # w:tblHeader
}

# w:tblHeader: the leading run of rows marked tblHeader repeats at the top of
# every page the table continues onto. Only a LEADING run counts - a tblHeader
# row in the middle of the table is not a header and does not repeat. Repeated
# header rows are laid out again, not copied as bitmaps, because conditional
# formatting (firstRow) applies to them on every page.
#
# vMerge across a break is the hard case. A span whose restart is on page 1 and
# whose continue rows are on page 2:
#   - the content lives in the restart cell and does NOT reflow into page 2
#   - Word draws the span's content in the first fragment and leaves the
#     continuation cells empty with their borders intact
#   - therefore: a row participating in an open vMerge span reports canSplit=false
#     for the span's own rows, but the SPAN may still break between rows
#
# Interaction with keep constraints: w:cantSplit is a keep constraint and goes
# through P8-08's backtracking with the same mandatory escape hatch - a row
# taller than a page must be placed and clipped, with a diagnostic, never looped.
```

**Done when.** A long row splits at a line boundary; `cantSplit` moves the whole row; a leading
`tblHeader` run repeats on continuation pages and a mid-table one does not; a `vMerge` span crossing a
break keeps its content in the first fragment with borders continuing; a row taller than the page is
placed with a diagnostic rather than looping.

---

### P7-11 — Cell text direction

**Size** M · **Depends** Phase 5 · **Escalate** no

`w:textDirection`, `ST_TextDirection`, **12 values across two naming generations**:
`tb` · `rl` · `lr` · `tbV` · `rlV` · `lrV` · `btLr` · `lrTb` · `lrTbV` · `tbLrV` · `tbRl` · `tbRlV`.

**Trap.** Two of them. First, treating this as a canvas rotation — it is a **layout-axis swap**: the
cell's available width becomes the line-breaking extent along the vertical axis, so line breaking must
run against the rotated extent, not against the horizontal width and then be rotated. Rotating after
layout gives text that wraps at the wrong points.

Second, the two naming generations overlap in meaning (`lr` and `lrTb` describe the same flow; `tb`
and `tbRl` likewise). Build one normalisation table from all 12 tokens to a `(flowAxis, glyphRotation)`
pair and switch on that, never on the raw token — a switch on raw tokens will be missing cases and
`noFallthroughCasesInSwitch` will not catch a missing *value*, only a missing `break`.

**Done when.** All 12 tokens normalise; line breaking uses the rotated extent (asserted by a cell that
wraps differently in `tbRl` than `lr` at the same size); glyph rotation matches the normalised pair.

---

### P7-12 — Floating tables

**Size** M · **Depends** P9-02 · **Escalate** no

`w:tblpPr`: `@tblpX`/`@tblpY` or `@tblpXSpec`/`@tblpYSpec`, `@horzAnchor`/`@vertAnchor`
(`text`|`margin`|`page`), `@leftFromText`/`@rightFromText`/`@topFromText`/`@bottomFromText`.

This is the same machinery as `P9-01`/`P9-02` — resolve to a rect, inflate by the `*FromText`
distances, contribute to the page's exclusion store. Do not build a second float system. Consecutive
tables with identical `tblpPr` behave like `w:framePr` (`P9-07`) and merge into one floating block.

**Done when.** A floating table contributes an exclusion that text wraps around; `*FromText` inflates
the exclusion; the resolution path is `P9-01`'s, asserted by there being no second anchor resolver.

---

### P7-13 — Conditional formatting application

**Size** M · **Depends** P3-09 · **Escalate** no

Resolution lives in `P3-09`; this ticket **applies** the resolved result to grid positions.

```pseudo
# Position -> conditional slots, computed from the grid (P7-01), not from cell order:
#   firstRow / lastRow / firstCol / lastCol
#   band1Horz / band2Horz / band1Vert / band2Vert
#   neCell / nwCell / seCell / swCell
#
# w:tblLook (@firstRow @lastRow @firstColumn @lastColumn @noHBand @noVBand)
# ENABLES slots. A style may define firstRow formatting that tblLook switches off.
# Banding counts (@w:val on w:tblStyleRowBandSize / w:tblStyleColBandSize) change
# which rows are band1 vs band2 - banding is not simply alternating.
#
# Banding indices SKIP header rows and the first/last row when those slots are
# enabled. Counting from row 0 unconditionally shifts the stripes by one, which
# is visible on every banded table and is the standard way this is wrong.
#
# w:cnfStyle on a row or cell OVERRIDES the computed position outright. It is a
# bitmask carried as a string of '0'/'1' characters - verify the bit order
# against the schema and record it; reading it as a number is wrong.
```

**Done when.** Banding skips header and first/last rows; `tblLook` disables a slot the style defines;
`cnfStyle` overrides the computed position; corner slots beat the row and column slots they overlap.

---

### P7-14 — Cell content layout

**Size** M · **Depends** Phase 5, P7-06 · **Escalate** no

`w:vAlign` in `w:tcPr` (top/center/bottom) positions content within the cell's height once the row
height is known — so it runs **after** `P7-08`, not during measurement.

`w:noWrap` suppresses wrapping, which feeds `P7-04`'s `minContent` (a `noWrap` cell's minimum is its
maximum). `w:tcFitText` scales glyph advances to make the content exactly fill the cell — implemented
via `P5-10`'s character-level `w:w` mechanism, not by changing the font size.

**Done when.** `vAlign=center` centres against the final row height; a `noWrap` cell reports
`minContent == maxContent` to autofit; `tcFitText` scales advances without changing font size.

---

### P7-15 — Table painting

**Size** M · **Depends** P7-07, P5-13 · **Escalate** no

Paint order within a table, which is a z-order problem and not merely a loop order:

```pseudo
1. table shading (w:shd on tblPr)
2. row shading
3. cell shading (w:shd on tcPr) - including on vMerge CONTINUE cells, which
   have no content but do have shading
4. cell content (P5-13 display list)
5. borders LAST, over the content
#
# Borders paint last because a border shares an edge with two cells and must not
# be half-covered by whichever cell painted second.
#
# Against floats: the table is ordinary block content, so it sits below
# behindDoc=false floats and above behindDoc=true ones (P9-02). A FLOATING table
# (P7-12) is itself a float and takes its z-order from the exclusion store.
```

**Done when.** Borders paint over content; `vMerge` continue cells show shading; a table under a
non-`behindDoc` float is overpainted by it; a floating table z-orders against other floats.

---

## Phase 7 exit criteria

1. All tickets closed per their **Done when** clauses.
2. The `SPEC-GAP` comment for `P7-04` exists in the source, names the approximation, and states the
   evidence it rests on.
3. The phase report carries the `UNVERIFIABLE-HERE` caveat for autofit and border resolution verbatim
   from `F6` — no sentence in it describes table layout as Word-compatible.
4. Layout goldens (`P5-17`) exist for: a `gridSpan`/`gridBefore` table whose grid disagrees with its
   rows, a `vMerge` span crossing a page break, a banded table with header rows, and a spaced table
   (`tblCellSpacing` non-zero) showing separated borders.
5. Two consecutive layout runs over the corpus produce byte-identical goldens.
