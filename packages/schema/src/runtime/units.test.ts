import { describe, expect, it } from 'vitest';
import {
  DEGREE60K_PER_DEGREE,
  degree60k,
  degree60kToDegrees,
  degree60kToRadians,
  degreesToDegree60k,
  eighthPoint,
  eighthPointToEmu,
  eighthPointToHalfPoint,
  eighthPointToPoint,
  eighthPointToPx,
  eighthPointToTwip,
  EMU_PER_INCH,
  EMU_PER_TWIP,
  emu,
  emuToEighthPoint,
  emuToHalfPoint,
  emuToInches,
  emuToMm,
  emuToPoint,
  emuToPx,
  emuToTwip,
  formatPercentage,
  formatTwips,
  formatUniversalMeasure,
  fractionToPercent,
  halfPoint,
  halfPointToEighthPoint,
  halfPointToEmu,
  halfPointToPoint,
  halfPointToPx,
  halfPointToTwip,
  inchesToEmu,
  inchesToTwip,
  MeasurementValueError,
  mmToEmu,
  mmToTwip,
  parseDrawingMLPercentage,
  parseEighthPointMeasure,
  parseHpsMeasure,
  parsePercentage,
  parseSignedHpsMeasure,
  parseSignedTwipsMeasure,
  parseTablePercent,
  parseTwipsMeasure,
  pct1000,
  pct1000ToPercent,
  pct50,
  pct50ToPercent,
  percent,
  percentToFraction,
  percentToPct1000,
  percentToPct50,
  point,
  pointToEighthPoint,
  pointToEmu,
  pointToHalfPoint,
  pointToPx,
  pointToTwip,
  PX_PER_INCH,
  px,
  pxToEighthPoint,
  pxToEmu,
  pxToHalfPoint,
  pxToPoint,
  pxToTwip,
  radiansToDegree60k,
  TWIP_PER_INCH,
  twip,
  twipToEighthPoint,
  twipToEmu,
  twipToHalfPoint,
  twipToInches,
  twipToMm,
  twipToPoint,
  twipToPx,
} from './units.js';

describe('the defining constants', () => {
  it('agrees with the one-inch identity', () => {
    expect(TWIP_PER_INCH).toBe(1440);
    expect(EMU_PER_INCH).toBe(914400);
    expect(PX_PER_INCH).toBe(96);
    expect(EMU_PER_TWIP).toBe(635);
    expect(DEGREE60K_PER_DEGREE).toBe(60000);
  });

  it('routes one inch through every unit to the same place', () => {
    const inch = twip(1440);
    expect(twipToEmu(inch)).toBe(914400);
    expect(twipToPoint(inch)).toBe(72);
    expect(twipToPx(inch)).toBe(96);
    expect(twipToHalfPoint(inch)).toBe(144);
    expect(twipToEighthPoint(inch)).toBe(576);
    expect(twipToInches(inch)).toBe(1);
    expect(twipToMm(inch)).toBeCloseTo(25.4, 10);
  });
});

describe('exact conversions', () => {
  it('never rounds when going to a finer unit', () => {
    expect(twipToEmu(twip(1))).toBe(635);
    expect(twipToEmu(twip(-3))).toBe(-1905);
    expect(halfPointToTwip(halfPoint(24))).toBe(240); // 12 pt of text
    expect(halfPointToEmu(halfPoint(1))).toBe(6350);
    expect(halfPointToEighthPoint(halfPoint(3))).toBe(12);
    expect(pointToTwip(point(11))).toBe(220);
    expect(pointToEmu(point(1))).toBe(12700);
  });

  it('keeps Point and Px fractional', () => {
    expect(twipToPoint(twip(1))).toBe(0.05);
    expect(emuToPoint(emu(1))).toBeCloseTo(1 / 12700, 15);
    expect(halfPointToPoint(halfPoint(21))).toBe(10.5); // 10.5 pt is a real size
    expect(eighthPointToPoint(eighthPoint(3))).toBe(0.375);
    expect(pxToPoint(px(1))).toBe(0.75);
    expect(pointToPx(point(12))).toBe(16);
    expect(halfPointToPx(halfPoint(24))).toBe(16);
    expect(eighthPointToPx(eighthPoint(48))).toBe(8);
    expect(twipToPx(twip(15))).toBe(1);
  });
});

describe('rounding policy', () => {
  it('rounds half away from zero, symmetrically', () => {
    // Math.round would give 1 and -0 here, which is the asymmetry the policy
    // exists to avoid: negating an indent would change its magnitude.
    expect(twipToHalfPoint(twip(5))).toBe(1);
    expect(twipToHalfPoint(twip(-5))).toBe(-1);
    expect(emuToTwip(emu(318))).toBe(1); // 317.5 is the half-way point
    expect(emuToTwip(emu(-318))).toBe(-1);
    expect(pointToTwip(point(0.025))).toBe(1);
    expect(pointToTwip(point(-0.025))).toBe(-1);
  });

  it('rounds coarse integer targets', () => {
    expect(emuToHalfPoint(emu(6350))).toBe(1);
    expect(emuToHalfPoint(emu(6349))).toBe(1);
    expect(emuToEighthPoint(emu(1588))).toBe(1);
    expect(eighthPointToTwip(eighthPoint(1))).toBe(3); // 2.5 rounds away from zero
    expect(eighthPointToTwip(eighthPoint(-1))).toBe(-3);
    expect(eighthPointToEmu(eighthPoint(1))).toBe(1588); // 1587.5
    expect(eighthPointToHalfPoint(eighthPoint(6))).toBe(2); // 1.5
    expect(pxToTwip(px(1))).toBe(15);
    expect(pxToEmu(px(1))).toBe(9525);
    expect(pxToHalfPoint(px(16))).toBe(24);
    expect(pxToEighthPoint(px(16))).toBe(96);
    expect(pointToHalfPoint(point(10.5))).toBe(21);
    expect(pointToEighthPoint(point(0.5))).toBe(4);
  });

  it('does not chain roundings', () => {
    // 6350 EMU is exactly one half-point. Going via twips (6350/635 = 10 twip,
    // then /10) happens to agree here; the point is that each conversion
    // divides once from the source unit, so error cannot accumulate.
    expect(emuToHalfPoint(emu(6350))).toBe(1);
    expect(emuToEighthPoint(emu(6350))).toBe(4);
  });

  it('round-trips integral values through the finer unit', () => {
    for (const n of [0, 1, 20, 240, 1440, -720, 31680]) {
      expect(emuToTwip(twipToEmu(twip(n)))).toBe(n);
      expect(twipToHalfPoint(halfPointToTwip(halfPoint(n)))).toBe(n);
    }
  });
});

describe('physical units', () => {
  it('converts inches and millimetres', () => {
    expect(inchesToTwip(1)).toBe(1440);
    expect(inchesToTwip(8.5)).toBe(12240); // US Letter width
    expect(inchesToEmu(1)).toBe(914400);
    expect(emuToInches(emu(914400))).toBe(1);
    expect(mmToTwip(210)).toBe(11906); // A4 width, the value Word writes
    expect(mmToEmu(25.4)).toBe(914400);
    expect(emuToMm(emu(914400))).toBeCloseTo(25.4, 10);
    expect(twipToMm(twip(11906))).toBeCloseTo(210, 1);
  });
});

describe('angles', () => {
  it('uses sixty-thousandths of a degree', () => {
    expect(degreesToDegree60k(90)).toBe(5400000);
    expect(degreesToDegree60k(-45)).toBe(-2700000);
    expect(degree60kToDegrees(degree60k(5400000))).toBe(90);
    expect(degree60kToRadians(degree60k(5400000))).toBeCloseTo(Math.PI / 2, 12);
    expect(radiansToDegree60k(Math.PI / 2)).toBe(5400000);
    expect(radiansToDegree60k(Math.PI)).toBe(10800000);
  });
});

describe('percentages', () => {
  it('converts between the three integer encodings', () => {
    expect(pct50ToPercent(pct50(5000))).toBe(100);
    expect(percentToPct50(percent(100))).toBe(5000);
    expect(percentToPct50(percent(33.3))).toBe(1665);
    expect(pct1000ToPercent(pct1000(100000))).toBe(100);
    expect(percentToPct1000(percent(33.3))).toBe(33300);
    expect(percentToFraction(percent(50))).toBe(0.5);
    expect(fractionToPercent(0.25)).toBe(25);
  });

  it('reads the Strict literal form', () => {
    expect(parsePercentage('33.3%', 'thousandths')).toBe(33.3);
    expect(parsePercentage('100%', 'fiftieths')).toBe(100);
    expect(parsePercentage('-25%', 'whole')).toBe(-25);
    expect(parsePercentage('0%', 'whole')).toBe(0);
  });

  it('reads the Transitional integer form, at the scale the caller names', () => {
    // The same text means three different things depending on the attribute.
    expect(parsePercentage('5000', 'thousandths')).toBe(5);
    expect(parsePercentage('5000', 'fiftieths')).toBe(100);
    expect(parsePercentage('5000', 'whole')).toBe(5000);
  });

  it('handles the two named call sites', () => {
    expect(parseTablePercent('2500')).toBe(2500); // w:tblW pct, fiftieths
    expect(parseTablePercent('50%')).toBe(2500);
    expect(parseDrawingMLPercentage('33000')).toBe(33);
    expect(parseDrawingMLPercentage('33%')).toBe(33);
  });

  it('rejects text outside the lexical space', () => {
    for (const bad of ['', '%', '33 %', 'abc', '33.3', '1e3%', '.5%', '+5%']) {
      expect(() => parsePercentage(bad, 'whole')).toThrow(MeasurementValueError);
    }
  });

  it('writes both spellings without an exponent', () => {
    expect(formatPercentage(percent(33.3), 'literal', 'thousandths')).toBe('33.3%');
    expect(formatPercentage(percent(100), 'literal', 'thousandths')).toBe('100%');
    expect(formatPercentage(percent(33.3), 'bare', 'thousandths')).toBe('33300');
    expect(formatPercentage(percent(100), 'bare', 'fiftieths')).toBe('5000');
    expect(formatPercentage(percent(0.0000001), 'literal', 'whole')).toBe('0%');
  });

  it('round-trips a literal percentage', () => {
    for (const n of [0, 1, 33.3, 50, 100, 250, -12.5]) {
      const text = formatPercentage(percent(n), 'literal', 'whole');
      expect(parsePercentage(text, 'whole')).toBeCloseTo(n, 6);
    }
  });
});

describe('ST_TwipsMeasure', () => {
  it('reads a bare number as twips', () => {
    expect(parseTwipsMeasure('1440')).toBe(1440);
    expect(parseTwipsMeasure('0')).toBe(0);
    expect(parseTwipsMeasure('+240')).toBe(240);
    expect(parseTwipsMeasure('01440')).toBe(1440); // leading zeros are legal
    expect(parseTwipsMeasure('  1440 ')).toBe(1440);
  });

  it('reads every ST_UniversalMeasure suffix', () => {
    expect(parseTwipsMeasure('1in')).toBe(1440);
    expect(parseTwipsMeasure('72pt')).toBe(1440);
    expect(parseTwipsMeasure('2.54cm')).toBe(1440);
    expect(parseTwipsMeasure('25.4mm')).toBe(1440);
    expect(parseTwipsMeasure('6pc')).toBe(1440); // a pica is 12 points
    expect(parseTwipsMeasure('6pi')).toBe(1440); // ...spelled either way
    expect(parseTwipsMeasure('0.5in')).toBe(720);
  });

  it('rejects what the XSD pattern rejects', () => {
    for (const bad of ['', 'in', '1 in', '.5in', '1px', '1em', '1IN', '-720', '-1in', '1.in']) {
      expect(() => parseTwipsMeasure(bad)).toThrow(MeasurementValueError);
    }
  });

  it('names the type in the error', () => {
    expect(() => parseTwipsMeasure('1px')).toThrow(/ST_TwipsMeasure/);
  });
});

describe('ST_SignedTwipsMeasure', () => {
  it('accepts negatives in both members of the union', () => {
    expect(parseSignedTwipsMeasure('-720')).toBe(-720);
    expect(parseSignedTwipsMeasure('-0.5in')).toBe(-720);
    expect(parseSignedTwipsMeasure('720')).toBe(720);
    expect(parseSignedTwipsMeasure('-1pt')).toBe(-20);
  });

  it('still rejects malformed text', () => {
    for (const bad of ['--1', '1.5', '- 720', 'x']) {
      expect(() => parseSignedTwipsMeasure(bad)).toThrow(MeasurementValueError);
    }
  });
});

describe('ST_HpsMeasure', () => {
  // The two union members are in *different units*: a bare 24 is 24 half-points
  // (12 pt), and "12pt" is the same size written the other way.
  it('reads a bare number as half-points', () => {
    expect(parseHpsMeasure('24')).toBe(24);
    expect(parseHpsMeasure('21')).toBe(21);
  });

  it('reads a suffixed value as a length and converts it', () => {
    expect(parseHpsMeasure('12pt')).toBe(24);
    expect(parseHpsMeasure('1in')).toBe(144);
    expect(parseHpsMeasure('10.5pt')).toBe(21);
  });

  it('agrees with itself across both spellings', () => {
    expect(parseHpsMeasure('12pt')).toBe(parseHpsMeasure('24'));
  });

  it('has a signed counterpart for w:position', () => {
    expect(parseSignedHpsMeasure('-6')).toBe(-6);
    expect(parseSignedHpsMeasure('-3pt')).toBe(-6);
  });

  it('rejects a negative in the unsigned form', () => {
    expect(() => parseHpsMeasure('-24')).toThrow(MeasurementValueError);
  });
});

describe('ST_EighthPointMeasure', () => {
  // Unlike ST_HpsMeasure, this one has no ST_UniversalMeasure member at all.
  it('accepts only a bare unsigned integer', () => {
    expect(parseEighthPointMeasure('4')).toBe(4); // a half-point border
    expect(parseEighthPointMeasure('0')).toBe(0);
    for (const bad of ['1pt', '-4', '4.5', '']) {
      expect(() => parseEighthPointMeasure(bad)).toThrow(MeasurementValueError);
    }
  });
});

describe('formatting', () => {
  it('writes bare integers, as Word does', () => {
    expect(formatTwips(twip(1440))).toBe('1440');
    expect(formatTwips(twip(-720))).toBe('-720');
    expect(formatTwips(twip(1440.4))).toBe('1440');
  });

  it('writes suffixed measures without an exponent and with a leading digit', () => {
    expect(formatUniversalMeasure(twip(1440), 'in')).toBe('1in');
    expect(formatUniversalMeasure(twip(720), 'in')).toBe('0.5in');
    expect(formatUniversalMeasure(twip(2400), 'in')).toBe('1.6667in');
    expect(formatUniversalMeasure(twip(240), 'pt')).toBe('12pt');
    expect(formatUniversalMeasure(twip(1440), 'pc')).toBe('6pc');
    expect(formatUniversalMeasure(twip(-720), 'in')).toBe('-0.5in');
  });

  it('produces text its own parser accepts', () => {
    for (const unit of ['mm', 'cm', 'in', 'pt', 'pc', 'pi'] as const) {
      const text = formatUniversalMeasure(twip(1440), unit);
      expect(parseTwipsMeasure(text)).toBe(1440);
    }
  });

  it('refuses to format a non-finite value', () => {
    expect(() => formatUniversalMeasure(twip(Number.NaN), 'in')).toThrow(MeasurementValueError);
    expect(() => formatPercentage(percent(Number.POSITIVE_INFINITY), 'literal', 'whole')).toThrow(
      MeasurementValueError,
    );
  });
});
