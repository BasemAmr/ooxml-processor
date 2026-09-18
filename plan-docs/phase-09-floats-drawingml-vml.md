# Phase 9 — Floats, DrawingML, VML

> **Difficulty rank 3 of 11.**
>
> **Depends on** Phase 5 (line boxes must already support segmented lines), Phase 8 (reuses the
> fixpoint driver from `P8-06`).
>
> **Owns** `packages/layout/src/floats/`, `packages/dml/`, `packages/paint/src/shapes/`.

## Why this phase ranks here

Three separate reasons compound:

1. **Surface area.** `dml-main` alone is 828 named types, plus 92 in `dml-wordprocessingDrawing`, 170
   in VML, and 187 preset geometries. This is the largest single block of the format.
2. **A second fixpoint.** A float's position can depend on the text it displaces — an anchor positioned
   relative to `line` or `paragraph` moves when wrapping pushes that line, which changes the wrapping.
   Same class of problem as footnotes, same driver.
3. **A small compiler.** The preset geometry system is a stack-free expression language with 17
   operators and ~60 built-in variables, evaluated per shape per layout. It has to be compiled once,
   not interpreted from XML on every paint.

**Explicitly deferred (tracked in the coverage manifest as placeholders, per `G3` and `G4`):** charts
(`dml-chart`, 659 defs) and SmartArt (`dml-diagram`, 260 defs). They round-trip losslessly and render
as labelled placeholders. Do not start them in this phase.

---

## Ticket index

| ID | Title | Size | Escalate |
|---|---|---|---|
| **Floats and wrapping** ||||
| P9-01 | Anchor model: inline vs anchored, position resolution | L | yes |
| P9-02 | Exclusion region store | L | **yes** |
| P9-03 | Wrap modes | M | no |
| P9-04 | Polygon wrapping: `wrapPolygon` ∩ line band | L | no |
| P9-05 | Line-segment integration into layout | L | **yes** |
| P9-06 | Anchor ⇄ wrap fixpoint | L | **yes** |
| P9-07 | `w:framePr` legacy text frames | M | no |
| **DrawingML** ||||
| P9-08 | Shape tree and the transform stack | L | no |
| P9-09 | Guide/formula evaluator | L | no |
| P9-10 | Preset geometry compiler | L | no |
| P9-11 | `a:custGeom` → path | M | no |
| P9-12 | Fills | L | no |
| P9-13 | Lines (`a:ln`) | M | no |
| P9-14 | Colour pipeline | M | **yes** |
| P9-15 | Effects, with a cost budget | L | no |
| P9-16 | `a:txBody` layout | L | no |
| P9-17 | Images and `a:blip` | M | no |
| **Legacy and fallback** ||||
| P9-18 | VML rendering | L | no |
| P9-19 | MCE preference: DrawingML over VML | S | no |
| P9-20 | Chart and SmartArt placeholders | S | no |

---

## Floats and wrapping

### P9-01 — Anchor model

**Size** L · **Depends** P5-01 · **Escalate** yes

**Goal.** Resolve every drawing's position to page coordinates.

**Trap.** Treating `wp:anchor` as "absolutely positioned at `positionH/positionV` offsets". Position is
expressed **relative to one of eight reference frames**, in either an *align* form or an *offset* form,
and the two axes can use different frames. `relativeFrom="line"` and `"paragraph"` and `"character"`
resolve against text that has not been laid out yet at the time the anchor is read — which is what
creates the fixpoint in `P9-06`.

**Design.**

```pseudo
# wp:inline  -> occupies an inline box in the line. No exclusion, no anchor.
#               Treated as a very large "glyph" by P5-02. Not a float at all.
# wp:anchor  -> a float.

AnchorSpec = {
    simplePos:  bool,                     # if true, use wp:simplePos x/y in EMU, ignore H/V
    h: { relativeFrom: margin|page|column|character|leftMargin|rightMargin
                      |insideMargin|outsideMargin,
         form: ALIGN('left'|'right'|'center'|'inside'|'outside') | OFFSET(Emu) },
    v: { relativeFrom: margin|page|paragraph|line|topMargin|bottomMargin
                      |insideMargin|outsideMargin,
         form: ALIGN('top'|'bottom'|'center'|'inside'|'outside') | OFFSET(Emu) },
    behindDoc:    bool,
    allowOverlap: bool,
    layoutInCell: bool,
    relativeHeight: uint,                 # z-order
    dist: { T, B, L, R: Emu },
    wrap: WrapMode,                       # P9-03
    anchorPos: DocPos                     # where the <w:drawing> run sits
}

fn resolveAnchor(spec, ctx) -> Rect
    # ctx carries: page geometry, column rects, the anchor paragraph's laid-out
    # rect, the anchor line's rect, the anchor character's x.
    # 'inside'/'outside' depend on page parity when mirrorMargins is on.
    # PROVISIONAL on first pass: paragraph/line/character frames are not known
    # until text is laid out. Use the pre-float layout as the seed; P9-06 iterates.
```

**Done when.** A fixture exercising all eight `relativeFrom` values on each axis, in both align and
offset form, resolves to expected page coordinates; `simplePos` overrides both axes; `inside`/`outside`
flip on even pages with mirrored margins.

---

### P9-02 — Exclusion region store

**Size** L · **Depends** P9-01 · **Escalate** **yes** · **Owns** `packages/layout/src/floats/exclusions.ts`

**Goal.** The per-page structure layout queries to ask "what horizontal space is available at this
vertical band?"

**Trap.** Storing exclusions as a list and scanning it per line. It is queried once per line per
layout pass, inside the fixpoint, inside incremental relayout — three nested multipliers. `HOT-PATH`.

Second trap: forgetting that `behindDoc` floats do **not** exclude. A float behind the text still has a
rect and a z-order, but contributes nothing to wrapping. Neither does `wrapNone`.

**Design.**

```pseudo
ExclusionStore per page:
    # bands sorted by top; each band lists occupied x-intervals
    bands: sorted array of { top, bottom, intervals: [x0,x1][] }

fn availableSegments(y, height, containerRect) -> Segment[]
    # returns the free x-intervals for a line box occupying [y, y+height)
    occupied <- union of intervals from every band overlapping [y, y+height)
    return containerRect.x-range minus occupied

# Contributors: a float contributes iff
#     wrap != None  AND  not behindDoc  AND  (layoutInCell or not inside a cell)
# Each contributed rect is INFLATED by distT/B/L/R before insertion.
#
# allowOverlap=false: two floats may not overlap each other. Resolve by
# pushing the LATER (higher relativeHeight) one down until clear.
# Deterministic: sort by (relativeHeight, anchorPos) before resolving, never
# by iteration order over a map (C1).
```

**Done when.** `availableSegments` is O(log n + k) not O(n); a `behindDoc` float produces no exclusion;
`allowOverlap=false` displaces deterministically across 100 runs; two floats at the same
`relativeHeight` order by anchor position.

---

### P9-03 — Wrap modes

**Size** M · **Depends** P9-02 · **Escalate** no

```pseudo
# wrapNone         no exclusion at all; text runs under/over the shape
# wrapSquare       exclude the shape's bounding box + dist*
# wrapTight        exclude the wrapPolygon (P9-04), text may enter concavities
# wrapThrough      as tight, but text may also enter interior holes of the polygon
# wrapTopAndBottom exclude the FULL container width for the shape's vertical band
#
# wrapSquare/@wrapText = bothSides | left | right | largest
#   'largest' keeps text only on whichever side has more room - which side that
#   is depends on the resolved position, so it is decided per page, not once.
#
# Tight vs Through differ ONLY in interior holes. If the polygon is convex they
# are identical. Do not implement Through as a synonym - a picture with a hole
# is exactly when a user notices.
```

**Done when.** Each of the five modes produces the expected exclusion on a fixture; `wrapText=largest`
picks the larger side; `wrapTopAndBottom` excludes full width.

---

### P9-04 — Polygon wrapping

**Size** L · **Depends** P9-03 · **Escalate** no

**Goal.** Convert `wp:wrapPolygon` into per-line x-intervals.

**Trap.** Treating the polygon as a bounding box for lines that only partially overlap it. The whole
point of tight wrapping is that a line near the shape's narrow end gets more space than one at its
widest. The intersection must be computed **per line band**, not per shape.

**Design.**

```pseudo
# wrapPolygon coordinates are in a 0..21600 space relative to the shape extent,
# NOT in EMU. Scale by (extent / 21600) before use.

fn polygonIntervalsForBand(poly, yTop, yBottom) -> [x0,x1][]
    # scanline: intersect every polygon edge with yTop and with yBottom, and
    # include every vertex whose y falls inside the band.
    # The band's occupied interval is [min x, max x] of those points for a
    # SOLID polygon (tight). For 'through', keep the individual spans between
    # crossings so interior holes stay free.
    xs <- edge crossings at yTop and yBottom, plus vertices inside the band
    if mode == TIGHT:   return [[min(xs), max(xs)]]
    if mode == THROUGH: return pairwiseSpans(sort(xs))    # even-odd fill rule

# Use the BAND (line top to line bottom), not the baseline. Using the baseline
# lets tall glyphs overlap the shape.
```

**Done when.** A triangular polygon gives progressively wider free space toward its apex; a
donut-shaped polygon in `through` mode leaves the interior available; a polygon fully inside one line
band excludes correctly.

---

### P9-05 — Line-segment integration

**Size** L · **Depends** P9-02, P5-01, P5-03 · **Escalate** **yes**

**Goal.** Line layout consumes *segments*, not a single width.

**Trap.** This is a change to the **line box's core shape** (`P5-01`), not an addition to it. If Phase 5
defines a line as having one `width`, retrofitting segments here means touching every consumer —
justification, tab stops, hit-testing, selection geometry, caret placement. **`P5-01` must define the
line as a list of segments from the start, with the common case being a list of one.** This ticket
exists to make that dependency explicit; if it is discovered here, Phase 5 was wrong.

**Design.**

```pseudo
# Greedy fill across segments:
fn layoutLine(y, height, items) -> Line
    segs <- exclusions.availableSegments(y, height, container)
    if segs is empty:
        # fully excluded band - advance y past the exclusion and retry.
        # Bound the retries; a float taller than the page must not loop.
        return SKIP_BAND
    place items into segs left-to-right (or right-to-left in RTL),
      breaking to the next segment when the current one fills,
      and to the next line when segments are exhausted.

# Height feedback: a line's height is not known until its items are placed, but
# availableSegments needs the height. Resolve by:
#   1. query with the paragraph's provisional line height
#   2. place items, compute real height
#   3. if the real height crosses into a different exclusion band, re-query and
#      re-place ONCE. Do not iterate further - a second re-query that changes
#      the band again is vanishingly rare and not worth the unbounded loop.
#      Record a diagnostic if it happens.
```

**Done when.** A line beside a left-anchored float starts at the float's right edge; a line between two
floats splits into two segments and text flows into both; justification distributes within each
segment independently; a fully-excluded band advances rather than looping.

---

### P9-06 — Anchor ⇄ wrap fixpoint

**Size** L · **Depends** P9-01, P9-05, P8-06 · **Escalate** **yes**

**Goal.** Converge positions for anchors whose reference frame is text that the anchor itself moves.

**Trap.** Not noticing the cycle exists. An anchor with `relativeFrom="paragraph"` and `wrapSquare`
sits beside its paragraph; wrapping narrows the paragraph, which can make it taller, which moves the
paragraph's top if a preceding float also moved — and the anchor follows. Documents with two
overlapping anchored images in one paragraph oscillate routinely.

**Design.**

```pseudo
step = (positions) ->
    exclusions.rebuildFrom(positions)
    layoutTextOfAffectedParagraphs()             # P9-05
    return resolveAllAnchors()                   # P9-01, now with real paragraph/line rects

r <- fixpoint(initial = resolveAllAnchors(preFloatLayout),
              step,
              key = positions -> join(quantiseToTwips(p) for p in sorted(positions)),
              maxIters = 8)                      # reuse P8-06 verbatim

if not r.converged:
    # Deterministic fallback: the cycle's lowest key, as P8-06 already returns.
    # Log document + anchor ids. A slightly-off image is acceptable; a hang is not.
```

**Scope the loop.** Only anchors whose `relativeFrom` is `character`, `line`, `paragraph`, or `column`
participate. `page` and `*Margin` frames are independent of text and resolve once — do not put them in
the loop, they are the majority and they make it cheap.

**Done when.** Two overlapping paragraph-anchored images converge or terminate as `oscillated` with an
identical result across 100 runs; page-anchored floats are resolved outside the loop (asserted by an
iteration counter); the corpus reports zero unconverged anchors, or each one is logged and triaged.

---

### P9-07 — `w:framePr` legacy text frames

**Size** M · **Depends** P9-02 · **Escalate** no

Pre-DrawingML floating paragraphs. `@w`/`@h`, `@hAnchor`/`@vAnchor` (`text`|`margin`|`page`),
`@x`/`@y` or `@xAlign`/`@yAlign`, `@wrap` (`auto`|`around`|`none`|`notBeside`|`through`|`tight`),
`@hSpace`/`@vSpace`, `@dropCap`/`@lines` (drop caps are implemented as frames).

Consecutive paragraphs with **identical** `framePr` form **one** frame. Treating them as separate
frames stacks them on top of each other.

**Done when.** A two-paragraph frame renders as one block; a `dropCap` frame positions the cap
correctly; wrap modes map onto the P9-03 machinery.

---

## DrawingML

### P9-08 — Shape tree and the transform stack

**Size** L · **Depends** P9-01 · **Escalate** no

**Design.**

```pseudo
# wp:inline/wp:anchor -> a:graphic -> a:graphicData -> pic:pic | wpg:wgp | wps:wsp | ...
#
# a:xfrm = { off: {x,y}, ext: {cx,cy}, rot: Degree60k, flipH, flipV }
# Group shapes add chOff/chExt: children are authored in a child coordinate
# space that is mapped onto the group's extent.
#
fn childTransform(group) -> Matrix
    sx <- group.ext.cx / group.chExt.cx        # guard chExt == 0
    sy <- group.ext.cy / group.chExt.cy
    return translate(group.off) * scale(sx,sy) * translate(-group.chOff)

# Order within a shape's own transform, applied to canvas state:
#   translate(off + ext/2) -> rotate(rot) -> scale(flipH?-1:1, flipV?-1:1)
#   -> translate(-ext/2)
# ROTATION IS ABOUT THE CENTRE, not the origin. Rotating about the origin is
# the classic error and it looks almost right for small angles.
#
# Units: EMU, 914400 per inch. Angles in 60000ths of a degree.
# canvas rotate() takes radians: rad = deg60k / 60000 * PI / 180
```

**Done when.** A rotated shape rotates about its centre; a flipped shape mirrors without moving; a
nested group with non-unit `chExt` scales children correctly; a group inside a group composes.

---

### P9-09 — Guide/formula evaluator

**Size** L · **Depends** — · **Escalate** no · **Owns** `packages/dml/src/geometry/guides.ts`

**Goal.** Evaluate the `a:gd` expression language that drives every preset and custom geometry.

**Trap.** Evaluating from XML on every paint. Guides are evaluated per shape per layout pass; a preset
like `roundRect` has ~10 guides, `star24` has ~50. Parse once into a closure or an op array, cache by
`(presetName, adjustValues, w, h)`.

**Design.**

```pseudo
# <a:gd name="x1" fmla="*/ w 1 2"/>  -> name = f(args)
# Args are: a number, a built-in variable, an adjust value (adj1..), or a
# previously-defined guide name. Evaluation order is DOCUMENT ORDER - a guide
# may only reference guides defined before it. Do not sort or topologically
# reorder; the spec guarantees the order and a cyclic reference is a defect.

OPERATORS (all 17):
  */  x y z   -> x * y / z            +-  x y z   -> x + y - z
  +/  x y z   -> (x + y) / z          ?:  x y z   -> x > 0 ? y : z
  val x       -> x                    abs x       -> |x|
  sqrt x      -> sqrt(x)              max x y     -> max
  min x y     -> min                  mod x y z   -> sqrt(x^2+y^2+z^2)
  pin x y z   -> y < x ? x : (y > z ? z : y)
  sin x y     -> x * sin(y)           cos x y     -> x * cos(y)
  tan x y     -> x * tan(y)           # y in 60000ths of a degree
  at2 x y     -> arctan2(y, x)  in 60000ths of a degree
  cat2 x y z  -> x * cos(arctan2(z, y))
  sat2 x y z  -> x * sin(arctan2(z, y))

BUILT-IN VARIABLES:
  w h                       shape extent
  l t r b                   0, 0, w, h
  hc vc                     w/2, h/2
  ss ls                     min(w,h), max(w,h)
  hd2 hd3 hd4 hd5 hd6 hd8 hd10 hd12         h / n
  wd2 .. wd32                               w / n
  ssd2 .. ssd32                             ss / n
  cd2 cd4 cd8               10800000, 5400000, 2700000   (180deg, 90deg, 45deg in 60k)
  3cd4 5cd8 7cd8            16200000, 13500000, 18900000
  # Names beginning with a digit are legal here and are a reliable way to break
  # a naive identifier regex.

# All arithmetic in FLOATING POINT, results kept as floats. The spec's integer
# framing loses precision on chained guides; rounding happens once, at path
# construction.
```

**Done when.** Each of the 17 operators has a unit test with hand-computed expected values; the `3cd4`
family parses; a preset with 50 chained guides evaluates in under a documented budget; results are
cached and the cache key includes adjust values.

---

### P9-10 — Preset geometry compiler

**Size** L · **Depends** P9-09 · **Escalate** no

**Goal.** Compile the 187 shapes in `presetShapeDefinitions.xml` into a generated module, at build time.

**Trap.** Parsing the 2 MB preset XML at runtime. It is static data; it belongs in the codegen output,
under the same determinism gate (`C1`).

**Design.**

```pseudo
# Build step (extends packages/codegen): read presetShapeDefinitions.xml ->
# emit packages/dml/src/generated/presets.ts as data, not code:
#
#   PRESETS = {
#     roundRect: {
#       avLst:  [{ name:'adj', fmla:'val 16667' }],
#       gdLst:  [{ name:'a', fmla:'pin 0 adj 50000' }, ...],
#       ahLst:  [...],        # adjust handles - needed for editing, not painting
#       cxnLst: [...],        # connection sites - needed for connectors
#       rect:   { l:'l', t:'t', r:'r', b:'b' },     # text inset rect, as guide names
#       pathLst:[ { w, h, fill, stroke, extrusionOk,
#                   cmds: [ {op:'moveTo', pts:[...]}, {op:'arcTo', wR,hR,stAng,swAng}, ... ] } ]
#     }, ...
#   }
#
# The guide/adjust/path fields stay as EXPRESSION STRINGS. They are evaluated
# per instance by P9-09 because they depend on w/h/adjustments.
#
# Path ops: moveTo, lnTo, arcTo, quadBezTo, cubicBezTo, close.
# arcTo is the awkward one: it is an ELLIPTICAL arc given as
# (wR, hR, stAng, swAng) in 60000ths of a degree, starting from the CURRENT
# POINT - the centre is implied. Canvas has ellipse(cx,cy,...), so the centre
# must be back-computed:
#     cx = curX - wR*cos(stAng)  ;  cy = curY - hR*sin(stAng)
# Getting this wrong shifts every rounded corner and every pie slice.
```

**Done when.** `pnpm gen` emits all 187 presets; `git diff --exit-code` is clean on a second run;
`rect`, `roundRect`, `ellipse`, `triangle`, `star5`, `rightArrow` and `wedgeRoundRectCallout` render
to paths matching hand-computed control points; `arcTo` centre derivation is unit-tested.

---

### P9-11 — `a:custGeom` → path

**Size** M · **Depends** P9-10 · **Escalate** no

Same path-op machinery as presets, but the geometry is inline in the document. Reuses the evaluator
and the path builder; the only new work is reading `a:custGeom`'s own `gdLst`/`pathLst` and honouring
per-path `@w`/`@h` (a local coordinate space scaled onto the shape extent) and `@fill`/`@stroke`.

**Done when.** A `custGeom` with two subpaths, one filled and one stroke-only, renders correctly;
per-path `@w`/`@h` scaling is applied.

---

### P9-12 — Fills

**Size** L · **Depends** P9-14 · **Escalate** no

```pseudo
# a:noFill | a:solidFill | a:gradFill | a:pattFill | a:blipFill | a:grpFill
#
# gradFill:
#   a:gsLst - stops with @pos in 1000ths of a percent (100000 = 100%)
#   a:lin @ang (60000ths deg) @scaled  -> canvas createLinearGradient
#   a:path @path=shape|circle|rect + a:fillToRect -> canvas createRadialGradient
#        (only an approximation for 'shape'; SPEC-GAP - a shape-following
#         gradient has no canvas primitive. Approximate with a radial gradient
#         centred on fillToRect and say so.)
#   a:tileRect, @rotWithShape
#
# pattFill @prst (48 preset patterns) + a:fgClr/a:bgClr
#   -> render an 8x8 tile to an offscreen canvas once, cache by
#      (prst, fg, bg, dpr), use createPattern. Do NOT redraw per paint.
#
# blipFill:
#   a:blip r:embed -> an OPC relationship -> image part (Phase 2)
#   a:srcRect l/t/r/b in 1000ths percent -> CROP before drawing
#   a:stretch/a:fillRect  -> stretch to the (possibly inset) rect
#   a:tile @tx @ty @sx @sy @flip @algn -> createPattern with a transform
#   @rotWithShape on gradients and tiles decides whether the fill rotates with
#   the shape or stays axis-aligned. Default differs between the two - read it,
#   do not assume.
```

**Done when.** Each fill kind renders on a fixture; `srcRect` crops; a tiled fill with `flip="xy"`
mirrors alternate tiles; pattern tiles are cached (asserted by a creation counter).

---

### P9-13 — Lines (`a:ln`)

**Size** M · **Depends** P9-14 · **Escalate** no

`@w` (EMU), `@cap` (`rnd`|`sq`|`flat`), `@cmpd` (`sng`|`dbl`|`thickThin`|`thinThick`|`tri`),
`@algn` (`ctr`|`in`), `a:prstDash` (16 presets) or `a:custDash`, `a:round`/`a:bevel`/`a:miter`,
`a:headEnd`/`a:tailEnd` (arrow `@type`, `@w`, `@len`).

**Trap.** `@cmpd` compound lines are **not** a single stroke with a wider width — `dbl` is two parallel
strokes with a gap. Canvas has no primitive; offset the path. Arrowheads likewise must be drawn as
filled paths, and the line must be **shortened** by the arrowhead length or it pokes through the tip.

**Done when.** All five `@cmpd` values render distinctly; dash presets map to `setLineDash` arrays
scaled by line width; an arrowed line does not protrude past its arrowhead.

---

### P9-14 — Colour pipeline

**Size** M · **Depends** P3-10 (theme) · **Escalate** **yes**

**Trap.** Applying transforms in the order they are convenient. **The order is normative and fixed.**
Applying `shade` before `lumMod` gives a different colour. Nobody notices until a designer opens a
themed document and every accent colour is subtly wrong across every shape — at which point the bug is
in 40 places.

**Design.**

```pseudo
# Colour sources:
#   a:srgbClr @val        a:sysClr @val @lastClr      a:prstClr @val (140 names)
#   a:schemeClr @val      -> theme lookup (P3-10). Note the mapping indirection:
#                            'tx1'/'bg1'/'tx2'/'bg2' are resolved through
#                            a:clrMapOvr / the slide-or-doc colour map to
#                            dk1/lt1/dk2/lt2. Skipping the map inverts light
#                            and dark themed colours.
#   a:hslClr, a:scrgbClr
#
# TRANSFORM ORDER - apply exactly this sequence, skipping absent ones:
#     1. lumMod    2. lumOff    3. shade    4. tint
#     5. alpha     6. satMod    7. hueMod
#   (plus alphaMod/alphaOff, lumMod/lumOff pairs, comp/inv/gray/gamma/invGamma
#    in their declared positions)
#
# Percentages are in 1000ths of a percent: 60000 = 60%.
# shade/tint operate in LINEAR light, not sRGB. Converting in sRGB gives
# visibly different mid-tones. Convert -> transform -> convert back.
```

**Done when.** A unit test applies `lumMod 60000` + `shade 50000` and matches a hand-computed value;
reversing the order produces a different value (proving the order is actually honoured); `schemeClr
tx1` resolves through the colour map; all 140 `prstClr` names resolve.

---

### P9-15 — Effects, with a cost budget

**Size** L · **Depends** P9-12 · **Escalate** no

`a:outerShdw`, `a:innerShdw`, `a:glow`, `a:reflection`, `a:softEdge`, `a:blur`, `a:prstShdw`.

**Trap.** Rendering effects inline on the page canvas. `shadowBlur` on a large shape is a
multi-millisecond operation, and `innerShdw`/`softEdge`/`reflection` need offscreen compositing
(`globalCompositeOperation` with a scratch canvas) — doing that on the page canvas corrupts everything
already drawn.

**Design.**

```pseudo
# Every effect renders into a scratch canvas sized to the shape's bounds plus
# the effect's bleed, then composites once. Scratch canvases are POOLED.
#
# Cost budget, enforced:
#   - per-shape effect budget in estimated pixels; over budget -> degrade,
#     do not skip silently (G3):
#       blur radius > N  -> clamp to N
#       reflection       -> render at half resolution and upscale
#       > K effects on one shape -> render the first K, report a diagnostic
#   - a document-wide effect budget per frame; exceeded -> render remaining
#     shapes without effects this frame and schedule them for the next
#
# outerShdw: offset from @dist/@dir (dir in 60000ths deg), @blurRad, @algn,
#            @rotWithShape, colour through P9-14.
# innerShdw/softEdge: composite 'destination-in'/'destination-out' on scratch.
# reflection: flip vertically, apply an alpha gradient, composite below.
```

**Done when.** Each effect renders; effects never draw outside their scratch canvas onto unrelated page
content; the budget degrades rather than skipping; scratch canvases are pooled (asserted by an
allocation counter over 100 shapes).

---

### P9-16 — `a:txBody` layout

**Size** L · **Depends** Phase 5, P9-10 · **Escalate** no

**Goal.** Text inside shapes.

**Trap.** Reusing the WML paragraph layout directly. Shape text uses **DrawingML** paragraph and run
properties (`a:pPr`, `a:rPr`, `a:defRPr`, list levels `lvl1pPr`..`lvl9pPr` from the theme's
`a:lstStyle`), not `w:pPr`/`w:rPr`. The *layout engine* is shared; the *property resolution* is not.

**Design.**

```pseudo
# a:bodyPr: @lIns @tIns @rIns @bIns (EMU, defaults 91440/45720/91440/45720)
#           @anchor = t|ctr|b|just|dist       vertical anchoring
#           @anchorCtr                        horizontal centring of the text block
#           @wrap = square|none
#           @vert = horz|vert|vert270|wordArtVert|eaVert|mongolianVert|wordArtVertRtl
#           @rot, @upright, @numCol, @spcCol
#           a:normAutofit @fontScale @lnSpcReduction   (1000ths of a percent)
#           a:spAutoFit   -> the SHAPE grows to fit the text
#
# normAutofit is applied by Word at authoring time and the scale is STORED.
# Do NOT recompute it on open - recomputing changes the rendering of a document
# nobody edited. Apply the stored @fontScale and @lnSpcReduction as given.
# Recompute only when our own editing changes the text (Phase 10 concern).
#
# @vert rotates the text FLOW, not just the glyphs: vert270 lays lines
# bottom-to-top with each line rotated. eaVert keeps CJK upright while rotating
# Latin. This is a layout-axis swap, not a canvas rotate.
```

**Done when.** Insets apply; `anchor=ctr` centres vertically; a stored `normAutofit` scale is applied
verbatim and not recomputed; `vert270` lays out along the correct axis; theme list styles cascade into
`a:pPr`.

---

### P9-17 — Images and `a:blip`

**Size** M · **Depends** Phase 2 · **Escalate** no

```pseudo
# r:embed -> relationship -> part. Decode via createImageBitmap, cache by part
# name + srcRect. Never decode per frame.
#
# r:link -> an EXTERNAL image. Blocked by default (Phase 2 SSRF rule). Render
# a labelled placeholder. Do not fetch.
#
# EMF / WMF: NOT DECODABLE on canvas. Render a labelled placeholder showing the
# alt text or the file name, sized to the shape extent, and mark the type
# 'painted: placeholder' in the coverage manifest (G3, G4).
# Word documents pasted from Excel or Visio are full of these, so the
# placeholder must look deliberate, not broken.
#
# a:duotone, a:alphaModFix, a:clrChange, a:biLevel, a:grayscl are blip
# EFFECTS - apply on a scratch canvas, cache the result by (part, effectKey).
```

**Done when.** PNG/JPEG/GIF render and are cached; an EMF renders a labelled placeholder and is
tracked in the manifest; an external `r:link` is not fetched; `duotone` applies and caches.

---

## Legacy and fallback

### P9-18 — VML rendering

**Size** L · **Depends** P9-12, P9-13 · **Escalate** no

**Goal.** Render `w:pict` content via the generated `vml-*` readers.

**Context.** VML is Transitional-only; the Strict dialect drops it entirely, which is why VML tokens in
`namespaces.ts` have no `strict` URI. `CT_Picture` (`wml.xsd:1186`) and `CT_Object` (`wml.xsd:1167`)
reach it through `xsd:any processContents="lax"`, so it arrives as preserved raw content that we
re-read through the VML readers when we choose to paint it.

```pseudo
# v:shape @style is a CSS-LIKE STRING, not attributes:
#     "position:absolute;left:10pt;top:20pt;width:100pt;height:50pt;z-index:3;
#      mso-position-horizontal-relative:page;rotation:45"
# It needs its own tiny parser. Units are CSS units (pt, px, in, mm, cm, pc)
# plus bare numbers meaning EMU-like 'twips' in some attributes - convert
# carefully and centrally.
#
# v:path @v uses VML's own path grammar (m/l/c/x/e and the 'nf'/'ae' variants),
# on a coordinate system given by @coordorigin/@coordsize. Different language
# from DrawingML paths - do not share the parser, share only the path builder.
#
# Common in real documents and worth prioritising in this order:
#   v:shape + v:imagedata  (pictures)     v:rect, v:line, v:oval, v:roundrect
#   v:shapetype + v:shape@type            v:textbox (hosts WML content!)
#   v:group                               w10:wrap (wrapping, maps to P9-03)
#
# v:textbox containing <w:txbxContent> re-enters ORDINARY WML layout. That
# mutual recursion (WML -> VML -> WML) must be depth-limited.
```

**Done when.** A `v:shape` with `imagedata` renders; the style-string parser handles all units; a
`v:textbox` lays out WML content inside it with a depth limit; `w10:wrap` maps onto exclusions.

---

### P9-19 — MCE preference

**Size** S · **Depends** P1-* (mce.ts) · **Escalate** no

```pseudo
# <mc:AlternateContent>
#   <mc:Choice Requires="wps">   <w:drawing>...</w:drawing>   </mc:Choice>
#   <mc:Fallback>                <w:pict>...</w:pict>         </mc:Fallback>
# </mc:AlternateContent>
#
# Render: prefer the first mc:Choice whose @Requires namespaces we support.
# PRESERVE ALL BRANCHES on save (A5). Rendering the Choice does not license
# dropping the Fallback - dropping it breaks the file in older Word.
```

**Done when.** A fixture with both branches renders the DrawingML one and round-trips both;
a `Choice` requiring an unknown namespace falls through to `Fallback`.

---

### P9-20 — Chart and SmartArt placeholders

**Size** S · **Depends** P9-17 · **Escalate** no

Charts and SmartArt are **deferred**, not skipped. They must:
1. round-trip losslessly (already true via the generated readers/writers);
2. render a labelled placeholder at the correct extent — not a blank (`G3`);
3. appear in the coverage manifest as `modelled: true, laidOut: true, painted: 'placeholder'`.

**Done when.** A document containing a chart and a SmartArt diagram round-trips byte-idempotently,
renders two labelled placeholders at correct sizes, and the manifest reports them as placeholders.

---

## Phase 9 exit criteria

1. All tickets closed per their **Done when** clauses.
2. `pnpm gen` emits the 187 presets and passes the determinism gate.
3. The anchor⇄wrap fixpoint reports zero unconverged documents across the corpus, or each is logged.
4. Layout goldens exist for: tight wrap around a concave polygon, two overlapping paragraph-anchored
   images, and a VML textbox containing WML content.
5. The coverage manifest shows charts and SmartArt as placeholders, and the phase report says so
   explicitly rather than implying full DrawingML support.
