# Phase 4 — Text: fonts, shaping, measurement

> **Difficulty rank 6 of 11.**
>
> **Depends on** Phase 3 (resolved run properties, `P3-06`; theme font bindings, `P3-10`).
>
> **Owns** `packages/text/`.

## Why this phase ranks here

Three things concentrate the risk, and all three are decisions rather than volume:

1. **The measurement cache is the hottest path in the system.** Every line break candidate, every
   incremental relayout, every zoom-independent remeasure goes through it. It has to be designed before
   anything is built on it, because retrofitting a cache around code that assumed measurement was free
   means rewriting the callers.
2. **The shaped-run representation is the second load-bearing data shape**, after `P5-01`'s line box —
   and it crosses a package boundary with hot code on both sides, so it constrains both.
3. **This phase spends the project's single WASM exception.** Decision D3 approved `harfbuzzjs`. The
   file has to justify that, not merely record it, because the fallback (`measureText`) is faster and
   is silently wrong for a large fraction of the world's documents.

It ranks sixth rather than higher because the algorithms themselves are _specified elsewhere and
specified well_: UAX#9 is a normative algorithm with a reference implementation and a conformance test
suite, UAX#14 likewise, and HarfBuzz is the reference shaper. Unlike Phases 6–9, the hard parts here
have right answers that can be looked up rather than designed.

---

## Verified against the schema

Read out of `assets/schema/transitional/wml.xsd`.

| Type                  | Finding                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ST_Hint`             | **`default` · `eastAsia` only — there is no `cs` value.** See `P4-01`.                                                                          |
| `CT_Fonts` attributes | `hint` `ascii` `hAnsi` `eastAsia` `cs` `asciiTheme` `hAnsiTheme` `eastAsiaTheme` **`cstheme`**                                                  |
| `CT_EastAsianLayout`  | `id` `combine` `combineBrackets` `vert` `vertCompress`                                                                                          |
| `CT_Font` children    | `altName` `panose1` `charset` `family` `notTrueType` `pitch` `sig` `embedRegular` `embedBold` `embedItalic` `embedBoldItalic`; attribute `name` |

Two traps visible in that table alone. **`cstheme` is lowercase** where the other three theme
attributes are `*Theme` — a generated reader gets this right, hand-written property resolution gets it
wrong and silently loses complex-script theme fonts. And **`ST_Hint` has no `cs` member**, so a
three-way hint switch has a branch that can never be taken, which usually means the author invented the
semantics of the other two as well.

---

## Ticket index

| ID    | Title                                   | Size | Escalate |
| ----- | --------------------------------------- | ---- | -------- |
| P4-01 | `w:rFonts` resolution and `w:hint`      | L    | **yes**  |
| P4-02 | Per-character script selection          | M    | no       |
| P4-03 | `fontTable.xml` and PANOSE substitution | M    | no       |
| P4-04 | Embedded font de-obfuscation (ODTTF)    | S    | no       |
| P4-05 | `FontFace` loading and FOUT mitigation  | M    | no       |
| P4-06 | Itemization                             | L    | no       |
| P4-07 | UAX#9 bidi                              | L    | **yes**  |
| P4-08 | Segmentation                            | M    | no       |
| P4-09 | harfbuzzjs integration                  | L    | no       |
| P4-10 | The `measureText` fast path             | M    | **yes**  |
| P4-11 | The measurement cache                   | L    | **yes**  |
| P4-12 | Shaped-run representation               | L    | **yes**  |
| P4-13 | Font metrics                            | M    | no       |
| P4-14 | Vertical text and CJK metrics           | M    | no       |

---

### P4-01 — `w:rFonts` resolution and `w:hint`

**Size** L · **Depends** P3-06, P3-10 · **Escalate** **yes** · **Owns** `packages/text/src/rfonts.ts`

**Goal.** Decide, for every character, which font family applies.

**Trap.** Picking one font per run. `w:rFonts` carries **four** slots — `@ascii`, `@hAnsi`,
`@eastAsia`, `@cs` — and which one applies is decided **per character**, by the character's codepoint,
not per run. One font per run is correct for pure-Latin documents, produces plausible output for
mixed documents, and is wrong for every CJK document in a way that only shows up as the wrong typeface
on the CJK portion — which a reviewer who does not read Chinese will not notice.

**Trap — the hint.** `ST_Hint` has exactly two values, `default` and `eastAsia`. There is no `cs`
hint. The hint is a **tie-breaker for ambiguous codepoints** (the ranges that could reasonably be
served by either the ASCII/hAnsi font or the East Asian font — Latin punctuation inside CJK text being
the common case), not a general font selector. Implementations that treat `w:hint` as "which slot to
use" get the unambiguous ranges wrong too.

**Trap — `cstheme`.** The four theme attributes are `asciiTheme`, `hAnsiTheme`, `eastAsiaTheme` and
**`cstheme`** — lowercase `t`, alone among the four. Resolution code written from the pattern rather
than from the schema drops complex-script theme fonts silently.

**Design.**

```pseudo
fn fontForChar(cp, rFonts, theme, lang) -> FontFamily
    slot <- slotFor(cp, rFonts.hint)          # P4-02
    name <- match slot:
        ASCII    -> rFonts.ascii    or themeFont(rFonts.asciiTheme,    theme)
        HANSI    -> rFonts.hAnsi    or themeFont(rFonts.hAnsiTheme,    theme)
        EASTASIA -> rFonts.eastAsia or themeFont(rFonts.eastAsiaTheme, theme)
        CS       -> rFonts.cs       or themeFont(rFonts.cstheme,       theme)
    return name or inheritedFromCascade or documentDefault

# themeFont resolves majorHAnsi/minorHAnsi/majorEastAsia/minorEastAsia/majorBidi/
# minorBidi against P3-10's fontScheme, including the script-specific overrides
# in a:font (a theme can name a different face per script tag).
#
# The four slots are resolved through the NORMAL cascade first (P3-06) - rFonts
# is a run property like any other and a slot can be inherited from the style
# chain while another is set directly. Resolving slots independently per level is
# what the cascade already does; do not re-implement it here.
```

**Done when.** A run containing Latin and CJK resolves two different families; `cstheme` resolves (a
fixture with only `cstheme` set produces the theme's bidi font); an ambiguous codepoint follows
`w:hint`; no code path exists that picks one family for a whole run.

---

### P4-02 — Per-character script selection

**Size** M · **Depends** P4-01 · **Escalate** no · `SPEC-GAP`

The codepoint-range rules that map a character to ASCII / hAnsi / eastAsia / cs. The boundaries are
**not fully normative** (`G2`): the standard describes the intent and Word's actual ranges are observed
behaviour. Mark it, write down the table's provenance, and say what was inferred.

```pseudo
# Broad shape of the mapping:
#   U+0000..U+007F               -> ascii
#   Latin-1 and Latin Extended   -> hAnsi (mostly)
#   CJK, Kana, Hangul, CJK punct -> eastAsia
#   Arabic, Hebrew, Syriac, Thaana -> cs
#   Devanagari and other Indic   -> cs
#   Ambiguous (general punctuation, some symbols) -> decided by w:hint
#
# w:cs / w:rtl on the run FORCE the cs slot regardless of codepoint - a run
# explicitly marked complex-script uses the cs font for everything in it.
```

**Done when.** The range table exists with its provenance recorded and a `SPEC-GAP` comment; `w:cs`
forces the cs slot; ambiguous ranges consult the hint; the table is data, not a chain of conditionals.

---

### P4-03 — `fontTable.xml` and PANOSE substitution

**Size** M · **Depends** P4-01 · **Escalate** no

`CT_Font`: `@name` plus `altName`, `panose1`, `charset`, `family`, `notTrueType`, `pitch`, `sig`
(`@usb0`–`@usb3`, `@csb0`–`@csb1` — Unicode and codepage coverage bitfields), and the four `embed*`
children (`P4-04`).

**The honest framing:** on the web, **the named font is usually absent**. Substitution is the normal
path, not the exception, and its quality determines how the whole editor looks. Say so in the ticket
rather than treating substitution as a fallback.

```pseudo
# Substitution order:
#   1. The embedded font, if present (P4-04) - always preferred, it is what the
#      author shipped
#   2. A locally available font with the same name
#   3. w:altName
#   4. PANOSE-nearest among available fonts, weighted: family type and serif
#      style dominate; weight and proportion next; the decorative digits rarely
#      help
#   5. The generic family from CT_Font/family + pitch
#
# w:sig's usb/csb bits say what the ORIGINAL font covered. Use them to reject
# substitutes that cannot render the text - a PANOSE-near font with no CJK
# coverage is a worse choice than a PANOSE-far one that has it.
#
# Metric compatibility matters more than shape similarity for LAYOUT: a
# substitute with different advances changes every line break. Where a known
# metric-compatible pair exists (the Liberation/Croscore families for the common
# Microsoft core fonts), prefer it over the PANOSE winner and record why.
```

**Done when.** Substitution prefers embedded, then exact, then `altName`, then PANOSE; a substitute
lacking the needed Unicode coverage is rejected via `w:sig`; the metric-compatible mappings are a
documented table with provenance; every substitution is recorded in the coverage manifest (`G4`) so a
document's rendering can be explained.

---

### P4-04 — Embedded font de-obfuscation (ODTTF)

**Size** S · **Depends** Phase 2 · **Escalate** no

`w:embedRegular` / `w:embedBold` / `w:embedItalic` / `w:embedBoldItalic` carry `r:id` to a font part
plus `@w:fontKey`, a GUID.

The obfuscation is a XOR of the **first 32 bytes** of the font file against the 16 bytes of the GUID,
applied twice (the 16-byte key covers 32 bytes as two passes). The part that is easy to get wrong is
the **byte order**: the GUID's string form is not its byte order — the first three fields are
little-endian and the last two are big-endian, so the key bytes must be derived from the GUID's binary
layout, not from stripping hyphens and reading pairs left to right.

`F5` applies: the PDF is unreadable here, so this cannot be checked against the prose. Verify against a
real embedded-font part instead, and **record in the ticket what the verification was** — a round-trip
that produces a font whose `sfnt` version tag reads `0x00010000` or `OTTO` is the decisive check,
because a wrong key produces noise in exactly those first bytes.

**Done when.** A real `.docx` with an embedded font yields a font whose sfnt tag validates; the byte
order derivation is documented; a wrong key is detected and reported rather than handed to `FontFace`.

---

### P4-05 — `FontFace` loading and FOUT mitigation

**Size** M · **Depends** P4-03, P4-04 · **Escalate** no

**The structural problem:** fonts load asynchronously; layout is synchronous. Something has to give.

```pseudo
# Policy (state it, do not leave it emergent):
#   - Lay out immediately with the best available metric-compatible fallback
#     (P4-03), never block the first paint.
#   - When a font resolves, mark every paragraph that used it dirty and relayout
#     through P6-13 - the incremental path, not a full document relayout.
#   - Track in-flight loads so a paragraph is not relaid out once per font.
#
# The alternative - block until fonts load - gives a blank page on slow networks
# and is worse. The cost of the chosen policy is visible reflow, which is
# acceptable and is what browsers do.
#
# A font that FAILS to load must invalidate the same paragraphs, so the fallback
# becomes permanent rather than leaving the document waiting.
```

**Done when.** First paint does not wait on fonts; a resolving font dirties only the paragraphs that
used it; a failing font settles to the fallback; loading the same font twice issues one request.

---

### P4-06 — Itemization

**Size** L · **Depends** P4-01, P4-02, P4-07 · **Escalate** no

Split a run into maximal sub-runs uniform in (font family, resolved face, size, script, bidi level,
feature set) — the unit the shaper accepts.

**Trap.** Itemizing by script alone. Two adjacent characters of the same script can still need
different sub-runs because they resolve to different faces or sit at different bidi levels. And
itemizing too finely destroys shaping: a ligature or a mark attachment that spans an itemization
boundary cannot form. Boundaries must be the _minimum_ set that the shaper requires.

**Done when.** A run mixing scripts, sizes and bidi levels itemizes into the minimum correct set; a
ligature that spans no boundary still forms; itemization is stable (the same input yields the same
boundaries every run, per `C1`'s spirit).

---

### P4-07 — UAX#9 bidi

**Size** L · **Depends** P4-06 · **Escalate** **yes**

**Goal.** Resolve embedding levels and reorder to visual order.

**Trap.** Implementing "reverse the RTL bits". UAX#9 is a real algorithm with explicit and implicit
levels, isolates (`LRI`/`RLI`/`FSI`/`PDI`), overrides, bracket pairing (BD16) and a rule set that
interacts with paragraph direction. Partial implementations handle pure-Arabic text correctly and fail
on Arabic containing Latin containing parentheses — which is most real Arabic documents. **There is a
conformance suite** (`BidiTest.txt`, `BidiCharacterTest.txt`); use it rather than fixtures of your own
invention.

**Escalate** because this is where the offset↔position 1:1 assumption breaks, which is the reason
`P6-01`'s position model is itself escalate.

```pseudo
# Inputs: w:bidi (paragraph base direction), w:rtl (run level), and the
# characters' own bidi classes.
#
# THE CONTRACT WITH PHASE 6, stated here because two phases depend on it:
#   - The shaper returns clusters in VISUAL order, each carrying its LOGICAL
#     source offset (P4-12, P5-01).
#   - Therefore srcOffset is NOT monotonic across an RTL run, and both orders are
#     recoverable: visual order is array order, logical order is srcOffset order.
#   - A single logical caret position can correspond to TWO visual positions at a
#     direction boundary. That ambiguity is resolved by affinity, which P6-01
#     owns. This ticket must not invent a second mechanism for it.
```

**Done when.** `BidiTest.txt` and `BidiCharacterTest.txt` pass; bracket pairing (BD16) is exercised;
isolates are handled; `w:bidi` sets the paragraph base level and `w:rtl` the run level; the
visual/logical contract above is written into the package's documentation, not just its code.

---

### P4-08 — Segmentation

**Size** M · **Depends** — · **Escalate** no

`Intl.Segmenter` for grapheme clusters (the caret's minimum movement unit, feeding `P6-07`) and word
boundaries (double-click selection, Ctrl+arrow).

**Constraint to state:** `Intl.Segmenter` provides grapheme, word and sentence segmentation — **not**
line-break opportunities. `P5-04` needs UAX#14, which is a separate table and a separate dependency.
Assuming `Intl.Segmenter` covers line breaking is a plausible mistake that produces breaks only at
spaces.

Locale matters: word segmentation for Thai, Lao, Khmer and Japanese is dictionary-based and
locale-dependent. Take the locale from `w:lang` (`@val`, `@eastAsia`, `@bidi`), not from the host
environment — the document says what language it is in.

**Done when.** Grapheme movement treats an emoji ZWJ sequence and a Devanagari cluster as single units;
word boundaries use the document's `w:lang`; the UAX#14 distinction is documented where a reader would
otherwise assume coverage.

---

### P4-09 — harfbuzzjs integration

**Size** L · **Depends** P4-06 · **Escalate** no

**The exception being spent.** The project's stated constraint is no WASM in the core. Decision D3
approves `harfbuzzjs` as the single exception. The justification belongs in the file:

`measureText` returns an advance width and nothing else — no glyph ids, no per-glyph positions, no
control over kerning or ligatures, no complex-script shaping. For Arabic it cannot produce contextual
forms; for Indic it cannot reorder; for any script it cannot report cluster boundaries. Those are not
quality gaps, they are correctness gaps, and there is no way to close them from the Canvas 2D API.
`opentype.js` can read the tables but its shaping is substantially weaker than HarfBuzz's, and shaping
is precisely the part that is hard. So: HarfBuzz, ~200 KB of WASM, loaded once.

```pseudo
# Practical shape of the integration:
#   - one WASM instance, one font-blob cache keyed by face (fonts are uploaded to
#     WASM memory once, never per shape call)
#   - buffer reuse: allocate one buffer and reset it, never one per run - this is
#     the allocation that shows up in a profile
#   - feature tags from run properties: 'liga'/'clig' off when w:ligatures says
#     so, 'kern' gated by P5-10's threshold, plus script-required features
#   - variable-font axes where present
#   - the WASM module load is async; P4-05's policy covers the interim
```

**Done when.** Arabic renders with correct contextual forms; a Devanagari cluster reorders correctly; a
font blob is uploaded once per face (asserted by a counter); buffers are reused; the bundle-size cost
is measured and recorded against the D3 justification.

---

### P4-10 — The `measureText` fast path

**Size** M · **Depends** P4-09 · **Escalate** **yes**

**Goal.** Use the cheap path where it is provably correct.

**Trap.** The predicate. `measureText` is much faster than shaping and is correct for a narrow class of
runs. If the predicate is too permissive, Arabic or Indic or ligature-bearing text takes the fast path
and is **silently mis-shaped** — no error, no diagnostic, just wrong glyphs and wrong advances that
propagate into line breaks and pagination. This is the escalate-worthy part: the failure is invisible
and it is invisible in exactly the languages the developer cannot read.

```pseudo
# A run is fast-path eligible ONLY IF ALL of:
#   - every codepoint is in a script with no complex shaping (Latin, Greek,
#     Cyrillic - and NOT via a blocklist of complex scripts; use an ALLOWLIST, so
#     an unrecognised script defaults to the slow, correct path)
#   - no combining marks
#   - bidi level is uniform and LTR
#   - no ligature-forming pairs, OR ligatures are explicitly disabled for the run
#   - w:kern is absent or below the run's size (P5-10)
#   - character w:spacing and w:w are absent
#   - the font has no mandatory required-feature table for this script
#   - we need only the ADVANCE, not glyph positions - i.e. the caller is
#     measuring for a break candidate, not shaping for paint
#
# Allowlist, not blocklist. A blocklist is wrong the first time a script is
# added to Unicode; an allowlist is merely slow.
#
# Verification: a differential test that shapes a corpus BOTH ways and asserts
# the advances agree for every fast-path-eligible run. That test is the ticket's
# real deliverable - the predicate cannot be reviewed into correctness.
```

**Done when.** The predicate is an allowlist; the differential test runs over a multi-script corpus and
agrees to within a stated tolerance on every eligible run; an unrecognised script takes the slow path;
the fast-path hit rate is reported.

---

### P4-11 — The measurement cache

**Size** L · **Depends** P4-09, P4-10 · **Escalate** **yes** · `HOT-PATH`

**Goal.** The hottest data structure in the system. Design it before anything depends on it.

**Trap.** Allocating the key. A cache whose key is a template string built per lookup allocates on
every measurement, and measurement happens per break candidate per line per relayout. The allocation
costs more than the cache saves. The key must be a number or an interned handle, computed without
building a string.

```pseudo
CacheKey <- (faceId, sizeInHalfPoints, featureSetId, textHandle)
    # faceId and featureSetId are interned integers assigned at resolution time
    # (P4-01, P4-09), not strings.
    # textHandle: for short runs, the text itself is the key via an interning
    # table; for long runs, a content hash. Both avoid re-hashing per lookup by
    # caching the handle on the shaped run.

# Two tiers, because they have different lifetimes:
#   L1: shaped runs, keyed as above. Invalidated by font load (P4-05) and by
#       edits to the run's text.
#   L2: whole-line measurements for the break loop's candidates. Invalidated
#       whenever L1 is, plus on width change.
#
# Eviction: LRU with a MEMORY bound, not an entry-count bound - a cached CJK
# paragraph is orders of magnitude larger than a cached word. Measure entry size.
#
# Reporting: hit rate, entry count and bytes must be observable at runtime. A
# cache whose hit rate nobody can see is a cache nobody can tune, and this is the
# one component where a regression is a user-visible frame drop rather than a
# failing test.
```

**Done when.** No allocation occurs on a cache hit (asserted by an allocation counter over 10,000
lookups); eviction is memory-bounded and the bound is enforced; hit rate is reported and is above a
stated threshold on a representative document; a font load invalidates exactly the affected entries.

---

### P4-12 — Shaped-run representation

**Size** L · **Depends** P4-09, P4-07 · **Escalate** **yes**

**Goal.** The structure handed across the `text` → `layout` boundary.

**Trap.** Designing it for the shaper's convenience. It is consumed by `P5-01`'s line box, which
copies clusters into segments, and both sides are hot. A representation that requires transformation at
the boundary pays that cost per line per relayout.

```pseudo
ShapedRun = {
    faceId:    int,                 # interned (P4-11)
    size:      HalfPoint,
    direction: LTR | RTL,
    script:    ScriptTag,
    clusters:  packed numeric storage, NOT an array of objects
                                    # per cluster: glyph ids, x-advance,
                                    # x/y-offset, srcOffset, srcLength
    totalAdvance: Twips,            # precomputed; the break loop asks for this
                                    # constantly and must not sum per query
}

# Requirements the ADR must state:
#   - Clusters in VISUAL order, srcOffset in LOGICAL order (P4-07's contract).
#   - srcOffset/srcLength tile the source with no gaps or overlaps, so
#     offset -> cluster is a binary search (P5-01 depends on this).
#   - Sub-run slicing must be O(1) and allocation-free: the break loop measures
#     prefixes constantly. A prefix is a (start, end) pair over the same storage,
#     never a copy.
#   - The storage layout is shared with P5-01's Cluster so the line box can
#     reference or memcpy rather than transform. Decide the layout ONCE, in
#     whichever of the two ADRs lands first, and have the other cite it.
```

**Done when.** Prefix measurement allocates nothing; `offset → cluster` is a binary search; the storage
layout is identical to `P5-01`'s and one ADR cites the other; a round-trip through the boundary
requires no transformation step.

---

### P4-13 — Font metrics

**Size** M · **Depends** P4-09 · **Escalate** no · `SPEC-GAP` `UNVERIFIABLE-HERE`

**Goal.** Pick ascent, descent and line gap — and pick them once.

**Trap.** There are **three** competing metric sets in every OpenType font: `hhea` (ascender/descender/
lineGap), `OS/2` typo metrics (sTypoAscender/Descender/LineGap), and `OS/2` win metrics
(usWinAscent/usWinDescent). They disagree, sometimes substantially. Which one is used shifts **every
line in the document**, so this is not a detail — it is a document-wide constant.

The `USE_TYPO_METRICS` bit (`OS/2` fsSelection bit 7) is supposed to settle it and is frequently unset
on fonts that nonetheless expect typo metrics.

Per `G1` the answer is "whatever Word does", and per `F6` we cannot measure what Word does on this
machine. So: choose, mark `SPEC-GAP`, record the reasoning, carry the `UNVERIFIABLE-HERE` label, and
make the choice a **single named constant** so that when someone can compare against Word, one change
fixes the whole document.

**Done when.** The choice is one named, documented constant; `USE_TYPO_METRICS` is read and its
handling recorded; the `SPEC-GAP` comment states the reasoning; the phase report carries the
`UNVERIFIABLE-HERE` caveat.

---

### P4-14 — Vertical text and CJK metrics

**Size** M · **Depends** P4-09, P4-13 · **Escalate** no

`CT_EastAsianLayout`: `@id`, `@combine`, `@combineBrackets`, `@vert`, `@vertCompress`.

```pseudo
# @combine     - horizontal-in-vertical (several chars occupying one em)
# @combineBrackets - the bracket style wrapping combined text
# @vert        - rotate the run within vertical text
# @vertCompress- compress punctuation in vertical layout
#
# Vertical metrics come from vhea/vmtx where present, and must be SYNTHESISED
# where absent - most Latin fonts have no vertical metrics at all, and a CJK
# document with embedded Latin needs them.
#
# Full-width vs proportional forms, and the vertical substitution features
# ('vert', 'vrt2') which the shaper applies only when told the run is vertical -
# so P4-06's itemization must carry orientation, not just script.
#
# This ticket supplies what P9-16's a:bodyPr/@vert and P7-11's w:textDirection
# both need. All three must agree on one orientation model rather than each
# carrying its own.
```

**Done when.** `vert`/`vrt2` features apply in vertical runs; missing `vhea`/`vmtx` are synthesised;
`@combine` renders within one em with the right brackets; the orientation model is shared with `P7-11`
and `P9-16` (asserted by there being one definition, referenced three times).

---

## Phase 4 exit criteria

1. All tickets closed per their **Done when** clauses.
2. `BidiTest.txt` and `BidiCharacterTest.txt` pass in CI — bidi is the one part of this phase with an
   external conformance suite, and not running it is a choice to be less correct than we could be.
3. The `P4-10` differential test (fast path vs shaped path) runs over a multi-script corpus and agrees
   on every eligible run.
4. The measurement cache reports hit rate, entry count and bytes at runtime, and allocates nothing on a
   hit.
5. `P4-12`'s storage layout and `P5-01`'s are the same layout, with one ADR citing the other.
6. The harness renders Latin, Arabic and CJK samples with correct advances and reports the cache hit
   rate. Per `F6` the phase report says the rendering is unverified against Word or LibreOffice.
7. The D3 WASM exception is justified in the file with its measured bundle cost, not merely asserted.
