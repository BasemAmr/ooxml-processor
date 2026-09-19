# ooxml-processor

A spec-conformant **ECMA-376 / ISO 29500 WordprocessingML (`.docx`) processor** that lays out and
paints documents to an HTML `<canvas>`, with real-time editing.

> **Status: Phase 0–11 (in progress).** Scaffold, codegen, OPC, document model, text shaping,
> line layout, paint pipeline, editing core, tables, pagination, DrawingML, features, and
> conformance tooling are in place. See [plan-docs/](plan-docs/) for the full roadmap and
> [docs/adr/](docs/adr/) for architectural decisions.

## What this is

Existing web options either convert `.docx` to HTML — losing fidelity and round-trip
integrity — or render read-only. This engine owns its own layout, so it can match Word's
pagination, tables, floats and drawings, and because it keeps the full parsed tree it can
save losslessly.

Conformance is **generated, not hand-written**. `packages/codegen` reads the normative XSDs
(~2,800 `.docx`-relevant type definitions) and emits types, readers, writers, validators and
a coverage manifest. That manifest tracks every type through four states —
`modelled` → `laidOut` → `painted` → `roundTripped` — so "what does this actually support?"
has a factual answer rather than a claimed one.

---

## Directory layout

### Root files

| File | Purpose |
| --- | --- |
| `package.json` | Monorepo root: scripts (`gen`, `build`, `test`, `verify`), devDependencies. |
| `pnpm-workspace.yaml` | pnpm workspace definition + store config + strict peer deps. |
| `pnpm-lock.yaml` | Lockfile (committed). |
| `tsconfig.json` / `tsconfig.base.json` | Shared TypeScript config for all packages. |
| `vitest.config.ts` | Test runner config. |
| `.prettierrc.json` / `.prettierignore` | Code formatting. |
| `AGENTS.md` | How AI assistants should think and work in this repo. |
| `NEXT-SESSION-PROMPT.md` | Handoff prompt for the next implementation session. |

### `packages/` — monorepo libraries

Dependency edges are strictly **one-way**. Nothing depends on `editor`.

| Package | Description |
| --- | --- |
| **`packages/codegen`** | **Build-time only.** Reads normative OOXML XSD schemas and generates TypeScript types, readers, writers, validators, and a coverage manifest. Never shipped to the browser. |
| **`packages/schema`** | Houses the machine-generated OOXML types (from `codegen`) plus a hand-authored runtime layer: XML cursor, sink, read/write contexts, raw node types, parse limits. The serialization backbone of the entire system. |
| **`packages/opc`** | **Open Packaging Conventions** (ECMA-376 Part 2): ZIP container read/write with decompression budgets and CRC32, content-type resolution, part-name grammar (security boundary), `_rels` relationship graph, well-known relationship type URIs, core/extended/custom properties. Deliberately agnostic to WordprocessingML semantics. |
| **`packages/wml`** | **WordprocessingML document model:** node identity (`IdTable`), document positions and position mapping, interval stores with gravity semantics, annotation stores (comments, diagnostics, bookmarks), style graph with basedOn cycle detection, docDefaults resolution, theme resolution (font/color schemes), settings/compatibility flags, toggle-property XOR logic, numbering with format/bullet rendering, field codes, bookmarks, hyperlinks, revisions, content controls, cross-references, TOC, footnotes/endnotes/comments, table conditional formatting (`cnfStyle`), a full property cascade engine, resolved-property cache, and property inspector. |
| **`packages/text`** | **Text engine:** script classification and font-slot selection, rFonts resolution with theme-font binding, font table with PANOSE distance and substitution ladder, embedded font de-obfuscation (ODTTF), UAX#9 bidirectional algorithm, grapheme and word segmentation, sub-run itemization, OpenType table parsing and font metrics reconciliation, CJK vertical text layout, font-face loading with FOUT mitigation, HarfBuzz shaper adapter, fast-path `measureText` for simple runs, two-tier memory-bounded measurement cache. |
| **`packages/layout`** | **Layout engine:** line box construction, golden-file serialization, table layout, fixpoint iteration driver, pagination (sections, geometry, page-fill, footnotes, endnotes, columns, numbering, breaks, line numbers, vertical-align, headers), floating objects with exclusions and polygon clipping, anchored frames, framePr handling, math layout, and line-segment computation. |
| **`packages/dml`** | **DrawingML** geometry (guides, transforms, paths, presets), colors, fills, line styles, visual effects, text-body formatting, image handling, and **VML** (Vector Markup Language) shapes and fallbacks. Converts DrawingML and VML constructs into canvas-drawable primitives. |
| **`packages/paint`** | **Rendering pipeline:** display-list data structure, batcher for grouping draw calls, page-level bitmap cache, viewport management, painter that issues canvas operations, and shape rendering modules. Converts layout output into efficient, batched canvas draws with dirty-rect repainting. |
| **`packages/editor`** | **Editing engine:** position model (caret with affinity), position mapping between layout and document coordinates, hit-testing, caret geometry and blink, selection model (collapsed, range, table-rect), selection geometry, keyboard navigation (horizontal, vertical, word, line-edge, document-edge), input proxy for IME composition, command model (insert/delete text, apply properties, split/merge paragraphs), undo/redo history, mutation APIs, incremental relayout driver, repaint scheduler, clipboard serialization (with OOXML MIME type), accessibility mirror, and latency instrumentation. |
| **`packages/conformance`** | **Conformance tooling:** `CoverageTracker` for tracking which OOXML types have been modelled/laid out/painted/round-tripped, corpus manifest validator, round-trip equivalence checking, XML canonicalization, layout golden-file comparison, visual RGBA diffing, performance budget assertions, and a fuzz harness with malformed-package recipes. |
| **`packages/text`** | (see above) |

### `apps/` — applications

| App | Description |
| --- | --- |
| **`apps/demo`** | **Vite-based browser app:** open a `.docx`, edit it, save it. Composes all `@ooxml/*` packages into a working .docx editor. Includes canvas rendering, file menu, document properties dialog, integration tests, probes, and UI components. |

### `assets/`

| Directory | Purpose |
| --- | --- |
| `assets/schema/` | Vendored normative OOXML XSD schemas from ECMA-376 Part 1, 5th edition (December 2016). Unmodified and provenance-stamped. These are the source of truth for codegen. |

### `docs/`

| Directory | Purpose |
| --- | --- |
| `docs/adr/` | **Architecture Decision Records** (17 ADRs): repo layout, ZIP library choice, document model representation, text shaper, worker boundary, XML parsing strategy, verification constraints, dialect handling, unknown content preservation, digital signatures, line box/position representation, bidi caret, clipboard conflicts, pagination fixpoint tie-breaking, OMML math fallback. |
| `docs/xsd-feature-survey.md` | Survey of XSD features and how they map to TypeScript. |

### `plan-docs/`

| File | Purpose |
| --- | --- |
| `plan-docs/README.md` | Overview of the phased implementation plan. |
| `plan-docs/00-conventions.md` | Coding conventions and project standards. |
| `plan-docs/01-invariants.md` | Invariants that must hold across all phases. |
| `plan-docs/full-plan.txt` | The complete implementation plan (all 11 phases). |
| `plan-docs/phase-01-codegen.md` | Phase 1: Code generation pipeline. |
| `plan-docs/phase-02-opc.md` | Phase 2: Open Packaging Conventions. |
| `plan-docs/phase-03-model-cascade.md` | Phase 3: Document model and style cascade. |
| `plan-docs/phase-04-text-shaping.md` | Phase 4: Text shaping and font resolution. |
| `plan-docs/phase-05-line-layout-paint.md` | Phase 5: Line layout and paint pipeline. |
| `plan-docs/phase-06-editing-core.md` | Phase 6: Editing core (caret, selection, commands, undo). |
| `plan-docs/phase-07-tables.md` | Phase 7: Table layout. |
| `plan-docs/phase-08-pagination-fields.md` | Phase 8: Pagination and fields. |
| `plan-docs/phase-09-floats-drawingml-vml.md` | Phase 9: Floats, DrawingML, and VML. |
| `plan-docs/phase-10-features.md` | Phase 10: Feature completion. |
| `plan-docs/phase-11-conformance.md` | Phase 11: Conformance testing and fuzzing. |

### `scripts/`

| Script | Purpose |
| --- | --- |
| `scripts/progress-heartbeat.ps1` | PowerShell script for periodic progress snapshots during long sessions. |

### `.github/`

| Directory | Purpose |
| --- | --- |
| `.github/workflows/` | CI pipeline definitions. |

---

## Development

```sh
pnpm install
pnpm gen          # regenerate packages/schema from assets/schema — output is checked in
pnpm build        # tsc --build
pnpm typecheck    # tsc --build --force
pnpm test         # vitest run
pnpm format       # prettier --write
pnpm verify       # format:check + gen + typecheck + test + schema drift check
```

Generated code is committed. `pnpm gen` is idempotent and CI fails if its output drifts.

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────┐
│                        apps/demo                             │
│              Vite browser app (.docx editor)                 │
├──────────────────────────────────────────────────────────────┤
│   editor          │          paint                           │
│   caret/selection │  display list / dirty-rect / cache       │
│   commands/undo   │  canvas painter                          │
├───────────────────┼──────────────────────────────────────────┤
│        layout               │        dml                     │
│  lines / tables / pagination│  geometry / fills / VML        │
│  floats / fixpoint driver   │                                │
├─────────────────────────────┼────────────────────────────────┤
│        text (font engine)   │                                │
│  shaping / bidi / cache     │                                │
├─────────────────────────────┴────────────────────────────────┤
│                      wml (document model)                    │
│         styles / numbering / fields / cascade                │
├──────────────────────────────────────────────────────────────┤
│               schema (generated types + XML runtime)         │
├──────────────────────────────────────────────────────────────┤
│                    opc (ZIP / relationships)                  │
├──────────────────────────────────────────────────────────────┤
│                  codegen (XSD → TypeScript)                   │
│                     [build-time only]                         │
└──────────────────────────────────────────────────────────────┘
        conformance (coverage / fuzzing / visual diff)
```

## Normative sources

The XSDs in [assets/schema/](assets/schema/) are vendored verbatim from ECMA-376 Part 1,
5th edition (December 2016). See [assets/schema/PROVENANCE.md](assets/schema/PROVENANCE.md)
for what was and was not vendored, and why.

The 5,000-page prose reference is **not** in this repo. Semantics the XSDs do not encode —
element ordering constraints, default values, layout behaviour — live only in that prose and
must be consulted manually.

## License

MIT. The vendored ECMA schemas are redistributed under ECMA International's terms; they are
unmodified and provenance-stamped.
