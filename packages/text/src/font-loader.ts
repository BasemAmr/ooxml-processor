/**
 * FontFace Loading, Lifecycle Management, and FOUT Mitigation (P4-05).
 *
 * Implements Ticket P4-05.
 *
 * ## Architectural Policy (FOUT Mitigation & Incremental Relayout)
 * 1. Non-Blocking First Paint:
 *    Layout never blocks waiting for asynchronous network or embedded fonts.
 *    Initial layout immediately renders using the best available metric-compatible fallback
 *    (P4-03 / METRIC_COMPATIBLE_FONTS: e.g. Carlito for Calibri, Arimo for Arial) or generic family.
 * 2. Incremental Relayout (P6-13):
 *    When a font finishes loading (or permanently fails), FontLoader notifies subscribers
 *    with the exact set of dirty paragraph IDs that reference that font family, preventing
 *    full-document relayout.
 * 3. Request Deduplication:
 *    Multiple requests to load the same font family share a single in-flight Promise.
 * 4. Permanent Failure Settlement:
 *    If a font fails to load (network error, corrupted binary, missing source), its status
 *    is permanently recorded as 'failed'. Tracked paragraphs are notified with the permanent
 *    metric-compatible fallback, and future requests resolve immediately without re-trying.
 */

import { METRIC_COMPATIBLE_FONTS, substituteFont, type FontTable } from './fonts.js';

/**
 * Lifecycle state of a font family in the loader.
 */
export type FontLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * Standard CSS FontFace descriptors for style, weight, and stretch.
 */
export interface FontFaceDescriptors {
  readonly style?: string | undefined;
  readonly weight?: string | number | undefined;
  readonly stretch?: string | undefined;
  readonly unicodeRange?: string | undefined;
  readonly variant?: string | undefined;
  readonly featureSettings?: string | undefined;
  readonly display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional' | undefined;
}

/**
 * Record tracking the loaded/cached state of a font family.
 */
export interface FontStateRecord {
  readonly family: string;
  readonly status: FontLoadStatus;
  readonly fallbackFont: string;
  readonly error?: Error | undefined;
  readonly descriptors?: FontFaceDescriptors | undefined;
}

/**
 * Result returned when a font load operation settles.
 */
export interface FontLoadResult {
  readonly family: string;
  readonly effectiveFont: string;
  readonly status: 'loaded' | 'failed';
  readonly isFallback: boolean;
  readonly error?: Error | undefined;
}

/**
 * Event notification payload dispatched when a font settles.
 */
export interface FontSettledEvent {
  readonly fontFamily: string;
  readonly status: 'loaded' | 'failed';
  readonly effectiveFont: string;
  readonly fallbackFont: string;
  readonly dirtyParagraphIds: ReadonlySet<string | number>;
  readonly error?: Error | undefined;
}

export type FontSettledListener = (event: FontSettledEvent) => void;

/**
 * Pluggable source resolver for acquiring binary font data or URLs.
 */
export interface FontSourceResolver {
  resolveFontSource(
    family: string,
    descriptors?: FontFaceDescriptors | undefined,
  ): Promise<ArrayBuffer | Uint8Array | string | null> | ArrayBuffer | Uint8Array | string | null;
}

/**
 * Pluggable FontFace API adapter (for mocking in Node/Vitest environments or custom canvas runtimes).
 */
export interface FontFaceApiAdapter {
  load(
    family: string,
    source: ArrayBuffer | Uint8Array | string,
    descriptors?: FontFaceDescriptors | undefined,
  ): Promise<void>;
}

/**
 * Default browser FontFace adapter using `window.FontFace` and `document.fonts`.
 */
export class BrowserFontFaceAdapter implements FontFaceApiAdapter {
  async load(
    family: string,
    source: ArrayBuffer | Uint8Array | string,
    descriptors?: FontFaceDescriptors | undefined,
  ): Promise<void> {
    // If running in browser with FontFace API
    if (typeof globalThis !== 'undefined' && 'FontFace' in globalThis) {
      const FontFaceConstructor = (globalThis as any).FontFace;
      let fontSource: any = source;

      if (typeof source === 'string') {
        // If URL or local font name
        fontSource =
          source.startsWith('url(') || source.startsWith('local(') ? source : `url(${source})`;
      }

      const face = new FontFaceConstructor(family, fontSource, descriptors ?? {});
      await face.load();

      if (typeof document !== 'undefined' && document.fonts) {
        document.fonts.add(face);
      }
    }
  }
}

export interface FontLoaderOptions {
  /** Source resolver for font binaries / URLs */
  readonly sourceResolver?: FontSourceResolver | undefined;
  /** Custom adapter for FontFace registration */
  readonly fontFaceAdapter?: FontFaceApiAdapter | undefined;
  /** Optional OOXML FontTable for resolving fallbacks via PANOSE/altName */
  readonly fontTable?: FontTable | undefined;
  /** Available system fonts list for fallback resolution */
  readonly availableFonts?: readonly string[] | undefined;
}

/**
 * Manages asynchronous font loading, FOUT mitigation, in-flight deduplication,
 * and incremental paragraph dirty notifications.
 */
export class FontLoader {
  private readonly sourceResolver?: FontSourceResolver | undefined;
  private readonly fontFaceAdapter: FontFaceApiAdapter;
  private readonly fontTable?: FontTable | undefined;
  private readonly availableFonts?: readonly string[] | undefined;

  /** Status record per normalized font family key */
  private readonly fontStates = new Map<string, FontStateRecord>();
  /** In-flight load promises per normalized font family key */
  private readonly inFlightLoads = new Map<string, Promise<FontLoadResult>>();
  /** Paragraph IDs mapped to the set of font families they use */
  private readonly paragraphFonts = new Map<string | number, Set<string>>();
  /** Font families mapped to the set of paragraph IDs using them */
  private readonly fontToParagraphs = new Map<string, Set<string | number>>();
  /** Registered listeners for font settle events */
  private readonly listeners = new Set<FontSettledListener>();

  constructor(options: FontLoaderOptions = {}) {
    this.sourceResolver = options.sourceResolver;
    this.fontFaceAdapter = options.fontFaceAdapter ?? new BrowserFontFaceAdapter();
    this.fontTable = options.fontTable;
    this.availableFonts = options.availableFonts;
  }

  /**
   * Normalizes font family string for indexing.
   */
  private normalizeFamily(family: string): string {
    return family.trim().toLowerCase();
  }

  /**
   * Computes the immediate metric-compatible fallback font for a requested family.
   */
  public resolveFallbackFont(family: string): string {
    const norm = this.normalizeFamily(family);

    // 1. Check known metric-compatible table directly
    const candidates = METRIC_COMPATIBLE_FONTS[norm];
    if (candidates && candidates.length > 0) {
      return candidates[0]!;
    }

    // 2. Use full font substitution ladder if fontTable/availableFonts available
    const sub = substituteFont(family, this.fontTable, this.availableFonts);
    return sub.resolvedFont;
  }

  /**
   * Gets the current load status of a font family.
   */
  public getFontStatus(family: string): FontLoadStatus {
    const norm = this.normalizeFamily(family);
    return this.fontStates.get(norm)?.status ?? 'idle';
  }

  /**
   * Returns the currently usable font for layout and paint.
   *
   * Non-blocking guarantee:
   *   - If the font is 'loaded', returns the actual family name.
   *   - If the font is 'idle', 'loading', or 'failed', returns the metric-compatible fallback.
   * This ensures first paint is never blocked by pending fonts.
   */
  public getEffectiveFont(family: string): string {
    const norm = this.normalizeFamily(family);
    const record = this.fontStates.get(norm);

    if (record && record.status === 'loaded') {
      return record.family;
    }

    return record ? record.fallbackFont : this.resolveFallbackFont(family);
  }

  /**
   * Associates a paragraph with a font family it consumes.
   * Used for incremental dirtying when the font finishes loading.
   */
  public trackParagraphFont(paragraphId: string | number, family: string): void {
    const norm = this.normalizeFamily(family);

    // Map paragraph -> fonts
    let paraSet = this.paragraphFonts.get(paragraphId);
    if (!paraSet) {
      paraSet = new Set();
      this.paragraphFonts.set(paragraphId, paraSet);
    }
    paraSet.add(norm);

    // Map font -> paragraphs
    let fontSet = this.fontToParagraphs.get(norm);
    if (!fontSet) {
      fontSet = new Set();
      this.fontToParagraphs.set(norm, fontSet);
    }
    fontSet.add(paragraphId);
  }

  /**
   * Removes tracking for a paragraph (e.g. when paragraph is deleted or rewritten).
   */
  public untrackParagraph(paragraphId: string | number): void {
    const fonts = this.paragraphFonts.get(paragraphId);
    if (fonts) {
      for (const norm of fonts) {
        const fontSet = this.fontToParagraphs.get(norm);
        if (fontSet) {
          fontSet.delete(paragraphId);
          if (fontSet.size === 0) {
            this.fontToParagraphs.delete(norm);
          }
        }
      }
      this.paragraphFonts.delete(paragraphId);
    }
  }

  /**
   * Subscribes a listener to font resolution events.
   * Returns an unsubscribe function.
   */
  public onFontSettled(listener: FontSettledListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Convenience subscription for when a font successfully loads.
   */
  public onFontLoaded(callback: (fontFamily: string) => void): () => void {
    return this.onFontSettled((ev) => {
      if (ev.status === 'loaded') {
        callback(ev.fontFamily);
      }
    });
  }

  /**
   * Loads a font family asynchronously.
   *
   * In-Flight Deduplication:
   *   If loadFont is called multiple times for the same family while loading,
   *   a single shared Promise is returned.
   *
   * Failure Settlement:
   *   If loading fails, the font is permanently marked as 'failed', tracked
   *   paragraphs are notified with the fallback font, and subsequent calls
   *   resolve immediately with the fallback.
   */
  public loadFont(
    family: string,
    descriptors?: FontFaceDescriptors | undefined,
  ): Promise<FontLoadResult> {
    const rawFamily = family.trim();
    const norm = this.normalizeFamily(family);

    // 1. Check existing state
    const existing = this.fontStates.get(norm);
    if (existing?.status === 'loaded') {
      return Promise.resolve({
        family: existing.family,
        effectiveFont: existing.family,
        status: 'loaded',
        isFallback: false,
      });
    }
    if (existing?.status === 'failed') {
      return Promise.resolve({
        family: existing.family,
        effectiveFont: existing.fallbackFont,
        status: 'failed',
        isFallback: true,
        error: existing.error,
      });
    }

    // 2. Check in-flight promise: returning inFlight directly preserves Promise referential identity
    const inFlight = this.inFlightLoads.get(norm);
    if (inFlight) {
      return inFlight;
    }

    // 3. Initiate new load
    const fallbackFont = existing?.fallbackFont ?? this.resolveFallbackFont(rawFamily);
    this.fontStates.set(norm, {
      family: rawFamily,
      status: 'loading',
      fallbackFont,
      descriptors,
    });

    const loadPromise = (async (): Promise<FontLoadResult> => {
      try {
        if (!this.sourceResolver) {
          throw new Error(`No FontSourceResolver configured to load font "${rawFamily}".`);
        }

        const source = await this.sourceResolver.resolveFontSource(rawFamily, descriptors);
        if (!source) {
          throw new Error(`Font source for "${rawFamily}" could not be resolved.`);
        }

        // Delegate to FontFace API adapter
        await this.fontFaceAdapter.load(rawFamily, source, descriptors);

        // Mark loaded
        this.fontStates.set(norm, {
          family: rawFamily,
          status: 'loaded',
          fallbackFont,
          descriptors,
        });

        // Notify affected paragraphs
        this.notifySettled(norm, rawFamily, 'loaded', rawFamily, fallbackFont);

        return {
          family: rawFamily,
          effectiveFont: rawFamily,
          status: 'loaded',
          isFallback: false,
        };
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));

        // Mark permanently failed
        this.fontStates.set(norm, {
          family: rawFamily,
          status: 'failed',
          fallbackFont,
          descriptors,
          error,
        });

        // Invalidate paragraphs so they switch to permanent fallback
        this.notifySettled(norm, rawFamily, 'failed', fallbackFont, fallbackFont, error);

        return {
          family: rawFamily,
          effectiveFont: fallbackFont,
          status: 'failed',
          isFallback: true,
          error,
        };
      } finally {
        this.inFlightLoads.delete(norm);
      }
    })();

    this.inFlightLoads.set(norm, loadPromise);
    return loadPromise;
  }

  /**
   * Dispatches font settled event to listeners with affected paragraph IDs.
   */
  private notifySettled(
    normFamily: string,
    fontFamily: string,
    status: 'loaded' | 'failed',
    effectiveFont: string,
    fallbackFont: string,
    error?: Error | undefined,
  ): void {
    const dirtyParagraphs = new Set(this.fontToParagraphs.get(normFamily) ?? []);

    const event: FontSettledEvent = {
      fontFamily,
      status,
      effectiveFont,
      fallbackFont,
      dirtyParagraphIds: dirtyParagraphs,
      error,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // Listener errors are logged without breaking loader loop
        console.error('Error in FontLoader listener:', err);
      }
    }
  }

  /**
   * Resets all loaded states and tracked paragraphs (useful in testing).
   */
  public clear(): void {
    this.fontStates.clear();
    this.inFlightLoads.clear();
    this.paragraphFonts.clear();
    this.fontToParagraphs.clear();
    this.listeners.clear();
  }
}
