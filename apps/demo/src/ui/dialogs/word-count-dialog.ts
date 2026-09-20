import { segmentWords } from '@ooxml/text';

export interface WordCountReport {
  readonly pages: number;
  readonly words: number;
  readonly characters: number;
  readonly charactersNoSpaces: number;
}

export interface WordCountOptions {
  readonly pageCount?: number;
  readonly lang?: string;
}

/** Counts document text using the same locale-aware segmenter as editor navigation. */
export function countWords(text: string, options: WordCountOptions = {}): WordCountReport {
  const words = segmentWords(text, options.lang).filter((segment) => segment.isWordLike).length;
  return {
    pages: Math.max(0, options.pageCount ?? 1),
    words,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/gu, '').length,
  };
}

export class WordCountDialog {
  constructor(private readonly root: HTMLElement) {}

  show(text: string, options: WordCountOptions = {}): WordCountReport {
    const report = countWords(text, options);
    this.root.textContent = `Pages: ${report.pages} | Words: ${report.words} | Characters: ${report.characters} | Characters (no spaces): ${report.charactersNoSpaces}`;
    this.root.hidden = false;
    return report;
  }

  hide(): void { this.root.hidden = true; }
}

export interface ToolsManagerOptions {
  readonly getText: () => string;
  readonly getPageCount?: () => number;
  readonly getLanguage?: () => string;
  readonly revisions?: RevisionsController;
  readonly setLineNumbers?: (enabled: boolean) => void;
}

/** UI-independent Tools menu coordinator; DOM dialogs are optional. */
export class ToolsManager {
  private lineNumbers = false;
  constructor(private readonly options: ToolsManagerOptions) {}

  showWordCount(root?: HTMLElement): WordCountReport {
    const language = this.options.getLanguage?.();
    const report = countWords(this.options.getText(), { pageCount: this.options.getPageCount?.() ?? 1, ...(language === undefined ? {} : { lang: language }) });
    if (root) root.textContent = `Pages: ${report.pages} | Words: ${report.words} | Characters: ${report.characters} | Characters (no spaces): ${report.charactersNoSpaces}`;
    return report;
  }

  showRevisions(): readonly RevisionDisplay[] { return this.options.revisions?.list() ?? []; }

  toggleLineNumbers(): boolean {
    this.lineNumbers = !this.lineNumbers;
    this.options.setLineNumbers?.(this.lineNumbers);
    return this.lineNumbers;
  }
}

export interface RevisionDisplay { readonly id: string; readonly author?: string; readonly kind: string; readonly text: string; }
export interface RevisionsController { list(): readonly RevisionDisplay[]; decide(id: string, decision: 'accept' | 'reject'): void; }
