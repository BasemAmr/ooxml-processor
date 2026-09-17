# 9. Unknown-content preservation model

- Status: **Accepted** — ⚠ NEEDS REVIEW (decided autonomously under the "decide and
  document" grant)
- Date: 2026-09-17
- Supersedes: nothing
- Related: [0006 — XML parsing strategy](0006-xml-parsing-strategy.md),
  [0008 — dialect handling](0008-dialect-handling.md)

## Context

Lossless round-trip is the project's foundational guarantee: open a `.docx`, edit one
character, save, and everything the editor did not touch must come back unchanged. That
is what makes the file safe to hand back to Word.

The obstacle is that the generated readers only know the ~2,800 types in the ECMA-376
schema set, and real Word documents contain considerably more than that:

- **Microsoft extension namespaces** — `w14`, `w15`, `w16`, `wps`, `wpg`, `wpc`, `wp14`.
  Not in ECMA-376 at all. Word emits them constantly.
- **`xsd:any` wildcard sites** — 8 on the `.docx` path (see `docs/xsd-feature-survey.md`),
  including `CT_Picture` and `CT_Object`, whose entire VML payload is wildcard content.
- **MCE-wrapped alternatives** — `mc:AlternateContent` containing a `mc:Choice` we do not
  implement alongside a `mc:Fallback` we do.
- **Future schema revisions** and vendor extensions we have never seen.

A reader that drops these produces a file Word will open but which has silently lost
content. That failure is worse than refusing to open the file, because it is invisible
until someone notices their shape is gone.

So unknown content must be captured *and repositioned exactly* on write. Capturing it is
the easy half; `XmlCursor.skipToRaw()` already returns a verbatim `RawNode`. The hard half
is position: a flat `unknown: RawNode[]` bag on each type records *what* was dropped but
not *where* it was, and re-emitting it at the end of the element is a different document.

## Decision

Two mechanisms, chosen so the common case costs nothing extra.

### 1. Repeating choice slots carry a `$raw` alternative

Every `ChoiceSlot` with `cardinality.repeated` emits a discriminated union that includes:

```ts
| { readonly kind: '$raw'; readonly value: RawNode }
```

Unknown children inside a repeating content model therefore live in the same ordered array
as the recognized ones, at the correct index. No separate bookkeeping, and position is
preserved by construction.

This covers the overwhelming majority of real cases, because the places Word puts
extension content — the body, a paragraph's run-level content, a table's row content, a
run's children — are all repeating choices.

### 2. Fixed slots get a positioned escape hatch

For content that is *not* inside a repeating region — an unknown element between `w:tblPr`
and `w:tblGrid`, say — the type carries:

```ts
readonly $unknown?: readonly PositionedRaw[];
// PositionedRaw = {
//   readonly afterSlot: number;
//   readonly afterIndex?: number;
//   readonly node: RawNode;
// }
```

`afterSlot` indexes the type's **slot list**, which is fixed by the schema and does not
change with document content. `-1` means "before the first slot". The writer emits slot
`i`, then flushes every `$unknown` entry with `afterSlot === i`. Absent slots are still
counted, so the anchor survives an edit that deletes the slot it was anchored to.

`afterIndex` disambiguates *within* a repeating slot, which is the one case `afterSlot`
alone cannot express: `<w:gridCol/><ext/><w:gridCol/>` would otherwise re-emit `ext` after
both columns. `-1` means "before the slot's first item"; absent means "after the slot as a
whole", which is the only available meaning for a non-repeating slot and the common case
elsewhere. The cost is one optional number and about six lines in the generated writer —
cheap enough that leaving a known repositioning bug in place was not defensible.

**Known limit.** Unknown *elements* inside a `simpleContent` or `empty` type get no anchor,
because such a type has no slots to anchor to. Both cases are schema-invalid input, and the
reader reports a diagnostic rather than dropping them silently.

### 3. Attributes

Every complex type carries `$unknownAttrs?: readonly XmlAttr[]`, in source order.
**Unconditionally** — including types the schema declares with no attributes at all. An
extension attribute can land on any element (Word puts `w14:paraId` on `w:p`, and nothing
says it could not have picked `w:hyperlink`), and gating the property on
`attributes.length > 0` would silently drop those. Attribute order within an element is not
semantically significant, but it *is* textually significant, and preserving it is what lets
the round-trip differ assert byte-stability rather than a weaker equivalence.

### 4. The `$` prefix is reserved

Engine-managed properties are `$`-prefixed. No OOXML element or attribute name can begin
with `$` — NCName forbids it — so the namespace is provably free of collisions with schema
content, and a reader of the generated types can tell at a glance which properties came
from the standard and which are ours.

## Alternatives considered

**A flat `unknown: RawNode[]` per type, re-emitted at the end.** This is what the approved
plan sketched. It is simpler, and it is wrong: it reorders content. For `CT_Picture`, whose
children are *entirely* wildcard, it happens to work; for anything with a mixed
known/unknown child list it produces a document that differs from the input in a way the
round-trip gate would catch — and if the gate did not catch it, Word would render it
differently.

**Represent all element content as one ordered array of a discriminated union.** Uniformly
position-faithful, and the position problem disappears entirely. Rejected because it
destroys the ergonomics the typed model exists for: `p.pPr?.jc` becomes a linear scan with
a type guard, at every call site in layout and paint. The cost lands on the hottest,
most-read code in the project to solve a problem that only affects the rare case.

**Keep a parallel DOM alongside the typed tree and write from the DOM.** Correct by
construction, but doubles memory for every document and makes the typed tree a
non-authoritative view — edits would have to be applied twice, in sync, forever. That is a
much larger correctness surface than the one it removes.

**Drop unknown content and warn.** Rejected outright. See Context.

## Consequences

- The writer's slot loop must interleave `$unknown` flushes; that ordering is part of the
  generated writer, not something a caller can get wrong.
- `RawNode` must retain namespace declarations, attribute order and prefix spellings — it
  does; see `packages/schema/src/runtime/xml.ts`. `PositionedRaw` and its writer-ordering
  helper live in `packages/schema/src/runtime/preserve.ts`.
- The round-trip gate in `packages/conformance` can assert **byte-stability** for untouched
  parts rather than a weaker semantic equivalence, which is a much sharper test.
- `$raw` in a choice union means every consumer of that union must handle a `'$raw'` case.
  That is deliberate: layout and paint should render unknown content as a visible labelled
  placeholder rather than silently nothing, which is the same principle the coverage
  manifest encodes.
- MCE processing happens *before* the generated readers see events
  (`packages/schema/src/runtime/mce.ts`), so `mc:AlternateContent` is resolved to its
  selected branch and only genuinely unrecognized content reaches `$raw`. The discarded
  branch is preserved by the MCE layer, not by this mechanism.
