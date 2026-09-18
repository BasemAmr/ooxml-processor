import { describe, expect, it, vi } from 'vitest';
import {
  FontLoader,
  type FontFaceApiAdapter,
  type FontSettledEvent,
  type FontSourceResolver,
} from './font-loader.js';

describe('FontFace Loading & FOUT Mitigation (P4-05)', () => {
  it('returns metric-compatible fallback immediately for idle/loading fonts (non-blocking first paint)', () => {
    const loader = new FontLoader();

    // Calibri has known metric-compatible substitute Carlito
    expect(loader.getFontStatus('Calibri')).toBe('idle');
    expect(loader.getEffectiveFont('Calibri')).toBe('Carlito');

    // Times New Roman has known metric-compatible substitute Liberation Serif
    expect(loader.getEffectiveFont('Times New Roman')).toBe('Liberation Serif');
  });

  it('deduplicates concurrent in-flight font load requests into a single promise', async () => {
    let resolveSource: (value: ArrayBuffer) => void;
    const sourcePromise = new Promise<ArrayBuffer>((res) => {
      resolveSource = res;
    });

    const mockResolver: FontSourceResolver = {
      resolveFontSource: vi.fn().mockReturnValue(sourcePromise),
    };

    const mockAdapter: FontFaceApiAdapter = {
      load: vi.fn().mockResolvedValue(undefined),
    };

    const loader = new FontLoader({
      sourceResolver: mockResolver,
      fontFaceAdapter: mockAdapter,
    });

    // Request same font twice simultaneously
    const p1 = loader.loadFont('CustomSerif');
    const p2 = loader.loadFont('CustomSerif');

    // Both requests must share the exact same Promise instance
    expect(p1).toBe(p2);
    expect(loader.getFontStatus('CustomSerif')).toBe('loading');
    expect(mockResolver.resolveFontSource).toHaveBeenCalledTimes(1);

    // Fulfill font source
    resolveSource!(new ArrayBuffer(16));
    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1.status).toBe('loaded');
    expect(res2.status).toBe('loaded');
    expect(mockAdapter.load).toHaveBeenCalledTimes(1);
    expect(loader.getFontStatus('CustomSerif')).toBe('loaded');
    expect(loader.getEffectiveFont('CustomSerif')).toBe('CustomSerif');
  });

  it('notifies affected paragraphs incrementally on font load', async () => {
    const mockResolver: FontSourceResolver = {
      resolveFontSource: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
    };
    const mockAdapter: FontFaceApiAdapter = {
      load: vi.fn().mockResolvedValue(undefined),
    };

    const loader = new FontLoader({
      sourceResolver: mockResolver,
      fontFaceAdapter: mockAdapter,
    });

    // Track paragraphs using different fonts
    loader.trackParagraphFont('p1', 'BrandSans');
    loader.trackParagraphFont('p2', 'OtherFont');
    loader.trackParagraphFont('p3', 'BrandSans');

    const settledEvents: FontSettledEvent[] = [];
    loader.onFontSettled((ev) => {
      settledEvents.push(ev);
    });

    const loadedFamilyCallbacks: string[] = [];
    loader.onFontLoaded((family) => {
      loadedFamilyCallbacks.push(family);
    });

    await loader.loadFont('BrandSans');

    expect(settledEvents).toHaveLength(1);
    const ev = settledEvents[0]!;
    expect(ev.fontFamily).toBe('BrandSans');
    expect(ev.status).toBe('loaded');
    expect(ev.effectiveFont).toBe('BrandSans');
    // Only p1 and p3 used BrandSans; p2 must NOT be marked dirty
    expect(Array.from(ev.dirtyParagraphIds).sort()).toEqual(['p1', 'p3']);

    expect(loadedFamilyCallbacks).toEqual(['BrandSans']);
  });

  it('handles load failure by permanently settling to metric-compatible fallback without hanging or re-requesting', async () => {
    const mockResolver: FontSourceResolver = {
      resolveFontSource: vi.fn().mockRejectedValue(new Error('Network 404: font not found')),
    };

    const loader = new FontLoader({
      sourceResolver: mockResolver,
    });

    loader.trackParagraphFont('para-failed', 'Calibri');

    const events: FontSettledEvent[] = [];
    loader.onFontSettled((ev) => events.push(ev));

    // Initial load fails
    const result1 = await loader.loadFont('Calibri');

    expect(result1.status).toBe('failed');
    expect(result1.isFallback).toBe(true);
    expect(result1.effectiveFont).toBe('Carlito');
    expect(loader.getFontStatus('Calibri')).toBe('failed');
    expect(loader.getEffectiveFont('Calibri')).toBe('Carlito');

    // Listener was notified with dirty paragraphs and permanent fallback font
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('failed');
    expect(events[0]!.effectiveFont).toBe('Carlito');
    expect(events[0]!.dirtyParagraphIds.has('para-failed')).toBe(true);

    // Subsequent load resolves immediately without calling sourceResolver again
    const result2 = await loader.loadFont('Calibri');
    expect(result2.status).toBe('failed');
    expect(result2.effectiveFont).toBe('Carlito');
    expect(mockResolver.resolveFontSource).toHaveBeenCalledTimes(1);
  });

  it('untracks deleted or updated paragraphs correctly', async () => {
    const mockResolver: FontSourceResolver = {
      resolveFontSource: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
    };
    const mockAdapter: FontFaceApiAdapter = {
      load: vi.fn().mockResolvedValue(undefined),
    };

    const loader = new FontLoader({
      sourceResolver: mockResolver,
      fontFaceAdapter: mockAdapter,
    });

    loader.trackParagraphFont('para-remove', 'SpecialFont');
    loader.trackParagraphFont('para-keep', 'SpecialFont');

    // Untrack para-remove
    loader.untrackParagraph('para-remove');

    const events: FontSettledEvent[] = [];
    loader.onFontSettled((ev) => events.push(ev));

    await loader.loadFont('SpecialFont');

    expect(events).toHaveLength(1);
    expect(Array.from(events[0]!.dirtyParagraphIds)).toEqual(['para-keep']);
  });
});
