import { describe, expect, it } from 'vitest';
import {
  MALFORMED_PACKAGE_RECIPES,
  CoverageTracker,
  assertCoverageThresholds,
  assertDisplayListSerializable,
  assertPerformance,
  canonicalXml,
  compareVisualRgba,
  equivalentParts,
  runFuzz,
  runLayoutGolden,
  runRoundTrip,
  serializeCoverageBaseline,
  validateCorpusManifest,
} from './index.js';

describe('coverage gates', () => {
  it('records all five states and emits deterministic HTML', () => {
    const tracker = new CoverageTracker([{ name: 'wml#CT_P', states: { modelled: true } }]);
    tracker.recordMany('wml#CT_P', ['laidOut', 'painted', 'roundTripped', 'placeholder']);
    const report = tracker.report();
    expect(report.counts).toEqual({
      modelled: 1,
      laidOut: 1,
      painted: 1,
      roundTripped: 1,
      placeholder: 1,
    });
    expect(report.html).toContain('<th>placeholder</th>');
    expect(() => assertCoverageThresholds(report, { laidOut: 1, painted: 1 })).not.toThrow();
    expect(serializeCoverageBaseline(report)).toContain('"version": 1');
  });
});

describe('equivalence and round-trip gates', () => {
  it('ignores element whitespace and attribute order while retaining text', () => {
    expect(canonicalXml('<w:p a="1" b="2">\n <w:t> a  b </w:t>\n</w:p>')).toBe(
      '<w:p a="1" b="2"><w:t> a  b </w:t></w:p>',
    );
    expect(
      equivalentParts(
        [{ name: 'a.xml', text: '<p a="1" b="2"/>' }],
        [{ name: 'a.xml', text: '<p b="2" a="1"></p>' }],
      ),
    ).toEqual([]);
    expect(
      equivalentParts(
        [{ name: 'a.xml', text: '<p>one</p>' }],
        [{ name: 'a.xml', text: '<p>two</p>' }],
      ),
    ).toHaveLength(1);
  });

  it('runs both generation assertions and names failures', async () => {
    const seen: string[] = [];
    await runRoundTrip(
      [1],
      async (value) => value,
      async (value) => value,
      (a, b) => a === b,
      {
        onFailure: (failure) => {
          seen.push(failure.document);
        },
      },
    );
    expect(seen).toEqual([]);
  });
});

describe('corpus, golden, visual and performance gates', () => {
  it('requires all corpus sources and the large performance fixture', () => {
    const issues = validateCorpusManifest([
      {
        path: 'synthetic.docx',
        source: 'synthetic',
        licence: 'MIT',
        retrieved: '2026-09-19',
        construction: 'generated',
      },
    ]);
    expect(issues.map((issue) => issue.message)).toContain('corpus-missing-real-world-source');
  });
  it('requires explicit golden updates and reports visual caveat', () => {
    expect(() => runLayoutGolden([], 'old')).toThrow('golden-mismatch');
    expect(runLayoutGolden([], 'old', { update: true }).changed).toBe(true);
    const visual = compareVisualRgba(
      new Uint8Array([0, 0, 0, 255]),
      new Uint8Array([0, 0, 0, 255]),
      { source: 'previous-commit' },
    );
    expect(visual.caveat).toContain('unverified');
  });
  it('uses throttled p95 and typed fuzz outcomes', () => {
    expect(
      assertPerformance(
        { openMs: 10, keystrokeMs: [1, 2, 3, 4], scrollFps: 60, cpuThrottle: 4 },
        { open100PagesMs: 100, keystrokeP95Ms: 16, scroll500PagesFps: 60 },
      ).passed,
    ).toBe(true);
    const results = runFuzz(['seed'], {
      iterations: 3,
      mutate: (seed) => seed,
      parse: () => {
        throw new TypeError('bad');
      },
      isTypedError: (error) => error instanceof TypeError,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
  });
});

describe('security and determinism gates', () => {
  it('keeps malformed packages as named recipes and checks cloneability', () => {
    expect(MALFORMED_PACKAGE_RECIPES).toHaveLength(12);
    expect(assertDisplayListSerializable({ type: 'rect', x: 1 })).toEqual({ type: 'rect', x: 1 });
  });
});
