# Phase 1 — Codegen (remainder)

> **Difficulty rank 10 of 11.** Size **M**.
>
> **Depends on** Phase 0 (done — workspace scaffold, vendored schemas, ADRs 0001–0008).
>
> **Owns** `packages/codegen/`, `packages/schema/`.

## Why this phase ranks here

Most of the hard thinking is already done and written down. The slot model and the flattening
precondition (`B6`, `B7`) are settled and machine-checked. The three `ST_OnOff` functions (`B1`) exist
and are tested. The optionality decision is made and recorded (`B2`, ADR 0010). The preservation model
is made and recorded (`A6`, ADR 0009). The dialect model is made and recorded (`A4`, ADR 0008). What
remains is mechanical emitter work behind a determinism gate (`C1`) that makes mistakes loud.

It ranks tenth for that reason, **not** because it is small. It is the largest volume of code in the
project, and it is the one phase where a silent bug propagates into ~2,800 types at once. `B3` exists
precisely because a single `any` fallback in `TypeContext.tsName` would be an invisible hole that
nothing downstream can detect, and `A3` exists because one line applying an XSD default would write
that default back into 1,236 attribute sites on every save.

**The verified state, 2026-09-17.** Three emitters' worth of infrastructure is in place and four
emitters are missing:

```
packages/codegen/src/emit/   source.ts  types.ts  types.test.ts  reader.ts
                             (no writer.ts, validator.ts, coverage.ts, namespaces.ts)
packages/codegen/src/        loader.ts  normalize.ts  ir.ts  model.ts  namespaces.ts  survey.ts
                             (no cli.ts — but package.json already points `gen` at dist/cli.js)
packages/schema/src/runtime/ all 11 modules present; mce.ts (34 KB) has no test file
packages/schema/src/generated/   does not exist
.github/                         does not exist — there is no CI at all
```

**The thing this phase must internalise.** Nothing in the repository compiles the emitters' _output_.
`npx tsc -p packages/codegen` type-checks the code that _writes_ strings; it cannot see inside the
strings. That gap is not hypothetical — it is currently hiding at least two distinct defects that
would break every generated module on the first run (see `P1-02`). Closing it is worth more than any
other single ticket here, which is why `P1-01` is only **S**: the errors `tsc` can already see are the
cheap half.

---

## Ticket index

| ID                                       | Title                                         | Size | Escalate |
| ---------------------------------------- | --------------------------------------------- | ---- | -------- |
| **Unblock the build**                    |                                               |      |          |
| P1-01                                    | Fix the three `reader.ts` type errors         | S    | no       |
| P1-02                                    | Compile the generated output in CI            | M    | **yes**  |
| P1-03                                    | Reconcile `types.test.ts` with ADR 0010       | S    | no       |
| P1-13                                    | Fix the two red `sink.ts` tests               | S    | no       |
| **The missing emitters**                 |                                               |      |          |
| P1-04                                    | `emit/writer.ts`                              | L    | **yes**  |
| P1-05                                    | `emit/validator.ts`                           | M    | no       |
| P1-06                                    | `emit/coverage.ts`                            | S    | no       |
| P1-07                                    | `emit/namespaces.ts`                          | S    | no       |
| P1-08                                    | `cli.ts` and the `pnpm gen` entry point       | M    | no       |
| **Coverage of what cannot be generated** |                                               |      |          |
| P1-09                                    | MCE tests                                     | M    | no       |
| P1-10                                    | Schema-derived synthetic fixtures             | M    | no       |
| **Closeout**                             |                                               |      |          |
| P1-11                                    | Branded unit types audit — **ALREADY LANDED** | S    | no       |
| P1-12                                    | Commit the working tree                       | S    | no       |

---

## Unblock the build

### P1-01 — Fix the three `reader.ts` type errors

**Size** S · **Depends** — · **Escalate** no · **Owns** `packages/codegen/src/emit/reader.ts`,
`packages/codegen/src/model.ts`, `packages/codegen/src/normalize.ts`

**Goal.** `npx tsc -p packages/codegen --noEmit` exits 0.

**The actual errors, verbatim as of 2026-09-17:**

```
packages/codegen/src/emit/reader.ts(240,41): error TS2379: Argument of type 'ModelSimpleType' is not
  assignable to parameter of type 'ModelSimpleType & { repr: { kind: "number"; }; }' with
  'exactOptionalPropertyTypes: true'.
packages/codegen/src/emit/reader.ts(288,25): error TS2339: Property 'fractionDigits' does not exist
  on type 'Facets'.
packages/codegen/src/emit/reader.ts(288,64): error TS2339: Property 'totalDigits' does not exist
  on type 'Facets'.
```

**Trap.** Both errors have an obvious wrong fix that compiles.

The `TS2379` is at `ctx.rt(numericCodec(st))` inside `case 'number':`. TypeScript narrows `st.repr` to
the number variant but does not narrow `st` itself — narrowing a discriminated property of a property
does not refine the parent. The wrong fix is `numericCodec(st as ...)`. The right fix is to change
`numericCodec` to take `st.repr` (or the facets) directly, because it never uses anything else on
`st`. The cast would work and would also silence the compiler the next time the signature genuinely
stops matching.

The `TS2339` pair looks like a missing field on an interface. It is not.

**Design — why `fractionDigits`/`totalDigits` must be _removed_, not added.**

```pseudo
# MEASURED, 2026-09-17:
#   grep -ro "fractionDigits|totalDigits" assets/schema/   ->  0 matches, all 51 XSDs
#
# And loader.ts ends its facet switch with:
#   default: throw new XsdLoadError(`Unhandled facet <xsd:${facet.local}>`, facetSource)
#
# So the IR does not carry them because the schemas do not use them, and if a
# schema revision ever introduced one the build would fail LOUDLY rather than
# drop it (B3, and the same policy as UnsupportedXsdFeature).
#
# Adding the fields to `Facets` therefore adds two properties that are provably
# always `undefined`. Worse, it makes the existing expression permanently dead:
#
#   facets.fractionDigits === 0  ->  undefined === 0   ->  false, always
#   facets.totalDigits !== undefined                   ->  false, always
#   => numericCodec() returns 'parseDouble' for EVERY numeric simple type
#
# That is a live semantic bug hiding behind a type error. `ST_TwipsMeasure` and
# `ST_DecimalNumber` are xsd:int-derived and would be parsed by parseDouble,
# which accepts "3.7" and "1e3" as twips. The type error is doing us a favour by
# refusing to compile it.
```

The discriminator `numericCodec` actually wants is **integral vs fractional**, and the information for
it exists but is thrown away. `normalize.ts` has `st.base` and already tests it with `isNumericBase()`
at the point it builds the repr — then keeps only `brand` and `facets`:

```pseudo
# normalize.ts, pass 5, today:
repr = isNumericBase(st.base)
     ? { kind: 'number', brand?, facets: st.facets }     # base DISCARDED here
     : { kind: 'string', facets: st.facets }

# what it should keep:
repr = { kind: 'number', brand?, facets, base: st.base }   # or a precomputed
                                                           # `integral: boolean`

# then, in reader.ts:
fn numericCodec(repr) -> string
    return INTEGRAL_BUILTINS.has(repr.base.name) ? 'parseInteger' : 'parseDecimal'
    # xsd:int|integer|long|unsignedInt|unsignedLong|unsignedShort|byte|
    # unsignedByte|positiveInteger|nonNegativeInteger  -> parseInteger
    # xsd:decimal                                      -> parseDecimal
    # xsd:double|float                                 -> parseDouble
#
# Note this also corrects the CURRENT mapping: today nothing routes to
# parseInteger at all, even though BUILTIN_PARSER maps ten built-ins to it.
```

Keep the existing doc comment's _reasoning_ — it correctly says the choice must not be guessed from
the brand, because `ST_Percentage` and `ST_Angle` are integers while `a:CT_Point3D` coordinates are
decimals — but fix the sentence that claims the decision comes from facets. It does not.

**Done when.** `npx tsc -p packages/codegen --noEmit` exits 0 with no output. `Facets` in `ir.ts` is
unchanged (no new fields). A unit test asserts `numericCodec` picks `parseInteger` for an
`xsd:int`-based type, `parseDecimal` for an `xsd:decimal`-based one, and `parseDouble` for
`xsd:double`. `grep -c 'fractionDigits\|totalDigits' packages/codegen/src` returns 0.

---

### P1-02 — Compile the generated output in CI

**Size** M · **Depends** P1-01, P1-08 · **Escalate** **yes** · **Owns** `packages/schema/tsconfig.json`,
`packages/schema/src/runtime/index.ts`, CI config

**Goal.** A gate that type-checks `packages/schema/src/generated/**`, so that a defect in an emitted
_string_ fails a build instead of waiting for a consumer.

**Trap.** Believing `npx tsc -p packages/codegen` covers this. It does not, and cannot. It checks the
emitter; the emitter's product is `string`. Every template literal in `reader.ts` is, to the compiler,
opaque text. This ticket exists because that blind spot is currently hiding real defects — found by
reading, which is not a strategy that scales to 2,800 types.

**The two defects already in the blind spot.** Both are real, both are on disk today, neither is
visible to any command in the repository.

```pseudo
# DEFECT 1 — the `$parsed` reference.  reader.ts:690 (emitReturn)
#
#   emitReturn:   if (ct.content.kind === 'simpleContent')
#                     fields.push('$value: $parsed ?? $value')      # UNCONDITIONAL
#
#   emitSimpleContentLoop:   parser <- ctx.parserFor(ct.content.valueType)
#                            if (parser !== undefined)
#                                emit `const $parsed = ...`         # CONDITIONAL
#
# parserFor() returns undefined for every built-in whose BUILTIN_PARSER entry is
# `null` — which is every string-ish built-in, including `xsd:string`.
#
# So for any simpleContent type over a string built-in, the emitted reader
# returns `$value: $parsed ?? $value` with NO declaration of `$parsed`.
# That is TS2304 "Cannot find name" in the generated module, and a
# ReferenceError at runtime.
#
# This is not an exotic corner. CT_Text — `w:t`, the element that carries every
# character of visible text in a WordprocessingML document — is simpleContent
# over xsd:string. The generated reader for the single most important type in
# the format does not compile.

# DEFECT 2 — the runtime barrel does not export what the emitter imports.
#
# reader.ts imports every runtime helper from '../../runtime/index.js'.
# runtime/index.ts re-exports xml.ts, cursor.ts, sink.ts, namespaces.ts,
# onoff.ts, units.ts, mce.ts and preserve.ts — and NOTHING from read.ts or
# lexical.ts. The emitter asks for eight names that are not there:
#
#   from read.ts     ReadContext, requireStart, isIgnorableWhitespace
#   from lexical.ts  collapse, parseInteger, parseDecimal, parseDouble,
#                    parseXsdBoolean, parseList
#
# Every generated reader module would fail with TS2305 on its first import line.
```

Defect 2 is the more instructive one: it is not a subtle logic slip, it is eight missing lines in a
barrel file, and it survived because _no file anywhere imports a generated module_. That is the class
of bug this gate closes, and the reason it is escalate-worthy — the failure mode is not a wrong
render, it is discovering at Phase 3 that none of Phase 1's output was ever compiled.

**Design.**

```pseudo
# The generated tree is a normal part of @ooxml/schema's compilation unit.
# packages/schema/tsconfig.json already includes src/**; once
# src/generated/ exists it is covered automatically. The gate is therefore:
#
#   pnpm gen                                      # P1-08
#   npx tsc -p packages/schema --noEmit           # now covers generated/**
#   git diff --exit-code packages/schema/src/generated    # C1 determinism
#
# ORDER MATTERS. Generate, then compile, then diff. Diffing first passes on a
# stale tree; compiling first passes on last run's output.

# WHERE THE GATE LIVES. There is no .github/ directory — the project has no CI
# at all. `pnpm verify` (= format:check && typecheck && test) is the existing
# aggregate gate and is the honest home for this until CI exists. Extending
# `verify` to run `gen` and the determinism diff is part of this ticket; a
# .github workflow that runs `pnpm verify` is the other part.
#
# `packages/schema/src/generated/` is already in .prettierignore, so
# format:check will not fight the emitter over byte-for-byte output (C1).
```

The generated tree is large. If whole-tree checking becomes slow enough that people skip it, keep the
full check in `verify`/CI and add nothing clever locally — a sampled type-check is a gate that reports
green on the type it did not sample.

**Done when.** `packages/schema/src/generated/**` is inside `tsc -p packages/schema`'s input, proven
by deliberately emitting a broken identifier and watching the gate go red. Both defects above are
fixed and each has a regression test: a simpleContent-over-`xsd:string` fixture emits a reader that
compiles, and `runtime/index.ts` re-exports all eight names (asserted by an import test, not by
reading the file). `pnpm verify` runs `gen` → `tsc` → `git diff --exit-code` in that order. A
`.github` workflow runs `pnpm verify` on push.

---

### P1-03 — Reconcile `types.test.ts` with ADR 0010

**Size** S · **Depends** — · **Escalate** no · **Owns** `packages/codegen/src/emit/types.test.ts`

**Goal.** `packages/codegen/src/emit/types.test.ts` is green and asserts the behaviour ADR 0010
actually specifies.

**Trap.** Treating this as "refresh a stale golden with `-u`". It is not, and `-u` alone leaves the
file red. The current failure count is **six**, and only **one** of them is the snapshot:

```
packages/codegen/src/emit/types.test.ts  (24 tests | 6 failed)
  × emits optional, required and repeated slots correctly
      expected output to contain 'readonly pPr?: CT_PPr;'
  × gives a type with only fixed slots a positional unknown anchor
      expected output to contain 'readonly $unknown?: readonly PositionedRaw[];'
  × emits simpleContent as a $value property
      expected output to contain 'readonly space?: string;'
  × marks required attributes as non-optional
      expected output to contain 'readonly id: string;'
  × documents a schema default without applying it
      expected output to contain 'readonly left?: string;'
  × golden > emits a readable module for a realistic miniature
      Snapshot mismatched
```

Five are `toContain` assertions that `-u` does not touch. All five fail the same way — the emitter now
writes `?: T | undefined` where the test expects bare `?: T` — which is exactly the `B2` / ADR 0010
change, correctly implemented in `types.ts` and not yet reflected in its test.

**The fourth one is different and is the whole reason this ticket is not clerical.** The test named
`marks required attributes as non-optional` expects `readonly id: string;` for a `use="required"`
attribute. ADR 0010 **deliberately reversed that**: required-ness no longer makes a property
non-optional, it moves to the validator and to `missing-required` diagnostics. The emitter is right
and the test is asserting a decision that has been overturned. Blindly running `-u`, or mechanically
appending `| undefined` to all five expectations, would leave a test whose _name_ documents the
opposite of the project's architecture — which is worse than no test, because the next reader believes
it.

**Design.**

```pseudo
# 1. The four mechanical ones: append `| undefined` to the expected substring.
#      'readonly pPr?: CT_PPr;'  ->  'readonly pPr?: CT_PPr | undefined;'
#    ...and so on. These are genuinely stale-in-one-direction.
#
# 2. The required-attribute one: RENAME and INVERT.
#      'marks required attributes as non-optional'
#        -> 'keeps required attributes optional; requiredness is the validator''s'
#      expect 'readonly id?: string | undefined;'
#    and add a comment pointing at ADR 0010 so the inversion reads as deliberate.
#
# 3. THEN `vitest -u` for the snapshot, and READ THE DIFF. The golden's job is
#    to make an unintended emitter change visible; a golden accepted without
#    reading is a golden that will be accepted without reading next time too.
#    What to look for in that diff, specifically:
#      - every non-repeating property gained ` | undefined`   (expected, B2)
#      - repeating slots did NOT gain it — arrays stay non-optional  (B2)
#      - the one-line JSDoc stayed one line                          (C3)
#      - import lines are still `import type`                        (C4)
#      - nothing else moved
```

**Done when.** `npx vitest run packages/codegen/src/emit/types.test.ts` is green with 24 passing. No
test in the file asserts that a required attribute is non-optional. The snapshot diff was reviewed and
the review's findings are in the commit message, item by item against the four checks above.

---

### P1-13 — Fix the two red `sink.ts` tests

**Size** S · **Depends** — · **Escalate** no · **Owns** `packages/schema/src/runtime/sink.ts`

**Goal.** `packages/schema/src/runtime/sink.test.ts` is green.

**Context.** Not in the original phase plan; found by running the suite. Two tests are red in
`packages/schema/src/runtime/sink.test.ts` (71 tests, 2 failed), and the sink is `ROUND-TRIP` code —
it is what `P1-04`'s writer will emit through, so this is a prerequisite, not a cleanup.

```
× escaping > escapes exactly what an attribute value requires
    Expected: "a &amp; b &lt; c &gt; d &quot;q&quot; 's'"
    Received: "a &amp; b &lt; c > d &quot;q&quot; 's'"

× namespace handling > undeclares the default namespace with xmlns="" rather than hoisting it
    Expected: '<root xmlns="urn:d"><bare xmlns=""/></root>'
    Received: '<ns:root xmlns:ns="urn:d" xmlns="urn:d"><bare xmlns=""/></ns:root>'
```

**Trap.** Deciding the tests are wrong because the implementation is defensible. The first is
arguable on the XML spec's terms — `>` is not _required_ to be escaped in an attribute value — but
"arguable" is not the standard for `ROUND-TRIP` code. Escaping `>` is what every mainstream serializer
does, it is what `A2` idempotence is cheapest to prove against, and a sink that escapes `>` in text
but not in attributes has two rules where one will do. Decide it once, write it down, and make the
code and the test agree.

The second failure is not arguable. The sink is emitting a prefixed root _and_ a default declaration
for the same URI — `<ns:root xmlns:ns="urn:d" xmlns="urn:d">` — where the test asked for the default
binding alone. Two bindings for one URI on one element is legal XML and a round-trip hazard: the
second generation has to pick one, and whichever it picks differs from generation one.

**Done when.** `npx vitest run packages/schema/src/runtime/sink.test.ts` is green (71/71). Whichever
way the `>` question is decided, `escapeText` and `escapeAttributeValue` agree with each other and a
comment says why. A test asserts the sink never emits two declarations of the same URI on one element.

---

## The missing emitters

### P1-04 — `emit/writer.ts`

**Size** L · **Depends** P1-01, P1-02, P1-13 · **Escalate** **yes** · **Owns**
`packages/codegen/src/emit/writer.ts` · `ROUND-TRIP`

**Goal.** `writeCT_Foo(sink, value, ctx)` for every complex type — the other half of the round-trip
guarantee.

**Trap.** Writing the writer as "the reader, backwards". It is not symmetrical, because the reader
throws information away in exactly four places where the writer must not invent it back:

1. **Absent is not default (`A3`).** 1,236 attributes carry an XSD `default`. The reader never applies
   one; the writer must never emit one. `if (v.jc !== undefined) writeAttr('jc', v.jc)` — never
   `writeAttr('jc', v.jc ?? DEFAULT)`. A writer that fills defaults in produces a diff on every save of
   an untouched document, and the round-trip test **cannot catch it**, because generations two and
   three both contain the default and therefore agree.
2. **`ST_OnOff` absence is meaningful (`B1`).** The reader used `parseOnOffAttr`, which does not apply
   the absent-means-true rule, specifically so `<w:b/>` survives as `<w:b/>` and does not become
   `<w:b w:val="true"/>`. The writer must honour the same distinction: `val` is written only if it was
   read.
3. **Position (`A6`).** `PositionedRaw` must be re-emitted at `afterSlot`/`afterIndex`, interleaved
   with the slot replay — not flushed at the end of the element.
4. **Dialect (`A4`).** URIs come from `ctx`, never from a literal, and a Transitional-only type
   emitted into a Strict package is an error, not a silent downgrade.

**Design.**

```pseudo
fn writeCT_Foo(sink, v, ctx)
    sink.startElement(ctx.uris['wml'], 'p')

    # -- attributes, in the type's declared order (D4 keeps read order for the
    #    unknown ones; known ones are schema order, which is stable) --
    for a in attributes:
        if v[a.prop] !== undefined: sink.attr(nsOf(a), a.name, format(a.type, v[a.prop]))
    for a in v.$unknownAttrs ?? []:  sink.attrRaw(a)          # verbatim, A1

    # -- children: slot order IS schema order (B6) --
    $unknown <- sortPositioned(v.$unknown ?? [])              # preserve.ts
    flushRawBefore(slotIndex = -1)                            # afterSlot -1 = leading

    for (i, slot) in slots:
        switch slot.kind:
          element:   if repeated: for x in v[slot.prop]: writeChild(x)
                     else if v[slot.prop] !== undefined: writeChild(v[slot.prop])
          choice:    for alt in v[slot.prop]:
                         if alt.kind == '$raw': sink.writeRaw(alt.value)   # A1, A5
                         else: writeChild(alt.value)
                         flushRawBefore(slotIndex = i, afterIndex = idx)
          wildcard:  for node in v[slot.prop]: sink.writeRaw(node)
        flushRawBefore(slotIndex = i, afterIndex = ABSENT)

    sink.endElement()

# `writeRaw` replays a RawNode byte-faithfully: element name, prefix, attribute
# ORDER (D4), comments, PIs, and CDATA kept distinct from text (D5). An
# mc:AlternateContent captured whole by skipToRaw replays whole, which is how A5
# is satisfied — the writer never even sees the branches separately.

# simpleContent: write $value through the type's FORMATTER, the inverse of the
# parser P1-01 selects. format(parse(x)) must be a fixed point — that identity
# is what A2 reduces to, and it is the one property to test exhaustively.
```

**Dialect refusal.** `ModelComplexType.dialects` already records single-dialect types, and
`TRANSITIONAL_ONLY` in `codegen/src/namespaces.ts` already names the five VML tokens. A writer handed a
Transitional-only type with `ctx.dialect === 'strict'` raises; it does not drop the element, and it
does not rewrite the URI.

**Done when.** For every complex type, `write(read(x))` over a corpus of hand-built fixtures produces
`gen2 === gen3` (`A2`). A fixture with an attribute at its schema default round-trips without the
attribute appearing. `<w:b/>` round-trips as `<w:b/>`, and `<w:b w:val="0"/>` as `<w:b w:val="0"/>`.
A `PositionedRaw` at `afterSlot: 0, afterIndex: 0` re-emits between the first and second repetition of
slot 0, verified by string comparison, not by parsing. An `mc:AlternateContent` with a `Fallback`
round-trips with both branches. Emitting a `vml` type into a Strict context throws a typed error.

---

### P1-05 — `emit/validator.ts`

**Size** M · **Depends** P1-02 · **Escalate** no · **Owns** `packages/codegen/src/emit/validator.ts`

**Goal.** The home that ADR 0010 moved required-ness to.

**Context.** `B2` says every non-repeating property is `?: T | undefined` regardless of schema
required-ness, for two reasons: a reader that must open defective documents cannot promise a required
child is present, and under `exactOptionalPropertyTypes` the bare `?` would force the reader to
accumulate into a mutable object instead of returning one object literal. Both reasons are about the
_reader_. Neither says the constraint stops existing — it moves here.

**Trap.** Shipping it to the browser. This is dev/CI-only code over ~2,800 types; it must be
tree-shaken out of production or it is dead weight in a bundle that Phase 11 has a size budget for.
Second trap: duplicating the reader's `missing-required` diagnostic. The reader already emits
`ctx.missingRequired(...)` per required attribute (`reader.ts`, `emitAttributeLoop`); the validator's
job is the constraints the reader deliberately does _not_ enforce.

**Design.**

```pseudo
fn validateCT_Foo(v, report) -> void
    # 1. use="required" attributes present
    if v.id === undefined: report('missing-required', 'CT_Foo/@id')
    # 2. required, non-repeating element slots present  (the reader does NOT
    #    check these at all today — only attributes)
    if v.tblPr === undefined && slot.cardinality.required: report(...)
    # 3. enumeration membership — reuse the ST_*_VALUES sets types.ts already
    #    emits beside every enum. Do not re-emit the literal list.
    # 4. simple-type facets the reader intentionally ignored: minInclusive,
    #    maxInclusive, minExclusive, maxExclusive, length, minLength, maxLength,
    #    pattern.  (That is the WHOLE facet set — see ir.ts `Facets`; there is
    #    no fractionDigits/totalDigits, see P1-01.)
    # 5. recurse into children.

# `pattern` is an XSD regex, NOT ECMAScript — ir.ts says so at the field. The
# translation happens here, at emit time, and the differences that bite are:
# XSD anchors implicitly (wrap in ^...$), `\i`/`\c` are XSD-only character
# class escapes, and XSD has character-class subtraction `[a-z-[aeiou]]`.
# A pattern that fails to translate is a build error (B3), never a skipped check.

# Diagnostics share ReadDiagnostic's shape and the DIAGNOSTIC_CAP of 1000 (B5).
```

**Done when.** A document missing a required attribute validates with exactly one `missing-required`
diagnostic naming the attribute. An out-of-range `ST_TwipsMeasure` and an out-of-enum `ST_Jc` each
produce one diagnostic. A translated XSD pattern accepts and rejects hand-picked strings. The
validator module is absent from a production bundle, asserted by a build-output check.

---

### P1-06 — `emit/coverage.ts`

**Size** S · **Depends** P1-08 · **Escalate** no · **Owns** `packages/codegen/src/emit/coverage.ts`

**Goal.** Emit the coverage manifest — one entry per type — that makes `G4` ("conformance is measured,
not claimed") a fact rather than a slogan.

**Context — most of this is already built.** `model.ts` fully defines `CoverageEntry` and
`CoverageStates { modelled, laidOut, painted, roundTripped }`, and `normalize.ts` pass 6 already
computes `docxPath` reachability from the WordprocessingML roots and populates `ModelSet.coverage`.
What is missing is only the emitter that serializes it. Do not redesign the shape.

**Trap.** Emitting `modelled: true` for everything because the generator generated it. `modelled`
means "generated, parsed into a typed value, **and written back**" per the field's own doc comment.
Until `P1-04` exists nothing has been written back, so the honest initial value is driven by which
emitters actually covered the type, not by its presence in the model.

**Design.**

```pseudo
# Emit as DATA, not code, so Phase 11 can diff two manifests:
#   packages/schema/src/generated/coverage.ts
#     export const COVERAGE: readonly CoverageEntry[] = [ ... ]
#
# Sort by qname (C1). laidOut/painted/roundTripped start false and are raised by
# later phases — Phase 11's P11-01 consumes this and fails CI if docx-path
# `modelled` coverage drops below 100% or the others regress.
```

**Done when.** `pnpm gen` emits one entry per complex and simple type. Every entry's `docxPath`
matches `normalize.ts`'s reachability set. A second `pnpm gen` produces a byte-identical file (`C1`).
The count of `docxPath: true` entries is printed by `pnpm gen` and recorded in the commit message.

---

### P1-07 — `emit/namespaces.ts`

**Size** S · **Depends** P1-08 · **Escalate** no · **Owns** `packages/codegen/src/emit/namespaces.ts`

**Goal.** Emit the Strict/Transitional alias table (`A4`) that every generated reader's `ctx.uris`
lookup and every writer's URI resolution reads from.

**Context.** The _input_ table is landed and good: `packages/codegen/src/namespaces.ts` is the
hand-authored binding list (token ↔ prefix ↔ transitional URI ↔ strict URI) built from the
`targetNamespace` of all 51 vendored schemas, and it already exports `NS_BY_TOKEN`, `NS_BY_URI`,
`TRANSITIONAL_ONLY` and `DOCX_NAMESPACES`. Only the emitter is missing.

**The VML fact, which the table already encodes.** Five tokens have **no Strict URI at all**, because
Strict drops VML entirely — they are `urn:schemas-microsoft-com:*` URNs, not `purl.oclc.org` URIs, and
there is no Strict spelling to alias to:

```pseudo
vml            v     urn:schemas-microsoft-com:vml
vml-office     o     urn:schemas-microsoft-com:office:office
vml-word       w10   urn:schemas-microsoft-com:office:word
vml-excel      x     urn:schemas-microsoft-com:office:excel
vml-powerpoint pptx  urn:schemas-microsoft-com:office:powerpoint

# These are exactly `TRANSITIONAL_ONLY`. A `strict` field of `undefined` is not
# a gap in the table, it is the fact. The emitted type must make it
# unrepresentable to ask for a Strict VML URI and get a plausible-looking string
# back — `strict?: string` and a lookup that returns undefined, never a
# fallback to the transitional URI. That fallback is how a Strict package ends
# up with a VML element in it.
```

**Trap — a live duplication this ticket must close.** `packages/schema/src/runtime/namespaces.ts` is
hand-authored and carries its own `CONVENTIONAL_PREFIXES` map of URI → prefix, while
`codegen/src/namespaces.ts` opens by claiming to be "the single place a namespace URI appears in the
whole project". Both statements cannot be true. The emitted module must become the single source and
the runtime's hand-maintained copy must go, or the two drift and the writer emits a prefix the reader
does not expect.

**Done when.** `pnpm gen` emits token → `{ prefix, transitional, strict? }` for every namespace, sorted
by token (`C1`). `uris` for a Strict document resolves `wml` to the `purl.oclc.org` URI and resolves
the five VML tokens to `undefined`, never to their Transitional URIs. `CONVENTIONAL_PREFIXES` no
longer exists as a hand-maintained literal in `runtime/namespaces.ts`. A test asserts every URI in the
emitted table round-trips through `NS_BY_URI` to its own token.

---

### P1-08 — `cli.ts` and the `pnpm gen` entry point

**Size** M · **Depends** P1-01 · **Escalate** no · **Owns** `packages/codegen/src/cli.ts`

**Goal.** One command that runs load → normalize → emit-all → write, and the `C1` determinism gate
around it.

**Context.** The wiring exists and points at nothing. Root `package.json` has
`"gen": "pnpm --filter @ooxml/codegen run gen"`; `packages/codegen/package.json` has
`"gen": "tsc --build && node ./dist/cli.js"`. `src/cli.ts` does not exist, so `pnpm gen` currently
fails with a module-not-found. (`"survey": "... node ./dist/survey.js"` does resolve — `survey.ts` is
present and tested.)

**Trap.** Any nondeterminism, which `C1` exists to catch and which is easy to introduce without
noticing. The specific sources, all of which are already avoided in `types.ts`/`reader.ts` and must
stay avoided:

```pseudo
# - iteration over a Map/Set/object without an explicit sort  -> both emitters
#   already do `[...set.complexTypes.values()].filter(...).sort(byTsName)`
# - a timestamp or version string in the banner  -> generatedBanner() takes only
#   a source description, deliberately
# - import order  -> SourceFile.toString() sorts module specifiers and names
# - alias disambiguation derived from insertion order -> importName() derives it
#   from the MODULE PATH instead, precisely so it is order-independent
# - Object.keys() on a record built by iteration
# - parallel emit writing into a shared accumulator

fn main()
    ir    <- loadSchemaSet('assets/schema')          # loader.ts   (landed)
    model <- normalize(ir)                           # normalize.ts (landed)
    assertFlattenable(model)                         # B7 — structural; if this
                                                     # fails, STOP and escalate
    modules <- []
    for ns in sorted(namespaces):
        modules += emitTypes(model, ns)              # landed
        modules += emitReader(model, ns)             # landed, needs P1-01
        modules += emitWriter(model, ns)             # P1-04
        modules += emitValidator(model, ns)          # P1-05
    modules += emitNamespaces(model)                 # P1-07
    modules += emitCoverage(model)                   # P1-06

    rmrf('packages/schema/src/generated')            # stale files must not
                                                     # survive a rename
    for m in sorted(modules by path): write(m)
    report: counts per namespace, and every normalize diagnostic

# Deleting the tree first is what makes `git diff --exit-code` meaningful: a
# module that stopped being emitted must show up as a deletion, not linger.
```

**Done when.** `pnpm gen` populates `packages/schema/src/generated/` and exits 0. Running it twice in
a row leaves `git diff --exit-code packages/schema/src/generated` clean. Deleting one emitted file and
re-running restores it byte-identically. `assertFlattenable` runs on every invocation and its result is
printed. `pnpm gen` prints the per-namespace type counts and every `NormalizeDiagnostic` at
`warning` or above.

---

## Coverage of what cannot be generated

### P1-09 — MCE tests

**Size** M · **Depends** — · **Escalate** no · **Owns** `packages/schema/src/runtime/mce.test.ts`

**Goal.** A specification for `mce.ts`, expressed as tests, because it has no other one.

**Context — and why this is not optional.** `packages/schema/src/runtime/mce.ts` is 34 KB of
hand-authored code with **no test file**. It is hand-authored because Markup Compatibility is
ECMA-376 **Part 3**, which is **not in the asset set** — `assets/schema/` holds 51 XSDs and none of
them describe MCE. So there is no schema to generate it from, no XSD to validate it against, and
nothing in `P1-10`'s synthetic-fixture strategy can reach it. Every other module in this package is
either generated from a schema or checked against one. This one is checked against nothing.

That makes its tests the only specification it has. `cursor.test.ts`, `onoff.test.ts`, `sink.test.ts`
and `units.test.ts` all exist; this is the single largest untested surface in the package, and it is
the surface that decides whether `A5` holds.

**Trap.** Testing selection and forgetting preservation. `McResolver.selectAlternateContent` picking
the right branch is the easy, visible half. The half that silently corrupts documents is what happens
to the branches it did _not_ pick. `A5` is unambiguous: choosing the DrawingML `mc:Choice` for
rendering does not license dropping the VML `mc:Fallback` on save, and a document that loses its
fallback is permanently downgraded for older Word — a corruption the user cannot see and we cannot
detect after the fact.

**Design — the surface to cover.** The module already exports `MC_NAMES`, `isAlternateContent`,
`QNameSet`, `McContext`, `McResolver`, `McError`/`McErrorCode`, and the `McAction`/`McDecision`/
`McSelection` types. Cover all seven MCE constructs, not the five in the usual summary:

```pseudo
mc:Ignorable="w14 w15 wp14"
    # a prefix list, resolved against IN-SCOPE bindings at the element where it
    # appears. Test: an unbound prefix; a prefix rebound on a descendant;
    # accumulation down the tree (McContext is a stack, not a flag).

mc:ProcessContent="w14:wrapper"
    # drop the ELEMENT, keep its CHILDREN, spliced in place. Test that the
    # children land at the parent's position, not appended.

mc:MustUnderstand="foo"
    # refusal, not preservation. Test it raises McError with a typed code and
    # that an ignorable-AND-must-understand prefix resolves as MustUnderstand.

mc:AlternateContent / mc:Choice@Requires / mc:Fallback
    # first Choice whose @Requires namespaces are ALL supported wins;
    # zero matching Choices falls to Fallback; no Fallback and no match is a
    # defined outcome, not an exception at a random layer.
    # @Requires is a LIST of prefixes, not one.

mc:PreserveElements / mc:PreserveAttributes
    # the two the summaries forget, both supported by this module. Wildcards
    # (`w14:*`) and the `#all` token.
```

Plus the round-trip property, which is the one that matters most:

```pseudo
# For every construct above: capture via skipToRaw, resolve a selection, then
# write back — and assert the output contains every branch and every attribute
# the input had, in order. Selection must be a VIEW over preserved bytes, never
# a filter applied to them.
```

**Done when.** `mce.test.ts` exists and is green. Each of the seven constructs has at least one
positive and one negative case. An `mc:AlternateContent` with two `mc:Choice` branches and an
`mc:Fallback` selects the first supported Choice **and** round-trips all three branches byte-for-byte.
`mc:MustUnderstand` on an unsupported namespace raises `McError` with a specific `McErrorCode`.
`mc:Ignorable` with an unbound prefix produces a diagnostic rather than a throw.

---

### P1-10 — Schema-derived synthetic fixtures

**Size** M · **Depends** P1-04, P1-05, P1-08 · **Escalate** no · **Owns**
`packages/codegen/src/emit/fixtures.ts`

**Goal.** One minimal-valid and one deliberately-invalid XML instance per complex type, generated by
the codegen itself.

**Why.** It is the only route to breadth coverage of ~2,800 types. Hand-writing two fixtures per type
is 5,600 files nobody will write, and the corpus of real `.docx` files exercises the few hundred types
Word happens to emit — leaving the long tail, which is exactly where an unnoticed emitter bug lives.
`P11-02` depends on this.

**Trap.** Generating fixtures from the same model the reader was generated from, and calling the
result validation. It is not: a bug in `normalize.ts` produces a wrong fixture and a wrong reader that
agree with each other, and the test passes. Say so in the module header. These fixtures prove
**internal consistency and non-crashing**, which is genuinely worth having across 2,800 types, and they
prove nothing about conformance to ECMA-376. Conformance evidence comes from real documents
(`P11-03`) and is `UNVERIFIABLE-HERE` for fidelity (`F6`, ADR 0007).

**Design.**

```pseudo
fn minimalValid(ct) -> xml
    # every required attribute, with a value drawn from its type:
    #   enum -> first value (sorted, C1)   number -> minInclusive ?? 0
    #   string -> shortest string matching `pattern` ?? ''
    #   ST_OnOff -> omit the attribute entirely (B1: absent means true, and
    #               that is the case worth exercising)
    # every required, non-repeating element slot -> recurse
    # repeating slots -> minOccurs copies, so usually zero
    # DEPTH-LIMIT the recursion: the type graph is cyclic (CT_Tbl -> CT_Tc ->
    # CT_Tbl). Cap depth and emit the deepest required child as empty; an
    # uncapped generator hangs, which is the same failure mode as a fixpoint
    # that does not converge.

fn invalidVariants(ct) -> [xml]
    # one defect each, so the diagnostic is unambiguous:
    #   drop a required attribute        -> expect exactly 1 missing-required
    #   value outside an enum            -> expect exactly 1 invalid-value
    #   value outside a numeric facet    -> expect exactly 1 (validator, P1-05)
    #   an undeclared child element      -> expect 1 unexpected-element AND
    #                                       preservation ($raw or $unknown)
    #   an undeclared attribute          -> expect 1 unexpected-attribute AND
    #                                       $unknownAttrs
    # Each invalid fixture asserts B4: the reader DIAGNOSES, never throws.
```

**Done when.** `pnpm gen` emits fixtures for every complex type. Every minimal-valid fixture reads
with zero diagnostics and round-trips `gen2 === gen3`. Every invalid fixture produces exactly the one
expected diagnostic code and no reader throws (`B4`). Generation is deterministic across two runs
(`C1`). The generated fixture module states in its header that it proves internal consistency, not
conformance.

---

## Closeout

### P1-11 — Branded unit types audit

**Size** S · **Depends** — · **Escalate** no · **Owns** `packages/codegen/src/normalize.ts`

**ALREADY LANDED** — `UNIT_BRANDS` in `normalize.ts:879` is correct as written, and the mistake this
ticket was opened to catch has already been reverted.

**What was verified.** The table maps 18 simple types onto 8 brands, and every one of them is a
**unit**:

```pseudo
Twip         ST_TwipsMeasure, ST_SignedTwipsMeasure
HalfPoint    ST_HpsMeasure, ST_SignedHpsMeasure
EighthPoint  ST_EighthPointMeasure
Point        ST_PointMeasure
Emu          ST_Coordinate, ST_CoordinateUnqualified, ST_PositiveCoordinate
Degree60k    ST_Angle, ST_FixedAngle, ST_PositiveFixedAngle
Pct1000      ST_Percentage, ST_PositivePercentage, ST_FixedPercentage,
             ST_PositiveFixedPercentage
Pct50        ST_TablePercent, ST_TablePercentMeasure
```

No `Int32`, no `UInt32`, no width brands of any kind. The entries a previous attempt added for
`ST_DecimalNumber` and `ST_UnsignedDecimalNumber` are gone, and the table carries a comment recording
_why_ they are gone, which is the part that stops them coming back: they are plain
`xsd:int`/`xsd:unsignedInt` with no unit attached, so a brand buys no safety — nothing can be confused
with them — while forcing a cast at every arithmetic use. **Brands are for units, not for widths.**

All 8 brand names are exported as types from `packages/schema/src/runtime/index.ts`, so
`emitSimpleType`'s `ctx.file.importName(RUNTIME, st.repr.brand)` resolves for every entry.

**Done when (verification only).** Re-read `UNIT_BRANDS` and confirm no entry names a type whose only
distinguishing property is integer width. Confirm every brand string in the table is exported from
`runtime/index.ts` — once `P1-08` runs, this is enforced automatically by `P1-02`, since an
unexported brand becomes a `TS2305` in the generated types module.

---

### P1-12 — Commit the working tree

**Size** S · **Depends** P1-01, P1-03, P1-13 · **Escalate** no

**Goal.** `git status --short` is clean and `HEAD` is green.

**Context.** The tree currently carries a large uncommitted change set on top of `4e47ca0`: 7 modified
files and 20 untracked paths, including the entire `packages/opc/src/` tree, the whole
`packages/schema/src/runtime/` directory, `packages/codegen/src/{loader,survey}.ts`,
`packages/codegen/src/emit/reader.ts`, ADR 0010, and `plan-docs/` itself. That is several days of work
living only on this disk.

**Trap.** Committing it to make the tree clean. `00-conventions.md` item 6 says _never leave the tree
in a knowingly-broken intermediate state overnight_ — it does not say commit whatever is there. The
tree is knowingly broken right now: three type errors and eight failing tests. Committing that state
makes `HEAD` a point nobody can bisect through.

**What must be true before the commit.**

```pseudo
npx tsc -p packages/codegen --noEmit    -> exit 0      # P1-01
npx tsc -p packages/schema  --noEmit    -> exit 0      # already true
npx tsc -p packages/opc     --noEmit    -> exit 0      # already true
npx vitest run                          -> 0 failed    # P1-03 + P1-13
                                                       # (389 tests, 8 red today)
pnpm format:check                       -> exit 0
```

The determinism gate (`00-conventions.md` item 3) cannot run yet — `pnpm gen` has no `cli.ts` and
`packages/schema/src/generated/` does not exist. That is `P1-08`, and this ticket does **not** wait for
it. Split the commit rather than blocking: the runtime, the OPC package and the loader are finished,
tested work that should be on the record now; the emitters land as they are completed.

**Suggested split**, smallest first so each is independently revertible:

```pseudo
1. packages/schema/src/runtime/**            + ADR 0009 edits
2. packages/opc/src/**                       (see phase-02-opc.md)
3. packages/codegen/src/{loader,survey}.ts   + their tests
4. packages/codegen/src/emit/reader.ts       + ADR 0010 + package.json
                                              (needs P1-01 and P1-03 first)
5. plan-docs/**
```

**Done when.** `git status --short` prints nothing. `npx vitest run` reports 0 failed. All three `tsc`
invocations exit 0. Each commit message states which invariants the change is claiming to satisfy, and
claims nothing about round-trip fidelity that has not been run (`F6`, `A2` — idempotence only, never
byte-identity with the input).

---

## Phase 1 exit criteria

1. All tickets closed per their **Done when** clauses.
2. `pnpm gen` emits types, readers, writers, validators, namespaces, coverage and fixtures for all 26
   Transitional namespaces, and `git diff --exit-code packages/schema/src/generated` is clean on a
   second consecutive run (`C1`).
3. `npx tsc -p packages/schema --noEmit` exits 0 **with `src/generated/**` inside its input** — the
   gate from `P1-02`. Without this clause the rest of the criteria are unverified.
4. `npx vitest run` is green, and `mce.ts` is no longer the package's untested module.
5. Round-trip is demonstrated, not asserted: every minimal-valid synthetic fixture satisfies
   `gen2 === gen3`, and the phase report says **idempotence after one pass** rather than byte-identity
   (`A2`).
6. No generated file has been hand-edited (`C2`), no `any` fallback exists in the emitters (`B3`), and
   no reader applies an XSD attribute default (`A3`) — the last verified by a fixture whose attribute
   is written at its schema default and round-trips absent.
