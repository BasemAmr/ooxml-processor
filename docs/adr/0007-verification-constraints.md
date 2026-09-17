# 0007 — Verification constraints: no Word, no LibreOffice

**Status:** Accepted ⚠ NEEDS REVIEW
**Date:** 2026-09-16

## Context

The approved plan's acceptance test for v1 is: _save an edited document, reopen it in
Microsoft Word, confirm no repair prompt and no unintended change._ Its visual-regression
gate compares our canvas output against headless LibreOffice.

Neither is available. The project owner reported Word automation is broken on this
machine, and that installing LibreOffice (possible via WSL) was not worth it for now.

## Decision

Build every verification harness the plan calls for, but be explicit about which gates
are **running** and which are **staged but unrun**.

**Running now:**

- Codegen determinism (`pnpm gen` produces no diff)
- Schema validation against codegen-derived synthetic fixtures — one minimal-valid and one
  invalid instance per complex type
- Round-trip idempotence against synthetic fixtures and any real `.docx` the owner supplies
- Layout goldens (serialized line boxes) — self-consistent regression detection
- Performance budgets
- Fuzz and security corpus

**Staged but unrun — requires the owner:**

- Word round-trip acceptance ("no repair prompt")
- LibreOffice perceptual visual diff

## The honest limitation

Synthetic fixtures prove we are **self-consistent and schema-conformant**. They cannot
prove we are **Word-compatible**. Those are different claims, and the gap between them is
where most real OOXML bugs live: Word tolerates, expects and emits things the schema does
not describe, and the normative prose (the 5,000-page PDF, not machine-readable here)
carries ordering and default-value rules the XSDs do not encode.

Accordingly: **no status report, README, or commit message may describe this editor as
"Word-compatible" until those two gates have actually run.** The supported claim is
"schema-conformant and round-trip-stable against synthetic and supplied fixtures."

`packages/conformance` exposes both gates behind `pnpm verify:external`, which skips with
a loud message rather than passing vacuously when the tools are absent — a skipped gate
must never read as a green one.

## Revisit when

The owner can supply real `.docx` files, or install LibreOffice in WSL, or fix Word
automation. Any one of those closes part of the gap; the Word gate is the one that matters
most.
