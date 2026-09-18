# 10. `required` is a validator property, not a type property

- Status: **Accepted** — ⚠ NEEDS REVIEW (decided autonomously under the "decide and
  document" grant)
- Date: 2026-09-17
- Related: [0009 — unknown-content preservation](0009-unknown-content-preservation.md),
  [0007 — verification constraints](0007-verification-constraints.md)

## Context

The XSDs mark plenty of things required: `minOccurs="1"` on an element particle,
`use="required"` on an attribute. `CT_Jc/@val` is required. `CT_Tbl/tblPr` is required.

The obvious emission is a non-optional TypeScript property, and that is what the types
emitter did first. It produces a nicer-looking model: `tbl.tblPr.tblW` with no `?.`.

It is also a claim the reader cannot honour. A generated reader must open a defective
document — that is not a nicety, it is the product: an editor that refuses a file because
one attribute in one paragraph is missing is useless, and ADR 0007 already establishes that
we cannot verify against Word here, so "documents in the wild are well-formed" is not an
assumption available to us. When `w:val` is absent from a `w:jc`, the reader has three
choices and the type decides which:

1. Return `{ val: undefined }` behind a non-optional type. The type is now a lie, and every
   downstream `switch (jc.val)` has an unhandled case it was told could not happen.
2. Refuse the document.
3. Fabricate a default. The fabricated value then gets **written back on save**, so a
   missing attribute silently becomes a present one and the document is corrupted in a way
   the round-trip gate cannot see, because both generations agree.

All three are worse than an optional property.

## Decision

**Every non-repeating slot and every attribute is emitted as `?: T | undefined`, whatever
the schema says about required-ness.** Repeating slots stay non-optional arrays, because an
empty array is an honest representation of "none present".

Required-ness is carried into the _validator_ (`use="required"` and `minOccurs>=1` become
checks) and into the coverage manifest, not into the type.

The reader reports `missing-required` as an **error**-severity diagnostic in both cases, so
the information is not lost — it moves from the type system to the diagnostic stream, which
is where a caller can act on it (refuse the document, warn, or proceed) instead of having
the decision made for it by a generator.

### Why `| undefined` and not a bare `?`

`tsconfig.base.json` sets `exactOptionalPropertyTypes: true`. Under it, `{ jc: undefined }`
is _not_ assignable to `{ jc?: CT_Jc }` — the property must be omitted entirely. A generated
reader would have to accumulate into a mutable object and conditionally assign each of up to
40 properties, instead of returning one object literal.

`?: T | undefined` keeps the caller-facing meaning identical (the property may be missing)
while letting the reader emit `return { jc, sectPr, ... };` in one shot. The verbosity is
paid once per property in generated source nobody reads by hand.

## Alternatives considered

**Non-optional for required, with a cast at the reader's return.** Same lie as (1) above,
with the added property that the lie is invisible at the call site. Rejected.

**Two type families — a `Strict` view for validated documents and a `Loose` view for
freshly-read ones.** Doubles 2,800 types, and every function in layout and paint has to
pick one. The distinction it encodes ("has this document been validated?") is better carried
by a flag on the document than by the shape of every node.

**Non-optional plus a `validate()` that must be called before use.** The compiler cannot
enforce the ordering, so it degrades to convention, and the failure mode is the same
unhandled-undefined at runtime — just later.

## Consequences

- Consumers write `p.pPr?.jc?.val` rather than `p.pPr?.jc.val`. In practice most OOXML
  properties are genuinely optional, so this changes a minority of call sites.
- The validator becomes load-bearing rather than decorative: it is the only place
  required-ness is checked. It must run in CI against the whole corpus.
- A document that trips `missing-required` still round-trips losslessly — nothing about
  this decision discards content.
- If a future layer wants the ergonomics back for a hot path, it can narrow once at the
  boundary (`const val = jc.val ?? 'start'`) with the default coming from the spec's prose,
  which is where defaults belong anyway — see the attribute-default handling in
  `packages/codegen/src/model.ts`.
