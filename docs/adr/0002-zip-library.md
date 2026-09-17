# 0002 — ZIP library: `fflate`, with our own central-directory handling

**Status:** Accepted
**Date:** 2026-09-16

## Context

An OPC package is a ZIP archive. We need to read and write it in the browser and in Node,
and we need control that a convenience wrapper does not give us.

## Decision

**`fflate`** for DEFLATE/INFLATE. We drive entry enumeration and central-directory
construction ourselves rather than using a high-level `zip`/`unzip` helper.

## Why not `JSZip` / `zip.js`

- **Size.** `fflate` is ~10 KB; `JSZip` is ~100 KB for less control.
- **Entry ordering.** Word is not order-sensitive when reading, but byte-stability across an
  open→save→open cycle is a project gate (Verification §3: second-generation output must be
  byte-identical to first). That requires preserving original entry order, compression method
  per entry, and — where possible — compression level. High-level helpers reorder entries and
  normalize metadata.
- **Streaming and abort.** Security limits (ADR-forthcoming, Phase 2) require aborting a
  decompress mid-stream when the ratio cap trips. `fflate`'s streaming API supports this;
  a one-shot `unzip` cannot.

## Consequences

- We own the ZIP64 edge cases, the data-descriptor variants, and the encoding of entry names
  (OPC part names are percent-encoded IRIs; ZIP entry names are bytes with an EFS flag).
  This is real work in Phase 2, and it is work we would have had to do anyway to meet the
  byte-stability gate.
- `fflate` has no dependencies, which matters under the disk constraint in [0001](0001-repo-location-and-disk-budget.md).

## Known limits to handle explicitly in Phase 2

- Encrypted packages (`EncryptedPackage` OLE compound file) are **out of scope**; detect and
  report a clean typed error rather than producing garbage.
- Zip bombs: enforce a decompression-ratio cap and a total-uncompressed-size cap per package.
