# Phase 11 — Conformance, performance, security hardening

> **Difficulty rank 9 of 11 — the easiest phase to plan, and the one most likely to be skipped.**
>
> **Depends on** every prior phase. Several tickets here are *started* in Phase 1 (`P11-01`, `P11-10`)
> and merely *finished* here — a coverage manifest that first appears in Phase 11 has nothing to
> measure.
>
> **Owns** `packages/conformance/` and `apps/demo/`.

## Why this phase ranks here

The engineering is the least novel in the project: test runners, CI gates, a demo app. Nothing here
requires a decision that cannot be revisited.

It nonetheless carries the project's **credibility risk**, which is a different thing from technical
risk. Three of these tickets are the only mechanisms that turn "we implemented WordprocessingML" from a
claim into a measurement, and two of them — `P11-06` and `P11-07` — **cannot be run in this
environment at all** (`F6`, `F1`). A phase whose gates are all deferred is a phase that silently never
happened.

So the framing for this phase is inverted relative to the others. The risk is not that a ticket is hard.
The risk is that a ticket is *quietly downgraded* — a threshold lowered to make CI green, a gate marked
advisory and never re-enabled, a corpus that turns out to be four files. Every ticket below therefore
states what its failure looks like as a *process* failure, not as a bug.

**`F6` binds this entire phase.** No output of this project may describe the editor as
"Word-compatible" until `P11-05` and `P11-06` have actually run somewhere they can run. Until then the
honest phrase is *"unverified — no Word/LibreOffice available in this environment."*

---

## Environment constraints that shape the tickets

Restated from `01-invariants.md` because this is the phase where each one is finally released:

| Invariant | Effect here |
|---|---|
| `F1` | ~11 GB free on `D:`. Playwright browsers (~1 GB) may be downloaded **in this phase and not before**. LibreOffice must still not be installed locally. |
| `F3` | `onlyBuiltDependencies: [esbuild]` may finally be widened to admit Playwright — this phase, not earlier. |
| `F6` | No Word and no LibreOffice on this machine. `P11-06` is authored here and **runs only in CI**. |
| `G3` | Unimplemented features degrade visibly. `P11-01` is what makes that auditable. |

---

## Ticket index

| ID | Title | Size | Escalate |
|---|---|---|---|
| P11-01 | Coverage manifest and thresholds | M | no |
| P11-02 | Corpus strategy and licensing | L | **yes** |
| P11-03 | The equivalence relation | L | **yes** |
| P11-04 | Round-trip runner | M | no |
| P11-05 | Layout golden runner | M | no |
| P11-06 | Visual regression | L | no |
| P11-07 | Performance gates | M | no |
| P11-08 | Parser fuzzing | M | no |
| P11-09 | Malformed-package corpus | M | no |
| P11-10 | Determinism gate | S | no |
| P11-11 | Demo app | M | no |

---

### P11-01 — Coverage manifest and thresholds

**Size** M · **Depends** Phase 1 (manifest emitted by codegen) · **Escalate** no

The manifest exists from Phase 1: one entry per named type, with four states — `modelled`, `laidOut`,
`painted`, `roundTripped`. This ticket turns it into a **gate** and a **published report**.

```pseudo
# Thresholds, as CI assertions:
#   modelled      == 100%  of .docx-path types        # hard floor, never lowered
#   roundTripped  == 100%  of types seen in the corpus
#   laidOut       >= previous commit                  # ratchet, never regress
#   painted       >= previous commit                  # ratchet, never regress
#
# The ratchets compare against a checked-in baseline file, not against a
# remembered number. The baseline is updated by an explicit commit, which makes
# every regression a visible diff rather than a silent CI edit.
```

**Trap — the states must be set by *evidence*, not by hand.** A `painted` flag a developer ticks is a
lie waiting to happen. Each state is set by instrumentation: `modelled` by codegen, `roundTripped` by
`P11-04` observing the type in a corpus document, `laidOut` and `painted` by the layout and paint code
recording which type dispatches they actually executed during the corpus run.

**Trap — a placeholder is not `painted`.** `G3` requires charts, SmartArt and EMF to render as labelled
placeholders. That is a **fifth state**, `placeholder`, distinct from `painted` — otherwise the report
claims coverage the editor does not have. Add it.

**Trap — lowering a threshold must be harder than fixing the code.** Put the thresholds in a file whose
CODEOWNERS or review requirements make a change conspicuous, and require the commit message to say why.

**Done when.** All five states are set by instrumentation and never by hand; the two ratchets compare
against a checked-in baseline; the HTML report is published by CI; `placeholder` is distinct from
`painted` in both the data and the report.

---

### P11-02 — Corpus strategy and licensing

**Size** L · **Depends** none · **Escalate** **yes**

Every other ticket in this phase consumes the corpus. It is the phase's real dependency and its real
risk, and the risk is **legal, not technical**.

```pseudo
# Three sources, three provenance rules:
#
# (a) Permissively-licensed real-world .docx
#     Government publications, OSS project docs, CC-licensed material.
#     Each file carries a sidecar: source URL, licence, retrieval date.
#
# (b) Documents we author ourselves
#     Written in Word or LibreOffice by a human, licensed into the repo.
#     NOT authorable in this environment (F6) - contributed, not generated.
#
# (c) Schema-derived synthetic fixtures
#     Generated by the codegen: one minimal-valid instance per complex type.
#     The ONLY source that can reach breadth across ~2,800 types.
```

**Trap — we cannot ship Microsoft's test documents.** Nor can we ship arbitrary documents found on the
web. Every corpus file needs a recorded licence before it lands, and a file without one is removed
rather than grandfathered.

**Trap — synthetic fixtures give breadth and no realism.** They exercise every type and no real
document's structure — no deeply nested tables, no float/table interaction, no 400-page pagination. They
satisfy `P11-01`'s `modelled` threshold and satisfy nothing else. Both (a)/(b) and (c) are required and
neither substitutes.

**Trap — corpus documents contain personal data.** Real-world documents carry author names, comment
authors, revision authors and `dc:creator`. Scrub or accept deliberately, and record which.

**Trap — the corpus is also the perf baseline.** `P11-07` needs a genuinely large document (400+ pages).
One must be sourced or constructed, and constructing it by concatenation produces an unrealistically
uniform document. Note the limitation where it applies.

**Escalate when.** A licence is unclear. The default is exclusion, and a judgement call about
"probably fine" is not one to make inside a ticket.

**Done when.** Every corpus file has a provenance sidecar with source, licence and date; CI fails on a
file lacking one; all three sources are represented; a 400+ page document exists for `P11-07` with its
construction method recorded; a personal-data policy is stated and applied.

---

### P11-03 — The equivalence relation

**Size** L · **Depends** P3-00 · **Escalate** **yes** · `ROUND-TRIP`

**Byte-identity is not achievable** — ZIP metadata, attribute ordering and namespace prefix choice all
legitimately differ. So "lossless round-trip", the claim the entire codegen approach exists to support,
means *equivalence under an explicitly-defined relation*. This ticket defines that relation. It is the
most consequential ticket in the phase, because every other round-trip assertion is only as strong as
this definition.

```pseudo
fn equivalent(a: Package, b: Package) -> Diff[]

# WHAT MAY DIFFER (and why):
#   ZIP entry order, timestamps, compression level   - container, not content
#   attribute order within an element                - XML-insignificant
#   namespace PREFIX (w: vs wp:)                     - if the URI matches
#   self-closing vs open/close empty element         - XML-insignificant
#   insignificant whitespace between elements        - where xml:space permits
#
# WHAT MUST NOT DIFFER:
#   the set of parts and their content types
#   the relationship graph (ids MAY differ; the resolved graph may not)
#   element document order everywhere
#   attribute VALUES, including lexical form where the type is a string
#   text content, including xml:space="preserve" whitespace exactly
#   unknown elements, unknown attributes, unknown parts - byte-for-byte
```

**Trap — "insignificant whitespace" is a trap in WML.** `xml:space="preserve"` on `w:t` makes whitespace
significant, and the attribute may be absent while the whitespace still matters to the producer's
intent. The safe relation treats **all** whitespace inside `w:t` as significant, and only ignores
whitespace between elements where no text content is possible.

**Trap — normalising attribute values is not allowed.** `w:val="1"` and `w:val="true"` are both valid
`ST_OnOff` and mean the same thing, and rewriting one as the other is a **content change** by this
relation. The reader may interpret both; the writer must emit what arrived. This is `A3`'s rule
(schema defaults are never applied at read time) seen from the other side.

**Trap — relationship ids may differ but the graph may not.** `rId7` becoming `rId3` is fine if every
source, target and type still resolves identically. Comparing ids directly produces false failures;
comparing resolved graphs is the correct test and is more work.

**Trap — the relation must be *asymmetric* about idempotence.** Generation 1 output may differ from the
original under the permitted-difference list. Generation 2 output must be **byte-identical** to
generation 1. These are two different assertions and `P11-04` runs both.

**Escalate when.** A corpus document fails equivalence and the honest fix is to widen the relation.
Widening it is how a round-trip guarantee erodes into nothing; each widening needs a recorded
justification.

**Done when.** The relation is one documented module with each permitted difference individually
justified; whitespace inside `w:t` is always significant; attribute lexical forms are compared
literally; relationship graphs are compared resolved; the diff output names the part and the XPath, not
just "documents differ."

---

### P11-04 — Round-trip runner

**Size** M · **Depends** P11-02, P11-03 · **Escalate** no

Open → save → compare, across the whole corpus, as a CI gate.

```pseudo
for doc in corpus:
    g1 <- save(open(doc))
    assert equivalent(doc, g1)          # P11-03's relation
    g2 <- save(open(g1))
    assert bytesIdentical(g1, g2)       # STRICTER - idempotence after one pass
```

**Trap — the second assertion is the one that finds bugs.** Equivalence is forgiving by design;
byte-idempotence is not, and it catches non-determinism the relation was written to tolerate — a `Map`
iteration order, an unstable sort, a timestamp. Do not let the first assertion's greenness stand in for
the second's.

**Trap — a failure must be diagnosable.** "Round-trip failed on document 47" is useless against a 2 MB
package. The runner emits the part name, the XPath and both values, and writes the failing generation
to a tmp directory for inspection.

**Done when.** Both assertions run over the whole corpus in CI; failures report part, path and both
values; failing artefacts are retained; the runner is incremental enough to be run locally on one
document.

---

### P11-05 — Layout golden runner

**Size** M · **Depends** P5-17 (golden format), P11-02 · **Escalate** no

`P5-17` defined the format: deterministic, diffable, keyed by `NodeId` rather than index, rounded to
whole twips, **no glyph ids**. This ticket runs it.

**Trap — goldens must be reviewable in a pull request.** That is the whole reason they beat pixel
diffs. If a one-line layout change produces a 4,000-line golden diff, the goldens are formatted wrong
and nobody will read them. Group by page, then by paragraph `NodeId`; keep one line per line box.

**Trap — goldens are font-dependent and this environment's fonts are not CI's.** The golden run must
pin its fonts explicitly — bundled test fonts, not system fonts — or every developer sees spurious
diffs and stops trusting them. Bundling a small set of permissively-licensed fonts is part of this
ticket.

**Trap — regenerating goldens must be deliberate.** An `--update` flag that is easy to run is an
`--update` flag that gets run instead of reading the diff. Require it to be explicit and make the
commit show the golden changes as a reviewable diff.

**Done when.** Goldens are per-page, per-paragraph, one line per line box; fonts are bundled and pinned;
regeneration is explicit; a deliberate one-paragraph layout change produces a diff a reviewer can read
in under a minute.

---

### P11-06 — Visual regression

**Size** L · **Depends** P11-02, P11-05 · **Escalate** no · `UNVERIFIABLE-HERE`

Render each corpus page to PNG and compare perceptually against a reference.

**`F1` and `F6` bind: LibreOffice must not be installed on this machine, and there is no Word here.
This ticket is authored here and runs only in CI.** That is not a reason to defer writing it — it is a
reason to write it such that it *can* run elsewhere without further design work.

```pseudo
# Reference source, in preference order:
#   1. headless LibreOffice in a pinned CI container   (automatable)
#   2. checked-in reference PNGs from a manual Word run (authoritative, static)
#   3. self-comparison against a previous commit        (catches regressions
#                                                        only, not wrongness)
#
# Source 3 is the fallback that works with no reference renderer at all, and it
# is worth having, PROVIDED the report never calls it "Word-compatible" (F6).
```

**Trap — perceptual diff thresholds hide real failures.** A tolerance loose enough to absorb font
rasterisation differences is loose enough to absorb a wrong indent. Prefer a **tight** threshold with a
per-document allowlist of known-different regions over a globally loose one.

**Trap — the font environment dominates the result.** Pin fonts in the container. Treat local runs as
advisory and say so in the output, so nobody debugs a font difference as a layout bug.

**Trap — LibreOffice is not Word.** It is an approximation of the reference, not the reference. A
difference against LibreOffice is a signal to investigate, not proof of a bug. Say this in the report
header, every time.

**Done when.** The runner works against all three reference sources with the source named in the output;
fonts are pinned in a container definition checked into the repo; thresholds are tight with explicit
per-document allowlists; the report header states the reference source and carries `F6`'s caveat when
applicable.

---

### P11-07 — Performance gates

**Size** M · **Depends** P11-02, `F1`/`F3` released · **Escalate** no

**This is the ticket that unblocks the Playwright browser download (~1 GB).** `F3`'s
`onlyBuiltDependencies` allowlist may be widened here and not before, and `F1`'s disk budget must be
re-checked at the time.

```pseudo
# The budgets, from the plan. Each is a CI assertion, not an aspiration:
#   open a 100-page document        < set wall-clock budget
#   keystroke-to-pixel latency      < 16 ms at p95
#   scroll a 500-page document      >= 60 fps
#
# Measured in Playwright with CPU throttling enabled, on the SAME corpus
# document every run.
```

**Trap — an unthrottled gate passes on a fast machine and tells you nothing.** CPU throttling is what
makes the number comparable between a developer laptop and a CI runner. Set it explicitly and record
the multiplier.

**Trap — p95, not mean.** Keystroke latency is a distribution with a tail, and the tail is what the user
experiences as jank. A mean under 16 ms with a p95 of 90 ms is a bad editor that passes a badly-written
gate.

**Trap — perf gates are the first thing disabled when they go red.** Make them fail the build, and make
re-baselining require the same explicit commit as `P11-01`'s ratchets.

**Trap — measure keystroke-to-*pixel*, not keystroke-to-model.** The model update is microseconds; the
relayout, repaint and compositor round-trip are the cost. Instrument at the frame, not at the handler.

**Done when.** All three budgets are CI assertions with throttling set explicitly; latency is reported at
p95; re-baselining requires an explicit commit; measurement is at the frame; the Playwright install is
gated on a disk check.

---

### P11-08 — Parser fuzzing

**Size** M · **Depends** Phase 1, Phase 2 · **Escalate** no

Structure-aware fuzzing of the XML reader and the OPC layer. The target is **not** finding crashes in a
memory-safe language — it is finding **hangs**, unbounded allocation and typed-error violations.

```pseudo
# Corpus-driven mutation: start from real corpus documents, mutate:
#   truncate a part mid-element
#   swap element names between valid ones
#   inject deeply nested elements (10k deep)
#   invalid UTF-8 byte sequences
#   attribute values outside every facet
#   duplicate attributes, duplicate part names differing only in case
#
# The assertion, every time:
#   result is a TYPED error OR a successful parse.
#   NEVER: an unhandled exception, a hang, unbounded memory.
```

**Trap — deep nesting is the practical hang.** A recursive descent reader stack-overflows on a 10k-deep
document, and a stack overflow in a worker is a silent death rather than an error. The reader needs an
explicit depth cap — which is also `P9-19`'s VML recursion limit, from the other direction.

**Trap — `DIAGNOSTIC_CAP` is a fuzz target.** A document engineered to emit millions of diagnostics is a
memory exhaustion attack. The cap of 1,000 must be enforced at the emit site, not by truncating a list
afterwards.

**Trap — fuzzing finds the same bug a thousand times.** Deduplicate by stack signature or the runs are
unreadable and get ignored.

**Done when.** The fuzzer runs corpus-driven mutation in CI on a time budget; every outcome is a typed
error or a parse; an explicit depth cap exists and is tested; `DIAGNOSTIC_CAP` is enforced at emit;
findings are deduplicated by signature.

---

### P11-09 — Malformed-package corpus

**Size** M · **Depends** Phase 2 · **Escalate** no

Where `P11-08` fuzzes randomly, this is a **hand-built, permanent** set of adversarial packages — one
per security boundary Phase 2 established, each asserting a specific typed error.

```pseudo
# One fixture per boundary, each asserting a NAMED error code:
#   zip bomb, high decompression ratio          -> ratio cap
#   zip bomb, many small entries                -> entry count cap
#   DOCTYPE present                             -> entity-rejected
#   billion laughs entity expansion             -> entity-rejected
#   external entity reference (XXE)             -> entity-rejected
#   part name with ../                          -> path-traversal
#   part name differing only in case            -> duplicate-part
#   absolute part name, or one with a drive     -> invalid-part-name
#   external relationship target (SSRF)         -> external-blocked
#   truncated central directory                 -> malformed-zip
#   [Content_Types].xml absent                  -> missing-content-types
#   relationship to a non-existent part         -> dangling-relationship
```

**Trap — assert the *specific* error, not "it threw."** A test that accepts any exception passes when
the zip-bomb guard is removed and a null dereference takes its place. Each fixture names its error code.

**Trap — these fixtures are malicious files in the repo.** Some will trip virus scanners and CI security
tooling. Store them as generated-on-demand recipes, or clearly quarantined with a README explaining what
they are.

**Trap — `entity-rejected` covers three distinct attacks.** DOCTYPE rejection is the single boundary for
all of them, which is correct and must be *stated*, or a later reader "improves" the parser by allowing
harmless DOCTYPEs.

**Done when.** Every boundary has a fixture asserting a named error code; no fixture passes on a generic
exception; fixtures are quarantined or generated with an explanatory README; removing any single guard
turns exactly one test red.

---

### P11-10 — Determinism gate

**Size** S · **Depends** Phase 1 · **Escalate** no

Two assertions, both of which exist from Phase 1 and are merely formalised here.

```pseudo
# 1. Codegen determinism
      pnpm gen && git diff --exit-code packages/schema/src/generated
# 2. Display-list serializability (Decision D4)
      structuredClone(displayList) succeeds and round-trips
```

**Trap — the second gate protects a decision, not a behaviour.** D4 chose main-thread-for-v1 *on the
condition* that the display list stays serializable so a worker boundary can be introduced later without
a rewrite. Nothing in normal development enforces that; one closure or one `Map` of functions in the
display list quietly forecloses the option. `P5-13` states this and this ticket enforces it.

**Trap — codegen non-determinism is usually a `Set` or `Map` iteration order** over symbols collected by
recursive descent. It surfaces as an intermittent CI failure and gets retried rather than fixed. Sort
explicitly at every collection boundary.

**Done when.** Both gates run in CI on every commit; the codegen gate sorts at collection boundaries
rather than relying on insertion order; the serializability gate tests the display list from a real
corpus document, not a synthetic one.

---

### P11-11 — Demo app

**Size** M · **Depends** everything · **Escalate** no

`apps/demo` — open a `.docx`, edit it, save it. The acceptance test for v1, and the only artefact a
non-developer can evaluate.

```pseudo
# The manual acceptance script, run end to end:
#   open a .docx with headers, footnotes, a multi-column section, a table and
#     a floating image
#   -> paints correctly against Word side by side          [F6: not here]
#   click to place the caret mid-paragraph
#   type Latin text, then CJK via IME
#   select across a paragraph boundary and a table cell boundary
#   undo and redo several times
#   save
#   -> reopen in Microsoft Word: no repair prompt, no visible change other
#      than the intended edit                              [F6: not here]
```

**Trap — the two steps that matter cannot be run here.** Both Word-comparison steps are `F6`-blocked.
The demo must therefore surface everything it *can* self-report: the coverage manifest for the open
document, a diagnostics panel, and a visible indicator wherever a placeholder was rendered (`G3`).

**Trap — the demo is where `G3` is finally visible or not.** A placeholder that is a blank rectangle is
indistinguishable from a bug. Labelled, listed in a panel, counted in the manifest.

**Trap — "no repair prompt" is a binary, unambiguous signal and the single best test in the project.**
Word's repair dialog is a true statement that our output is malformed. When this becomes runnable, it
outranks every other gate.

**Done when.** The full manual script is documented with the two `F6`-blocked steps marked as such; the
demo shows per-document coverage, diagnostics and placeholder counts; every placeholder is visibly
labelled; a written statement records which acceptance steps have actually been run and which have not.

---

## Exit criteria for Phase 11

1. **The coverage manifest is published by CI** with five instrumented states, two ratchets against a
   checked-in baseline, and `placeholder` distinct from `painted`.
2. **The corpus exists** with per-file provenance and licence, spanning all three sources, including a
   400+ page document for the perf gate — and CI rejects a file lacking a sidecar.
3. **The equivalence relation is documented** with each permitted difference individually justified, and
   the round-trip runner asserts both equivalence at generation 1 and byte-identity at generation 2.
4. **Layout goldens are reviewable** — a one-paragraph change produces a diff a reviewer reads in a
   minute — with fonts bundled and pinned.
5. **Every security boundary has a fixture** asserting a named error code, and removing any single guard
   turns exactly one test red.
6. **A written statement records which gates have actually run and which have not**, using `F6`'s
   wording verbatim for the blocked ones. This is the phase's real deliverable: not a claim of
   conformance, but an accurate account of what has been measured.
