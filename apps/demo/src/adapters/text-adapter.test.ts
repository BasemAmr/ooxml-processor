import { describe, expect, it } from 'vitest';
import { obfuscateFont } from '@ooxml/text';
import { DemoTextService } from './text-adapter.js';

const FONT_KEY = '12345678-abcd-ef01-2345-6789abcdef01';

describe('DemoTextService', () => {
  it('shapes mixed Arabic, Latin, and CJK text with UTF-16 source offsets', () => {
    const service = new DemoTextService();
    const text = 'Aسلام界';
    const result = service.shapeParagraph([{ text, options: { fontSize: 22 } }]);

    expect(result.runs.length).toBeGreaterThan(1);
    const clusters = result.runs.flatMap((run) =>
      Array.from({ length: run.shapedRun.clusterCount }, (_, index) => ({
        offset: run.shapedRun.srcOffset(index),
        length: run.shapedRun.srcLength(index),
      })),
    );
    expect(clusters.some((cluster) => cluster.offset === 0 && cluster.length === 1)).toBe(true);
    expect(clusters.some((cluster) => cluster.offset === 1)).toBe(true);
    expect(clusters.some((cluster) => cluster.offset === text.length - 1 && cluster.length === 1)).toBe(true);
    expect(result.totalAdvance).toBeGreaterThan(0);
  });

  it('forms a Latin ligature and keeps the source range on the cluster', () => {
    const result = new DemoTextService().shapeParagraph([{ text: 'office' }]);
    const ligature = result.runs.flatMap((candidate) =>
      Array.from({ length: candidate.shapedRun.clusterCount }, (_, index) => ({
        offset: candidate.shapedRun.srcOffset(index),
        length: candidate.shapedRun.srcLength(index),
      })),
    ).find((cluster) => cluster.length >= 2);
    expect(ligature).toBeDefined();
    expect(ligature?.offset).toBe(1);
    expect(ligature?.length).toBe(3);
  });

  it('uses the ODTTF resolver and emits safe invalidation snapshots', async () => {
    const plainFont = new Uint8Array(32);
    plainFont.set([0, 1, 0, 0]);
    const service = new DemoTextService({
      embeddedFonts: new Map([['DemoFont', { data: obfuscateFont(plainFont, FONT_KEY), fontKey: FONT_KEY }]]),
    });
    const events: number[] = [];
    service.trackParagraphFont('p1', 'DemoFont');
    service.onParagraphInvalidated((event) => {
      events.push(event.dirtyParagraphIds.size);
      (event.dirtyParagraphIds as Set<string | number>).clear();
    });

    await service.loadFont('DemoFont');
    expect(events).toEqual([1]);
    expect(service.fonts.getFontStatus('DemoFont')).toBe('loaded');
    expect(service.getEffectiveFont('DemoFont')).toBe('DemoFont');
  });
});
