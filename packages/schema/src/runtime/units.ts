/**
 * Branded measurement types and the conversions between them.
 *
 * OOXML mixes incompatible units constantly, and the numbers look alike: `240`
 * is a plausible value in twips (12 pt of paragraph spacing), in half-points (a
 * 120 pt font), in eighths of a point (a 30 pt border) and in EMU (a quarter of
 * a thousandth of an inch). Nothing in a `number` type stops `w:spacing/@after`
 * from being assigned a half-point value; the result is a layout that is wrong
 * by a factor of ten and looks, on screen, merely like a bad guess about
 * spacing. Branding makes that a compile error.
 *
 * ```ts
 * type Twip = number & { readonly __brand: 'Twip' };
 * ```
 *
 * The brand is a type-level lie: at run time a `Twip` *is* a `number`, so
 * arithmetic, comparison and JSON all behave normally and the branding costs
 * nothing — `twip(n)` compiles to `n`. What it buys is that `Twip` and
 * `HalfPoint` are not assignable to each other, so a unit mix-up is caught
 * where it is written instead of in a layout diff.
 *
 * ## The exact relationships
 *
 * All of these are exact by definition, not approximations:
 *
 * ```
 * 1 inch = 1440 twip = 914400 EMU = 72 pt = 96 px (CSS) = 25.4 mm
 * 1 twip = 635 EMU   = 1/20 pt
 * 1 pt   = 20 twip   = 12700 EMU = 2 half-points = 8 eighth-points = 4/3 px
 * 1 px   = 15 twip   = 9525 EMU  = 0.75 pt
 * ```
 *
 * EMU was chosen by the format's designers precisely so that inches, points and
 * (metric) centimetres all divide it exactly: 914400 = 2^5 × 3^2 × 5^2 × 127.
 *
 * ## Rounding policy
 *
 * Stated once, applied everywhere:
 *
 * - **Conversions to a finer unit are exact** and never round: twip → EMU
 *   (×635), point → twip (×20), half-point → twip (×10).
 * - **Conversions to a coarser integer unit round half away from zero.**
 *   `Math.round` rounds half *up*, which is asymmetric about zero: it sends
 *   −0.5 to −0 but +0.5 to 1. Indents, `w:spacing/@before` and kerning
 *   adjustments are genuinely signed (`ST_SignedTwipsMeasure`), and an
 *   asymmetric rule makes a −½-unit indent and a +½-unit indent round by
 *   different amounts — the kind of off-by-one that shows up as a one-pixel
 *   jitter when a value is negated. Half-away-from-zero is symmetric.
 * - **Conversions to `Point` and `Px` do not round at all.** Both are used for
 *   measurement and painting rather than storage, where a fraction is the
 *   correct answer and premature rounding compounds through a layout pass.
 *
 * Exact-then-round is applied per conversion, never chained: `emuToHalfPoint`
 * divides once rather than going via twips, so it does not accumulate two
 * roundings.
 */

/* ------------------------------------------------------------------------- */
/* Branded types                                                              */
/* ------------------------------------------------------------------------- */

/** Twentieth of a point, 1/1440 inch. `w:ind`, `w:spacing`, `w:pgSz`, `w:tblW` dxa. */
export type Twip = number & { readonly __brand: 'Twip' };

/** English Metric Unit, 1/914400 inch. All of DrawingML: extents, offsets, insets. */
export type Emu = number & { readonly __brand: 'Emu' };

/** Half a point. `w:sz`/`w:szCs` font size — `w:sz w:val="24"` is 12 pt. */
export type HalfPoint = number & { readonly __brand: 'HalfPoint' };

/** Eighth of a point. Border widths: `w:tblBorders`, `w:pBdr`, `w:bdr` `@w:sz`. */
export type EighthPoint = number & { readonly __brand: 'EighthPoint' };

/** Fiftieth of a percent: 5000 = 100%. `w:tblW`/`w:tcW` with `w:type="pct"`. */
export type Pct50 = number & { readonly __brand: 'Pct50' };

/** Thousandth of a percent: 100000 = 100%. DrawingML `ST_Percentage` decimal form. */
export type Pct1000 = number & { readonly __brand: 'Pct1000' };

/** A percentage as a human reads it: `100` is 100%, `33.3` is 33.3%. */
export type Percent = number & { readonly __brand: 'Percent' };

/** Sixty-thousandth of a degree: 5400000 = 90°. DrawingML `ST_Angle`, `a:rot`. */
export type Degree60k = number & { readonly __brand: 'Degree60k' };

/** A typographic point, 1/72 inch. Fractional; a measurement unit, not a storage unit. */
export type Point = number & { readonly __brand: 'Point' };

/** A CSS pixel at 96 dpi, 1/96 inch. Fractional; canvas coordinates before DPR scaling. */
export type Px = number & { readonly __brand: 'Px' };

/* --- constructors --------------------------------------------------------- */

export const twip = (n: number): Twip => n as Twip;
export const emu = (n: number): Emu => n as Emu;
export const halfPoint = (n: number): HalfPoint => n as HalfPoint;
export const eighthPoint = (n: number): EighthPoint => n as EighthPoint;
export const pct50 = (n: number): Pct50 => n as Pct50;
export const pct1000 = (n: number): Pct1000 => n as Pct1000;
export const percent = (n: number): Percent => n as Percent;
export const degree60k = (n: number): Degree60k => n as Degree60k;
export const point = (n: number): Point => n as Point;
export const px = (n: number): Px => n as Px;

/* --- the defining constants ---------------------------------------------- */

export const TWIP_PER_INCH = 1440;
export const EMU_PER_INCH = 914400;
export const POINT_PER_INCH = 72;
export const PX_PER_INCH = 96;
export const MM_PER_INCH = 25.4;

/** Exactly 635. The reason EMU and twips interconvert without loss in one direction. */
export const EMU_PER_TWIP = EMU_PER_INCH / TWIP_PER_INCH;
export const TWIP_PER_POINT = TWIP_PER_INCH / POINT_PER_INCH; // 20
export const TWIP_PER_PX = TWIP_PER_INCH / PX_PER_INCH; // 15
export const EMU_PER_POINT = EMU_PER_INCH / POINT_PER_INCH; // 12700
export const EMU_PER_PX = EMU_PER_INCH / PX_PER_INCH; // 9525

/** `a:rot="5400000"` is 90°. */
export const DEGREE60K_PER_DEGREE = 60000;

/**
 * Symmetric rounding. See the rounding policy in the file header: `Math.round`
 * is asymmetric about zero and signed measurements are common in WML.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/* ------------------------------------------------------------------------- */
/* Length conversions — every ordered pair of the six length units            */
/* ------------------------------------------------------------------------- */

/* --- from Twip ------------------------------------------------------------ */
/** Exact: 1 twip = 635 EMU. */
export const twipToEmu = (v: Twip): Emu => emu(v * EMU_PER_TWIP);
/** Rounds: 1 twip = 0.1 half-point. */
export const twipToHalfPoint = (v: Twip): HalfPoint => halfPoint(roundHalfAwayFromZero(v / 10));
/** Rounds: 1 twip = 0.4 eighth-point. */
export const twipToEighthPoint = (v: Twip): EighthPoint =>
  eighthPoint(roundHalfAwayFromZero(v / 2.5));
/** Exact within floating point; fractional by design. */
export const twipToPoint = (v: Twip): Point => point(v / TWIP_PER_POINT);
/** Exact within floating point; fractional by design. */
export const twipToPx = (v: Twip): Px => px(v / TWIP_PER_PX);

/* --- from Emu ------------------------------------------------------------- */
/** Rounds: 635 EMU per twip. */
export const emuToTwip = (v: Emu): Twip => twip(roundHalfAwayFromZero(v / EMU_PER_TWIP));
/** Rounds: 6350 EMU per half-point. */
export const emuToHalfPoint = (v: Emu): HalfPoint =>
  halfPoint(roundHalfAwayFromZero(v / (EMU_PER_POINT / 2)));
/** Rounds: 1587.5 EMU per eighth-point. */
export const emuToEighthPoint = (v: Emu): EighthPoint =>
  eighthPoint(roundHalfAwayFromZero(v / (EMU_PER_POINT / 8)));
export const emuToPoint = (v: Emu): Point => point(v / EMU_PER_POINT);
export const emuToPx = (v: Emu): Px => px(v / EMU_PER_PX);

/* --- from HalfPoint ------------------------------------------------------- */
/** Exact: 1 half-point = 10 twip. */
export const halfPointToTwip = (v: HalfPoint): Twip => twip(v * 10);
/** Exact: 1 half-point = 6350 EMU. */
export const halfPointToEmu = (v: HalfPoint): Emu => emu(v * (EMU_PER_POINT / 2));
/** Exact: 1 half-point = 4 eighth-points. */
export const halfPointToEighthPoint = (v: HalfPoint): EighthPoint => eighthPoint(v * 4);
export const halfPointToPoint = (v: HalfPoint): Point => point(v / 2);
export const halfPointToPx = (v: HalfPoint): Px => px((v / 2) * (PX_PER_INCH / POINT_PER_INCH));

/* --- from EighthPoint ----------------------------------------------------- */
/** Rounds: 1 eighth-point = 2.5 twip, so odd values land on a half twip. */
export const eighthPointToTwip = (v: EighthPoint): Twip => twip(roundHalfAwayFromZero(v * 2.5));
/** Rounds: 1 eighth-point = 1587.5 EMU, so odd values land on a half EMU. */
export const eighthPointToEmu = (v: EighthPoint): Emu =>
  emu(roundHalfAwayFromZero(v * (EMU_PER_POINT / 8)));
/** Rounds: 4 eighth-points per half-point. */
export const eighthPointToHalfPoint = (v: EighthPoint): HalfPoint =>
  halfPoint(roundHalfAwayFromZero(v / 4));
export const eighthPointToPoint = (v: EighthPoint): Point => point(v / 8);
export const eighthPointToPx = (v: EighthPoint): Px => px((v / 8) * (PX_PER_INCH / POINT_PER_INCH));

/* --- from Point ----------------------------------------------------------- */
/** Rounds: fractional points are common (10.5 pt) and twips are integral. */
export const pointToTwip = (v: Point): Twip => twip(roundHalfAwayFromZero(v * TWIP_PER_POINT));
export const pointToEmu = (v: Point): Emu => emu(roundHalfAwayFromZero(v * EMU_PER_POINT));
export const pointToHalfPoint = (v: Point): HalfPoint => halfPoint(roundHalfAwayFromZero(v * 2));
export const pointToEighthPoint = (v: Point): EighthPoint =>
  eighthPoint(roundHalfAwayFromZero(v * 8));
export const pointToPx = (v: Point): Px => px(v * (PX_PER_INCH / POINT_PER_INCH));

/* --- from Px -------------------------------------------------------------- */
export const pxToTwip = (v: Px): Twip => twip(roundHalfAwayFromZero(v * TWIP_PER_PX));
export const pxToEmu = (v: Px): Emu => emu(roundHalfAwayFromZero(v * EMU_PER_PX));
export const pxToHalfPoint = (v: Px): HalfPoint =>
  halfPoint(roundHalfAwayFromZero(v * (POINT_PER_INCH / PX_PER_INCH) * 2));
export const pxToEighthPoint = (v: Px): EighthPoint =>
  eighthPoint(roundHalfAwayFromZero(v * (POINT_PER_INCH / PX_PER_INCH) * 8));
export const pxToPoint = (v: Px): Point => point(v * (POINT_PER_INCH / PX_PER_INCH));

/* --- physical units, for the lexical forms and for page setup ------------- */

export const inchesToTwip = (v: number): Twip => twip(roundHalfAwayFromZero(v * TWIP_PER_INCH));
export const twipToInches = (v: Twip): number => v / TWIP_PER_INCH;
export const inchesToEmu = (v: number): Emu => emu(roundHalfAwayFromZero(v * EMU_PER_INCH));
export const emuToInches = (v: Emu): number => v / EMU_PER_INCH;
export const mmToTwip = (v: number): Twip =>
  twip(roundHalfAwayFromZero((v / MM_PER_INCH) * TWIP_PER_INCH));
export const twipToMm = (v: Twip): number => (v / TWIP_PER_INCH) * MM_PER_INCH;
export const mmToEmu = (v: number): Emu =>
  emu(roundHalfAwayFromZero((v / MM_PER_INCH) * EMU_PER_INCH));
export const emuToMm = (v: Emu): number => (v / EMU_PER_INCH) * MM_PER_INCH;

/* ------------------------------------------------------------------------- */
/* Angle and percentage conversions                                           */
/* ------------------------------------------------------------------------- */

export const degreesToDegree60k = (v: number): Degree60k =>
  degree60k(roundHalfAwayFromZero(v * DEGREE60K_PER_DEGREE));
export const degree60kToDegrees = (v: Degree60k): number => v / DEGREE60K_PER_DEGREE;
export const degree60kToRadians = (v: Degree60k): number =>
  (v / DEGREE60K_PER_DEGREE) * (Math.PI / 180);
export const radiansToDegree60k = (v: number): Degree60k =>
  degree60k(roundHalfAwayFromZero(((v * 180) / Math.PI) * DEGREE60K_PER_DEGREE));

export const pct50ToPercent = (v: Pct50): Percent => percent(v / 50);
export const percentToPct50 = (v: Percent): Pct50 => pct50(roundHalfAwayFromZero(v * 50));
export const pct1000ToPercent = (v: Pct1000): Percent => percent(v / 1000);
export const percentToPct1000 = (v: Percent): Pct1000 => pct1000(roundHalfAwayFromZero(v * 1000));
/** 100% → 1. The form layout wants. */
export const percentToFraction = (v: Percent): number => v / 100;
export const fractionToPercent = (v: number): Percent => percent(v * 100);

/* ------------------------------------------------------------------------- */
/* Lexical forms                                                              */
/* ------------------------------------------------------------------------- */

/** Raised for a value outside the lexical space of an OOXML measurement type. */
export class MeasurementValueError extends Error {
  constructor(
    readonly value: string,
    typeName: string,
  ) {
    super(`${JSON.stringify(value)} is not a valid ${typeName}`);
    this.name = 'MeasurementValueError';
  }
}

/**
 * The unit suffixes of `ST_UniversalMeasure`, and how many twips each is worth.
 *
 * ```xml
 * <xsd:simpleType name="ST_UniversalMeasure">
 *   <xsd:restriction base="xsd:string">
 *     <xsd:pattern value="-?[0-9]+(\.[0-9]+)?(mm|cm|in|pt|pc|pi)"/>
 * ```
 *
 * `pc` and `pi` are both the pica, 12 points — `pi` is the OOXML spelling and
 * `pc` the CSS one, and the schema accepts either. Note what the pattern does
 * *not* allow: no space before the unit, no leading `+`, no `.5in` without a
 * leading zero, and no `px`/`em`/`%`.
 */
const TWIPS_PER_UNIT: Readonly<Record<string, number>> = {
  mm: TWIP_PER_INCH / MM_PER_INCH,
  cm: (TWIP_PER_INCH / MM_PER_INCH) * 10,
  in: TWIP_PER_INCH,
  pt: TWIP_PER_POINT,
  pc: TWIP_PER_POINT * 12,
  pi: TWIP_PER_POINT * 12,
};

/** Exactly the XSD pattern, anchored. */
const UNIVERSAL_MEASURE = /^(-?[0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|pi)$/;
/** `xsd:integer`: optional sign, then digits. Leading zeros are legal. */
const XSD_INTEGER = /^[+-]?[0-9]+$/;
/** `xsd:unsignedLong`: digits, optionally a `+`. */
const XSD_UNSIGNED = /^\+?[0-9]+$/;

function collapse(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, ' ');
}

/**
 * `ST_TwipsMeasure` — `union(ST_UnsignedDecimalNumber, ST_PositiveUniversalMeasure)`.
 *
 * A bare number is already in twips; a suffixed one is a physical length that
 * has to be converted. Both spellings appear in the wild: Word writes bare
 * twips, but hand-authored and library-generated documents write `"1in"`, and
 * refusing those rejects valid files.
 *
 * Negative values are not in this type's lexical space — use
 * {@link parseSignedTwipsMeasure} for `w:ind/@left`, which can be negative.
 */
export function parseTwipsMeasure(value: string): Twip {
  const v = collapse(value);
  if (XSD_UNSIGNED.test(v)) return twip(Number(v));
  const m = UNIVERSAL_MEASURE.exec(v);
  if (m !== null && !v.startsWith('-')) return universalToTwip(m);
  throw new MeasurementValueError(value, 'ST_TwipsMeasure');
}

/**
 * `ST_SignedTwipsMeasure` — `union(xsd:integer, ST_UniversalMeasure)`.
 *
 * The signed counterpart, and note the asymmetry in the schema: the unsuffixed
 * member is `xsd:integer` (unbounded) rather than `xsd:int`, and the suffixed
 * member is the signed `ST_UniversalMeasure`, so `"-0.5in"` is legal here and
 * not in `ST_TwipsMeasure`.
 */
export function parseSignedTwipsMeasure(value: string): Twip {
  const v = collapse(value);
  if (XSD_INTEGER.test(v)) return twip(Number(v));
  const m = UNIVERSAL_MEASURE.exec(v);
  if (m !== null) return universalToTwip(m);
  throw new MeasurementValueError(value, 'ST_SignedTwipsMeasure');
}

function universalToTwip(m: RegExpExecArray): Twip {
  const magnitude = Number(m[1]);
  const perUnit = TWIPS_PER_UNIT[m[2] ?? ''];
  /* c8 ignore next */
  if (perUnit === undefined) throw new MeasurementValueError(m[0], 'ST_UniversalMeasure');
  return twip(roundHalfAwayFromZero(magnitude * perUnit));
}

/**
 * `ST_HpsMeasure` — `union(ST_UnsignedDecimalNumber, ST_PositiveUniversalMeasure)`,
 * the font-size type of `w:sz`.
 *
 * The bare form is in **half-points**, so `w:sz w:val="24"` is 12 pt — but the
 * suffixed form is a real length, so `w:sz w:val="12pt"` is the *same* size. The
 * two members of the union are in different units, which is easy to miss and
 * produces a 2× font-size error in exactly the files that use the rarer form.
 */
export function parseHpsMeasure(value: string): HalfPoint {
  const v = collapse(value);
  if (XSD_UNSIGNED.test(v)) return halfPoint(Number(v));
  const m = UNIVERSAL_MEASURE.exec(v);
  if (m !== null && !v.startsWith('-')) return twipToHalfPoint(universalToTwip(m));
  throw new MeasurementValueError(value, 'ST_HpsMeasure');
}

/** `ST_SignedHpsMeasure` — `union(xsd:integer, ST_UniversalMeasure)`. `w:position`. */
export function parseSignedHpsMeasure(value: string): HalfPoint {
  const v = collapse(value);
  if (XSD_INTEGER.test(v)) return halfPoint(Number(v));
  const m = UNIVERSAL_MEASURE.exec(v);
  if (m !== null) return twipToHalfPoint(universalToTwip(m));
  throw new MeasurementValueError(value, 'ST_SignedHpsMeasure');
}

/** `ST_EighthPointMeasure` — a plain `xsd:unsignedLong`; no suffixed form exists. */
export function parseEighthPointMeasure(value: string): EighthPoint {
  const v = collapse(value);
  if (XSD_UNSIGNED.test(v)) return eighthPoint(Number(v));
  throw new MeasurementValueError(value, 'ST_EighthPointMeasure');
}

/** Bare integer twips, which is what Word writes. */
export const formatTwips = (v: Twip): string => String(roundHalfAwayFromZero(v));
export const formatHalfPoints = (v: HalfPoint): string => String(roundHalfAwayFromZero(v));
export const formatEighthPoints = (v: EighthPoint): string => String(roundHalfAwayFromZero(v));
export const formatEmu = (v: Emu): string => String(roundHalfAwayFromZero(v));
export const formatDegree60k = (v: Degree60k): string => String(roundHalfAwayFromZero(v));

/**
 * A decimal literal with no exponent and a digit on both sides of any point.
 *
 * `String(0.0000001)` is `"1e-7"` and `String(1e21)` is `"1e+21"`; neither
 * matches any OOXML lexical pattern, all of which are plain `[0-9]+(\.[0-9]+)?`
 * forms. Trailing fractional zeros are stripped so that a round number does not
 * acquire `.0000`, and the point goes with them.
 */
function decimalString(value: number, maxFractionDigits: number): string {
  if (!Number.isFinite(value)) {
    throw new MeasurementValueError(String(value), 'finite measurement');
  }
  return value
    .toFixed(maxFractionDigits)
    .replace(/(\.[0-9]*?)0+$/, '$1')
    .replace(/\.$/, '');
}

/**
 * Format a length with a unit suffix, for the cases where a human-authored
 * value is clearer. Never used on the round-trip path — a value read as `2400`
 * is written back as `2400`, not as `"1.6667in"`.
 */
export function formatUniversalMeasure(
  value: Twip,
  unit: 'mm' | 'cm' | 'in' | 'pt' | 'pc' | 'pi',
): string {
  const perUnit = TWIPS_PER_UNIT[unit];
  /* c8 ignore next */
  if (perUnit === undefined) throw new MeasurementValueError(unit, 'ST_UniversalMeasure unit');
  return `${decimalString(value / perUnit, 4)}${unit}`;
}

/* --- percentages ---------------------------------------------------------- */

/**
 * How to read a percentage written without a `%` sign.
 *
 * There is no single answer, which is the whole problem: the same `"5000"` is
 * 100% in a `w:tblW` and 5% in a DrawingML `a:alpha`. The scale is a property of
 * the attribute being read, not of the text, so the caller has to name it.
 *
 * - `'fiftieths'` — WML table widths (`w:tblW`, `w:tcW` with `w:type="pct"`).
 *   5000 = 100%.
 * - `'thousandths'` — DrawingML `ST_PercentageDecimal`. 100000 = 100%.
 * - `'whole'` — a plain percentage number, e.g. `w:zoom/@w:percent`. 100 = 100%.
 */
export type BarePercentScale = 'fiftieths' | 'thousandths' | 'whole';

const BARE_PERCENT_DIVISOR: Readonly<Record<BarePercentScale, number>> = {
  fiftieths: 50,
  thousandths: 1000,
  whole: 1,
};

/** `-?[0-9]+(\.[0-9]+)?%`, the shared `ST_Percentage`. */
const PERCENT_LITERAL = /^(-?[0-9]+(?:\.[0-9]+)?)%$/;

/**
 * Parse a percentage in either of the two spellings ECMA-376 uses.
 *
 * Strict writes `"33.3%"` — `s:ST_Percentage` is
 * `<xsd:pattern value="-?[0-9]+(\.[0-9]+)?%"/>` and is the *only* member of
 * DrawingML's `ST_Percentage` union in the Strict schema. Transitional's
 * `ST_Percentage` is `union(ST_PercentageDecimal, s:ST_Percentage)`, where
 * `ST_PercentageDecimal` is an `xsd:int` in thousandths of a percent — and that
 * integer form is what Word actually writes. Both must be read; which one gets
 * written is a dialect decision made by the writer, not here.
 *
 * `bareScale` says how to interpret a value with no `%`. It is required, and
 * required for a reason — see {@link BarePercentScale}.
 */
export function parsePercentage(value: string, bareScale: BarePercentScale): Percent {
  const v = collapse(value);
  const literal = PERCENT_LITERAL.exec(v);
  if (literal !== null) return percent(Number(literal[1]));
  if (XSD_INTEGER.test(v)) return percent(Number(v) / BARE_PERCENT_DIVISOR[bareScale]);
  throw new MeasurementValueError(value, 'ST_Percentage');
}

/**
 * `w:tblW`/`w:tcW` with `w:type="pct"`.
 *
 * The XSD type is `ST_MeasurementOrPercent` — `union(ST_DecimalNumberOrPercent,
 * s:ST_UniversalMeasure)` — so the attribute can carry a bare integer, a `"…%"`
 * literal, or even `"2in"`. This handles the two percentage spellings; a
 * suffixed length in a `pct`-typed width is a contradiction the caller should
 * treat as a `dxa` width instead.
 */
export function parseTablePercent(value: string): Pct50 {
  return percentToPct50(parsePercentage(value, 'fiftieths'));
}

/** DrawingML `ST_Percentage`, either spelling. */
export function parseDrawingMLPercentage(value: string): Percent {
  return parsePercentage(value, 'thousandths');
}

/**
 * Write a percentage.
 *
 * `style: 'literal'` produces the `"33.3%"` form, which is valid in both
 * dialects and required in Strict. `style: 'bare'` produces the integer form,
 * which is what Word writes in Transitional and what a Transitional-only
 * consumer may be the only thing that understands.
 */
export function formatPercentage(
  value: Percent,
  style: 'literal' | 'bare',
  bareScale: BarePercentScale,
): string {
  if (style === 'literal') return `${decimalString(value, 6)}%`;
  return String(roundHalfAwayFromZero(value * BARE_PERCENT_DIVISOR[bareScale]));
}
