import { describe, expect, it } from 'vitest';
import type { ParagraphRunInput } from './itemizer.js';
import { TextEngine } from './text-engine.js';

describe('TextEngine & Multi-Script Shaping Harness (Phase 4 Verification Gate)', () => {
  it('shapes a standard Latin run with fast path qualification and L1 caching', () => {
    const engine = new TextEngine();

    // 1. Initial pass: Cache MISS, qualifies for fast path
    const results1 = engine.shapeRun('Hello world', {
      fontSize: 24, // 12pt
    });

    expect(results1).toHaveLength(1);
    const item1 = results1[0]!;
    expect(item1.cached).toBe(false);
    expect(item1.fastPath).toBe(true);
    expect(item1.shapedRun.clusterCount).toBe(11);
    expect(item1.shapedRun.direction).toBe('ltr');
    expect(item1.shapedRun.totalAdvance).toBeGreaterThan(0);

    // 2. Second pass: Cache HIT, zero allocation
    const results2 = engine.shapeRun('Hello world', {
      fontSize: 24,
    });

    expect(results2).toHaveLength(1);
    const item2 = results2[0]!;
    expect(item2.cached).toBe(true);
    expect(item2.shapedRun).toBe(item1.shapedRun); // exact same cached instance

    const stats = engine.cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it('shapes Arabic text with contextual cursive joining and strict visual cluster order (Ticket P4-07 & P4-09)', () => {
    const engine = new TextEngine();

    // Arabic sample: "كتب" (Kaf U+0643, Ta U+062A, Ba U+0628)
    // Initial Kaf (0xfedb), Medial Ta (0xfe98), Final Ba (0xfe90)
    const arabicText = '\u0643\u062A\u0628';

    const results = engine.shapeRun(arabicText, {
      rtl: true,
      baseLevel: 1,
      fontSize: 28, // 14pt
    });

    expect(results).toHaveLength(1);
    const res = results[0]!;
    expect(res.subRun.script).toBe('cs');
    expect(res.subRun.bidiLevel).toBe(1);
    expect(res.fastPath).toBe(false); // Arabic NEVER takes fast path

    const run = res.shapedRun;
    expect(run.direction).toBe('rtl');
    expect(run.clusterCount).toBe(3);

    // Visual Order Contract:
    // In visual order (left to right on screen):
    // The leftmost glyph (index 0) is Final Ba (logical end, srcOffset = 2)
    // The middle glyph (index 1) is Medial Ta (logical middle, srcOffset = 1)
    // The rightmost glyph (index 2) is Initial Kaf (logical start, srcOffset = 0)
    expect(run.glyphId(0)).toBe(0xfe90); // Final Ba
    expect(run.srcOffset(0)).toBe(2);

    expect(run.glyphId(1)).toBe(0xfe98); // Medial Ta
    expect(run.srcOffset(1)).toBe(1);

    expect(run.glyphId(2)).toBe(0xfedb); // Initial Kaf
    expect(run.srcOffset(2)).toBe(0);

    // Verify O(log N) source-offset-to-cluster mapping
    expect(run.clusterAtSourceOffset(0)).toBe(2); // Kaf
    expect(run.clusterAtSourceOffset(1)).toBe(1); // Ta
    expect(run.clusterAtSourceOffset(2)).toBe(0); // Ba
  });

  it('shapes CJK text with full-width advances (Ticket P4-14)', () => {
    const engine = new TextEngine();

    // CJK Sample: "中文测试" (Chinese text test)
    const cjkText = '\u4e2d\u6587\u6d4b\u8bd5';
    const fontSize = 24; // 12pt (em = 240 twips)

    const results = engine.shapeRun(cjkText, {
      fontSize,
    });

    expect(results).toHaveLength(1);
    const res = results[0]!;
    expect(res.subRun.script).toBe('eastAsia');
    expect(res.shapedRun.clusterCount).toBe(4);

    // East Asian ideographs must have exactly 1.0 em advance = fontSize * 10 = 240 twips
    const expectedAdvance = fontSize * 10;
    for (let i = 0; i < res.shapedRun.clusterCount; i++) {
      expect(res.shapedRun.xAdvance(i)).toBe(expectedAdvance);
    }
    expect(res.shapedRun.totalAdvance).toBe(expectedAdvance * 4);
  });

  it('demonstrates measurement cache hit rate > 90% across repeated paragraphs', () => {
    const engine = new TextEngine();

    // Representative document paragraph containing mixed Latin, CJK, and Arabic runs
    const paragraph: ParagraphRunInput[] = [
      { text: 'The quick brown fox jumps over the lazy dog. ', options: { fontSize: 24 } },
      { text: '这是一段用于测试布局性能的中文文本。', options: { fontSize: 24 } },
      { text: 'هذا نص عربي لاختبار التشكيل.', options: { rtl: true, fontSize: 28 } },
      { text: 'Section 4.1: Technical Architecture.', options: { fontSize: 24, bold: true } },
    ];

    // Pass 1: Fresh document parse / cold start
    const pass1 = engine.shapeParagraph(paragraph);
    expect(pass1.passHitRate).toBe(0.0); // cold cache
    expect(pass1.runs.length).toBeGreaterThanOrEqual(4);

    // Passes 2 to 20: Repeated line breaking / pagination / relayout passes
    const TOTAL_PASSES = 20;
    for (let p = 2; p <= TOTAL_PASSES; p++) {
      const passResult = engine.shapeParagraph(paragraph);
      expect(passResult.passHitRate).toBe(1.0); // 100% hits on repeated runs
    }

    const overallStats = engine.cache.getStats();
    // Cold pass had ~4 misses. 19 subsequent passes had 19 * 4 = 76 hits.
    // Total hit rate = 76 / 80 = 95.0% (> 90%)
    expect(overallStats.hitRate).toBeGreaterThan(0.9);
    console.log(
      `[Phase 4 Verification] Repeated paragraph cache hit rate: ${(overallStats.hitRate * 100).toFixed(1)}% ` +
        `(${overallStats.hits} hits / ${overallStats.hits + overallStats.misses} total lookups, ` +
        `memory: ${overallStats.currentBytes} bytes across ${overallStats.entryCountL1} L1 entries)`,
    );
  });

  it('purges cached runs on exact font face or text invalidation', () => {
    const engine = new TextEngine();

    const text = 'Editable paragraph content';
    engine.shapeRun(text, { fontSize: 22 });

    const statsBefore = engine.cache.getStats();
    expect(statsBefore.entryCountL1).toBe(1);

    // Invalidate the text handle
    const invalidated = engine.invalidateText(text);
    expect(invalidated).toBe(1);

    const statsAfter = engine.cache.getStats();
    expect(statsAfter.entryCountL1).toBe(0);

    // Shaping again results in a cache miss and repopulation
    const res = engine.shapeRun(text, { fontSize: 22 });
    expect(res[0]!.cached).toBe(false);
  });
});
