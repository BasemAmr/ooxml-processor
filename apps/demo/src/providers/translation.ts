export interface TranslationProvider { translate(text: string, sourceLang: string, targetLang: string): Promise<string>; }

/** Deterministic offline provider used until an external translation service is configured. */
export class MockTranslationProvider implements TranslationProvider {
  async translate(text: string, _sourceLang: string, targetLang: string): Promise<string> {
    return `[Translated to ${targetLang}]: ${text}`;
  }
}
