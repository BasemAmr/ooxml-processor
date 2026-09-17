# 0004 — Text shaper: `harfbuzzjs`, with a `measureText` fast path

**Status:** Accepted — **approved by the project owner**, as an explicit amendment to the
original "no WASM in the core" constraint
**Date:** 2026-09-16

## Context

Canvas 2D's `measureText` returns an **advance width and little else**. It gives no per-glyph
positions, no glyph IDs, no control over kerning or ligatures, and no complex-script shaping.
For Latin text set with default features that is survivable. For Arabic (contextual forms,
mandatory ligatures), Indic (reordering, conjuncts), or any script where cluster ≠ character,
it is not: you cannot place a caret correctly inside text you cannot shape, because you do not
know where the glyph boundaries are.

Since the editor must place carets, hit-test, and draw selection geometry, shaping is not a
rendering nicety here — it is load-bearing for the editing model.

## Decision

**`harfbuzzjs`** (HarfBuzz compiled to WASM, ~200 KB) as the shaping engine, with
`measureText` retained as a fast path.

The fast path applies only when **all** of these hold for a run:

- script is Latin, Cyrillic or Greek, and the run is LTR
- no OpenType features requested beyond the font's defaults
- `w:kern` is off or the size is below the kerning threshold
- no `w:spacing` (character spacing) or `w:w` (scaling) adjustment
- the text contains no combining marks and no ligature-forming sequences the font applies

Otherwise the run goes to HarfBuzz. Both paths produce the same `ShapedRun` shape — a glyph
array with IDs, advances, offsets, and cluster back-references into source text — so nothing
downstream knows which path produced it.

## Why this is the right exception to make

The original constraint was "no Rust/WASM in the core", motivated by build simplicity and
bundle size. Shaping is the one place where the JavaScript alternatives are not merely
slower but _wrong_:

- `opentype.js` — parses fonts and does basic GSUB/GPOS, but its shaping is incomplete for
  Indic and inconsistent for Arabic. It also cannot see system fonts, only fonts we load.
- `measureText` only — correct advance sums for simple Latin; wrong glyph boundaries
  everywhere else, which breaks caret placement, not just appearance.

HarfBuzz is the same engine Chrome, Firefox and LibreOffice use. Matching it is the closest
we get to matching what users see elsewhere.

## Consequences

- WASM is now in the dependency graph. The loader must handle instantiation failure and fall
  back to `measureText` with a **visible** degradation signal (recorded in the coverage
  manifest), not a silent one.
- Fonts must be available to HarfBuzz as bytes. For fonts embedded in the `.docx`
  (`fontTable.xml`, ODTTF-obfuscated) we have the bytes. For system fonts we do not — the
  browser will not hand them over. **System-font runs therefore always take the
  `measureText` path**, which is exactly the case where that path is acceptable for Latin
  and unacceptable for complex scripts. Phase 4 must either require embedded fonts or ship
  fallback font bytes for complex scripts; this is an open problem, flagged here so it is
  not discovered late.
- Shaping results are cached aggressively (ADR pending in Phase 4 — the measurement cache is
  the hottest path in the system).
