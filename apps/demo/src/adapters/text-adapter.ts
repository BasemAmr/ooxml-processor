import {
  deobfuscateFont,
  FontLoader,
  MeasurementCache,
  TextEngine,
  createTextShaper,
  type FontFaceDescriptors,
  type FontLoadResult,
  type FontSettledEvent,
  type FontSettledListener,
  type FontSourceResolver,
  type HarfBuzzWasmApi,
  type ParagraphShapingResult,
  type ParagraphRunInput,
  type ShaperFeatureOptions,
  type FaceResolver,
} from '@ooxml/text';

/** An embedded OOXML font before the 32-byte ODTTF header is de-obfuscated. */
export interface EmbeddedFontSource {
  readonly data: Uint8Array;
  readonly fontKey: string;
}

export interface TextServiceOptions {
  readonly cache?: MeasurementCache;
  readonly harfbuzz?: HarfBuzzWasmApi;
  readonly resolveFace?: FaceResolver;
  readonly sourceResolver?: FontSourceResolver;
  readonly embeddedFonts?: ReadonlyMap<string, EmbeddedFontSource>;
  readonly onFontSettled?: FontSettledListener;
  /** Called after a font settles; errors from one listener never stop another. */
  readonly onParagraphInvalidated?: (event: FontSettledEvent) => void;
}

/**
 * Demo boundary for shaping and font lifecycle.
 *
 * TextEngine deliberately receives createTextShaper(undefined) when no WASM API
 * is supplied: this makes the fallback immediate rather than waiting for a
 * network/module promise, while preserving Arabic/CJK source clusters.
 */
export class DemoTextService {
  readonly fonts: FontLoader;
  readonly engine: TextEngine;
  private readonly invalidationListeners = new Set<(event: FontSettledEvent) => void>();

  constructor(options: TextServiceOptions = {}) {
    const embedded = options.embeddedFonts;
    const sourceResolver = options.sourceResolver ?? (embedded === undefined ? undefined : {
      resolveFontSource: (family: string) => {
        const source = embedded.get(family) ?? embedded.get(family.trim().toLowerCase());
        return source === undefined ? null : deobfuscateFont(source.data, source.fontKey);
      },
    });

    this.fonts = new FontLoader(sourceResolver === undefined ? {} : { sourceResolver });
    this.engine = new TextEngine({
      cache: options.cache ?? new MeasurementCache(),
      // Passing no API is intentional: createTextShaper immediately constructs
      // FallbackTextShaper; this is the documented no-WASM behavior.
      shaper: createTextShaper(options.harfbuzz),
      ...(options.resolveFace === undefined ? {} : { resolveFace: options.resolveFace }),
    });

    if (options.onParagraphInvalidated !== undefined) {
      this.invalidationListeners.add(options.onParagraphInvalidated);
    }
    if (options.onFontSettled !== undefined) {
      this.fonts.onFontSettled(options.onFontSettled);
    }
    this.fonts.onFontSettled((event) => {
      // The loader snapshots dirty IDs. Snapshotting again prevents a consumer
      // from mutating loader-owned state while notifications are being emitted.
      const safeEvent: FontSettledEvent = {
        ...event,
        dirtyParagraphIds: new Set(event.dirtyParagraphIds),
      };
      for (const listener of [...this.invalidationListeners]) {
        try {
          listener(safeEvent);
        } catch {
          // A dirty-marking observer is optional; one bad observer must not
          // prevent the remaining observers or FontLoader settlement.
        }
      }
    });
  }

  shapeParagraph(
    runs: readonly ParagraphRunInput[],
    baseLevel?: 0 | 1 | 'auto',
    features?: ShaperFeatureOptions,
  ): ParagraphShapingResult {
    return this.engine.shapeParagraph(runs, baseLevel, features);
  }

  /** Loads asynchronously, but callers always get the loader's immediate fallback first. */
  async loadFont(family: string, descriptors?: FontFaceDescriptors): Promise<void> {
    await this.fonts.loadFont(family, descriptors);
  }

  trackParagraphFont(paragraphId: string | number, family: string): void {
    this.fonts.trackParagraphFont(paragraphId, family);
  }

  onParagraphInvalidated(listener: (event: FontSettledEvent) => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  getEffectiveFont(family: string): string {
    return this.fonts.getEffectiveFont(family);
  }
}

export type { FontLoadResult, FontSettledEvent, ParagraphShapingResult, ParagraphRunInput };
