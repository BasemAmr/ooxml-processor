# Phase 2 — OPC package layer

> **Difficulty rank 11 of 11 — the easiest phase in the project.** Size **M**.
>
> **Depends on** Phase 1 (the runtime XML cursor and sink; `@ooxml/opc` reads relationship and
> content-type parts through them).
>
> **Owns** `packages/opc/`.

## Why this phase ranks here

OPC is the only layer in this project with a complete, unambiguous, freely-available specification
(ECMA-376 Part 2) that fits in one afternoon's reading. There is no fixpoint, no fidelity question, no
place where the standard shrugs and leaves you to match Word's undocumented behaviour. A part name is
either valid or it is not, and §9.1.1.1 says which. That is the opposite of every other phase.

It ranks last for a second reason: **the implementation already exists.** 202 KB of source across 11
modules, all of it type-clean:

```
packages/opc/src/   zip.ts 45K   partname.ts 26K   package.ts 22K   relationships.ts 17K
                    errors.ts 14K   content-types.ts 14K   xml-support.ts 6K
                    rel-types.ts 5K   limits.ts 4K   index.ts 3K
                    testing/fake-xml.ts 17K   testing/zip-fixtures.ts 10K

npx tsc -p packages/opc --noEmit   ->  exit 0, no output
```

**So this phase is not "build the OPC layer." It is "prove the OPC layer works."** The gap is stark
and it is the organising fact of every ticket below:

```
npx vitest run packages/opc/src
  ✓ packages/opc/src/partname.test.ts  (68 tests)  32ms
    Test Files  1 passed (1)
         Tests  68 passed (68)
```

One test file. Sixty-eight tests, all of them about part names. **Zero tests for the ZIP reader, zero
for the content-type resolver, zero for the relationship graph, zero for the package round-trip.**
`testing/zip-fixtures.ts` exists — 10 KB of fixture builders, written specifically so a `zip.test.ts`
could consume them — and no file imports it. Someone built the test scaffolding and then did not
build the tests.

That is why most tickets here are marked **ALREADY LANDED** and yet none of them is free. Per
`00-conventions.md` item 2, a ticket is not done until *the ticket added tests for its own behaviour*.
An ALREADY-LANDED ticket in this phase therefore means: **the implementation is complete and correct on
reading, and the remaining work is characterisation tests that pin the behaviour it already has.** Do
not rewrite these modules. Read them, write tests that assert what they currently do, and only then
change anything a test proves wrong.

**And the risk profile is not as flat as the rank suggests.** Ranking eleventh is about *design*
difficulty. This layer is the attack surface: it is the only code in the project that touches
untrusted bytes before any schema has been consulted. A zip bomb, a path traversal, or an SSRF through
an external relationship are all Phase 2 failures, and none of them is loud. `P2-09` carries
**Escalate yes** on its own merits regardless of where the phase sits in the table.

---

## Ticket index

| ID | Title | Size | Escalate |
|---|---|---|---|
| **Establish the baseline** ||||
| P2-01 | Audit and characterise what landed | M | no |
| **Container and naming** ||||
| P2-02 | ZIP reader and writer — **ALREADY LANDED** | M | no |
| P2-03 | `[Content_Types].xml` resolution — **ALREADY LANDED** | S | no |
| P2-04 | Part-name grammar — **ALREADY LANDED** | M | no |
| **The relationship graph** ||||
| P2-05 | Relationship parsing and resolution — **ALREADY LANDED** | M | no |
| P2-06 | Word part discovery — **ALREADY LANDED**, two gaps | S | no |
| P2-07 | Core, app and custom properties | S | no |
| P2-08 | Digital signature parts | S | no |
| **Guarantees** ||||
| P2-09 | Security limits | M | **yes** |
| P2-10 | Unknown-part passthrough — **ALREADY LANDED** | S | no |
| P2-11 | Package round-trip idempotence | M | no |

---

## Establish the baseline

### P2-01 — Audit and characterise what landed

**Size** M · **Depends** — · **Escalate** no · **Owns** `packages/opc/src/**`

**Goal.** Every module in `packages/opc/src/` has a test file that pins its current behaviour, so that
the other ten tickets can be closed by reading a green suite instead of by reading the source.

**Trap.** Writing tests that assert what the code *should* do, discovering they fail, and then fixing
the code — in one undifferentiated change. When that lands, nobody can tell which failures were real
defects and which were the test's opinion. **Characterise first: write the test to match the current
behaviour, get it green, commit.** Then, in a separate change, fix the behaviours the specification
says are wrong, and the diff shows exactly what changed and why.

Second trap: assuming the code is correct because it is thorough. 45 KB of ZIP parsing that nothing
executes is 45 KB of unexecuted code. Its author's confidence is not evidence.

**Design — the audit, module by module.** What is there, and what a test file for it must cover:

```pseudo
zip.ts            45K  fflate {Inflate, deflateSync} + OWN central-directory
                       parsing (ADR 0002 — the library's own directory handling
                       was rejected; we read End-of-Central-Directory, walk the
                       CD entries, and stream each local header ourselves).
                       COVER: EOCD locator with and without a ZIP comment;
                       CD/local-header disagreement; STORED vs DEFLATE; data
                       descriptors; ZIP64; CRC mismatch; truncation mid-entry;
                       duplicate entry names; entry-order preservation.
                       -> testing/zip-fixtures.ts ALREADY BUILDS THESE. Use it.

partname.ts       26K  DONE — 68 tests. The only module with real coverage.

package.ts        22K  OpcPackage / OpcPart / WordPartIndex; archive order is
                       captured on open and replayed on save (this is what P2-10
                       rests on). COVER: open→save with no edits; part lookup by
                       name; the index; an edited part keeping its slot.

relationships.ts  17K  _rels parsing, Internal vs External, TargetMode, relative
                       target resolution against the source part's folder.
                       COVER: package-level vs part-level _rels; "../" targets;
                       absolute targets; duplicate Id; missing Id; an External
                       target (see P2-09).

errors.ts         14K  the typed error taxonomy, incl. OpcEncryptedPackageError
                       (not in the original plan — a bonus, and the right call:
                       a password-protected .docx is an ECMA-376 OLE compound
                       file, not a ZIP, and deserves its own error rather than
                       "not a zip").
                       COVER: every error carries the part name that caused it.

content-types.ts  14K  Default-by-extension + Override-by-partname.
                       COVER: the precedence rule, §10.1.2.3 — see P2-03.

xml-support.ts     6K  the bridge to @ooxml/schema's cursor.
                       COVER: DOCTYPE rejection propagates as an OPC error (D2).

rel-types.ts       5K  dual-dialect relationship-type constants.
limits.ts          4K  the caps — see P2-09.
index.ts           3K  the public surface.
```

**Done when.** Every `.ts` file in `packages/opc/src/` other than `index.ts`, `rel-types.ts` and
`testing/**` has a sibling `*.test.ts`. `npx vitest run packages/opc/src` reports more than 68 tests
and 0 failures. `testing/zip-fixtures.ts` is imported by at least one test. The audit's findings —
specifically, any place where the code's behaviour differs from what these tickets describe — are
written into the commit message as a list, with the follow-up ticket ID for each.

---

## Container and naming

### P2-02 — ZIP reader and writer

**Size** M · **Depends** P2-01 · **Escalate** no · **Owns** `packages/opc/src/zip.ts` · `ROUND-TRIP`

**ALREADY LANDED** — `packages/opc/src/zip.ts`, 45 KB, implements ADR 0002 as specified: `fflate` is
used for `Inflate`/`deflateSync` only, and the central directory is parsed by this module rather than
by the library. `npx tsc -p packages/opc --noEmit` is clean. **There is no `zip.test.ts`.**

**Why the decision was made, so it is not undone.** `fflate`'s own `unzip` gives up the two things
this layer needs most: entry order (it hands back a name-keyed object, and `[Content_Types].xml` must
stay first for Word), and the ability to enforce a decompression cap *while* inflating rather than
after. Rolling the central directory is ~300 lines and buys both. That is worth re-reading before
anyone proposes replacing it with a one-liner.

**Trap, for whoever writes the tests.** Testing only well-formed archives. The interesting inputs are
the malformed ones, and the fixture builder already supports them:

```pseudo
# The disagreements a real .docx in the wild actually exhibits:
#   - EOCD preceded by a ZIP comment (the locator must scan backwards)
#   - central directory says DEFLATE, local header says STORED
#   - local header sizes are 0 with a data descriptor after the data
#   - ZIP64 extra field where the 32-bit fields are 0xFFFFFFFF
#   - two entries with the same name (last wins? first wins? reject?)
# THE CENTRAL DIRECTORY IS AUTHORITATIVE. Local headers are a hint, because
# streaming writers legitimately cannot fill them in. A reader that trusts the
# local header is the reader that fails on documents Word itself produced.
```

**Done when (verification only).** `packages/opc/src/zip.test.ts` exists, imports
`testing/zip-fixtures.ts`, and covers each malformed case above with an asserted outcome — either a
successful read or a specific typed error from `errors.ts`, never a generic throw. A round-trip test
asserts entry order is preserved across open→save. The decompression cap is asserted to fire *during*
inflation, proven by a fixture whose declared uncompressed size is under the cap and whose actual
output exceeds it.

---

### P2-03 — `[Content_Types].xml` resolution

**Size** S · **Depends** P2-01 · **Escalate** no · **Owns** `packages/opc/src/content-types.ts`

**ALREADY LANDED** — `content-types.ts` (14 KB) implements both `Default` (by extension) and
`Override` (by part name), and its source comments cite §10.1.2.3 for the precedence rule. **No test
file.**

**Trap.** Getting the precedence backwards, which is easy because the part is written
Defaults-then-Overrides and reading it top-to-bottom suggests last-wins-by-position. It is not
positional:

```pseudo
# §10.1.2.3 — Override ALWAYS beats Default, regardless of document order.
#
#   <Default Extension="xml" ContentType="application/xml"/>
#   <Override PartName="/word/document.xml"
#             ContentType="...wordprocessingml.document.main+xml"/>
#
# /word/document.xml       -> the OVERRIDE. Getting this wrong makes the main
#                             document part look like generic XML and the whole
#                             open fails with a confusing error three layers up.
# /word/anythingelse.xml   -> application/xml
# /word/media/image1.png   -> the png Default, or NO CONTENT TYPE AT ALL
#
# Extension matching is CASE-INSENSITIVE (".PNG" matches Default "png").
# Part-name matching for Override is case-insensitive too — part names compare
# case-insensitively per §9.1.1.2, and this is a place implementations differ.
#
# A part with no applicable Default and no Override is a MALFORMED PACKAGE, not
# a part with an empty content type. Reject it and name the part.
```

**Done when (verification only).** `content-types.test.ts` asserts Override beats Default when both
apply, that extension and part-name matching are both case-insensitive, that a part with neither
raises a typed error naming the part, and that a `[Content_Types].xml` which is absent or unparseable
raises before any other part is touched.

---

### P2-04 — Part-name grammar

**Size** M · **Depends** — · **Escalate** no · **Owns** `packages/opc/src/partname.ts`

**ALREADY LANDED AND TESTED** — the one ticket in this phase that is genuinely complete.
`partname.ts` (26 KB) plus `partname.test.ts` (19 KB, **68 tests, all green**) covers the §9.1.1
grammar: segment structure, the empty-segment and dot-segment rules, percent-encoding normalisation,
the reserved-character set, case-insensitive comparison, and traversal rejection.

**What it establishes for everything downstream.** This is the module that makes `P2-09`'s
path-traversal boundary real. Every `zip.ts` entry name and every relationship target passes through
here before it is used as a part name, so `../../etc/passwd` and `..%2f..%2fetc%2fpasswd` are both
rejected at one chokepoint rather than at each caller. Do not add a second parser anywhere.

**Done when (verification only).** `npx vitest run packages/opc/src/partname.test.ts` is green (68/68 —
already true as of 2026-09-17). Confirm by grep that no other module in `packages/opc/src` constructs
or compares a part name with string operations instead of calling into `partname.ts`.

---

## The relationship graph

### P2-05 — Relationship parsing and resolution

**Size** M · **Depends** P2-01, P2-04 · **Escalate** no · **Owns** `packages/opc/src/relationships.ts`

**ALREADY LANDED** — `relationships.ts` (17 KB) parses `_rels/.rels` and `<part>/_rels/<part>.rels`,
distinguishes `TargetMode="Internal"` from `"External"`, and carries a documented SSRF boundary in its
header comment. **No test file.**

**Trap.** Resolving a relative target against the package root instead of against the folder of the
part that *owns* the `_rels` file. The two agree for package-level relationships and disagree for every
part-level one, so a root-relative implementation opens a normal document perfectly and then fails on
images:

```pseudo
# /word/_rels/document.xml.rels  contains  Target="media/image1.png"
#   resolved against /word/     ->  /word/media/image1.png     CORRECT
#   resolved against /          ->  /media/image1.png          WRONG, and it
#                                   only shows up on documents that have images
#
# Targets may also be "../customXml/item1.xml" (legal, resolve then normalise)
# or absolute "/word/styles.xml" (use as-is).
# Resolution happens BEFORE part-name validation; the normalised result is then
# handed to partname.ts, which is what rejects "../../outside".

# THE EXTERNAL BOUNDARY — the security-relevant half.
#   TargetMode="External" targets are recorded and NEVER dereferenced.
#   An external target may be http://, file://, \\unc\share, or anything else.
#   The package layer must not fetch it, and it must not resolve it as a part
#   name either (it is a URI, not a part name, and forcing it through the part
#   grammar produces a confusing error for a legitimate document).
#   Store it verbatim, mark it external, let a higher layer decide. That is the
#   SSRF boundary and it lives here.
```

**Done when (verification only).** `relationships.test.ts` asserts: a part-level relative target
resolves against the owning part's folder, not the root; a `../` target resolves and normalises; an
absolute target is used as-is; a target that escapes the package is rejected by `partname.ts`; a
duplicate or missing `Id` raises a typed error; an `External` target is retained verbatim and never
resolved as a part name. A test asserts no code path in `packages/opc` performs network or filesystem
I/O for an external target — by grep for `fetch`/`http` in the package, with the result recorded.

---

### P2-06 — Word part discovery

**Size** S · **Depends** P2-05 · **Escalate** no · **Owns** `packages/opc/src/package.ts`,
`packages/opc/src/rel-types.ts`

**ALREADY LANDED, with two gaps** — `WordPartIndex` in `package.ts` walks from `_rels/.rels` to the
main document part and out to styles, numbering, settings, fonts, theme, headers, footers, footnotes,
endnotes, comments, and media. `rel-types.ts` correctly stores each relationship type as a
**dual-dialect tuple** (Transitional `schemas.openxmlformats.org/…` and Strict `purl.oclc.org/ooxml/…`),
which is `A4` applied at the OPC layer and is exactly right. **No test file.**

**The two gaps, both small and both real.**

```pseudo
# GAP 1 — rel-types.ts DEFINES commentsExtended and people; WordPartIndex does
#   not index them. Word 2013+ writes both on any document with threaded
#   comments. Unindexed, they still round-trip (P2-10 carries them through as
#   unknown parts), so nothing is lost — but Phase 10's comments work has to
#   go find them by hand. Add them to the index.
#
# GAP 2 — no digital-signature parts are indexed at all. That is P2-08.

# Also assert in the test, because it is easy to regress:
#   - the main document part is found via the OFFICE DOCUMENT relationship TYPE,
#     never by the literal name "/word/document.xml". Word accepts other names,
#     and a document whose main part is /word/document2.xml is valid.
#   - both dialect URIs for each type resolve to the same index slot.
```

**Done when (verification only).** `package.test.ts` opens a synthetic package and asserts every
indexed part resolves; the main part is located by relationship type, proven by a fixture that names
it `/word/document2.xml`; `commentsExtended` and `people` appear in `WordPartIndex`; and a
Strict-dialect fixture indexes identically to its Transitional twin.

---

### P2-07 — Core, app and custom properties

**Size** S · **Depends** P2-05 · **Escalate** no · **Owns** `packages/opc/src/package.ts`

**PARTIALLY LANDED** — the three property parts are *discovered*: `rel-types.ts` carries the
`core-properties`, `extended-properties` and `custom-properties` relationship types, and the
relationship walk reaches them, so they exist as `OpcPart`s and round-trip as opaque bytes. **Nothing
parses them.** There is no typed accessor for a title, an author, or a custom property.

**Trap.** Writing the properties back with a "modified" timestamp the user did not ask for. `dcterms:
modified` is a document property, not a save artifact. Updating it on every open→save breaks `A2`
directly: generation 2 and generation 3 differ in one element, the idempotence test goes red, and the
fix is to stop touching it — not to exclude it from the comparison.

```pseudo
# docProps/core.xml    Dublin Core: dc:title, dc:creator, dc:subject,
#                      dc:description, cp:keywords, cp:lastModifiedBy,
#                      cp:revision, dcterms:created, dcterms:modified.
#                      dcterms dates carry xsi:type="dcterms:W3CDTF" — PRESERVE
#                      the attribute; dropping it makes the part invalid.
# docProps/app.xml     Application, Pages, Words, Characters, Company...
#                      These are STALE BY DESIGN — they describe the last app to
#                      save. Do not recompute them. A word count we compute is a
#                      word count we have to keep correct forever.
# docProps/custom.xml  user-defined, each with a fmtid, a pid, and a typed
#                      value. PIDS ARE ALLOCATED SEQUENTIALLY FROM 2. Adding a
#                      property means max(pid)+1, never reusing a hole.
#
# All three are OPTIONAL. Absent is normal, not an error.
# Read-only typed accessors for now; mutation is Phase 10's problem.
```

**Done when.** Typed read accessors exist for all three parts. A package with none of them opens
without error and reports them absent. A round-trip leaves all three byte-identical, including
`dcterms:modified` and the `xsi:type` attributes — asserted by byte comparison, not by field
comparison. A custom property of each supported value type reads back with its type intact.

---

### P2-08 — Digital signature parts

**Size** S · **Depends** P2-05 · **Escalate** no · **Owns** `packages/opc/src/package.ts`,
`packages/opc/src/rel-types.ts`

**NOT LANDED** — no signature relationship types are defined and no signature parts are indexed. This
is the one genuinely unimplemented ticket in the container half of the phase.

**Goal.** A policy for `_xmlsignatures/` that is explicit in code, so that editing a signed document
does something defined instead of something accidental.

**Trap.** Preserving signature parts and considering the job done. A digital signature signs a digest
of specific parts; **any** edit to a signed part invalidates it. Carrying the signature through
faithfully produces a file that Word opens with a red "invalid signature" banner — which is *worse*
than a file with no signature, because it tells the user the document was tampered with. We cannot
re-sign (no private key, and we should never want one).

```pseudo
# The parts:
#   /_xmlsignatures/origin.sigs           (the signature origin part)
#   /_xmlsignatures/sig1.xml, sig2.xml…   (one per signature)
#   relationship type …/digital-signature/{origin,signature,certificate}
#
# THE DECISION (needs an ADR — none exists today):
#   A. preserve and let the signature go invalid   -> alarming red banner
#   B. strip signatures on save, surface a warning -> honest: the document was
#                                                     edited, so the signature
#                                                     no longer applies
#   C. refuse to open signed documents             -> safe, and useless
#
# B is the defensible default: an edited document genuinely is no longer the
# document that was signed, and saying so plainly beats shipping a file that
# accuses the user of tampering. It must be LOUD (G3) — a warning the host app
# can surface, not a silent deletion — and opening without saving must never
# strip anything.
#
# Whatever is chosen, it is a decision that affects the save path, so per the
# autonomy policy it gets an ADR with the alternatives above and their reasons.
```

**Done when.** Signature relationship types exist in `rel-types.ts` and signature parts are indexed.
An ADR in `docs/adr/` records the chosen policy and rejects the other two with reasons. Opening a
signed package without saving leaves every signature part untouched, asserted by byte comparison.
Saving an edited signed package follows the ADR and emits a diagnostic that names every signature
affected. A test covers the unedited-save case explicitly, since it is the one where the policy could
plausibly differ.

---

## Guarantees

### P2-09 — Security limits

**Size** M · **Depends** P2-01, P2-02 · **Escalate** **yes** · **Owns** `packages/opc/src/limits.ts`

**PARTIALLY LANDED** — `limits.ts` (4 KB) defines the cap structure, `zip.ts` enforces compression
ratio and size caps, `partname.ts` rejects traversal (68 tests), `relationships.ts` documents the
external-target boundary, and the XML cursor rejects DOCTYPE (`D2`) and caps nesting depth at
`DEFAULT_PARSE_LIMITS.maxDepth = 256`. **No test file asserts any of it.**

**Escalate because every failure here is silent.** A cap that is defined, plumbed, and never fired in a
test is indistinguishable from a cap that is not plumbed at all. This is the only ticket in the phase
where "the code looks right" is worth nothing, because the code that is wrong also looks right.

**Trap — where the limits actually live.** They are not all in `limits.ts`, and a reviewer who reads
only that file will conclude two of them are missing:

```pseudo
# DEFENCE                 WHERE IT LIVES                      STATE
# zip bomb (ratio)        zip.ts, during inflation            enforced, untested
# zip bomb (total bytes)  zip.ts, running total across parts  enforced, untested
# entry count             zip.ts                              enforced, untested
# path traversal          partname.ts                         enforced, TESTED
# XXE / billion laughs    schema/runtime/cursor.ts (D2)       enforced, untested
#                                                              from the OPC side
# XML nesting depth       DEFAULT_PARSE_LIMITS.maxDepth = 256 enforced, untested
#                         — in the CURSOR, not in limits.ts
# SSRF                    relationships.ts: external targets  by construction —
#                         are recorded, never dereferenced    NOTHING FETCHES
#
# The last one is the weak entry. "Nothing fetches" is a property of the code as
# currently written, not an enforced invariant, and it is one helpful commit
# away from being false. It needs a test that FAILS if any code path in the
# package touches the network — not a comment saying it does not.
```

Second trap: caps tuned so tight they reject real documents. A `.docx` with a large embedded font or a
high-resolution image legitimately decompresses to tens of megabytes. Every cap needs a rationale
recorded next to its value, and the ratio cap in particular must be justified against a real
worst-case document rather than picked because it is a round number.

**Design.**

```pseudo
# Every cap is a TYPED ERROR carrying the limit, the observed value, and the
# part name — never a bare throw and never a truncated read. A silent truncation
# here is a corrupted document that opens successfully, which is the single
# worst outcome this package can produce.

# The ratio cap must fire DURING inflation. A cap checked after the fact has
# already allocated the memory the cap existed to prevent. zip.ts uses fflate's
# streaming `Inflate` rather than `unzipSync` precisely so the callback can
# abort mid-stream — that is the other half of ADR 0002's rationale and it is
# what makes the ratio cap real rather than decorative.

# Limits are configurable, with defaults that open every document in the corpus.
# Record the corpus's actual maximum next to each default so the headroom is a
# measured number and not a feeling.
```

**Done when.** `limits.test.ts` exercises **every** cap in the table above with a fixture that trips it
and asserts the specific error type, the part name in the message, and that no partial result was
returned. A 42-byte fixture that inflates past the cap is rejected *during* inflation, demonstrated by
peak allocation staying bounded. A DOCTYPE in `[Content_Types].xml` and in a `.rels` part both raise
`entity-rejected` through the OPC layer. A test asserts no network access from any code path in
`packages/opc`. Every default in `limits.ts` has a comment giving its rationale and the largest value
observed in the corpus.

---

### P2-10 — Unknown-part passthrough

**Size** S · **Depends** P2-02 · **Escalate** no · **Owns** `packages/opc/src/package.ts` ·
`ROUND-TRIP`

**ALREADY LANDED** — `package.ts` captures archive order on open and replays it on save, and parts the
`WordPartIndex` does not recognise are carried through as opaque byte ranges. This is `A1` at the
package layer. **No test file.**

**Trap.** Testing this with a package that has no unknown parts, which is every package a
straightforward fixture builder produces. The parts that matter are the ones our index does not know
about, and real documents are full of them: `customXml/`, `word/embeddings/` (an embedded workbook),
`word/glossary/` (building blocks — a whole nested document part), `word/stylesWithEffects.xml`,
`word/webSettings.xml`, vendor extension parts under `word/`, and anything a future Word version adds.
Losing `word/glossary/` silently deletes every custom building block in the user's document.

```pseudo
# Round-trip means: open -> save -> open -> save, and gen2 === gen3 (A2).
# NOT byte-identity with the input — ZIP metadata varies, compression level
# varies, and the first save may reorder nothing but still re-deflate. Do not
# claim more than idempotence, here or in the commit message.
#
# What must survive verbatim: the part's BYTES, its content type, its
# relationships, and its position in the archive.
```

**Done when (verification only).** A fixture containing `customXml/item1.xml`, `word/glossary/
document.xml`, `word/embeddings/sheet.xlsx` and one invented vendor part round-trips with all four
byte-identical and in their original archive positions. `gen2 === gen3` for that fixture. A part whose
content type has no `Default` and no `Override` still raises (`P2-03`) rather than being silently
carried as an unknown.

---

### P2-11 — Package round-trip idempotence

**Size** M · **Depends** P2-02, P2-03, P2-05, P2-07, P2-10 · **Escalate** no · **Owns**
`packages/opc/src/package.test.ts` · `ROUND-TRIP`

**NOT LANDED** — this is the phase's closing gate and it is the one ticket that cannot be finished
inside Phase 2, because the corpus it runs against is assembled in Phase 11.

**Goal.** `open → save → open → save` produces `gen2 === gen3` for every document available, so that
Phase 3 can assume the container layer is transparent and stop thinking about it.

**Trap.** Declaring victory on synthetic fixtures. Fixtures contain what their author thought of;
real documents contain what Word actually emits, which includes empty directory entries, parts with no
relationships at all, `_rels` files for parts that were deleted, duplicate content-type overrides, and
mixed-case extensions. The synthetic suite is necessary and it is not sufficient.

```pseudo
for doc in corpus:
    p1 <- open(doc);   gen2 <- save(p1)
    p2 <- open(gen2);  gen3 <- save(p2)
    assert gen2 == gen3                          # A2 — byte equality of the ZIPs
    assert partNames(p1) == partNames(p2)
    assert contentTypes(p1) == contentTypes(p2)
    assert relationshipGraph(p1) == relationshipGraph(p2)   # incl. Ids

# When gen2 != gen3, the diff is a ZIP and unreadable. Compare ENTRY BY ENTRY
# and report the first differing part name with a byte offset. A failure that
# says "packages differ" costs an hour that a failure saying
# "/word/document.xml differs at byte 4127" costs a minute.
#
# Deliberately NOT asserted: gen2 == the original file. See A2. The first save
# legitimately canonicalizes — deflate parameters, the ZIP version-made-by
# field, and extra fields we do not reproduce. Asserting input-identity here
# produces a test that can never go green and will be deleted by whoever
# inherits it.
```

**Done when.** The idempotence harness exists and is green over every synthetic fixture in
`testing/zip-fixtures.ts`. It is wired into Phase 11's corpus run (`P11-03`) rather than duplicated
there. Failures report the differing part name and byte offset, demonstrated by deliberately
perturbing one part and reading the message. The commit message says **idempotence after one pass**
and does not claim byte-identity with the input (`A2`).

---

## Phase 2 exit criteria

1. All tickets closed per their **Done when** clauses — including the ALREADY LANDED ones, whose
   remaining work is characterisation tests, not implementation.
2. `npx vitest run packages/opc/src` reports **more than one test file** and 0 failures. Today it
   reports 1 file and 68 tests, all of them about part names; that number is the measure of this
   phase's progress.
3. `npx tsc -p packages/opc --noEmit` exits 0 (already true — do not lose it).
4. Every security cap in `P2-09`'s table has a test that trips it and asserts a typed error. A cap
   with no test does not count as enforced.
5. Idempotence is demonstrated over the synthetic fixtures and wired into Phase 11's corpus run;
   the phase report claims **idempotence after one pass**, never byte-identity with the input (`A2`).
6. Phase 3 can open a `.docx`, reach `/word/document.xml` by relationship type, and round-trip every
   part it does not understand — without knowing anything about ZIP, content types, or `_rels`.
