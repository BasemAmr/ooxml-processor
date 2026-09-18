# Invariants — inherited by every ticket

Violating any of these fails a ticket even if the feature works. They are ordered by how expensive the
violation is to detect, not by importance — the ones at the top fail _silently_.

---

## A. Round-trip and document integrity

**A1 — Nothing is silently dropped.** Every byte of input is either modelled, or preserved verbatim
(`$unknown` / `$unknownAttrs` / `RawNode`), or reported as a diagnostic. There is no fourth option.

**A2 — The guarantee is idempotence after one pass, not byte-identity.** `gen2 === gen3`. The first
save may canonicalize; every save after that is byte-identical. Byte-identity with the _input_ is not
achievable — ZIP metadata varies, and splitting known from unknown attributes necessarily reorders
them. Never claim more than idempotence, in code comments, commit messages or reports.

**A3 — XSD attribute defaults are NEVER applied at read time.** 1,236 attributes carry one. Absent and
explicitly-present-at-the-default are semantically identical but textually different. A reader that
applies a default writes it back on save, and the round-trip test cannot catch it because both
generations agree. Defaults are applied in `@ooxml/wml` property resolution, downstream of the model.

**A4 — Write back in the dialect the file arrived in.** Strict (`purl.oclc.org/ooxml/…`) and
Transitional (`schemas.openxmlformats.org/…`) are parallel dialects, not versions. Word emits
Transitional. Never "upgrade" a document on save. (ADR 0008.)

**A5 — Unselected `mc:AlternateContent` branches are preserved.** Choosing the DrawingML `mc:Choice`
for rendering does not license dropping the VML `mc:Fallback` on save; dropping it breaks the file in
older Word.

**A6 — Position is part of preservation.** Unknown content carries `PositionedRaw { afterSlot,
afterIndex?, node }`. A flat bag re-emitted at the end of the element produces a different document.
There is deliberately no `afterIndex: -1` — that position is already expressible as `afterSlot` of the
previous slot, and two encodings for one position gives a writer two behaviours. (ADR 0009.)

---

## B. Schema and type-system rules

**B1 — `ST_OnOff`: an absent `val` on a present WML element means TRUE.** Lexical space is
`1|0|true|false|on|off` — note `on`/`off`, which `xsd:boolean` does not accept. This is normative
_prose_, not schema: `CT_OnOff/@val` has no XSD `default`.

It is **not a property of the type**. DrawingML's `CT_Boolean` uses the same `s:ST_OnOff` with
`default="0"`, where absent means FALSE. Hence three runtime functions:

| Function                      | Rule                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `parseOnOff(v)`               | WML rule — absent ⇒ true                                                                         |
| `parseOnOffOr(v, whenAbsent)` | Everywhere else — default supplied by the schema                                                 |
| `parseOnOffAttr(v)`           | Literal, no default applied — what the reader uses, so the writer can leave `<w:b/>` as `<w:b/>` |

They look redundant. **They are not. Never merge them.** Merging inverts booleans across one family or
the other, in every document.

**B2 — Every non-repeating property is `?: T | undefined`**, regardless of schema required-ness.
Repeating slots stay non-optional arrays. Required-ness lives in the validator and in
`missing-required` error diagnostics. Two independent reasons (ADR 0010):
a reader that must open defective documents cannot promise a required child is present; and under
`exactOptionalPropertyTypes`, `{ jc: undefined }` is not assignable to `{ jc?: CT_Jc }`, so the bare `?`
would force the reader to accumulate into a mutable object instead of returning one object literal.

**B3 — Failures in the codegen are loud by design.** `BUILTIN_TS` and `TypeContext.tsName` throw on an
unknown type rather than degrading to `any`. Never add a fallback that produces `any` — a silently-`any`
type is an invisible hole in a 2,800-type model that nothing downstream can detect.

**B4 — Readers never throw on document content.** Only cursor errors (malformed XML, tripped parse
limits) and caller misuse escape. Everything a _document_ can do wrong produces a diagnostic and a
preserved value. An editor that refuses a file because one attribute in one paragraph is malformed is
useless; one that half-opens and silently discards the rest is worse than useless.

**B5 — Diagnostics are capped** at `DIAGNOSTIC_CAP = 1000`, then counted in `suppressed`. A file
crafted with a million bad attributes must not make us allocate a million objects.

**B6 — Slot order is schema order, and the writer replays it.** Every complex type's element content
is an ordered `Slot[]`. The governing rule of `toSlots()`: _a compositor that can repeat collapses into
a single slot; a non-repeating sequence/all is transparent._

**B7 — The flattening precondition holds and is asserted at build time.** Flattening a repeating
`xsd:choice` into one array of a discriminated union is sound only because no choice branch is a
multi-element sequence. Measured across all 26 Transitional schemas: 154 choices, exactly 1 contains a
sequence (a redundant single-group-ref wrapper, `CT_RPR` in `shared-math.xsd:141`), 0 are multi-element.
`assertFlattenable()` re-checks this. If it ever fails, the slot model's soundness is in question —
that is structural, escalate.

---

## C. Codegen mechanics

**C1 — Determinism is a CI gate.** `pnpm gen && git diff --exit-code packages/schema/src/generated`.
Sort every iteration over a map, object or set. No timestamps, no randomness, no insertion-order
dependence in generated output.

**C2 — Never hand-edit anything under `packages/schema/src/generated/`.** It is regenerated and
overwritten. Fix the emitter in `packages/codegen/src/emit/`. A type error in generated code points at
the generated file; the bug is always in the emitter.

**C3 — Generated JSDoc is one line, pointing at an ADR.** The preservation docs are emitted ~2,800
times and the schema-default doc 1,236 times. Multi-line prose there is 30k lines of noise in every
regenerated diff, which destroys exactly the reviewability the determinism gate exists to provide.

**C4 — `verbatimModuleSyntax` is on.** Type-only imports must be written `import type`.
`SourceFile.importName(module, name, typeOnly = true)` handles this; pass `typeOnly: false` for runtime
values or the build breaks.

**C5 — `noUncheckedIndexedAccess` is on.** `arr[i]` is `T | undefined`. Guard it. Do not silence it
with `!` — a `!` in generated code is how `undefined` reaches layout and crashes a paint at 60fps.

---

## D. The XML cursor contract

Every generated reader depends on these. They are contracts, not implementation details.

**D1 —** `skipToRaw()` returns the element and everything under it, leaving the cursor on the event
**after** the matching `endElement`. Every reader must mirror this exactly.

**D2 —** DOCTYPE is rejected outright (`code: 'entity-rejected'`). That is the XXE / billion-laughs
boundary and it lives in the cursor, not in a caller.

**D3 —** Namespace declarations are lifted out of `attrs` into `nsDeclarations`. Otherwise every writer
emits them twice.

**D4 —** `Object.values(tag.attributes)` is document order, and **that ordering is load-bearing for
round-trip**.

**D5 —** Adjacent plain text is coalesced (saxes splits at entity and chunk boundaries). **CDATA is
never merged with anything**, because `<![CDATA[a]]><![CDATA[b]]>` and `<![CDATA[ab]]>` have identical
infosets but different bytes.

**D6 —** All event access goes through `EventFeed { peek(); advance(); endPosition }` — forward-only,
one event of lookahead, deliberately no random access, so an incremental feed can be swapped in later
without touching a single generated reader. Do not add random access.

---

## E. Measured facts — do not re-derive by assumption

Recorded in `docs/xsd-feature-survey.md`. If you doubt one, re-measure it; do not guess.

| Fact                                               | Value           | Consequence                                                                                                                                                |
| -------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mixed="true"` types on the `.docx` path           | **ZERO**        | No mixed-content machinery anywhere. Text in WML is always `simpleContent`. Adding "just in case" handling is dead code in the hottest loop in the reader. |
| `xsd:choice` total / with sequence / multi-element | 154 / 1 / **0** | See B7                                                                                                                                                     |
| `xsd:any` wildcard sites on the `.docx` path       | 8               | Small enough to handle explicitly                                                                                                                          |
| Attributes with a schema `default`                 | 1,236           | See A3                                                                                                                                                     |
| Preset shape geometries                            | 187             | Phase 9                                                                                                                                                    |

---

## F. Environment — hard constraints

**F1 — Disk.** ~11 GB free on `C:`, ~11 GB on `D:`. The repo stays on `D:`. Do not install LibreOffice.
Do not let Playwright download browsers before Phase 11. Do not vendor the ~30 MB ArtBorders PNG set
before Phase 10.

**F2 — pnpm 10+ reads its settings from `pnpm-workspace.yaml` and SILENTLY IGNORES them in `.npmrc`.**
There is deliberately no `.npmrc`. Do not create one — it will appear to work and do nothing. The store
is pinned to `D:/.pnpm-store` because pnpm hardlinks from a content-addressed store and **hardlinks
cannot cross volumes**; a store on `C:` with the repo on `D:` degrades silently to full copies, which
is how the disk fills.

**F3 — `onlyBuiltDependencies: [esbuild]`** is an allowlist blocking all other postinstall scripts. It
is also what keeps Playwright from downloading ~1 GB of browsers. Do not widen it before Phase 11.

**F4 — The shell cwd resets to `C:\Users\smart` between commands.** Prefix every one with
`cd /d/workspace/ooxml-editor && `.

**F5 — The 5,000-page ECMA PDF is not machine-readable here** (no poppler). Everything is driven off
the XSDs in `assets/schema/`. Do not burn tokens trying to extract it.

**F6 — No Word automation and no LibreOffice on this machine.** Real-world `.docx` fidelity **cannot**
be verified here. ADR 0007 binds: no status report, README, or commit message may describe this editor
as "Word-compatible" until those gates have actually run. Write "unverified — no Word/LibreOffice
available in this environment." Tickets carrying `UNVERIFIABLE-HERE` ship with that caveat attached.

---

## G. Fidelity philosophy

**G1 — Match Word, not the textbook.** Word uses **greedy** line breaking, not Knuth-Plass. Matching
Word is the requirement; "better" is wrong here. The same applies wherever the two diverge.

**G2 — Where the standard is underspecified, say so in the code.** Table autofit, `contextualSpacing`
edge cases, footnote placement heuristics. Mark them `SPEC-GAP`, describe what behaviour is being
approximated and on what evidence. Pretending the spec settled it is how a later reader trusts a guess.

**G3 — Unimplemented must degrade visibly, never silently.** Charts, SmartArt, EMF/WMF render as
labelled placeholders and are tracked in the coverage manifest. A blank area that should have content
is indistinguishable from a bug.

**G4 — Conformance is measured, not claimed.** The coverage manifest tracks every type through
`modelled → laidOut → painted → roundTripped`. "What does this editor support" has a factual answer or
it has no answer.
