# 0006 — XML parsing strategy: `saxes`, one reader for both runtimes

**Status:** Accepted ⚠ NEEDS REVIEW
**Date:** 2026-09-16

## Context

We parse XML in two very different places:

1. **Build time (Node):** `packages/codegen` reads 51 XSDs. Correctness and namespace
   fidelity matter; speed does not.
2. **Run time (browser):** `packages/schema` readers parse `document.xml`, `styles.xml`,
   `numbering.xml` and friends. These can be tens of megabytes in a large document, and
   they sit directly on the document-open latency path.

The browser has a native, namespace-aware `DOMParser` that costs zero bytes of bundle.
Node has no `DOMParser`. The obvious move — native `DOMParser` in the browser,
`@xmldom/xmldom` in Node — means **two parse paths, and therefore two sets of bugs**, in
the layer where a single misread attribute silently corrupts a document.

## Decision

Use **`saxes`** (namespace-aware streaming SAX parser, pure TypeScript, ~50 KB) as the
single parsing substrate in both environments.

Generated readers are written against a narrow internal event interface
(`XmlEvents` in `packages/schema/src/runtime/xml.ts`), not against `saxes` directly, so
the parser remains swappable without touching ~2,800 generated readers.

## Why not native `DOMParser`

Two reasons beyond the dual-path bug surface:

- **Memory.** Building a full DOM for a 40 MB `document.xml` and then walking it to build
  our own typed tree means holding two complete representations at once. Streaming
  straight into the typed tree holds one. On a document editor this is the difference
  between opening a large file and failing to.
- **Position reporting.** Round-trip fidelity and diagnostics need source positions for
  unknown/invalid content. SAX gives them naturally.

## Consequences

- The reader is a state machine over events rather than a recursive DOM walk. Generated
  code is more intricate; this is why it is generated rather than hand-written.
- `saxes` is a real dependency in the shipped bundle (~50 KB gzipped-ish). Acceptable.
- **The escape hatch stays open:** if profiling later shows native `DOMParser` wins
  decisively for small parts (`styles.xml`, `_rels`), a second implementation of
  `XmlEvents` can be added for those without disturbing the generated layer.

## Revisit when

Phase 11 performance work, against the "100-page document open" budget.
