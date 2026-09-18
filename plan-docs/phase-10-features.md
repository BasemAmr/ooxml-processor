# Phase 10 — Remaining features

> **Difficulty rank 8 of 11.**
>
> **Depends on** Phase 3 (cascade, `P3-06`; numbering resolution, `P3-08`), Phase 5 (line layout),
> Phase 8 (the fixpoint driver and field infrastructure, `P8-06`, `P8-12`).
>
> **Owns** `packages/wml/` additions, plus `packages/layout/math/` for `P10-12`.

## Why this phase ranks here

It ranks eighth because it is **wide rather than deep**. Most tickets are self-contained: hyperlinks do
not interact with comments, art borders do not interact with content controls. Wide phases are
schedulable, parallelisable and low-risk per ticket.

Two tickets break that pattern and carry the phase's risk:

- **`P10-01` (numbering) is a stateful fold over the entire document.** Every other resolution in this
  project is local — give it a node and its context and it answers. List numbering is not: the value of
  a counter at paragraph _n_ depends on every numbered paragraph before it, across sections, tables and
  text boxes. It is the only place where a local edit can change output arbitrarily far away.
- **`P10-12` (OMML math) is a phase inside a phase.** It is a complete nested-box layout engine — 19
  distinct mathematical object types, each with its own geometry — and it needs font metrics this
  project does not otherwise read (the OpenType `MATH` table). Budget it as such; it is `XL` and it
  will not fit in a sprint.

Everything else here is enumerable work against a schema that says what it means.

---

## Verified against the schema

Read out of `assets/schema/transitional/wml.xsd` and `shared-math.xsd`.

| Type                      | Finding                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ST_NumberFormat`         | **63 values.** Includes `bullet`, `none` and `custom` as _values_ — see `P10-02`.                                                                                                  |
| `ST_LevelSuffix`          | `tab` · `space` · `nothing` — three values, default `tab`                                                                                                                          |
| `CT_Lvl` children         | `start` `numFmt` `lvlRestart` `pStyle` `isLgl` `suff` `lvlText` `lvlPicBulletId` `legacy` `lvlJc` `pPr` `rPr`                                                                      |
| `CT_Lvl` attrs            | `ilvl` `tplc` `tentative`                                                                                                                                                          |
| `CT_Lvl/w:pPr`            | Type **`CT_PPrGeneral`** — consistent with `P3-04`; no `rPr`, no `sectPr`                                                                                                          |
| `CT_Lvl/w:lvlJc`          | Type `CT_Jc` — takes any of `ST_Jc`'s **12** values, not just left/center/right                                                                                                    |
| `ST_FldCharType`          | `begin` · `separate` · `end` — **three**, and `separate` is optional in practice                                                                                                   |
| `CT_SdtPr` control kinds  | `equation` `comboBox` `date` `docPartObj` `docPartList` `dropDownList` `picture` `richText` `text` `citation` `group` `bibliography` — **12; there is no checkbox**                |
| `CT_SdtPr` other          | `rPr` `alias` `tag` `id` `lock` `placeholder` `temporary` `showingPlcHdr` `dataBinding` `label` `tabIndex`                                                                         |
| `shared-math.xsd` objects | `acc` `bar` `box` `borderBox` `d` `eqArr` `f` `func` `groupChr` `limLow` `limUpp` `m` `nary` `phant` `rad` `sPre` `sSub` `sSubSup` `sSup` — **19**, plus `r`, `oMath`, `oMathPara` |

Three of those rows change the shape of the code:

**`bullet` is a `numFmt`, not a separate mechanism.** The instinct is to model "numbered lists" and
"bulleted lists" as two things. The schema models one thing with 63 formats, one of which is `bullet`
and one of which is `none`. A bulleted list still has a level, still has a counter (unused), still
cascades identically. Two code paths here means every fix gets applied once.

**`custom` is also a `numFmt`**, paired with `CT_NumFmt/@w:format`. A 63-way switch that does not have
a `custom` arm silently renders the wrong glyph.

**There is no checkbox content control in ECMA-376.** `CT_SdtPr` offers twelve kinds and checkbox is not
among them — Word's checkbox is a `w14:checkbox` extension in a namespace outside this asset set.
`P10-11` must therefore round-trip an unknown SDT control kind gracefully, because the most common one
in modern documents is one the schema does not define.

---

## Ticket index

| ID     | Title                          | Size | Escalate |
| ------ | ------------------------------ | ---- | -------- |
| P10-01 | Numbering — the document fold  | L    | **yes**  |
| P10-02 | Number formats — all 63        | M    | no       |
| P10-03 | Bullets and symbol fonts       | S    | no       |
| P10-04 | Hyperlinks and bookmarks       | M    | no       |
| P10-05 | Cross-references               | M    | no       |
| P10-06 | Table of contents              | M    | no       |
| P10-07 | Footnote and endnote content   | M    | no       |
| P10-08 | Comments                       | M    | no       |
| P10-09 | Revision markup display        | M    | no       |
| P10-10 | Accept / reject revisions      | L    | **yes**  |
| P10-11 | Content controls (SDT)         | M    | no       |
| P10-12 | OMML math                      | XL   | **yes**  |
| P10-13 | Art borders                    | S    | no       |
| P10-14 | Page decoration and watermarks | S    | no       |

---

### P10-01 — Numbering — the document fold

**Size** L · **Depends** P3-08 (which definition and level apply), P8-06 (fixpoint driver) · **Escalate** **yes**

`P3-08` answered _which_ `CT_Lvl` applies to a paragraph. This ticket computes _what number it shows_,
and that is a different kind of problem: a left fold over every numbered paragraph in the document, in
document order, carrying nine counters per numbering instance.

```pseudo
CounterState = Map<numId, u32[9]>          # one counter per level, per instance

fn foldDocument(paragraphs) -> Map<NodeId, string>
    state <- {}
    labels <- {}
    for para in documentOrder(paragraphs):        # see traps for what this means
        (numId, ilvl) <- numberingFor(para)       # P3-08
        if none: continue
        lvl <- levelFor(numId, ilvl)              # P3-08

        # 1. advance this level
        state[numId][ilvl] += 1

        # 2. reset deeper levels - BUT only those whose lvlRestart permits it
        for deeper in (ilvl+1 .. 8):
            restartAt <- levelFor(numId, deeper).lvlRestart
            if restartAt is ABSENT:  state[numId][deeper] <- startOf(deeper) - 1
            elif restartAt == 0:     pass                    # never restarts
            elif restartAt <= ilvl+1: state[numId][deeper] <- startOf(deeper) - 1

        # 3. render
        labels[para.id] <- renderLvlText(lvl.lvlText, state[numId], lvl, ilvl)

fn renderLvlText(template, counters, lvl, ilvl) -> string
    # template is e.g. "%1.%2." - the placeholders are %1..%9, ONE-BASED, and
    # %n refers to level n-1's counter.
    for each %n in template:
        emit format(counters[n-1], levelFormatFor(n-1), lvl.isLgl)
    # literal text between placeholders is emitted verbatim, including the
    # trailing period that nearly every template has.
```

**Trap — `lvlRestart` semantics are three-way.** Absent means "restart when any higher level advances."
`0` means "never restart." A positive value _n_ means "restart when level _n-1_ or higher advances."
Treating absent as `0`, or `0` as absent, gives lists that either never restart or always restart, and
both look plausible on a short document.

**Trap — `startOverride` is once, not always.** `w:lvlOverride/w:startOverride` sets the counter for the
_first_ use of that level after the override, not on every restart. Modelling it as "the start value"
makes a restarted list resume at the override instead of at `w:start`.

**Trap — `w:isLgl` changes the format of _other_ levels.** When a level has `isLgl`, every `%n`
placeholder in its `lvlText` renders as **decimal**, regardless of the referenced level's own `numFmt`.
A legal-numbering level referencing an `upperRoman` parent shows `1.1`, not `I.1`. The flag lives on the
_referencing_ level and affects the _referenced_ levels' rendering — which is why `renderLvlText` takes
`lvl` as well as the counters.

**Trap — document order is not tree order for this purpose.** Numbered paragraphs inside table cells
participate in the same counters as body paragraphs, in visual reading order (row-major). Paragraphs
inside text boxes, headers and footnotes do **not** participate in the body's fold — they are separate
stories with separate state. Define the story partition explicitly; getting it wrong makes a numbered
list in a header restart the body's list.

**Trap — this is where incremental relayout gets expensive.** Inserting a numbered paragraph changes
every subsequent label in that instance. The fold must be resumable from a checkpoint rather than rerun
from the document head on every keystroke — checkpoint `CounterState` every _k_ numbered paragraphs and
restart the fold from the last checkpoint before the edit.

**Trap — `@w:tentative`.** Levels marked tentative were created speculatively by the producer and are
not in use. They round-trip and they must not affect the fold.

**Escalate when.** The story partition (which paragraphs share counters) needs to change. It determines
correctness for every numbered document and is the assumption most likely to be wrong.

**Done when.** The three `lvlRestart` cases each have a fixture; `startOverride` applies once; `isLgl`
forces decimal on referenced levels; the story partition is one documented function; the fold is
resumable from checkpoints and a benchmark shows an insert near the document end does not rescan from
the head; tentative levels are inert.

---

### P10-02 — Number formats — all 63

**Size** M · **Depends** P10-01 · **Escalate** no

One function: counter value plus `ST_NumberFormat` to display string. Sixty-three arms.

```pseudo
fn format(n: u32, fmt: ST_NumberFormat, custom?: string) -> string

# Groups, roughly:
#   Western      decimal decimalZero ordinal cardinalText ordinalText hex
#                upperRoman lowerRoman upperLetter lowerLetter chicago
#                numberInDash none bullet custom
#   Enclosed     decimalEnclosedCircle decimalEnclosedFullstop
#                decimalEnclosedParen decimalEnclosedCircleChinese
#                ideographEnclosedCircle
#   Japanese     japaneseCounting japaneseLegal japaneseDigitalTenThousand
#                aiueo iroha aiueoFullWidth irohaFullWidth
#   Chinese      chineseCounting chineseLegalSimplified chineseCountingThousand
#                taiwaneseCounting taiwaneseCountingThousand taiwaneseDigital
#                ideographDigital ideographTraditional ideographZodiac
#                ideographZodiacTraditional ideographLegalTraditional
#   Korean       koreanDigital koreanDigital2 koreanCounting koreanLegal
#                ganada chosung
#   Width        decimalFullWidth decimalFullWidth2 decimalHalfWidth
#   Hebrew       hebrew1 hebrew2
#   Arabic       arabicAlpha arabicAbjad
#   Hindi        hindiVowels hindiConsonants hindiNumbers hindiCounting
#   Thai         thaiLetters thaiNumbers thaiCounting
#   Other        russianLower russianUpper vietnameseCounting
#                bahtText dollarText
```

**Trap — `upperLetter` past 26.** It is not base-26. Word renders 27 as `AA`, 28 as `BB` — the letter
repeats rather than carrying. Implementing base-26 (`AA`, `AB`, `AC`) is the obvious choice and is wrong.

**Trap — Roman numerals have no upper bound in the schema** but have a conventional maximum. Decide the
behaviour past 3999 and write it down rather than producing a thousand `M`s.

**Trap — `none` renders the empty string but still advances the counter.** It is not "skip this
paragraph."

**Trap — `custom` uses `CT_NumFmt/@w:format`**, whose content is not specified by the XSD (`SPEC-GAP`).
Fall back to `decimal` with a diagnostic rather than rendering nothing.

**Trap — most of the 63 are unverifiable here.** We cannot run Word to check `taiwaneseCountingThousand`.
Mark the CJK, Hebrew, Hindi and Thai groups `UNVERIFIABLE-HERE`, implement from published tables, cite
the table, and record them in the coverage manifest as implemented-but-unverified — distinct from both
implemented and unimplemented.

**Done when.** All 63 arms exist with no silent fallthrough; `upperLetter` repeats rather than carrying;
`none` advances; `custom` degrades to decimal with a diagnostic; unverifiable groups are flagged as such
in the coverage manifest.

---

### P10-03 — Bullets and symbol fonts

**Size** S · **Depends** P10-02, P4-01 · **Escalate** no

`numFmt="bullet"` renders `lvlText` literally — usually a single character from Symbol or Wingdings —
using the level's own `rPr` font, not the paragraph's.

**Trap — the Symbol font's private-use mapping.** Bullet characters are stored as codepoints in
`U+F000`–`U+F0FF` (the private use area) _or_ as the ASCII codepoint with a symbol font applied,
depending on the producer. Both appear. Normalise by masking `U+F000` when the resolved font is a symbol
font, and leave other codepoints alone.

**Trap — `w:lvlPicBulletId`** references a `w:numPicBullet` holding an image bullet. It is rare and it
round-trips; render the image if present, fall back to the `lvlText` character otherwise.

**Trap — the level `rPr` applies to the bullet only.** Already stated in `P3-08`; restated because this
is where it becomes visible.

**Done when.** A Wingdings bullet renders with the correct glyph from both encodings; the level's font
is used rather than the paragraph's; picture bullets render or degrade to the character.

---

### P10-04 — Hyperlinks and bookmarks

**Size** M · **Depends** P3-03 (range annotations), Phase 2 (relationship graph) · **Escalate** no

`CT_Hyperlink` carries `@r:id` (external, into the part's `.rels`), `@w:anchor` (internal, naming a
bookmark), `@w:tgtFrame`, `@w:tooltip` and `@w:docLocation`. Bookmarks are already modelled by `P3-03`;
this ticket makes them navigable and clickable.

**Trap — external targets are blocked by default.** Phase 2's SSRF boundary means `@r:id` resolves to a
relationship whose target is _not_ fetched. Clicking is a user-initiated navigation and is allowed;
prefetching, previewing or resolving redirects is not.

**Trap — `@r:id` and `@w:anchor` can both be present.** The anchor then names a fragment within the
external target. Do not treat presence of `anchor` as proof the link is internal.

**Trap — a hyperlink is a run container, not a run.** It holds runs and its own `rPr` does not exist;
the "Hyperlink" character style is applied to the contained runs by the producer, not implied by the
element. A hyperlink whose runs carry no style renders as body text, and that is correct.

**Done when.** Internal anchors navigate to the bookmark's resolved position; external links are
click-only with no prefetch; both-present resolves as external-plus-fragment; a hyperlink with unstyled
runs renders unstyled.

---

### P10-05 — Cross-references

**Size** M · **Depends** P8-12 (field infrastructure), P10-04 · **Escalate** no

`REF`, `PAGEREF`, `NOTEREF`, `STYLEREF` and `SEQ` resolved against bookmarks and sequence counters.

```pseudo
# REF     <bookmark> [\h hyperlink] [\p relative-position] [\n \r \w number]
# PAGEREF <bookmark> [\h] [\p]                 -> needs pagination: P8-06
# SEQ     <identifier> [\c repeat] [\n next] [\r n] [\s level] [\* fmt]
# STYLEREF <style> [\l last-on-page] [\n \r \w] [\p]
```

**Trap — `PAGEREF` is a fixpoint input, not a lookup.** It depends on pagination, and a cross-reference
whose rendered width changes (page 9 → page 10) can reflow the line that contains it and move the target.
It belongs in `P8-06`'s fixpoint, and `P8-06`'s iteration cap applies.

**Trap — `SEQ` is a second document fold**, structurally identical to `P10-01` but with its own counters
keyed by identifier. Share the checkpoint machinery rather than writing a second fold.

**Trap — a broken reference renders as an error string, not as nothing.** `Error! Reference source not
found.` is the observed behaviour and it round-trips as a cached field result. Preserve the cached
result; recomputing it is `P8-12`'s policy decision.

**Done when.** Each switch above is parsed and honoured or explicitly recorded as unimplemented;
`PAGEREF` participates in the pagination fixpoint; `SEQ` shares `P10-01`'s checkpointing; broken
references preserve their cached result.

---

### P10-06 — Table of contents

**Size** M · **Depends** P10-05, P8-06 · **Escalate** no

`TOC` is a complex field whose body is a generated block of paragraphs, each typically containing a
`PAGEREF` and a right tab with a dot leader.

**Trap — the TOC body is real content that round-trips.** It is not generated on open. It sits between
`fldChar begin`/`separate` and `fldChar end` as ordinary paragraphs and must be written back unchanged
unless the user explicitly updates the field. Regenerating on open produces a diff on every save.

**Trap — regeneration is a fixpoint with a genuine cycle.** A regenerated TOC can change its own page
count, which changes every `PAGEREF` after it. `P8-06`'s cap and deterministic tie-break apply. Default
policy: **do not regenerate on open**; regenerate only on explicit user action.

**Trap — `\o "1-3"` selects by outline level, `\t` by style name, `\h` makes entries hyperlinks.** A TOC
built only from `\o` misses style-driven tables of figures.

**Done when.** An existing TOC round-trips byte-equivalently through open→save with no regeneration;
explicit regeneration runs inside the fixpoint and converges or logs; `\o`, `\t`, `\h`, `\n`, `\z` are
each parsed and honoured or explicitly recorded as unimplemented.

---

### P10-07 — Footnote and endnote content

**Size** M · **Depends** P8-09 (footnote placement), P3-06 · **Escalate** no

Placement is Phase 8's. This ticket owns the content: the `footnotes.xml`/`endnotes.xml` parts, the
separator and continuation separator special notes, the reference mark, and numbering.

```pseudo
# ST_FtnEdn special types, by @w:type:
#   normal              ordinary note content
#   separator           the short rule above the first note on a page
#   continuationSeparator   the full-width rule when a note continues
#   continuationNotice  text shown when a note continues to the next page
#
# The separators are notes with ids 0 and 1 by convention, always present,
# always round-tripped, and NEVER rendered as note content.
```

**Trap — separators are notes.** They live in the same part and the same id space. Iterating
`footnotes.xml` and rendering everything puts a horizontal rule in the middle of the footnote list.
Filter by `@w:type`, not by id.

**Trap — `w:footnoteRef` is an element, not text.** The mark inside the note body is a placeholder
element that renders the note's own number, formatted per `w:footnotePr/w:numFmt`. It is not the same
element as `w:footnoteReference` in the body text.

**Trap — note numbering has its own restart rules.** `w:numRestart` is `continuous` / `eachSect` /
`eachPage`, and `eachPage` depends on pagination — so note numbering is a fixpoint input like
`PAGEREF`.

**Done when.** Separators are filtered by type and rendered only in their structural role;
`footnoteRef` renders the note's own number; all three restart modes work with `eachPage` inside the
fixpoint; custom marks (`@w:customMarkFollows`) suppress automatic numbering.

---

### P10-08 — Comments

**Size** M · **Depends** P3-03 (comment ranges), Phase 2 (`comments.xml`) · **Escalate** no

`CT_Comment` carries `@w:id`, `@w:author`, `@w:initials`, `@w:date` and block content. The range is
`P3-03`'s; this ticket owns the content, the anchor and the display.

**Trap — three elements, one comment.** `w:commentRangeStart`, `w:commentRangeEnd` and
`w:commentReference` are separate, and the _reference_ — not the range end — is what carries the run
properties and the "Comment Reference" style. All three can be orphaned independently.

**Trap — comment replies are not in ECMA-376.** Threading is a `w15:commentsEx` extension outside this
asset set. Model comments flat, round-trip the extension part opaquely, and do not invent threading.

**Trap — balloon layout is a layout problem, not a comment problem.** Balloons occupy a margin region
that changes the body text area, which makes them a Phase 8 page-geometry input if they are rendered
in-layout. Default: render balloons in an **overlay** that does not affect text area, and record the
choice. In-margin balloons are a later decision with pagination consequences.

**Done when.** All three elements are handled independently, including orphans; `comments.xml` content
resolves and renders; the extension part round-trips opaquely; balloons render in an overlay with the
decision recorded.

---

### P10-09 — Revision markup display

**Size** M · **Depends** P3-06 · **Escalate** no

Display only — accepting and rejecting is `P10-10`.

```pseudo
# Content revisions (wrap runs / paragraphs):
#   w:ins  w:del  w:moveFrom  w:moveTo
# Property revisions (record the PREVIOUS value):
#   w:rPrChange  w:pPrChange  w:tblPrChange  w:trPrChange  w:tcPrChange
#   w:sectPrChange  w:tblGridChange  w:numberingChange
# Paragraph-mark revisions (on w:pPr/w:rPr):
#   w:ins  w:del      - the MARK was inserted or deleted, merging paragraphs
```

**Trap — `w:delText` is not `w:t`.** Deleted text lives in `w:delText` inside `w:del`. A reader that
handles only `w:t` renders deleted content as absent, which looks like correct rendering of accepted
changes and is not.

**Trap — `*Change` elements carry the OLD value.** `w:rPrChange` contains the run properties _before_
the change; the current properties are the surrounding `w:rPr`. Reading the change element as the
current state inverts every tracked formatting change.

**Trap — a deleted paragraph mark merges two paragraphs.** `w:del` inside `w:pPr/w:rPr` means the
pilcrow was deleted, so this paragraph and the next display as one when revisions are shown as accepted,
and as two when shown as markup. This is a layout-affecting revision, not a decoration.

**Trap — `moveFrom`/`moveTo` pair across the document** via `P3-03`'s move ranges, and display as moved
rather than as delete-plus-insert only when both halves are found.

**Done when.** `w:delText` renders; `*Change` elements are read as previous-state; a deleted paragraph
mark changes paragraph structure in the display; move pairs display as moves and orphaned halves degrade
to insert/delete; each of the three display modes (markup / final / original) is a single switch.

---

### P10-10 — Accept / reject revisions

**Size** L · **Depends** P10-09, P6-11 (undo) · **Escalate** **yes** · `ROUND-TRIP`

**This is the only destructive operation in the project.** Everything else preserves what it does not
understand; this deliberately deletes markup, and a bug here loses user content with no error.

```pseudo
fn accept(revision) -> Edit[]
    match kind:
        ins        -> unwrap: keep content, remove the w:ins wrapper
        del        -> DELETE the content, remove the wrapper
        moveFrom   -> DELETE the content
        moveTo     -> unwrap: keep content
        rPrChange  -> remove the change record; keep current properties
        ...

fn reject(revision) -> Edit[]
    match kind:
        ins        -> DELETE the content
        del        -> unwrap: restore content as normal text (w:delText -> w:t)
        moveFrom   -> unwrap: restore
        moveTo     -> DELETE
        rPrChange  -> RESTORE the recorded previous properties; remove the record

# Every arm emits Edits through P6-11's command log. None mutates directly.
```

**Trap — accept and reject are not symmetric, and neither is a no-op.** Rejecting a `del` must convert
`w:delText` back to `w:t`; accepting an `ins` must unwrap without touching content. Four of the eight
content arms delete, four preserve, and the mapping is not guessable from the element name.

**Trap — nested revisions.** A run can be inserted by author A and then deleted by author B —
`w:del` containing `w:ins`. Accepting the delete removes content that was never in the original;
rejecting it leaves an insertion. Resolve innermost-first and define the order explicitly.

**Trap — paragraph-mark revisions restructure the document.** Accepting a deleted paragraph mark merges
two paragraphs, which invalidates node identities, range annotation endpoints and the caret. It must go
through the same edit path as a user deletion, not through a special case.

**Trap — accept-all is not a loop over accept.** Applying one revision shifts the positions of all
later ones. Either apply in reverse document order, or apply through the edit log so positions are
maintained. Reverse order is simpler and is the recommendation.

**Escalate when.** Any arm of the accept/reject matrix is uncertain. The matrix is sixteen-plus entries
and a wrong one destroys content silently.

**Done when.** The full accept/reject matrix exists as one table with a fixture per arm; nested
revisions resolve innermost-first with the order documented; every operation routes through `P6-11` and
is undoable; accept-all runs in reverse document order; a document with all revisions accepted contains
no revision markup and no `w:delText`.

---

### P10-11 — Content controls (SDT)

**Size** M · **Depends** P3-06, Phase 2 (custom XML parts) · **Escalate** no

`CT_SdtPr` has twelve control kinds plus metadata. SDTs appear at block, row, cell and run level, each
with a distinct wrapper type.

**Trap — there is no checkbox in ECMA-376.** Word's checkbox is `w14:checkbox`, outside this asset set.
The reader must handle an SDT whose control kind is an unknown element: preserve it verbatim, render the
content normally, and record it in the coverage manifest as an unknown control. This is the _common_
case in modern documents, not an edge case.

**Trap — `w:showingPlcHdr` means the content is placeholder text**, not user data. It is styled
differently and is replaced wholesale on first edit. Treating it as content means the user's first
keystroke appends to "Click here to enter text."

**Trap — `w:dataBinding` makes the SDT a view of a custom XML part.** The content is a cached
projection. Editing it without updating the bound part produces a document where the two disagree, and
Word resolves in favour of the XML on next open — silently discarding the edit. Default policy: SDTs
with `dataBinding` are **read-only** in v1, with the reason surfaced in the UI.

**Trap — `w:lock` has four values** (`sdtLocked`, `contentLocked`, `sdtContentLocked`, `unlocked`)
controlling deletion of the control and editing of its content independently. Honour both axes.

**Done when.** All four nesting levels parse; the twelve known kinds are modelled; an unknown control
kind round-trips and is reported; placeholder content is replaced rather than appended to; bound SDTs
are read-only with a stated reason; both `w:lock` axes are honoured.

---

### P10-12 — OMML math

**Size** XL · **Depends** P5-01 (line box), P4-11 (measurement cache) · **Escalate** **yes** · `UNVERIFIABLE-HERE`

A complete nested-box layout engine for 19 mathematical object types. This is a phase inside a phase and
should be planned as one; the ticket below is a decomposition sketch, not a sprint.

```pseudo
# The 19 objects, from shared-math.xsd:
#   acc        accent over a base            bar      bar over/under
#   box        logical grouping              borderBox boxed with borders
#   d          delimiters (parens, etc.)     eqArr    equation array
#   f          fraction                      func     function-apply
#   groupChr   grouping character            limLow   limit below
#   limUpp     limit above                   m        matrix
#   nary       n-ary operator (sum, int)     phant    phantom (spacing only)
#   rad        radical                       sPre     pre-sub-superscript
#   sSub       subscript                     sSubSup  sub+superscript
#   sSup       superscript
# Plus: r (run), oMath (inline), oMathPara (display)

MathBox = { width, ascent, descent, axisOffset, italicCorrection, children }
# Layout is bottom-up: each object type computes its box from its children's
# boxes, then the parent positions them. Identical in shape to TeX's boxes.
```

**Trap — this needs the OpenType `MATH` table.** Correct math layout requires constants no other part of
this project reads: `AxisHeight`, `FractionNumeratorShiftUp`, `SuperscriptShiftUp`,
`StackTopDisplayStyleShiftUp`, the glyph-variant and glyph-assembly tables for stretchy delimiters and
radicals, and italic correction per glyph. **`harfbuzzjs` exposes some of this and not all of it.**
Determine what is reachable _before_ committing to the ticket; if the assembly tables are not reachable,
stretchy delimiters cannot be built correctly and that is a scope decision, not an implementation detail.

**Trap — display vs inline changes the geometry, not just the spacing.** `oMathPara` is display style:
larger operators, limits above and below rather than beside, different fraction shifts. It is a mode
threaded through every object's layout, not a wrapper.

**Trap — Cambria Math is effectively required.** The layout constants and glyph variants come from the
font, and a fallback font without a `MATH` table cannot lay out mathematics correctly. Decide and record
the behaviour when it is unavailable: degraded layout with a diagnostic, or a labelled placeholder.
`UNVERIFIABLE-HERE` — we cannot check against Word.

**Trap — math runs are `m:r`, not `w:r`.** They carry `m:rPr` alongside `w:rPr` and their text is
`m:t`. The run cascade from `P3-06` applies to the `w:rPr` half only.

**Decomposition sketch** — treat each as its own ticket when this phase is planned:
`P10-12a` MATH-table access audit · `P10-12b` box model and the bottom-up driver · `P10-12c` runs,
scripts and n-ary · `P10-12d` fractions, radicals and stretchy delimiters · `P10-12e` matrices and
equation arrays · `P10-12f` accents, bars, boxes and phantoms · `P10-12g` display/inline modes and line
breaking inside math.

**Escalate when.** The MATH-table audit (`P10-12a`) finds the needed constants unreachable. That
determines whether this ticket is "implement math" or "render math as an image-like placeholder," and
they are different projects.

**Done when.** `P10-12a` has produced a written audit; the remaining sub-tickets are planned against its
findings; every one of the 19 object types either lays out or renders a labelled placeholder, with the
distinction recorded in the coverage manifest.

---

### P10-13 — Art borders

**Size** S · **Depends** P8-01 (page borders), P5-12 (paragraph borders) · **Escalate** no

`CT_Border/@w:val` with an `ST_Border` art value names a PNG tile set — four edges and four corners per
style, roughly 1,600 files in total.

**Trap — do not vendor the tile set before this ticket (`F1`).** It is about 30 MB and the disk budget
is tight (ADR 0001). Vendor it here, or implement the tiling against a small subset and record which
styles are unavailable.

**Trap — tiles scale, they do not stretch.** The edge tile repeats along the border at its natural size
with the remainder distributed; corners are placed once. Stretching produces visibly wrong output.

**Done when.** The tiling algorithm repeats rather than stretches; corners are placed once; missing
styles degrade to a plain border with a diagnostic; whatever subset is vendored is recorded with its
provenance.

---

### P10-14 — Page decoration and watermarks

**Size** S · **Depends** P8-05 (headers/footers), P9-02 (anchored objects) · **Escalate** no

Watermarks are not a feature — they are anchored VML or DrawingML shapes living in a header, behind the
body text. `w:background` plus `w:displayBackgroundShape` from `P3-13` is the page background.

**Trap — a watermark is just an anchored shape.** Special-casing it means a second, worse implementation
of `P9-02`. The only special handling is z-order (`behindDoc`) and the fact that it lives in a header
part, both of which Phase 9 and Phase 8 already do.

**Trap — `w:background` renders only when `w:displayBackgroundShape` is set** in settings, and it does
not print by default. Two independent conditions.

**Done when.** A watermark renders through `P9-02` with no watermark-specific layout code; page
background honours both conditions; print and screen behaviours are distinguishable.

---

## Exit criteria for Phase 10

1. **Numbering is correct on a real multi-level document** — all three `lvlRestart` cases, `isLgl`,
   `startOverride`, and a documented story partition, with a resumable fold demonstrated by benchmark.
2. **All 63 number formats** have an arm, with the unverifiable groups flagged as such in the coverage
   manifest rather than silently claimed.
3. **Revisions display in all three modes** and the accept/reject matrix has a fixture per arm, routes
   through the undo log, and leaves no residual markup after accept-all.
4. **An SDT with an unknown control kind** — the common `w14:checkbox` case — round-trips and renders.
5. **`P10-12a`'s MATH-table audit exists in writing**, and the math sub-tickets are planned against it.
6. **Comments, footnotes, hyperlinks and cross-references** each resolve, with orphaned halves degrading
   to a diagnostic rather than an exception in every case.
