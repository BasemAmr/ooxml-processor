# Phase 3 — Document model + style cascade

> **Difficulty rank 7 of 11.**
>
> **Depends on** Phase 1 (generated types and readers) and Phase 2 (part graph, so `styles.xml`,
> `numbering.xml`, `settings.xml` and `theme1.xml` can be found rather than assumed).
>
> **Owns** `packages/wml/`.
>
> **Is depended on by every later phase.** `P3-06` feeds `P4-01`; `P3-10` feeds `P4-01` and `P9-14`;
> `P3-01` feeds `P6-01`; `P3-09` feeds `P7-13`. Ticket IDs here are cited from four other phase files
> and must not be renumbered.

## Why this phase ranks here

It ranks seventh — below the layout and drawing phases — because almost nothing in it is _unspecified_.
The cascade order is written down, the toggle rule is written down, the conditional-formatting
vocabulary is enumerated in the schema. There is no equivalent of Phase 7's autofit or Phase 9's
anchor fixpoint, where the standard simply stops short and Word's behaviour has to be reverse-engineered.

It ranks as high as seventh, rather than near the bottom, for three reasons:

1. **`P3-00` is a genuinely irreversible decision.** ADR 0003 is still open. Everything in `packages/wml`
   and everything in Phase 6 is built on whatever it decides, and it cannot be revisited cheaply once
   the editor exists.
2. **Failures here are invisible.** A wrong cascade produces a document that renders — just with the
   wrong font, or bold where Word shows regular. There is no crash and no exception. Half the tickets
   in this phase carry **Escalate** for that reason alone.
3. **The range-annotation problem is structural, not incidental.** Bookmarks, comments, moves and
   permissions are intervals that do **not** nest with the element tree, and no amount of care in the
   tree representation makes them safe. They need their own structure, designed here or retrofitted
   painfully later.

The phase is large but the risk is concentrated: `P3-00`, `P3-01`, `P3-03`, `P3-06` and `P3-07` carry
nearly all of it. The rest is careful, enumerable work.

---

## Verified against the schema

Read out of `assets/schema/transitional/wml.xsd`. Each row is a trap that a plausible guess gets wrong.

| Type                      | Finding                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CT_Style/w:pPr`          | Type is **`CT_PPrGeneral`**, _not_ `CT_PPr`. See `P3-04`.                                                                                                                                                                         |
| `CT_PPr`                  | `CT_PPrBase` + `rPr` + `sectPr` + `pPrChange`                                                                                                                                                                                     |
| `CT_PPrGeneral`           | `CT_PPrBase` + `pPrChange` — **no `rPr`, no `sectPr`**                                                                                                                                                                            |
| `CT_Style/w:tblPr`        | Type is **`CT_TblPrBase`**, not `CT_TblPr`                                                                                                                                                                                        |
| `ST_StyleType`            | `paragraph` · `character` · `table` · `numbering` — **four values, and `numbering` is one of them**                                                                                                                               |
| `CT_Style` attrs          | `type` `styleId` `default` `customStyle`                                                                                                                                                                                          |
| `CT_Style` children       | `name` `aliases` `basedOn` `next` `link` `autoRedefine` `hidden` `uiPriority` `semiHidden` `unhideWhenUsed` `qFormat` `locked` `personal` `personalCompose` `personalReply` `rsid` `pPr` `rPr` `tblPr` `trPr` `tcPr` `tblStylePr` |
| `CT_DocDefaults`          | `rPrDefault` (`CT_RPrDefault`) · `pPrDefault` (`CT_PPrDefault`) — **two wrappers, not bare `rPr`/`pPr`**                                                                                                                          |
| `ST_TblStyleOverrideType` | `wholeTable` `firstRow` `lastRow` `firstCol` `lastCol` `band1Vert` `band2Vert` `band1Horz` `band2Horz` `neCell` `nwCell` `seCell` `swCell` — **13 values**                                                                        |
| `CT_Cnf` attrs            | `val` `firstRow` `lastRow` `firstColumn` `lastColumn` `oddVBand` `evenVBand` `oddHBand` `evenHBand` `firstRowFirstColumn` `firstRowLastColumn` `lastRowFirstColumn` `lastRowLastColumn` — **12 flags in a different vocabulary**  |
| `ST_Cnf`                  | `xsd:string`, `length = 12`, pattern `[01]*`                                                                                                                                                                                      |
| `CT_LatentStyles`         | `lsdException`\* + `defLockedState` `defUIPriority` `defSemiHidden` `defUnhideWhenUsed` `defQFormat` `count`                                                                                                                      |
| `EG_RPrBase` toggles      | `b` `bCs` `i` `iCs` `caps` `smallCaps` `strike` `dstrike` `outline` `shadow` `emboss` `imprint` `noProof` `snapToGrid` `vanish` `webHidden` `rtl` `cs` `specVanish` `oMath` are all `CT_OnOff`                                    |

Three findings deserve calling out before the tickets, because each one invalidates an approach that
looks obviously right:

**A style's `w:pPr` is a different type from a paragraph's `w:pPr`.** `CT_PPrGeneral` has no `rPr` and
no `sectPr`. This is not a schema quirk to paper over — it is the schema telling us that a style
**cannot** carry paragraph-mark run properties or section properties, and that the cascade's paragraph
side and its paragraph-mark side are not the same channel. Code that types both as one "paragraph
properties" bag will happily read a `sectPr` out of a style that can never contain one, and will
silently drop the distinction that `P3-06` depends on.

**`CT_Cnf` and `ST_TblStyleOverrideType` name the same twelve conditions with different words.**
`firstCol` in a style override is `firstColumn` on a `w:cnfStyle`; `band1Vert` is `oddVBand`; `nwCell`
is `firstRowFirstColumn`. There is no textual transformation between the two vocabularies — it is a
lookup table, and it must be written once, as data, in `P3-09`.

**`w:cnfStyle` encodes the same twelve bits twice.** `ST_Cnf` is a fixed-length-12 binary string on
`@val`, _and_ there are twelve individually-named `ST_OnOff` attributes. Real files carry both. They
can disagree. `P3-09` has to pick a winner and record why.

---

## Ticket index

| ID    | Title                                         | Size | Escalate |
| ----- | --------------------------------------------- | ---- | -------- |
| P3-00 | Resolve ADR 0003 — model representation spike | XL   | **yes**  |
| P3-01 | Stable node identity                          | L    | **yes**  |
| P3-02 | Text storage and the interval store           | L    | **yes**  |
| P3-03 | Range annotations                             | L    | **yes**  |
| P3-04 | Style graph and `w:basedOn` cycle detection   | M    | no       |
| P3-05 | `w:docDefaults`                               | S    | no       |
| P3-06 | Cascade order                                 | L    | **yes**  |
| P3-07 | Toggle-property XOR                           | M    | **yes**  |
| P3-08 | Numbering-derived properties                  | M    | no       |
| P3-09 | Table conditional formatting and `w:cnfStyle` | L    | **yes**  |
| P3-10 | Theme resolution                              | M    | no       |
| P3-11 | Resolved-property cache                       | M    | no       |
| P3-12 | Property inspector                            | S    | no       |
| P3-13 | `settings.xml` and compatibility flags        | M    | no       |

`P3-00` blocks the entire phase. Nothing else starts until it closes.

---

### P3-00 — Resolve ADR 0003 — model representation spike

**Size** XL · **Depends** Phase 1, Phase 2 · **Escalate** **yes** · `ROUND-TRIP`

**`docs/adr/0003-document-model-representation.md` exists and its status is `OPEN — spike required
before Phase 3`.** This ticket does not author that ADR. It runs the spike that closes it, and amends
the file in place with a **Decision** section and a **Consequences** section.

The four requirements are already stated in the ADR and are not restated here. What this ticket adds is
the **shape of the spike** — because the failure mode for a decision like this is not choosing wrong,
it is choosing on the basis of an argument rather than a measurement, and discovering in Phase 6 that
the argument was about the wrong thing.

**Build all three candidates, minimally, against the same fixture.** Not sketches — three
implementations that support exactly four operations, against one real 200-page `.docx` parsed by
Phase 1:

```pseudo
# The spike interface. Deliberately tiny; deliberately the four operations that
# actually discriminate between the candidates.

  insertText(pos, text)        # the typing path
  deleteRange(from, to)        # the backspace-over-a-selection path
  resolveRunProps(pos)         # the cascade read path, once per shaped run
  serialize() -> XML           # the round-trip path

# Measure, on the SAME fixture, with the SAME operation sequence:
#   - wall-clock for 10,000 single-character inserts at a mid-document position
#   - peak RSS after those inserts
#   - wall-clock for serialize()
#   - bytes-differing between serialize() and the original (must be zero-
#     equivalent under the Phase 11 equivalence relation, P11-03)
#   - lines of code, honestly counted, for each candidate
```

**The decision criterion is stated before the numbers are in.** Write it into the ADR _first_, so the
spike cannot be rationalised afterwards. Proposed: **round-trip fidelity is a gate, not a score** — any
candidate that cannot serialize the fixture equivalently is eliminated regardless of speed. Among
survivors, the 10,000-insert wall-clock is the primary metric, because that is the operation Phase 6
performs on the critical path and the only one the user can feel.

**Trap — the round-trip requirement is not symmetric with the editing requirement.** Candidate A (piece
table + interval tree) is fastest to edit and hardest to serialize, because the original element tree,
with its unknown extensions and its attribute order, has to be reconstructed from intervals. Candidate B
(keep the parsed tree, edit in place) serializes trivially and copies too much. The temptation is to
pick A for speed and discover that `P2`'s lossless round-trip guarantee — the thing the whole codegen
approach was _for_ — cannot be met. **Hence the gate.** If A cannot pass it, A loses, and the honest
outcome is a hybrid: tree retained for serialization, text and intervals layered over it, with an
explicit statement of which is authoritative for which question.

**Trap — "we can decide later."** The ADR already says this is the decision hardest to reverse. It is
reversible only while `packages/wml` is empty. Every ticket after this one writes against whatever this
chooses; Phase 6's undo log, Phase 5's dirty-paragraph propagation and Phase 11's determinism gate all
encode assumptions from it.

**Escalate when.** Any candidate fails the round-trip gate, _or_ the fastest survivor is more than
about 5× slower than the fastest eliminated candidate on the insert benchmark. That combination means
the requirements genuinely conflict and the resolution is an architecture question, not a benchmark
question.

**Done when.** Three spike implementations exist under a clearly-marked throwaway path; the measurement
table is in the ADR; the ADR's status is `ACCEPTED` with a Decision and a Consequences section; the
Consequences section names, by ticket ID, what each later phase may now assume; the spike code is
deleted or moved out of the build.

---

### P3-01 — Stable node identity

**Size** L · **Depends** P3-00 · **Escalate** **yes**

Every addressable thing in the document needs an identity that survives edits. This is the substrate
for the caret (`P6-01`), for range annotations (`P3-03`), for layout invalidation (`P5-16`), for the
layout goldens (`P5-17`, keyed by `NodeId` precisely so they survive reordering) and for undo (`P6-11`).

**`NodeId` is opaque, dense and never reused.**

```pseudo
NodeId = opaque u32        # dense so it indexes arrays directly; opaque so no
                           # caller can do arithmetic on it or infer order

IdTable:
    nextId     : u32                   # monotonic, never decremented
    generation : Map<NodeId, u32>      # bumped on delete; catches use-after-free
    freeList   : NONE                  # deliberately absent - see trap

fn mint() -> NodeId
fn isLive(id) -> bool
fn retire(id)                          # bumps generation; does NOT return id to a pool
```

**Trap — reuse.** A freelist that recycles `NodeId`s is the single most attractive optimisation here and
it is a correctness bug. A retired id handed back out means a stale bookmark, a stale caret or a stale
undo record silently re-targets a _different_ node, and the resulting corruption is unattributable
because nothing is out of range and nothing throws. `u32` at one id per node gives four billion ids; a
document that exhausts them has other problems. **No freelist.**

**Trap — identity is not position.** `NodeId` says _which_ node; it says nothing about where it is, and
it must not be ordered. If callers can compare ids to determine document order, they will, and the
first time a node is moved (drag-drop, cut-paste, `P10-10`'s move-revision) every such comparison is
silently wrong. Document order is a separate query against the tree, and it is `P3-02`'s job.

**Trap — what gets an id.** Not everything. Giving every attribute an id is waste; giving only
paragraphs ids means the caret cannot address a run boundary. The set is: paragraphs, runs, tables,
rows, cells, and every element that can host a range annotation endpoint. Write the list down, because
extending it later means migrating persisted goldens.

**Done when.** Ids are minted densely from zero; retirement bumps a generation and a use-after-retire is
detectable in dev builds; no freelist exists; there is no public API that orders or compares two ids for
position; the set of id-bearing node kinds is enumerated in one place.

---

### P3-02 — Text storage and the interval store

**Size** L · **Depends** P3-00, P3-01 · **Escalate** **yes** · `HOT-PATH`

Whatever `P3-00` chose, this ticket implements it. Two structures and the mapping between them.

```pseudo
# Position. Every layer above talks in these; nothing above this ticket may
# assume a position is an integer offset into a single string.

DocPos = { node: NodeId, offset: u32 }     # logical; survives edits elsewhere
AbsPos = u32                               # flat offset; INVALIDATED by any edit

fn toAbs(p: DocPos) -> AbsPos
fn toDoc(a: AbsPos) -> DocPos

# The invariant that makes this safe: AbsPos is a CACHE, never a store. It may
# live inside a single synchronous algorithm (line breaking walks AbsPos, and
# that is the point - it is fast). It may never be persisted, never cross an
# await, never be written into an undo record or a bookmark.

IntervalStore:
    # ordered by start; supports stabbing and range queries in O(log n + k)
    insert(from: AbsPos, to: AbsPos, payload) -> IntervalId
    stab(at: AbsPos)            -> Interval[]
    overlapping(from, to)       -> Interval[]
    shift(at: AbsPos, delta: i32)   # called on every edit; the hot path
```

**Trap — `shift` is the whole ballgame.** Every edit moves every interval after it. A naive
implementation walks all intervals per keystroke, which is O(n) per character typed and becomes visible
around the length of a thesis. The structure must support an offset applied to a subtree rather than to
each interval — an order-statistic tree, or a piece-table-relative addressing scheme where intervals
are anchored to pieces rather than to absolute offsets and `shift` is a no-op.

**Trap — zero-width intervals.** A collapsed bookmark, an empty comment range and the caret itself are
all zero-width. An interval structure that assumes `from < to` drops them, and an `insert` at exactly
their position has an ambiguous result (does the new text go inside the bookmark or outside?). Both
answers are needed in different cases, so the interval carries an explicit **gravity** per endpoint —
whether it sticks to the text before or the text after an insertion at its exact position. Bookmark
starts have right gravity, bookmark ends left gravity, so typing inside a bookmark extends it and typing
at either boundary does not.

**Done when.** `AbsPos` never appears in a persisted structure and a CI grep proves it; `shift` is
sub-linear in interval count, demonstrated by a benchmark at 10k intervals; zero-width intervals survive
an insertion at their exact position; gravity is per-endpoint and its default is stated.

---

### P3-03 — Range annotations

**Size** L · **Depends** P3-01, P3-02 · **Escalate** **yes** · `ROUND-TRIP`

Bookmarks, comment ranges, moves and permissions are **ranges that do not nest with the element tree**.
`w:bookmarkStart` can sit inside one paragraph and its `w:bookmarkEnd` inside a table cell three
paragraphs later. They interleave with each other arbitrarily. They are not a tree and no tree can hold
them.

The members:

```pseudo
# Paired, tree-crossing, arbitrarily overlapping:
  w:bookmarkStart / w:bookmarkEnd          keyed by @w:id, named by @w:name
  w:commentRangeStart / w:commentRangeEnd  keyed by @w:id -> comments.xml
  w:moveFromRangeStart / w:moveFromRangeEnd
  w:moveToRangeStart / w:moveToRangeEnd
  w:permStart / w:permEnd                  editing permissions
  w:customXmlInsRangeStart / ...End        and the Del/MoveFrom/MoveTo variants

Annotation = {
    kind, id, from: DocPos, to: DocPos, payload,
    sourceOrder: u32       # see trap
}
```

**Trap — the markers are content, and they round-trip.** These elements occupy positions in the run
sequence. Lifting them into a side structure is right for querying and wrong for serialization: on save
they must be written **back into the same positions**, and where two markers sit at the _same_ position
their relative order must be preserved, because Word's own output has a consistent order there and
changing it produces a spurious diff on every save. Hence `sourceOrder`: the original document order
among coincident markers, carried through untouched. This is a `ROUND-TRIP` obligation and `P11-04`
tests it.

**Trap — unmatched and crossed markers are real.** Files in the wild contain a `bookmarkStart` with no
`bookmarkEnd`, an end with no start, and pairs whose end precedes their start. The reader must not
throw, must not drop the orphan (it round-trips), and must not let it corrupt the interval store. The
policy: an unmatched start is an annotation extending to end-of-document for _query_ purposes but
retains its orphan status for _serialization_; an unmatched end is retained positionally and ignored for
query; a crossed pair is normalised for query and preserved as-authored for write. Each case emits a
diagnostic, capped by `DIAGNOSTIC_CAP`.

**Trap — `w:id` is not unique across kinds and is not a `NodeId`.** Bookmark ids and comment ids are
separate `ST_DecimalNumber` spaces, both authored by the producer, both reusable after deletion, and
neither related to `P3-01`'s identity. Keying the store by `w:id` alone collides. Key by
`(kind, w:id)`, and keep `NodeId` for the endpoints.

**Trap — the bookmark named `_GoBack`.** Word writes it, moves it on every save and never shows it. It
must round-trip and must not be surfaced in any UI that lists bookmarks. It is the canonical instance of
"do not filter this out, do not display it."

**Done when.** A document with interleaved, non-nesting bookmark and comment ranges survives open→save
with marker positions and coincident-marker order preserved; orphaned and crossed markers each have a
stated policy, a diagnostic and a fixture; deleting text containing one endpoint of a range leaves the
range well-formed; `(kind, id)` keying is enforced.

---

### P3-04 — Style graph and `w:basedOn` cycle detection

**Size** M · **Depends** Phase 2 (`styles.xml` located) · **Escalate** no

Build the style table from `CT_Styles`, resolve `w:basedOn` chains, and expose a flattened lookup.

```pseudo
StyleTable:
    byId      : Map<styleId, Style>
    defaults  : Map<ST_StyleType, styleId>    # from @w:default
    latent    : LatentStyleTable              # P3-04b, below

Style = {
    id, type: ST_StyleType,       # paragraph | character | table | numbering
    name, basedOn?, next?, link?,
    pPr?: CT_PPrGeneral,          # NOTE the type - not CT_PPr
    rPr?: CT_RPr,
    tblPr?: CT_TblPrBase,         # NOTE the type - not CT_TblPr
    trPr?, tcPr?,
    tblStylePr: CT_TblStylePr[],  # the 13 conditional overrides; P3-09
    flags: { hidden, semiHidden, qFormat, locked, personal, ... }
}

fn chain(styleId) -> Style[]       # self first, then basedOn ancestors
    seen <- {}
    out  <- []
    cur  <- styleId
    while cur exists and cur not in seen:
        seen.add(cur); out.append(byId[cur]); cur <- byId[cur].basedOn
    if cur in seen: diagnostic(STYLE_CYCLE, cur); # truncate, do not throw
    return out
```

**Trap — `basedOn` across types.** A paragraph style whose `basedOn` names a character style is
malformed but occurs. The chain walk must stop at the type boundary rather than mixing property bags;
`P3-06` assumes each chain is type-homogeneous.

**Trap — the style's `pPr` is `CT_PPrGeneral`.** No `rPr`, no `sectPr`. If the model types style
properties and direct properties identically, this distinction is lost and `P3-06`'s paragraph-mark
handling has nowhere to come from. Keep them as distinct types, exactly as the schema has them.

**Trap — a missing `basedOn` target.** `basedOn` naming a `styleId` that does not exist in the document
is common (the style was deleted, the reference was not). Treat as no `basedOn`, emit a diagnostic, do
not fabricate the style.

**Trap — `w:default` is per type.** Four default slots, one per `ST_StyleType`, each from the style
carrying `@w:default="1"`. Two styles of the same type both claiming default is malformed; first in
document order wins, diagnostic emitted.

**Sub-ticket — latent styles.** `CT_LatentStyles` carries `defLockedState`, `defUIPriority`,
`defSemiHidden`, `defUnhideWhenUsed`, `defQFormat` and `@count`, plus `w:lsdException` per named style.
Latent styles affect **UI presentation only** — never formatting — and they round-trip. Model them,
expose them to `P3-12`, and never consult them from `P3-06`.

**Done when.** A cyclic `basedOn` chain terminates with a diagnostic instead of hanging; a chain that
crosses `ST_StyleType` stops at the boundary; missing targets degrade to no-`basedOn`; the four default
slots resolve; latent styles are modelled and provably unread by the cascade.

---

### P3-05 — `w:docDefaults`

**Size** S · **Depends** P3-04 · **Escalate** no

The bottom of the cascade. `CT_DocDefaults` has exactly two children and **both are wrappers**:
`w:rPrDefault` of type `CT_RPrDefault` (containing an optional `w:rPr`) and `w:pPrDefault` of type
`CT_PPrDefault` (containing an optional `w:pPr`). Reading `docDefaults/rPr` directly finds nothing.

**Trap — absent `docDefaults` is not "no defaults."** When the element is missing, the application's own
built-in defaults apply, and those are not in the schema (`SPEC-GAP`, `UNVERIFIABLE-HERE` — we cannot
observe Word here). Write them down as one named constant table with its provenance and reasoning, so a
later session can correct it in one place. Do not scatter `?? 20` half-point fallbacks through the
cascade.

**Done when.** Both wrapper levels are traversed; a document with no `docDefaults` resolves through the
named fallback table; the fallback table is one exported constant carrying `SPEC-GAP` and its
provenance.

---

### P3-06 — Cascade order

**Size** L · **Depends** P3-04, P3-05, P3-07, P3-08, P3-09, P3-10 · **Escalate** **yes**

The core of the phase. Resolve effective properties for a run and for a paragraph, in the normative
order, with provenance retained.

```pseudo
# PARAGRAPH properties, bottom to top. Later wins, EXCEPT toggles (P3-07).
#
#   1. docDefaults/pPrDefault/pPr                     P3-05
#   2. table style pPr (if inside a table)            P3-09 - conditional layers
#   3. numbering style pPr (if numbered)              P3-08
#   4. paragraph style chain, ROOT-FIRST              P3-04
#   5. numbering level pPr (ind/jc from the level)    P3-08
#   6. direct w:pPr on the paragraph
#
# RUN properties, bottom to top:
#
#   1. docDefaults/rPrDefault/rPr                     P3-05
#   2. table style rPr (conditional layers)           P3-09
#   3. numbering style rPr
#   4. paragraph style chain rPr, ROOT-FIRST
#   5. character style chain rPr (w:rStyle), ROOT-FIRST
#   6. direct w:rPr on the run
#
# Paragraph-MARK run properties (w:pPr/w:rPr, type CT_ParaRPr) are a SEPARATE
# resolution with the same stack, terminating at the paragraph mark's own rPr.
# They format the pilcrow and therefore contribute to the last line's height
# (P5-06). A style cannot contribute at level 6 here: CT_PPrGeneral has no rPr.

fn resolve(levels: PropertyBag[]) -> Resolved
    out <- {}
    for lvl in levels:                 # bottom to top
        for (key, value) in lvl:
            if isToggle(key): out[key] <- toggleCombine(out[key], value)  # P3-07
            else:             out[key] <- value                           # overwrite
            provenance[key] <- lvl.origin                                 # P3-12
    return out
```

**Trap — root-first, not leaf-first.** A style chain resolves from the _most distant_ ancestor down to
the style itself, so the style's own properties win over what it is based on. `P3-04`'s `chain()`
returns self-first and must therefore be **reversed** before feeding this loop. Getting this backwards
inverts every inherited property in the document and still renders.

**Trap — the two numbering levels are not adjacent.** The numbering _style_'s `pPr` sits **below** the
paragraph style chain; the numbering _level_'s `ind`/`jc` sit **above** it. They are separate entries at
positions 3 and 5, not one combined step. Collapsing them makes indented list styles resolve wrong —
which looks like a small indent error, not like a cascade bug.

**Trap — "absent" is not "false".** A property absent from a level means _inherit_, and a property
present with `w:val="0"` means _explicitly off_. These are different, and `ST_OnOff`'s rule that an
absent `@val` on a _present_ element means **true** makes the confusion easy: `<w:b/>` is on,
`<w:b w:val="0"/>` is off, and no `<w:b>` at all is inherit. The property bag must distinguish
`absent` from `present-and-false`, which means it cannot be a plain object of booleans. Use the three
runtime `ST_OnOff` parsers from Phase 1 — `parseOnOff`, `parseOnOffOr`, `parseOnOffAttr` — and do not
merge them.

**Trap — provenance is not optional.** `P3-12` needs to report which level each property came from, and
it is also the only practical way to debug a wrong cascade. Recording it costs one write per property
per level; retrofitting it means rewriting the loop. Record it from the start.

**Escalate when.** Any document is found where the order above produces a result that disagrees with an
independent reading of the standard. The order is the phase's central claim; a counterexample is a
design question, not a bug fix.

**Done when.** Both stacks resolve in the order above; style chains are reversed to root-first; the two
numbering entries are at distinct positions; `absent` / `present-false` / `present-true` are three
distinguishable states throughout; provenance is populated for every resolved property; the paragraph
mark resolves separately and a fixture proves it can differ from the paragraph's last run.

---

### P3-07 — Toggle-property XOR

**Size** M · **Depends** P3-06 · **Escalate** **yes**

Toggle properties do not overwrite when inherited — they **XOR**. A style sets bold; direct formatting
sets bold; the result is **not bold**. This is the single most commonly botched part of the cascade, and
it is invisible: the document renders, with the wrong weight.

```pseudo
# The toggle set, from EG_RPrBase. All are CT_OnOff:
#
#   b  bCs  i  iCs  caps  smallCaps  strike  dstrike  outline
#   shadow  emboss  imprint  vanish  webHidden
#
# NOT toggles despite being CT_OnOff - these overwrite normally:
#   noProof  snapToGrid  rtl  cs  specVanish  oMath
#
fn toggleCombine(inherited, direct) -> OnOff
    if direct is ABSENT: return inherited
    if inherited is ABSENT: return direct
    return inherited XOR direct

# The rule applies only across INHERITANCE boundaries - between a style level
# and a level above it. Two properties at the SAME level (which cannot happen
# in valid markup, but can in malformed files) overwrite, last wins.
```

**Trap — the set is not "everything that is `CT_OnOff`."** Twenty elements in `EG_RPrBase` have type
`CT_OnOff`; fourteen of them toggle. `rtl`, `cs`, `noProof`, `snapToGrid`, `specVanish` and `oMath` are
plain booleans that overwrite. `SPEC-GAP` — the schema does not distinguish them, so the set is
established from the prose and must be recorded as a single named constant with a comment saying where
it came from and that it is not derivable from the XSD.

**Trap — direct formatting toggles too.** The instinct is that direct `w:rPr` should be authoritative.
It is not: direct formatting is just the topmost level and XORs like any other. A user who selects text
in a Heading style and presses Ctrl+B gets _not bold_, and that is correct behaviour that matches Word.

**Trap — `bCs` and `iCs` are independent toggles.** They are the complex-script counterparts and have
their own inheritance. A run can be bold in Latin and not bold in Arabic. Do not alias them to `b`/`i`.

**Escalate when.** The toggle set needs to change after being written down. Each addition or removal
silently changes the rendering of existing documents, so it is a decision with a paper trail, not an
edit.

**Done when.** The fourteen-member set is one named constant carrying `SPEC-GAP` and provenance; the six
non-toggling `CT_OnOff` members are explicitly listed as non-toggles in the same place; style-bold plus
direct-bold resolves to _not bold_ in a fixture; `bCs` and `iCs` resolve independently of `b` and `i`.

---

### P3-08 — Numbering-derived properties

**Size** M · **Depends** P3-04, P3-06 · **Escalate** no

The cascade's two numbering inputs. This ticket resolves _which_ numbering definition and level apply to
a paragraph and what properties they contribute. It does **not** compute list counters — that is
`P10-01`, which is a stateful fold over the whole document and belongs in Phase 10.

```pseudo
fn numberingFor(para) -> (numId, ilvl) or NONE
    # From the resolved pPr (P3-06), not from direct markup: w:numPr can be
    # inherited from the paragraph style like any other property.
    numPr <- resolved.numPr
    if absent: return NONE
    if numPr.numId == 0: return NONE      # 0 means "no numbering", explicitly

fn levelFor(numId, ilvl) -> CT_Lvl
    num         <- numbering.num[numId]
    abstract    <- numbering.abstractNum[num.abstractNumId]
    base        <- abstract.lvl[ilvl]
    override    <- num.lvlOverride[ilvl]?.lvl
    return override or base

# Contributions to the cascade:
#   - the numbering STYLE (abstractNum/w:numStyleLink -> a style of type
#     'numbering') contributes pPr and rPr at cascade level 3
#   - the LEVEL's own pPr (indentation, jc) contributes at level 5
#   - the LEVEL's own rPr formats the number GLYPH only, never the paragraph
#     text - it is an input to P10-01's rendering, not to the run cascade
```

**Trap — `numId="0"` means no numbering.** It is not a valid reference to be looked up; it is the
sentinel that removes numbering inherited from a style. A paragraph in a numbered style with
`<w:numPr><w:numId w:val="0"/></w:numPr>` is unnumbered.

**Trap — `numStyleLink` and `styleLink` point in opposite directions.** An `abstractNum` with
`w:styleLink` _is_ the definition behind a numbering style; one with `w:numStyleLink` _defers_ to the
numbering style named. Following the wrong one gives an infinite loop or the wrong indents. Resolve
`numStyleLink` by indirection through the style table, with the same cycle guard as `P3-04`.

**Trap — the level `rPr` does not format the text.** It formats the number. A level with bold `rPr`
gives a bold "1." and regular body text. Feeding it into the run cascade bolds the entire paragraph.

**Done when.** `numId=0` resolves to unnumbered; `lvlOverride` beats the abstract level; `numStyleLink`
indirection terminates on a cycle; the level `rPr` is exposed on a separate channel from the run
cascade and a fixture proves the paragraph text is unaffected.

---

### P3-09 — Table conditional formatting and `w:cnfStyle`

**Size** L · **Depends** P3-04, P3-06 · **Escalate** **yes**

A table style carries up to thirteen `w:tblStylePr` overrides — `wholeTable` plus twelve positional
conditions — and each cell may additionally carry `w:cnfStyle` naming which conditions apply to it.
`P7-13` consumes this.

**The two vocabularies.** `ST_TblStyleOverrideType` and `CT_Cnf` name the same twelve conditions
differently. This table is the deliverable; it is data, written once:

| `ST_TblStyleOverrideType` | `CT_Cnf` attribute          | `ST_Cnf` bit |
| ------------------------- | --------------------------- | ------------ |
| `firstRow`                | `firstRow`                  | 0            |
| `lastRow`                 | `lastRow`                   | 1            |
| `firstCol`                | **`firstColumn`**           | 2            |
| `lastCol`                 | **`lastColumn`**            | 3            |
| `band1Vert`               | **`oddVBand`**              | 4            |
| `band2Vert`               | **`evenVBand`**             | 5            |
| `band1Horz`               | **`oddHBand`**              | 6            |
| `band2Horz`               | **`evenHBand`**             | 7            |
| `neCell`                  | **`firstRowLastColumn`**    | 8            |
| `nwCell`                  | **`firstRowFirstColumn`**   | 9            |
| `seCell`                  | **`lastRowLastColumn`**     | 10           |
| `swCell`                  | **`lastRowFirstColumn`**    | 11           |
| `wholeTable`              | _(no bit — always applies)_ | —            |

**The bit order is `SPEC-GAP`.** `ST_Cnf` is `xsd:string` with `length="12"` and pattern `[01]*`; the
schema fixes the _length_ and the _alphabet_ but says nothing about which position means which
condition. The order above follows the attribute declaration order in `CT_Cnf`, which is a reasonable
inference and not a normative one. Record it as `SPEC-GAP` + `UNVERIFIABLE-HERE`, in one constant, with
a comment saying exactly that — so when a document contradicts it, one line changes.

```pseudo
# Application order, lowest to highest precedence. A cell in the first row of a
# banded table receives several of these, in this order:

  wholeTable
  band1Horz / band2Horz          # horizontal banding
  band1Vert / band2Vert          # vertical banding
  firstRow / lastRow
  firstCol / lastCol
  nwCell / neCell / swCell / seCell   # corners win over everything

# Each layer is a full property bag (pPr / rPr / tblPr / trPr / tcPr) and is
# pushed onto the cascade at level 2, in this order, before the paragraph style
# chain. Toggles XOR here too (P3-07) - a banded row that sets bold under a
# whole-table bold produces regular text.
```

**Trap — `w:cnfStyle` and computed position can disagree.** The cell's own `w:cnfStyle` is the producer's
statement of which conditions apply; the table geometry also implies conditions (this _is_ the first
row). They can conflict, and both are present in real files. **`w:cnfStyle` wins** — it is explicit and
it is what round-trips. Compute position only where `cnfStyle` is absent.

**Trap — `@val` and the named attributes can disagree.** `CT_Cnf` carries both the twelve-bit string and
twelve named flags. Pick one as authoritative, state it, and preserve _both_ verbatim for write-back
regardless of which was read. Proposed: **named attributes win where present**, falling back to `@val`,
because they are unambiguous and do not depend on the unverified bit order above.

**Trap — banding indices skip.** As recorded in `P7-13`: banding counts exclude header rows and the
first/last row when those conditions are active. The band index is not the row index.

**Escalate when.** A real document contradicts the inferred bit order, or contradicts `cnfStyle`
winning over computed position. Both are inferences and both change rendering across every styled table.

**Done when.** The vocabulary mapping is one data table, used by both directions; the bit order is one
constant marked `SPEC-GAP`; the layer order above is applied lowest-to-highest; toggles XOR across
layers; `cnfStyle` beats computed position; both `@val` and named attributes round-trip regardless of
which was authoritative.

---

### P3-10 — Theme resolution

**Size** M · **Depends** Phase 2 (`theme1.xml` located) · **Escalate** no

Resolve `a:clrScheme` and `a:fontScheme` so `P4-01` can bind `w:rFonts *Theme` attributes and `P9-14`
can resolve `a:schemeClr`.

```pseudo
ColorScheme = {
    dk1, lt1, dk2, lt2,               # NOTE: not the same tokens as references
    accent1..accent6, hlink, folHlink
}

# The mapping trap: DrawingML references use bg1/tx1/bg2/tx2, which map onto
# dk1/lt1/dk2/lt2 THROUGH a:clrMap on the slide/document part. In WML the map is
# effectively identity, but the indirection must exist as a function or P9-14
# duplicates it wrongly.
fn resolveSchemeColor(token, scheme, clrMap) -> RGB

FontScheme = {
    major: { latin, ea, cs, fonts: Map<scriptTag, typeface> },
    minor: { latin, ea, cs, fonts: Map<scriptTag, typeface> }
}

# w:rFonts theme attribute values bind as:
#   majorAscii / majorHAnsi   -> major.latin
#   majorEastAsia             -> major.ea
#   majorBidi                 -> major.cs
#   minorAscii / minorHAnsi   -> minor.latin
#   minorEastAsia             -> minor.ea
#   minorBidi                 -> minor.cs
```

**Trap — `a:latin/@typeface` can be empty.** An empty string is not a font name; it means "fall through
to the script-specific `a:font` list, then to the application default." Treating `""` as a family name
produces a request for a font called nothing.

**Trap — the script-specific `a:font` entries are not decoration.** A theme carries per-script typefaces
keyed by script tag (`Jpan`, `Hang`, `Hans`, `Arab`, …). `P4-01` needs them for correct CJK theme font
resolution; a resolver that reads only `a:latin`/`a:ea`/`a:cs` silently uses the wrong face for most
non-Latin documents.

**Trap — a missing theme part is normal.** Not every `.docx` has one. Theme references in a themeless
document resolve to the application defaults from `P3-05`'s constant table, with a diagnostic, not an
error.

**Done when.** All six theme-font bindings resolve; script-specific `a:font` entries are consulted;
empty `@typeface` falls through rather than being used; a themeless document resolves theme references
to the `P3-05` fallbacks with a diagnostic; `resolveSchemeColor` exists as a function `P9-14` calls
rather than reimplements.

---

### P3-11 — Resolved-property cache

**Size** M · **Depends** P3-06 · **Escalate** no · `HOT-PATH`

`P3-06` walks up to six levels per run. Layout calls it once per shaped run, and incremental relayout
calls it again. It must be cached, and the cache must be invalidated **exactly**.

```pseudo
CacheKey = (styleId, directPropsHash, contextHash)
    # contextHash folds in: table conditional layers in effect (P3-09),
    # numbering level (P3-08), theme generation, docDefaults generation

Invalidation:
    styles.xml edited        -> clear all
    theme edited             -> clear all
    numbering edited         -> clear entries whose contextHash includes numbering
    direct rPr/pPr edited    -> clear that node only
    table structure changed  -> clear that table's subtree (conditions moved)
```

**Trap — the cache key must not be the `NodeId`.** Keying by node gives one entry per run and no reuse;
a document where ten thousand runs share one style should have one entry. Key by the _inputs_, not by
the consumer.

**Trap — table structure changes move conditions.** Inserting a row changes which cells are `lastRow`,
which invalidates resolved properties in cells that were not themselves edited. This is the invalidation
case that gets missed, and it produces stale formatting on exactly one row.

**Trap — a generation counter beats a deep hash.** Hashing the whole style table per lookup defeats the
cache. Bump an integer on every mutation to styles / theme / numbering / docDefaults and fold those four
integers into `contextHash`.

**Done when.** Hit rate is observable; ten thousand runs sharing a style produce one entry; each of the
five invalidation triggers has a fixture; inserting a table row invalidates the previously-last row.

---

### P3-12 — Property inspector

**Size** S · **Depends** P3-06, P3-11 · **Escalate** no

The phase demo, and the debugging tool that makes every other ticket here tractable. For any run or
paragraph, show each resolved property, its value, and **which cascade level produced it** — reading
`P3-06`'s provenance rather than recomputing.

```pseudo
# Output shape, per property:
#   b        = true    <- direct w:rPr          (XOR over: style 'Heading1' = true, docDefaults = absent)
#   sz       = 28hp    <- style 'Heading1'
#   rFonts.ascii = Calibri <- theme minorAscii via docDefaults
#   ind.left = 720tw   <- numbering level 0
```

**Trap — toggles need their history, not just their result.** "`b = true`" is useless when debugging an
XOR bug. Show the chain of contributions and the combine operation, as above.

**Done when.** Every resolved property reports its origin level; toggle properties additionally report
their contribution chain; the inspector reads provenance rather than re-resolving; it works for
paragraph marks as well as runs.

---

### P3-13 — `settings.xml` and compatibility flags

**Size** M · **Depends** Phase 2 · **Escalate** no

`CT_Settings` is large and most of it is irrelevant to rendering. The deliverable is not "model all of
it" — Phase 1 already models all of it — but **a small, explicit list of the settings that change
layout**, so later phases read a typed value rather than reaching into raw settings.

```pseudo
LayoutSettings = {
    defaultTabStop,            # P5-04
    evenAndOddHeaders,         # P8-05
    displayBackgroundShape,    # P10-14
    mirrorMargins,             # P8-01
    gutterAtTop, bookFoldPrinting,
    compat: CT_Compat          # see below
}
```

**Trap — `w:compat` is a list of "behave like an older Word version" switches**, and it is where
observed-behaviour divergences hide (`SPEC-GAP` throughout). Most are unimplementable without the
behaviour they name. The policy: **model all of them, implement none by default, and record each one
that a later phase decides to honour** in the coverage manifest as a distinct entry. A `compat` flag
silently ignored is acceptable; a `compat` flag silently _half_-honoured is not.

**Trap — `w:compatSetting` is the modern form.** Newer flags are name/uri/val triples rather than
elements, including the ones that matter most for line breaking. Read both forms.

**Trap — settings affect the cascade indirectly.** Several flags change how styles resolve rather than
how layout runs. Any such flag consulted by `P3-06` must be folded into `P3-11`'s `contextHash`, or the
cache serves pre-flag results.

**Done when.** The layout-relevant subset is a typed struct, not raw settings access; both `w:compat`
and `w:compatSetting` forms are read; every honoured flag has a coverage-manifest entry; unhonoured
flags round-trip and are enumerable; any cascade-affecting flag is in `contextHash`.

---

## Exit criteria for Phase 3

1. **ADR 0003 is `ACCEPTED`** with measurements, a stated decision criterion recorded before the
   measurements, and a Consequences section naming what later phases may assume.
2. **A property inspector** (`P3-12`) reports, for any run or paragraph in a real `.docx`, every
   resolved property with its origin level, and toggle properties with their contribution chain.
3. **The cascade order** of `P3-06` is implemented with style chains root-first and the two numbering
   inputs at distinct levels, with `absent` / `present-false` / `present-true` distinguishable
   throughout.
4. **The toggle set** is one named constant with provenance, and style-bold + direct-bold resolves to
   not-bold in a fixture.
5. **Range annotations** survive open→save with positions and coincident-marker order preserved,
   including interleaved non-nesting ranges, orphans and crossed pairs.
6. **The conditional-formatting vocabulary mapping** is one data table serving both directions, with the
   `ST_Cnf` bit order isolated in a single `SPEC-GAP` constant.
