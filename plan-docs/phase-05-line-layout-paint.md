# Phase 5 — Line layout and first paint

> **Difficulty rank 5 of 11.**
>
> **Depends on** Phase 4 (shaped runs, `P4-12`) and Phase 3 (resolved properties, `P3-06`).
>
> **Owns** `packages/layout/src/line/`, `packages/paint/`.

## Why this phase ranks here

This phase produces **the single most-depended-on data structure in the system**. Caret placement
(`P6-01`), hit-testing (`P6-03`), selection geometry (`P6-06`), float exclusion (`P9-05`), table cell
content (`P7-14`), incremental relayout (`P6-13`) and the layout goldens that guard all of them
(`P11-05`) every one of them reads the line box.

Its shape is fixed here. Changing it later means touching Phases 6, 7, 8 and 9 simultaneously — which
is why `P5-01` is the only XL in a phase otherwise made of ordinary, checkable work, and why the two
constraints that phase 9 and the demo app impose on it (**segments**, and **serializability**) are
written into the tickets rather than discovered later.

It ranks fifth rather than higher because everything after `P5-01` and `P5-13` is finite: greedy
breaking is an algorithm with a known shape, tab stops are a table lookup, painting is a loop. The risk
is concentrated in two tickets, not spread across the phase.

---

## Verified against the schema

Read out of `assets/schema/transitional/wml.xsd`. Where these differ from the obvious assumption, the
difference is the trap.

| Type                 | Values                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ST_Jc`              | `start` · `center` · `end` · `both` · `mediumKashida` · `distribute` · `numTab` · `highKashida` · `lowKashida` · `thaiDistribute` · `left` · `right` — **12 values**, including three Kashida forms and `numTab`        |
| `ST_LineSpacingRule` | `auto` · **`exact`** · `atLeast` — note `exact`, **not** `exactly`                                                                                                                                                      |
| `ST_TabJc`           | `clear` · `start` · `center` · `end` · `decimal` · `bar` · `num` · `left` · `right`                                                                                                                                     |
| `ST_TabTlc`          | `none` · `dot` · `hyphen` · `underscore` · `heavy` · `middleDot`                                                                                                                                                        |
| `ST_Underline`       | **18 values** — `single` `words` `double` `thick` `dotted` `dottedHeavy` `dash` `dashedHeavy` `dashLong` `dashLongHeavy` `dotDash` `dashDotHeavy` `dotDotDash` `dashDotDotHeavy` `wave` `wavyHeavy` `wavyDouble` `none` |
| `ST_Em`              | `none` · `dot` · `comma` · `circle` · `underDot`                                                                                                                                                                        |
| `ST_TextEffect`      | `blinkBackground` · `lights` · `antsBlack` · `antsRed` · `shimmer` · `sparkle` · `none`                                                                                                                                 |
| `ST_TextAlignment`   | `top` · `center` · `baseline` · `bottom` · `auto`                                                                                                                                                                       |

Note the `ST_Underline` asymmetry: the light/heavy pairs are **not** named consistently —
`dotted`/`dottedHeavy` but `dash`/`dashedHeavy`, and `dotDash`/`dashDotHeavy`,
`dotDotDash`/`dashDotDotHeavy`. Any mapping built by appending `"Heavy"` to a base name is wrong for
four of the eighteen.

---

## Ticket index

| ID    | Title                                   | Size | Escalate |
| ----- | --------------------------------------- | ---- | -------- |
| P5-01 | The line box                            | XL   | **yes**  |
| P5-02 | Inline item stream                      | M    | no       |
| P5-03 | Greedy line breaking                    | L    | **yes**  |
| P5-04 | Break opportunities: UAX#14 and kinsoku | M    | no       |
| P5-05 | Indentation                             | S    | no       |
| P5-06 | Tab stops                               | M    | no       |
| P5-07 | Justification                           | L    | no       |
| P5-08 | Paragraph spacing                       | M    | no       |
| P5-09 | Baseline computation                    | M    | no       |
| P5-10 | Character-level metrics                 | S    | no       |
| P5-11 | Hyphenation                             | M    | no       |
| P5-12 | Drop caps                               | S    | no       |
| P5-13 | Display list                            | L    | **yes**  |
| P5-14 | Glyph-run batching                      | M    | no       |
| P5-15 | Page bitmap cache                       | M    | no       |
| P5-16 | devicePixelRatio, zoom, virtualization  | M    | no       |
| P5-17 | Layout-golden serialization format      | M    | **yes**  |
| P5-18 | Text decoration painting                | M    | no       |

---

### P5-01 — The line box

**Size** XL · **Depends** P4-12 · **Escalate** **yes** · **Owns** `packages/layout/src/line/linebox.ts`

**Goal.** The data structure everything downstream reads. Must produce an ADR.

**Trap — segments.** Defining a line as having _one_ width. It is the obvious shape, it is correct for
every document without floats, and it is wrong. `P9-05` requires a line beside a float to occupy the
free space **between** exclusions, which can be two or more disjoint x-intervals. Retrofitting that
means touching justification, tab stops, hit-testing, selection geometry and caret placement — every
consumer written between now and then.

**So: a line is a list of segments from the start, and the common case is a list of one.** Phase 9's
`P9-05` says explicitly that if segments are discovered in Phase 9, Phase 5 was wrong. This is that
sentence's counterpart.

**Trap — back-references.** Storing only glyphs and positions. The caret has to map a screen point to a
document position and back, so every cluster must know where it came from. A line box that cannot
answer "which document offset is this pixel" forces Phase 6 to rebuild a parallel index, and the two
drift.

**Design.**

```pseudo
Line = {
    segments:   Segment[],          # >= 1. One element in the common case.
    top, height, baseline: Twips,   # baseline measured from top (P5-09)
    paraId:     NodeId,             # P3-01 stable identity, NOT an index
    breakKind:  WRAP | EXPLICIT | PARA_END | PAGE | COLUMN,
    isFirst, isLast: bool,          # for firstLine indent / last-line justify
}

Segment = {
    x, width:   Twips,              # the segment's own box
    runs:       GlyphRun[],
    direction:  LTR | RTL,          # visual direction of this segment
}

GlyphRun = {
    font:       FontKey,            # P4-11 cache key, not a string
    size:       HalfPoint,
    clusters:   Cluster[],
    style:      ResolvedRunProps,   # P3-06 - shared, never copied per run
    srcNode:    NodeId,             # the w:r this came from
}

Cluster = {
    xOffset:    Twips,              # from the segment's x, in VISUAL order
    advance:    Twips,
    glyphs:     GlyphId[],          # a cluster may be several glyphs (ligature,
                                    # mark attachment) or several chars (CJK, IVS)
    srcOffset:  int,                # offset within srcNode - the back-reference
    srcLength:  int,                # chars consumed; > 1 for ligatures/graphemes
}

# INVARIANTS this structure must hold, and which the ADR must state:
#   - clusters within a run are in VISUAL order; srcOffset is in LOGICAL order and
#     is NOT monotonic across an RTL run. P6-02 depends on this being explicit.
#   - srcOffset/srcLength tile the source text with no gaps and no overlaps, so
#     document offset -> cluster is a binary search and not a scan.
#   - A cluster is the smallest caret-addressable unit. Caret positions exist at
#     cluster boundaries only (P6-01's DocPos is constrained by this).
#   - Nothing here holds a reference to the paragraph's mutable model beyond
#     NodeId, so a line can outlive an edit long enough for P6-13 to compare it.

# Memory: HOT-PATH. A 500-page document is ~25,000 lines. Cluster must be a flat
# numeric record, not a class with an object per glyph. Specify the layout
# (parallel typed arrays vs packed struct) in the ADR and measure it - this is
# the one place in the phase where the representation decision is empirical.
```

**Done when.** The ADR exists and states the three invariants above with their rationale; a line with
two segments lays out and both segments are addressable; `srcOffset` is non-monotonic across an RTL
run and a test asserts that the offset→cluster lookup still works; a 500-page document's lines fit
within a stated memory budget, measured and pasted.

---

### P5-02 — Inline item stream

**Size** M · **Depends** P4-12, P3-06 · **Escalate** no

**Goal.** Flatten a paragraph into the linear sequence the break loop consumes.

```pseudo
InlineItem =
    | Text      { shapedRun, breakOpportunities }    # P4-12, P5-04
    | Tab       { tabProps }                         # P5-06
    | Break     { kind: line | page | column, clear: none|left|right|all }
    | Drawing   { inline: bool, extent }             # wp:inline occupies a box;
                                                     # wp:anchor is NOT an item,
                                                     # it goes to P9-02
    | FieldMark { begin | separate | end }           # P8-15 state machine
    | Annotation{ bookmarkStart/End, commentRange... }  # zero-width, P3-03
    | NoteRef   { footnote | endnote }               # P8-09 reserves space

# Zero-width items are the subtle ones. A bookmark start between two characters
# is a real position the caret can occupy and a real thing that must round-trip
# (A1), but it contributes no advance. Dropping them from the stream because
# they have no width loses them on save.
#
# w:br/@clear on a line break interacts with floats: 'clear' advances past the
# exclusion rather than to the next line (P9-05's SKIP_BAND).
```

**Done when.** Zero-width annotations survive the stream and appear in the line box; `w:br` with
`@clear` advances past an exclusion; an inline drawing occupies a box in the line.

---

### P5-03 — Greedy line breaking

**Size** L · **Depends** P5-01, P5-02, P5-04 · **Escalate** **yes**

**Goal.** Fill segments with items, breaking at opportunities.

**Trap.** Optimising. Word is **greedy** — it takes the last opportunity that fits and never looks
back. Knuth-Plass produces better-looking paragraphs and different line breaks, which means different
pagination, which means every layout golden and every page number disagrees with Word. `G1` is
explicit: matching Word is the requirement and "better" is wrong here.

```pseudo
fn breakParagraph(items, para) -> Line[]
    y <- paragraphTop
    while items remain:
        height <- provisional line height (P5-09, from the tallest run so far)
        segs   <- exclusions.availableSegments(y, height, container)   # P9-05
        if segs empty: y <- advance past the exclusion; continue       # SKIP_BAND
        place greedily across segs:
            for each opportunity, if the run up to it fits the current segment,
            remember it; when it no longer fits, break at the LAST remembered one
        if no opportunity fits at all:
            overflow the first unbreakable unit into the segment (never loop),
            report diagnostic 'unbreakable-overflow'
        finalise height; if it crossed into a different exclusion band, re-query
        and re-place ONCE (P9-05 - bounded, not iterated)
        y <- y + height + spacing (P5-08)

# The last-opportunity-that-fits rule is the whole algorithm. Resist every
# instinct to improve it.
```

**Done when.** A paragraph breaks identically to a hand-traced greedy run on a fixture; an unbreakable
word longer than the line overflows rather than looping; the re-query on height change happens at most
once per line (asserted by a counter).

---

### P5-04 — Break opportunities: UAX#14 and kinsoku

**Size** M · **Depends** P4-08 · **Escalate** no

UAX#14 line-break classes for the general case; JLREQ kinsoku for CJK — characters that may not begin a
line (closing brackets, small kana, sokuon, punctuation) and may not end one (opening brackets).
`Intl.Segmenter` does not give line-break opportunities, only grapheme/word/sentence — so this is
either a table or a dependency, and the ticket must say which and why.

`w:kinsoku`, `w:overflowPunct`, `w:topLinePunct`, `w:autoSpaceDE`, `w:autoSpaceDN` from settings modify
the rules. `w:wordWrap` (off = break anywhere, for Latin in narrow CJK columns) is the escape hatch.

**Done when.** A closing bracket does not start a line; an opening bracket does not end one;
`w:wordWrap="0"` permits mid-word breaks; the table's provenance is recorded.

---

### P5-05 — Indentation

**Size** S · **Depends** P3-06 · **Escalate** no

`w:ind` carries both `@left`/`@right` and `@start`/`@end`, plus `@firstLine`/`@hanging` and their
`@firstLineChars`/`@hangingChars`/`@startChars`/`@endChars` character-unit variants.

**Trap.** `start`/`end` are logical (flip under RTL); `left`/`right` are physical (do not). Both can be
present on the same `w:ind`. Establish the precedence once, apply it everywhere, and note per `A3` that
absent is not zero — it is unspecified, and resolves through the cascade.

`@hanging` and `@firstLine` are mutually exclusive in practice; `@hanging` is a negative first-line
indent relative to `@left`/`@start`, not an independent value.

**Done when.** `start` flips under `w:bidi` and `left` does not; both present resolves by the stated
precedence; `hanging` produces a first line to the left of the body indent.

---

### P5-06 — Tab stops

**Size** M · **Depends** P5-01, P5-05 · **Escalate** no

`w:defaultTabStop` from `w:settings`, `w:tabs/w:tab` with `@val` (`ST_TabJc`), `@pos`, `@leader`
(`ST_TabTlc`).

**Trap — segments.** A tab advances to a position, but with floats the line is segmented (`P5-01`) and
a tab stop may fall inside an _excluded_ interval. Advancing to it puts text under the float. The rule:
a tab that lands in an exclusion advances to the **start of the next segment** instead.

**Trap — clear.** `ST_TabJc` includes `clear`, which _removes_ an inherited tab stop rather than
defining one. A `clear` entry treated as a stop puts a tab stop at position 0.

```pseudo
# Resolution: style-chain tabs merged by @pos, then w:clear entries REMOVE, then
# defaultTabStop fills the remainder at regular intervals beyond the last
# explicit stop.
#
# decimal: align the decimal separator - which is LOCALE-dependent, so it comes
# from w:themeFontLang / the run's w:lang, not from a hardcoded '.'.
# bar:     draws a vertical rule and does NOT advance the pen.
# num:     list-number alignment (P10-01), behaves as 'start' for plain text.
#
# Leaders fill the advanced distance and are painted in the run properties
# active AT THE TAB, not at the following text.
```

**Done when.** `clear` removes an inherited stop; a tab landing in an exclusion advances to the next
segment; `bar` draws without advancing; a decimal tab aligns on a locale-appropriate separator;
leaders paint with the tab's own run properties.

---

### P5-07 — Justification

**Size** L · **Depends** P5-03, P5-01 · **Escalate** no

`ST_Jc` has **12 values**, and three of them are Arabic Kashida forms (`lowKashida`, `mediumKashida`,
`highKashida`) that justify by _elongating_ connected letters rather than by widening spaces. An
implementation that maps everything except `both` and `distribute` onto `start` silently renders Arabic
documents unjustified.

```pseudo
# start/left, end/right, center: trivial, but start/end flip under RTL and
# left/right do not - same duality as P5-05.
# both:           expand inter-word spaces only
# distribute:     expand inter-CHARACTER spacing as well, evenly
# thaiDistribute: distribute with Thai cluster rules
# *Kashida:       elongate via the font's kashida/tatweel, at the three strengths;
#                 requires shaper support (P4-09) - if the font has no kashida,
#                 fall back to 'both' and record it (G3), do not silently do
#                 nothing
# numTab:         legacy list alignment (P10-01)
#
# The last line of a justified paragraph is NOT justified (it takes the
# paragraph's base direction alignment) - except under 'distribute', where it is.
# This asymmetry is real and is the commonest justification bug.
#
# PER SEGMENT (P5-01): with floats, each segment justifies within its own width.
# Justifying against the sum of segment widths stretches text across the float.
```

**Done when.** All 12 `ST_Jc` values are handled distinctly or explicitly fall back with a record;
last-line behaviour differs between `both` and `distribute`; a two-segment line justifies each segment
independently; Kashida without font support falls back visibly.

---

### P5-08 — Paragraph spacing

**Size** M · **Depends** P3-06 · **Escalate** no

`w:spacing` — `@before`/`@after` (twips) with `@beforeLines`/`@afterLines` (hundredths of a line) and
`@beforeAutospacing`/`@afterAutospacing`; `@line` with `@lineRule` (`ST_LineSpacingRule`:
`auto | exact | atLeast` — **`exact`, not `exactly`**).

```pseudo
# lineRule semantics:
#   auto    -> @line is in 240ths of a line (240 = single, 360 = 1.5x)
#   exact   -> @line is twips, absolute; content taller than it is CLIPPED
#   atLeast -> @line is twips, a floor
#
# Adjacent paragraph spacing: Word takes max(prev.after, next.before), it does
# not sum them - EXCEPT across a table boundary and at a page top, where before
# is suppressed. Summing is the intuitive implementation and is wrong everywhere.
#
# w:contextualSpacing suppresses before/after between paragraphs OF THE SAME
# STYLE. SPEC-GAP (G2): "same style" is underspecified - same styleId, or same
# resolved formatting, or same numbering? Pick one, write down which and why,
# and mark it.
#
# *Autospacing overrides @before/@after with a font-derived value (roughly 14pt
# for CJK contexts, 0 otherwise). Another SPEC-GAP - the derivation is not
# normative. Record what you chose.
```

**Done when.** Adjacent spacing takes the max, not the sum; `exact` clips; the two `SPEC-GAP` marks
exist in source with their reasoning; spacing before is suppressed at a page top.

---

### P5-09 — Baseline computation

**Size** M · **Depends** P4-13 · **Escalate** no

**Goal.** One baseline per line, given runs of mixed fonts and sizes.

```pseudo
# The line's ascent is max over runs of (run ascent + any raise), descent is max
# of (descent - raise). Height = ascent + descent, subject to P5-08's lineRule.
#
# Which ascent/descent? P4-13's metric-selection decision applies here and the
# two tickets must agree - OS/2 typo vs hhea vs win metrics differ by enough to
# shift every line in the document.
#
# w:vertAlign (superscript/subscript) shifts the baseline AND conventionally
# reduces the size. The reduction factor is not normative - SPEC-GAP, record it.
# w:position raises/lowers in HALF-POINTS without changing size, and a raised run
# DOES increase the line's ascent (it is not clipped).
# w:textAlignment (ST_TextAlignment: top|center|baseline|bottom|auto) aligns
# runs of differing size within the line - it is not the same as w:vAlign.
```

**Done when.** A line of mixed sizes puts all baselines on one line; a raised run grows the line;
`w:textAlignment=center` centres rather than baseline-aligns; the metric choice matches `P4-13`.

---

### P5-10 — Character-level metrics

**Size** S · **Depends** P4-12 · **Escalate** no

Character `w:spacing` (twips, added to every advance — may be negative), `w:kern` (a **minimum font
size in half-points at or above which kerning applies**, not a boolean), `w:w` (percentage stretch of
advances, and the mechanism `P7-14`'s `tcFitText` reuses).

**Trap.** `w:kern` reads like an on/off toggle and is a threshold. `<w:kern w:val="16"/>` means "kern at
8pt and above". Treating it as truthy kerns everything; treating absence as false disables kerning the
document asked for.

**Done when.** `w:kern` is compared against the run's size; negative character spacing tightens without
reordering clusters; `w:w` scales advances and not glyph geometry.

---

### P5-11 — Hyphenation

**Size** M · **Depends** P5-04 · **Escalate** no

`w:autoHyphenation`, `w:suppressAutoHyphens` (paragraph-level), `w:hyphenationZone`,
`w:consecutiveHyphenLimit`, `w:doNotHyphenateCaps`.

**The honest constraint:** hyphenation requires per-language pattern dictionaries (Liang patterns) we
do not ship and cannot derive. State the policy plainly: **without a dictionary, hyphenation is not
performed**, the document lays out with wider ragged edges than Word, and this is recorded in the
coverage manifest (`G4`) rather than silently approximated. An approximate hyphenator that breaks words
in the wrong places is worse than not hyphenating, because it is wrong in a way users read.

Explicit hyphens (`w:softHyphen`, `w:noBreakHyphen`) are **not** affected by this and must work — they
are break opportunities in the item stream (`P5-02`), not dictionary output.

**Done when.** Soft and non-breaking hyphens behave correctly with no dictionary present; auto
hyphenation is recorded as unimplemented in the manifest; `consecutiveHyphenLimit` is honoured if a
dictionary is later supplied.

---

### P5-12 — Drop caps

**Size** S · **Depends** P9-07 · **Escalate** no

Drop caps are `w:framePr` with `@dropCap` (`drop`|`margin`) and `@lines`. They are **not** a line-layout
special case — the capped character becomes a frame, the frame becomes an exclusion (`P9-02`), and the
following lines wrap around it through the ordinary segment machinery (`P5-01`). Implementing them as a
bespoke first-line rule duplicates the float system and disagrees with it.

**Done when.** A drop cap produces an exclusion; `@lines` controls how many lines wrap; `margin` places
it outside the text area; no code path exists for drop caps outside the frame path.

---

### P5-13 — Display list

**Size** L · **Depends** P5-01 · **Escalate** **yes** · **Owns** `packages/paint/src/displaylist.ts`

**Goal.** The paint-side representation, sitting between layout and canvas.

**Trap.** Painting directly from line boxes. Decision D4 keeps everything on the main thread for v1
**but requires that the worker/`OffscreenCanvas` boundary can be introduced later without a rewrite**.
That is only true if the display list is **serializable** — no closures, no model references, no canvas
objects, no `Path2D` instances, nothing that cannot cross `postMessage`. A display list holding a
callback is indistinguishable from a correct one until the day someone tries to move it to a worker,
and then the whole paint layer is rewritten.

```pseudo
DisplayItem =                       # all fields plain numbers, strings, or typed arrays
    | GlyphRunItem { fontKey, size, color, x, y, glyphs, positions }
    | RectItem     { x, y, w, h, fill }
    | LineItem     { x1, y1, x2, y2, stroke, width, dash }
    | PathItem     { commands: Float32Array, fill?, stroke? }   # P9-11 geometry,
                                                                # NOT a Path2D
    | ImageItem    { partKey, sx, sy, sw, sh, dx, dy, dw, dh }  # key, not bitmap
    | ClipPush     { x, y, w, h } | ClipPop
    | TransformPush{ matrix: [6 numbers] } | TransformPop

# Rules the ADR must state:
#   - Items reference fonts and images by KEY. Resolution to a live FontFace or
#     ImageBitmap happens at paint time, on whichever thread paints.
#   - No item holds a NodeId-to-model pointer. Hit-testing reads line boxes, not
#     the display list - they are separate concerns and coupling them is how the
#     display list stops being serializable.
#   - Order is paint order. No z-index field; the producer sorts (P9-02, P7-15).
#
# Enforcement: a structuredClone() round-trip over a page's display list is the
# cheap, decisive test that serializability has not been lost. Wire it as a gate,
# not as a convention - conventions erode.
```

**Done when.** `structuredClone` of a page's display list succeeds and the clone paints identically;
no display item holds a function, `Path2D`, `ImageBitmap` or model reference (asserted by the gate); a
page containing text, a table, an image and a rotated shape round-trips.

---

### P5-14 — Glyph-run batching

**Size** M · **Depends** P5-13 · **Escalate** no · `HOT-PATH`

In Canvas 2D the expensive operations are **state changes** — assigning `ctx.font` and `ctx.fillStyle`
— not `fillText` itself. A naive painter sets both per run and spends most of a frame in state
transitions.

```pseudo
# Batch by (fontKey, size, color) across the whole page, preserving paint order
# within each batch. Sorting across batches is only legal where items do not
# overlap - so: partition into runs of non-overlapping items, batch within a
# partition, never reorder across a ClipPush/TransformPush.
#
# fillText per cluster is also wrong - pass the whole run's string and let the
# browser position it ONLY when the advances match the shaper's (P4-10's
# fast-path predicate). Otherwise positions come from the line box and each
# cluster is drawn at its own x, which is slower and correct.
```

**Done when.** A page of mixed formatting issues a measured, documented number of state changes below a
stated budget; batching never reorders across a clip or transform; the fast-path and positioned paths
produce identical pixels on a Latin fixture.

---

### P5-15 — Page bitmap cache

**Size** M · **Depends** P5-13, P5-16 · **Escalate** no

Cache rendered pages as bitmaps keyed on an explicit invalidation key. The key must include: page
content version, zoom, `devicePixelRatio`, theme/colour state, and selection-independent state only —
selection and caret paint **over** the cached bitmap (`P6-14`), they are never baked into it. Baking
the caret in means every blink invalidates a page.

**Done when.** The key is a single value derivable without walking content; typing in one paragraph
invalidates one page, not the document; caret blink causes zero bitmap invalidations.

---

### P5-16 — devicePixelRatio, zoom, virtualization

**Size** M · **Depends** P5-15 · **Escalate** no

Layout is in twips and is **zoom-independent** — zoom is a paint-time transform, not a relayout.
Getting this backwards makes every zoom change a full document relayout, and worse, lets rounding at
one zoom level change line breaks, so the document reflows as you zoom.

`devicePixelRatio` scales the backing store; fractional dPR (1.25, 1.5) needs explicit rounding rules
so glyphs do not shimmer. Virtualization: only pages within a window of the viewport are laid out and
painted; `P8-11`'s page numbering requires knowing the _count_ of pages, which needs pagination of the
whole document even when only a few pages are painted — state that distinction.

**Done when.** Changing zoom causes zero relayout (asserted by a counter) and identical line breaks; a
500-page document paints only the windowed pages; page count is available without painting.

---

### P5-17 — Layout-golden serialization format

**Size** M · **Depends** P5-01 · **Escalate** **yes**

**Goal.** The review surface for every layout change made after this phase.

**Trap.** Treating this as a test-harness detail. It is the mechanism by which every later layout
regression becomes visible in a pull request (verification gate 4). Pixel diffs are slow, environment-
sensitive and unreviewable; a golden that serializes _positions_ is fast, deterministic and readable.
If the format is not stable and diffable, layout regressions become invisible and stay invisible.

```pseudo
# Requirements, in priority order:
#   1. DETERMINISTIC. Same input, same bytes, always (C1 applies here too).
#      No map iteration order, no floats printed at full precision.
#   2. DIFFABLE. One line per line box. A changed line break moves one line in
#      the diff, not the whole file.
#   3. READABLE. A reviewer must see what changed without a tool.
#   4. STABLE under irrelevant change. Adding a paragraph must not renumber
#      everything after it - key lines by NodeId (P3-01), not by index.
#
# Sketch, one line per line box:
#   p=<nodeId> l=<n> y=<twips> h=<twips> base=<twips> seg=[<x>+<w>,...] "first 40 chars…"
#
# Round positions to whole twips before serializing. Sub-twip differences are
# noise from float arithmetic and will make every golden churn.
# Do NOT serialize glyph ids - they are font-version dependent and will churn on
# any machine with a different font build (F6 makes this a real risk, not a
# hypothetical).
```

**Done when.** Two runs produce byte-identical goldens; inserting a paragraph changes only the affected
lines in the diff; a reviewer can identify a changed line break by reading the diff alone; no font
version dependence (asserted by generating on two font configurations).

---

### P5-18 — Text decoration painting

**Size** M · **Depends** P5-13 · **Escalate** no

**Trap.** `ST_Underline`'s 18 values are **not** consistently named. The light/heavy pairs are
`dotted`/`dottedHeavy`, `dash`/`dashedHeavy`, `dotDash`/`dashDotHeavy`,
`dotDotDash`/`dashDotDotHeavy` — note that three of those four _reverse the component order_ in the
heavy form. A mapping generated by appending `"Heavy"`, or by a regex over the base name, is wrong for
four values and right for fourteen, which is exactly the ratio that survives review.

```pseudo
# Enumerate all 18 explicitly. No pattern, no derivation.
#   single words double thick dotted dottedHeavy dash dashedHeavy dashLong
#   dashLongHeavy dotDash dashDotHeavy dotDotDash dashDotDotHeavy wave wavyHeavy
#   wavyDouble none
#
# 'words' underlines words but not the spaces between them - it is the only value
# that changes WHAT is underlined rather than how.
# Underline position and thickness come from the font's post/OS2 tables, not from
# a fixed fraction of the size (P4-13).
#
# w:strike / w:dstrike: single and double strikethrough.
# w:highlight: a fixed 17-colour enum, painted BEHIND the glyphs and ABOVE w:shd.
# w:shd on runs and paragraphs: fill + pattern (ST_Shd has many pattern values -
#   pct5..pct90, thinDiagStripe etc.). Patterns need the P9-12 tile cache.
# w:bdr: a border around the run itself, not the paragraph.
# w:em (ST_Em: none|dot|comma|circle|underDot): CJK emphasis marks, positioned
#   above (or below, for underDot) each cluster - a per-cluster decoration, so it
#   reads Cluster.xOffset and cannot be drawn per run.
# w:effect (ST_TextEffect: blinkBackground|lights|antsBlack|antsRed|shimmer|
#   sparkle|none): animated in Word. Render STATICALLY and record it in the
#   manifest (G3) - do not animate, and do not silently ignore.
```

**Done when.** All 18 underline values render distinctly and none is produced by string derivation;
`words` skips inter-word spaces; emphasis marks position per cluster; `w:effect` values render
statically and appear in the coverage manifest as `painted: 'static-approximation'`.

---

## Phase 5 exit criteria

1. All tickets closed per their **Done when** clauses.
2. The `P5-01` ADR exists and states the segment, back-reference and memory-layout decisions with
   rationale; a line is a list of segments in the type, not by convention.
3. The `structuredClone` gate on the display list is wired into CI, not documented as a convention.
4. Layout goldens exist and are byte-stable across two runs and two font configurations.
5. A real `.docx`'s first page paints to canvas. Per `F6` the phase report says "visually unverified —
   no Word or LibreOffice available in this environment" and does **not** claim visual fidelity.
6. The four `SPEC-GAP` marks in this phase (`contextualSpacing`, autospacing, superscript size
   reduction, hyphenation absence) exist in source with their reasoning recorded.
