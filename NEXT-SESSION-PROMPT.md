# Starter prompt — next session

Copy everything below the line into a fresh Claude Code session.

---

You are continuing work on a greenfield, spec-conformant **ECMA-376 / ISO 29500 WordprocessingML
(.docx) editor** that does its own layout and paints to an HTML `<canvas>` — real-time editing, caret,
selection, keyboard + IME input, incremental relayout, undo/redo, and save back to a valid `.docx`.

**Repo: `D:\workspace\ooxml-editor`. You are on branch `integrate-agents`. Start there.**

## Your job this session

Phases 1–6 are done. **Implement Phases 7–11 (78 tickets) and get the demo app running.** Use
subagents aggressively and work at high volume — this is implementation, not planning. The plan is
already written; do not re-plan it.

## Step 1 — Verify the starting position yourself (~5 min, do not skip)

Everything below was verified at the end of the previous session. Re-confirm it rather than trusting
it, then move on quickly:

```bash
cd /d/workspace/ooxml-editor && git branch --show-current   # expect: integrate-agents
cd /d/workspace/ooxml-editor && git status --short | wc -l  # expect: 0 (clean)
cd /d/workspace/ooxml-editor && pnpm install                # expect: fast, lockfile current
cd /d/workspace/ooxml-editor && npx tsc --build --force     # expect: exit 0, no output
cd /d/workspace/ooxml-editor && npx vitest run --reporter=dot | tail -5   # expect: 91 files, 931 tests, all pass
```

Known-good baseline as of the handoff: **52 commits + 1 WIP commit (`cf505a5`), 324 TS files, 90 test
files, 931 tests passing, typecheck clean, 15 ADRs.**

**Do not re-derive the ticket status by grepping for ticket IDs in source.** That was already tried and
it is misleading: Phases 1, 2 and 5 show ~22 "missing" ticket IDs that are in fact fully implemented —
the IDs simply were not written into the source files. Completion was confirmed by artifact instead
(e.g. `packages/layout/src/line/{indent,tabs,justify,spacing,baseline,dropcap}.ts` for P5-05..P5-10).
Trust the artifacts and the passing tests.

## Step 2 — What actually remains

| Phase | File | Tickets | Package |
|---|---|---:|---|
| 7 — Tables | `plan-docs/phase-07-tables.md` | 15 | `packages/layout/` |
| 8 — Sections, pagination, footnotes, fields | `plan-docs/phase-08-pagination-fields.md` | 18 | `packages/layout/` |
| 9 — Floats, DrawingML, VML | `plan-docs/phase-09-floats-drawingml-vml.md` | 20 | `packages/dml/` (**one-line stub**) |
| 10 — Remaining features | `plan-docs/phase-10-features.md` | 14 | `packages/wml/`, `packages/layout/` |
| 11 — Conformance + demo | `plan-docs/phase-11-conformance.md` | 11 | `packages/conformance/` (**stub**), `apps/demo/` (**stub**) |

`packages/dml/src/index.ts`, `packages/conformance/src/index.ts` and `apps/demo/src/index.ts` are each
**one line**. Those three are the real greenfield work.

**Read `plan-docs/00-conventions.md` and `plan-docs/01-invariants.md` before writing any code.** Every
ticket inherits the invariants; violating one fails the ticket even if the feature works. Then read the
phase file for the phase you are starting. Each ticket has a **Done when** clause — that clause is the
acceptance test, and it is meant to be literally true and verified by running something, not by reading
the diff and believing it.

## Step 3 — Suggested execution order

Dependency-bound, so this order is not negotiable in its broad strokes:

1. **Phase 7 (tables)** — self-contained in `packages/layout`, unblocks nothing else but is needed for
   any real document. Good parallel fan-out: grid/merge/width/borders are largely independent.
2. **Phase 8 (pagination)** — owns the **fixpoint driver** (`P8-06`), which Phase 9 and Phase 10 both
   reuse. Build the driver early; it is shared infrastructure, not a Phase 8 detail.
   `P7-10`/`P8-07`/`P8-08` (row splitting across pages) is a mutual contract between 7 and 8 — neither
   phase owns it alone.
3. **Phase 9 (floats + DrawingML + VML)** — largest surface (~930 types, 20 tickets). Reuses `P8-06`.
   Contains a small compiler (the 17-operator guide-formula evaluator) and 187 preset geometries.
4. **Phase 10 (features)** — mostly parallel-safe. Two exceptions: `P10-01` (numbering, a stateful fold
   over the whole document) and `P10-12` (OMML math, an XL nested-box layout engine — start with
   `P10-12a`, the MATH-table access audit, before committing to the rest).
5. **Phase 11 + demo** — `P11-11` is the demo app and the acceptance test for v1.

**If you want a demo sooner:** Phases 7 and 8 plus `P11-11` are enough to render a realistic multi-page
document with tables, headers and footnotes. Phase 9 adds images and floats. Consider getting a
minimal demo painting after Phase 8, then improving it as 9–10 land, rather than leaving the demo to
the very end.

## Step 4 — Subagent strategy (the user has explicitly asked for high volume)

The user has authorized heavy subagent use. Two hard-won lessons from prior sessions — both cost real
budget:

- **Order the brief write-first, verify-second.** Agents told to verify against the XSDs *before*
  writing consumed their entire context on verification and returned zero files. A complete file with
  three wrong attribute names beats perfect notes and no file.
- **Verify agent output with `ls` and by running the tests — never trust the completion summary.**
  Multiple agents reported "All names verified. Now writing FILE 1." with nothing on disk.

Also: **pin the ticket-ID spine in every brief.** Ticket IDs are cross-referenced from other phase
files and must never be renumbered. Run this after any batch of work to prove no reference dangled:

```bash
cd /d/workspace/ooxml-editor/plan-docs
grep -ohE '^### (P[0-9]+-[0-9]+)' phase-*.md | sed 's/^### //' | sort -u > /tmp/defined
grep -ohE '\bP[0-9]+-[0-9]+\b'    phase-*.md | sort -u > /tmp/refd
comm -13 /tmp/defined /tmp/refd   # only P10-12a..g and P3-04b may appear
```

## Step 5 — Environment constraints (`01-invariants.md` section F) — these bite

- **F1 — Disk.** ~11 GB free on `D:`, ~9 GB on `C:`. Repo stays on `D:`. **Do not install
  LibreOffice.** Playwright browsers (~1 GB) may be downloaded **in Phase 11 and not before**. Do not
  vendor the ~30 MB ArtBorders PNG set before `P10-13`.
- **F2 — pnpm 10+ reads settings from `pnpm-workspace.yaml` and silently ignores `.npmrc`.** There is
  deliberately no `.npmrc`. **Do not create one** — it will appear to work and do nothing. The store is
  pinned to `D:/.pnpm-store` because hardlinks cannot cross volumes.
- **F3 — `onlyBuiltDependencies: [esbuild]`** blocks all other postinstall scripts, including
  Playwright's browser download. Widen it only in Phase 11.
- **F4 — the shell cwd resets to `C:\Users\smart` between commands.** Prefix every single one with
  `cd /d/workspace/ooxml-editor && `.
- **F5 — the 5,000-page ECMA PDF is not machine-readable here** (no poppler). Everything is driven off
  the vendored XSDs in `assets/schema/{transitional,strict,opc,geometries}`. Do not burn tokens trying
  to extract the PDF.
- **F6 — no Word and no LibreOffice on this machine. Real-world `.docx` fidelity cannot be verified
  here.** ADR 0007 binds: no status report, README or commit message may describe this editor as
  "Word-compatible". Write *"unverified — no Word/LibreOffice available in this environment."*

## Step 6 — Standing project rules

- **Autonomy: "decide and document."** When you hit an architectural decision the plan does not cover,
  pick the most defensible option, write an ADR in `docs/adr/` (next number is **0016** — 0001–0015
  exist), and keep going. Do not stop to ask.
- **Fidelity: match Word, not the textbook** (`G1`). Word uses greedy line breaking, not Knuth-Plass.
- **Underspecified areas get marked in the code** (`G2`) with `SPEC-GAP` and a note on what is being
  approximated and on what evidence. Table autofit and footnote placement are the known ones.
- **Unimplemented must degrade visibly, never silently** (`G3`). Charts, SmartArt and EMF/WMF render as
  *labelled* placeholders and are tracked in the coverage manifest. A blank area that should have
  content is indistinguishable from a bug.
- **tsconfig is strict**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noImplicitReturns`, `useUnknownInCatchVariables`.
- **`pnpm verify`** runs the full gate: `format:check && gen && typecheck && test && git diff
  --exit-code packages/schema/src/generated`. Codegen output is checked in and CI fails on drift.
- **Commit as you go**, one coherent commit per ticket or small ticket group, matching the existing
  message style (`feat(layout): ... (P7-01, P7-02)`). End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Step 7 — Safety: do not destroy the inbound work

- `D:\_mostaql_projects\ooxml-editor` is the user's separate clone where the Phase 1–6 work was done.
  **It still has 8 uncommitted items in its working tree and the user asked that they not be
  discarded.** They are already preserved — captured as commit `cf505a5` on branch `wip-handoff` in
  that clone, fetched into our repo, and that clone's working tree, index and HEAD were left untouched.
  **Do not run destructive git commands in that clone.**
- Recovery refs in `D:\workspace\ooxml-editor` if anything goes wrong:
  - `pre-integration-backup` — our working tree before the merge
  - `mostaql/master`, `mostaql/wip-handoff` — the clone's history (remote `mostaql` → the clone path)
  - `master` — our original 3-commit line at `4e47ca0`

## Definition of done for this session

A demo that opens a real `.docx` and paints it to canvas, with as much of Phases 7–11 landed behind it
as the session allows, `pnpm verify` green, and an honest written statement of which acceptance steps
have actually been run and which are `F6`-blocked.

Start by running the Step 1 verification, then read `plan-docs/00-conventions.md`,
`plan-docs/01-invariants.md` and `plan-docs/phase-07-tables.md`, and begin Phase 7.
