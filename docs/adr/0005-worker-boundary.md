# 0005 — Worker boundary: main thread for v1, serializable display list

**Status:** Accepted
**Date:** 2026-09-16

## Context

Layout of a long document is expensive and blocks the main thread. `OffscreenCanvas` allows
painting from a worker, which is the usual answer.

It does not cleanly apply here. Two hard dependencies are main-thread-bound:

- **`measureText`** requires a canvas context. `OffscreenCanvas` has one in a worker, but its
  text metrics depend on fonts available to that worker.
- **`FontFace` / `document.fonts`** — font loading is a document-level API. Workers can use
  `FontFace` via `self.fonts` in some browsers, but coverage is uneven and system-font
  enumeration differs.

Moving layout to a worker therefore means moving font handling too, and font handling is
where the largest number of environment-specific bugs live.

## Decision

**Main thread for v1.** No worker, no `OffscreenCanvas`.

The constraint this buys us must be paid for in design, not deferred:

- The **display list is a plain serializable structure** — no closures, no class instances
  with methods, no references into the document model. Structured-cloneable by construction,
  enforced by a type-level check in `packages/paint`.
- Layout input is likewise a serializable snapshot: resolved properties, shaped runs, and
  geometry — not live model nodes.
- Shaped-run measurement is cached behind an interface that can become async without changing
  callers.

## Consequences

- A single long relayout will jank. Mitigations in v1 are algorithmic rather than
  architectural: incremental relayout from the first dirty paragraph, page virtualization,
  and early-stop in the pagination fixpoint. The Phase 11 budget — keystroke-to-pixel under
  16 ms at p95 — is what tells us whether that is sufficient.
- If it is not sufficient, the worker boundary can be introduced at the layout→paint seam
  without rewriting either side, _provided_ the serializability discipline above was actually
  maintained. That discipline is the whole value of this decision, so it needs a test, not
  just a convention.

## Revisit when

Phase 11 performance measurement, against the keystroke-latency and 500-page scroll budgets.
