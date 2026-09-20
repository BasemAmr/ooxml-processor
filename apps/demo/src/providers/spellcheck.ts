export interface SpellcheckIssue { readonly word: string; readonly offset: number; readonly length: number; readonly suggestions: readonly string[]; }

const WORDS = new Set(['a','and','arabic','document','editor','hello','is','text','the','this','to','world']);

export interface SpellcheckProvider { check(text: string, lang?: string): Promise<readonly SpellcheckIssue[]>; }

export class MockSpellcheckProvider implements SpellcheckProvider {
  async check(text: string, _lang = 'en-US'): Promise<readonly SpellcheckIssue[]> {
    const issues: SpellcheckIssue[] = [];
    for (const match of text.matchAll(/[\p{L}]+/gu)) {
      const word = match[0] ?? '';
      if (!WORDS.has(word.toLocaleLowerCase())) issues.push({ word, offset: match.index ?? 0, length: word.length, suggestions: [] });
    }
    return issues;
  }
}
