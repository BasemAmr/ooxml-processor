# ooxml-editor

A spec-conformant **ECMA-376 / ISO 29500 WordprocessingML (`.docx`) editor** that lays out and
paints documents to an HTML `<canvas>`, with real-time editing.

> **Status: Phase 0–1.** Scaffold is up and the codegen pipeline is in progress. Nothing here
> opens a document yet. See [docs/adr/](docs/adr/) for decisions and
> [docs/adr/0007](docs/adr/0007-verification-constraints.md) for what is and is not verified.

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

## Layout

| Package                | Role                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `packages/codegen`     | Build-time only. XSD → TypeScript. Never shipped.                    |
| `packages/schema`      | Generated types, readers, writers, validators, coverage manifest.    |
| `packages/opc`         | ZIP/OPC package layer, part graph, relationships, security limits.   |
| `packages/wml`         | Document model, style cascade, numbering, fields, range annotations. |
| `packages/text`        | Font resolution, shaping, segmentation, bidi, measurement cache.     |
| `packages/layout`      | Line breaking, tables, pagination, floats, fixpoint driver.          |
| `packages/dml`         | DrawingML geometry/fill/effect evaluation; VML fallback.             |
| `packages/paint`       | Display list, dirty-rect repaint, page cache, glyph-run batching.    |
| `packages/editor`      | Caret, selection, IME, clipboard, undo, accessibility mirror.        |
| `packages/conformance` | Coverage tooling, corpus runner, visual diff, fuzz harness.          |
| `apps/demo`            | Vite app: open a `.docx`, edit it, save it.                          |

Dependency edges are strictly one-way. Nothing depends on `editor`.

## Development

```sh
pnpm install
pnpm gen        # regenerate packages/schema from assets/schema — output is checked in
pnpm build
pnpm test
pnpm verify     # format:check + typecheck + test
```

Generated code is committed. `pnpm gen` is idempotent and CI fails if its output drifts.

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
