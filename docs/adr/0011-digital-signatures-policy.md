# 11. Digital signatures policy on save

- Status: **Accepted** — ⚠ NEEDS REVIEW (decided autonomously under the "decide and
  document" grant)
- Date: 2026-09-18
- Related: [0007 — verification constraints](0007-verification-constraints.md),
  [0008 — dialect handling](0008-dialect-handling.md),
  [0009 — unknown-content preservation](0009-unknown-content-preservation.md)

## Context

Open Packaging Conventions (ECMA-376 Part 2 §13 / ISO/IEC 29500-2 §13) defines a digital
signature mechanism for OPC packages. Digital signatures are stored under the
`/_xmlsignatures/` folder hierarchy, starting from an origin part
(`/_xmlsignatures/origin.sigs`, relationship type
`http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin`)
which relates to one or more individual XML signature parts (relationship type
`http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature`)
and optional certificate parts.

A digital signature computes and signs cryptographic hashes (digests) of specific parts
and relationship streams within the package. As a consequence of cryptographic signing:

**Any edit to a signed part or package relationship invalidates the digital signature.**

Because our editor does not possess (and should never possess or manage) the original signer's
private cryptographic key, an edited document cannot be re-signed.

When a user opens a signed `.docx` file, edits its content (e.g. text, styles, or relationships),
and saves it back to disk, the editor must have an explicit, well-defined policy for handling
the digital signature parts and relationship entries.

## Decision

We adopt **Policy B**:

1. **Unedited documents preserve all digital signature parts and relationships verbatim:**
   If a package is opened and saved without modifications (`modified === false` across all parts,
   content types, and relationship sets), every signature part, certificate, and relationship entry
   is preserved byte-for-byte in original archive order. Read-only workflows and document inspection
   must never strip or alter signatures.

2. **Edited documents strip digital signatures on save with a loud diagnostic warning:**
   If any part in the package has been modified (`modified === true`) or package-level relationships
   changed, `savePackage` automatically strips all digital signature parts (`origin.sigs`,
   `sig*.xml`, certificates) and their relationship declarations from `/_rels/.rels` and
   `[Content_Types].xml`. On stripping, a loud diagnostic warning (`OpcSaveWarning` with code
   `digital-signatures-stripped`) is emitted via the save options callback and recorded on
   `package.lastSaveWarnings`, detailing every stripped signature.

## Alternatives considered

### Policy A — Preserve signature parts unchanged on edit

Carrying signature parts through faithfully on an edited package means saving a file whose
cryptographic digests no longer match the modified parts.

**Why rejected:** When Microsoft Word opens an edited document with broken signatures, it displays
an alarming red "invalid signature / document has been tampered with" security banner. This is
significantly worse than displaying no signature banner at all: it falsely accuses the user or
transmission channel of malicious tampering, confuses end users, and erodes trust. An edited
document is genuinely no longer the document that was signed, so keeping a stale signature is
dishonest.

### Policy C — Refuse to open or save signed documents

Refusing to open signed packages or throwing an error on save.

**Why rejected:** This makes the editor completely useless for valid read, view, and print
workflows on signed documents. Many business documents are digitally signed; refusing to open
them breaks user workflows without adding safety. Throwing an error on save leaves the user
stranded with unsaved work.

## Consequences

- **Integrity and user experience:** Edited documents open cleanly in Word and other OOXML readers
  without frightening tampering alerts.
- **Transparency:** The host application and user are informed via an explicit diagnostic warning
  (`OpcSaveWarning`) naming the exact signatures that were stripped, allowing UI prompts or logs.
- **Round-trip fidelity:** Unmodified documents retain bit-identical signature parts and
  relationships, fulfilling ADR-0002 and Verification §3 idempotence requirements.
