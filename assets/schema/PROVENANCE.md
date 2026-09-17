# Vendored schema provenance

## Source

**ECMA-376 Part 1, 5th edition (December 2016)** — *Office Open XML File Formats —
Fundamentals and Markup Language Reference*. Also published as ISO/IEC 29500-1.

Obtained from the ECMA-International standards distribution; copied verbatim from
`C:\Users\smart\Downloads\ECMA-376-1_5th_edition_december_2016\` on 2026-09-16.
Files are unmodified. Do not hand-edit anything in this directory — `packages/codegen`
treats it as normative input.

## Layout

| Directory | Origin | Contents |
|---|---|---|
| `transitional/` | `OfficeOpenXML-XMLSchema-Transitional` | 26 XSDs, `schemas.openxmlformats.org/...` namespaces |
| `strict/` | `OfficeOpenXML-XMLSchema-Strict` | 21 XSDs, `purl.oclc.org/ooxml/...` namespaces |
| `opc/` | `OpenPackagingConventions-XMLSchema` | 4 XSDs — contentTypes, relationships, coreProperties, digSig |
| `geometries/` | `OfficeOpenXML-DrawingMLGeometries` | 187 preset shape geometries + preset text warps |

Total ~2.5 MB.

## Which dialect is normative for us

**Transitional is the primary target.** It is what Microsoft Word actually writes.
Strict is supported for reading and is written back only when the source package was
Strict. See `docs/adr/0008-dialect-handling.md`.

Measured scale (named `complexType`/`simpleType`/`element`/`group`/`attributeGroup`
definitions, counted by `codegen`):

- Transitional: **5,536** across 26 files (`wml.xsd` = 1,206)
- Strict: **5,159** across 21 files (`wml.xsd` = 1,116)
- `.docx`-relevant subset: **~2,800**

## Deliberately NOT vendored

- **`OfficeOpenXML-WordprocessingMLArtBorders`** (~30 MB of PNG tiles, 8 per border
  style). Needed only for `w:pgBorders` art borders in Phase 10. Both drives on this
  machine are ~96% full; vendor it when that phase starts, not before.
- **RELAX NG schemas** (`OfficeOpenXML-RELAXNG-*`). Equivalent content to the XSDs in a
  grammar our generator does not consume.
- **SpreadsheetML styles / PresentationML assets.** Out of scope.
- **The 5,000-page Part 1 PDF.** Not machine-readable in this environment (no poppler),
  and too large to vendor. Consult it manually at the source path above for semantics the
  XSDs do not encode — element *ordering constraints*, default values, and layout
  behavior are frequently prose-only.

## Known gap: Markup Compatibility

`mc:AlternateContent`, `mc:Choice`, `mc:Fallback`, `mc:Ignorable`, `mc:ProcessContent`
and `mc:MustUnderstand` are specified in **ECMA-376 Part 3**, which is not part of this
asset set. There is no XSD here to generate from. The namespace is small and stable, so
it is **hand-authored** in `packages/schema/src/runtime/mce.ts`.

This is not optional: real `.docx` files use `mc:AlternateContent` pervasively (most
commonly to offer a DrawingML shape with a VML fallback), and a reader that does not
understand it will either drop content or fail outright.
