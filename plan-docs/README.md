# plan-docs

Ticket-level breakdown of the remaining work on the OOXML WordprocessingML canvas editor.

**These are planning documents. They contain no source code and no test files.** Architecture is
expressed as pseudo-code — deliberately not valid TypeScript, so nothing here can be pasted into
`src/` and mistaken for an implementation. Every code block is fenced as `pseudo`.

---

## How to read this folder

| File                                   | What it is                                                          |
| -------------------------------------- | ------------------------------------------------------------------- |
| [00-conventions.md](00-conventions.md) | Ticket format, sizing, labels, definition-of-done, escalation rules |
| [01-invariants.md](01-invariants.md)   | The rules **every** ticket inherits. Read before any ticket.        |
| `phase-NN-*.md`                        | One file per phase, broken into tickets                             |

Tickets are identified `P<phase>-<nn>`, e.g. `P6-09`. IDs are stable — never renumber. If a ticket
is dropped, mark it `WITHDRAWN` and leave the ID dead.

---

## Two different orderings — do not confuse them

**Authoring order (why these files were written hardest-first).** The difficult design decisions are
the ones that are expensive to get wrong and cheap to get right _on paper_. Writing them down first,
while the reasoning is fresh, is what makes the later phases mechanical. That is the order below.

**Execution order is dependency-bound and unchanged:** `1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11`.

You cannot build Phase 6 before Phase 5 — the editor reads from the line box that Phase 5 defines.
The hardest-first ordering is for _reading and designing_, not for _doing_.

## Phases by difficulty (authoring order)

| Rank | Phase                                                                         | Size | Why it ranks here                                                                                                                                                                                                                      |
| ---: | ----------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | [06 — Editing core](phase-06-editing-core.md)                                 | XL   | The v1 heartbeat. Canvas has neither text input nor an a11y tree, so both are built from scratch. Caret affinity, bidi navigation, IME, and incremental relayout are four independently hard problems that must agree with each other. |
|    2 | [08 — Sections, pagination, footnotes, fields](phase-08-pagination-fields.md) | XL   | Owns the fixpoint driver. Pagination ⇄ footnotes ⇄ fields are genuinely circular; non-convergence presents as a hang, not a wrong pixel.                                                                                               |
|    3 | [09 — Floats, DrawingML, VML](phase-09-floats-drawingml-vml.md)               | XL   | Largest surface area in the project (~930 types), plus a second fixpoint (anchor ⇄ wrap) and a small compiler (the guide-formula evaluator).                                                                                           |
|    4 | [07 — Tables](phase-07-tables.md)                                             | L    | Autofit is genuinely underspecified by the standard. Row-splitting across a page boundary is where tables and pagination collide.                                                                                                      |
|    5 | [05 — Line layout + first paint](phase-05-line-layout-paint.md)               | L    | Contains the single most load-bearing data structure in the system (the line box). Everything downstream reads from it.                                                                                                                |
|    6 | [04 — Text: fonts, shaping, measurement](phase-04-text-shaping.md)            | L    | Bidi and shaping are exacting but well-specified. The measurement cache is the hottest path in the system.                                                                                                                             |
|    7 | [03 — Document model + style cascade](phase-03-model-cascade.md)              | L    | Blocked on the ADR 0003 spike. Toggle properties and range annotations are the two traps.                                                                                                                                              |
|    8 | [10 — Remaining features](phase-10-features.md)                               | L    | Breadth, not depth — except OMML math, which is a nested-box layout engine in its own right.                                                                                                                                           |
|    9 | [11 — Conformance, performance, security](phase-11-conformance.md)            | M    | Mechanical once the rest exists, but gated on infrastructure this machine cannot fully provide (see ADR 0007).                                                                                                                         |
|   10 | [01 — Codegen (remainder)](phase-01-codegen.md)                               | M    | Mostly built. Three known compile errors and four emitters left. Conventions are already established by the types emitter.                                                                                                             |
|   11 | [02 — OPC package layer](phase-02-opc.md)                                     | M    | Substantially landed by a subagent. Well-trodden problem space; the security limits are already enumerated.                                                                                                                            |

---

## Cross-reference index

**165 tickets across 11 files. 40 are marked Escalate.** Counts are generated from the files, not
maintained by hand — regenerate rather than edit:

```
grep -cE '^### P[0-9]+-[0-9]+ ' phase-*.md                              # tickets per phase
grep -cE '^\*\*Size\*\*.*Escalate\*\* \*\*yes\*\*' phase-*.md            # escalations per phase
```

| Phase                       | Tickets | Escalate |
| --------------------------- | ------: | -------: |
| 01 Codegen                  |      13 |        2 |
| 02 OPC                      |      11 |        1 |
| 03 Model + cascade          |      14 |        7 |
| 04 Text                     |      14 |        5 |
| 05 Line layout + paint      |      18 |        4 |
| 06 Editing core             |      17 |        3 |
| 07 Tables                   |      15 |        4 |
| 08 Pagination + fields      |      18 |        5 |
| 09 Floats + DrawingML + VML |      20 |        4 |
| 10 Features                 |      14 |        3 |
| 11 Conformance              |      11 |        2 |

### Load-bearing tickets

These are cited from the most other phases. A change to any of them invalidates work elsewhere, so
they are the ones to get right on paper first — which is the whole reason for the hardest-first
authoring order.

| Ticket   | Defines                                        | Read by        |
| -------- | ---------------------------------------------- | -------------- |
| `P5-01`  | The line box and shaped-run storage            | 04, 06, 09, 10 |
| `P3-06`  | Cascade order                                  | 04, 05, 07, 10 |
| `P3-03`  | Range annotations (bookmarks, comments, moves) | 05, 06, 08, 10 |
| `P6-01`  | Document ⇄ layout position mapping             | 03, 04, 05     |
| `P6-13`  | Incremental relayout                           | 04, 05, 08     |
| `P5-17`  | Layout golden format                           | 03, 07, 11     |
| `P9-02`  | Anchored object positioning                    | 05, 07, 10     |
| `P11-03` | The equivalence relation                       | 01, 02, 03     |

### Mutual dependencies — the four places two phases constrain each other

These are not ordering mistakes. They are real bidirectional contracts, and each is stated from both
sides so the two definitions cannot drift apart:

| Pair    | The contract                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 04 ⇄ 05 | `P4-12`'s shaped-run layout must be **identical** to `P5-01`'s line-box storage. One ADR, cited by both.                               |
| 05 ⇄ 06 | `P5-01` carries per-cluster source offsets _because_ `P6-01` needs them; `P6-13` reflows from the line box `P5-16` invalidates.        |
| 05 ⇄ 09 | `P9-05` states "if segments are discovered in Phase 9, Phase 5 was wrong" — `P5-01` is segmented from the start so that never happens. |
| 07 ⇄ 08 | Row splitting across a page boundary (`P7-10`, `P8-07`, `P8-08`) is where tables and pagination collide. Neither phase owns it alone.  |

### Verifying the index

Every cross-phase `P<n>-<nn>` reference resolves to a defined ticket. To re-check after editing:

```
grep -ohE '^### (P[0-9]+-[0-9]+)' phase-*.md | sed 's/^### //' | sort -u > /tmp/defined
grep -ohE '\bP[0-9]+-[0-9]+\b'    phase-*.md | sort -u > /tmp/refd
comm -13 /tmp/defined /tmp/refd      # must print nothing
```

Two families are _deliberately_ undefined at top level and will not appear in that output, because
they are sketched inside their parent ticket's body rather than promoted to tickets of their own:
`P10-12a`–`P10-12g` (the OMML math decomposition, inside `P10-12`) and `P3-04b` (latent styles,
inside `P3-04`). Promote them to real tickets when Phase 10 and Phase 3 are scheduled.

---

## Current repo state (verified 2026-09-17)

Committed and green: `4e47ca0`.

```
packages/schema   npx tsc --noEmit  ->  clean
packages/codegen  npx tsc --noEmit  ->  3 errors, all in src/emit/reader.ts
```

Landed but uncommitted (subagent output, plus this session's work):

- `packages/schema/src/runtime/` — `xml.ts`, `cursor.ts`, `sink.ts`, `onoff.ts`, `units.ts`,
  `namespaces.ts`, `mce.ts`, `lexical.ts`, `read.ts`, `preserve.ts`, `index.ts` **all present**
- `packages/codegen/src/` — `loader.ts`, `survey.ts` present; `emit/reader.ts` present but not compiling
- `packages/opc/src/` — `zip.ts`, `package.ts`, `partname.ts`, `content-types.ts`, `relationships.ts`,
  `rel-types.ts`, `limits.ts`, `errors.ts`, `xml-support.ts` present
- `docs/adr/0010-required-is-a-validator-property.md` new

The handoff document written earlier in this project claimed `runtime/index.ts` and `mce.ts` did not
exist. **They do.** That claim was written before the subagents' output was inspected. Phase 1's
ticket list here reflects the verified state, not that claim.

---

## Working agreement

1. One ticket at a time. A ticket is done when its **Done when** clause is literally true, verified by
   running something — not by reading the diff and believing it.
2. Every ticket inherits [01-invariants.md](01-invariants.md). Violating an invariant fails the ticket
   regardless of whether the feature works.
3. A ticket that turns out to need an architectural decision the plan does not cover stops and produces
   an ADR first. See the autonomy policy in `01-invariants.md`.
4. Tickets marked **Escalate** are ones where a wrong answer is invisible or structural. Do not let a
   cheap model close them unsupervised.
