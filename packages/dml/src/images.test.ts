import { describe, expect, it } from 'vitest';
import { imageSource, resolveBlipImage } from './images.js';

describe('DrawingML images', () => {
  it('blocks external links and labels unsupported formats', () => {
    expect(resolveBlipImage({ link: 'https://example.test/a.png' }, new Map()).external).toBe(true);
    expect(
      resolveBlipImage(
        { embed: 'r1' },
        new Map([['r1', { name: 'chart.emf', mimeType: 'image/x-emf' }]]),
      ).placeholder,
    ).toContain('chart.emf');
  });
  it('returns a cropped image source without decoding per call', () => {
    const out = imageSource(
      { blip: { embed: 'r1' }, srcRect: { l: 10000 } },
      new Map([['r1', { name: 'a.png', mimeType: 'image/png' }]]),
      100,
      50,
    );
    expect(out?.sx).toBe(10);
    expect(out?.sw).toBe(90);
  });
});
