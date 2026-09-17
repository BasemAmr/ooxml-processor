# 0008 — Dialect handling: Transitional primary, Strict read and preserved

**Status:** Accepted ⚠ NEEDS REVIEW
**Date:** 2026-09-16

## Context

ECMA-376 defines the same document format twice:

|                  | Namespace root                          | Reality                                                                              |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| **Transitional** | `http://schemas.openxmlformats.org/...` | What Microsoft Word actually writes. Includes VML, `w:pict`, legacy compat settings. |
| **Strict**       | `http://purl.oclc.org/ooxml/...`        | ISO 29500 Strict. Cleaner; drops the deprecated surface. Rare in the wild.           |

The two XSD sets are structurally near-identical (5,536 vs 5,159 named definitions) but share no
namespace URIs, so nothing that names a namespace is portable between them.

Three approaches were possible:

1. Generate two complete parallel type hierarchies. Doubles ~2,800 types to ~5,600, and forces
   every consumer — layout, paint, editor — to be generic over dialect. Rejected.
2. Support Transitional only. Strict files fail to open. Rejected: the format is normatively
   part of the standard the project is implementing.
3. One type hierarchy, dialect as data.

## Decision

**Option 3.** Namespace is not part of the type identity.

- `packages/codegen` unifies the two schema sets into a single symbol table keyed by
  `{localName, logicalNamespace}`, where `logicalNamespace` is a dialect-independent token
  (`wml`, `dml`, `vml`, …). It emits **one** TS type per logical type.
- A generated `NamespaceTable` maps `logicalNamespace × dialect → URI`. Readers accept either
  URI for a given logical namespace. Writers consult the table.
- The dialect of the opened package is detected from the namespace on
  `word/document.xml`'s root element, recorded on the package, and **used verbatim on save**.
  A file that arrives Strict leaves Strict.
- Types with no Strict counterpart (VML hosts, several `CT_Compat` members) are emitted with
  `dialect: 'transitional'`. The writer refuses to emit them into a Strict package and records
  a typed diagnostic rather than silently dropping or silently corrupting.

## Consequences

- **Codegen must prove the unification is sound.** A generated report lists every type
  present in only one dialect, and every type whose particle list differs between dialects
  beyond the namespace substitution. If that report shows structural differences we did not
  anticipate, this ADR is wrong and must be revisited — the report is the falsification test,
  and it runs on every `pnpm gen`.
- Layout, paint and editor never see a namespace URI. That is the point.
- **Mixed-dialect packages are a real hazard.** A Transitional `document.xml` can reference a
  Strict-namespace theme part, and `mc:AlternateContent` can carry either. Dialect is therefore
  tracked **per part**, not per package.
- Round-trip tests must cover both dialects, and must assert the output dialect matches
  the input dialect. This is a required gate, not an optional one.

## Revisit when

The codegen dialect-difference report shows more than namespace-level divergence.
