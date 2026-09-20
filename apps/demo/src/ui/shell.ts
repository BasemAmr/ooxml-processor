import { createAccessibilityMirror, LatencyTracker, type Caret, type Selection } from '@ooxml/editor';
import { resolveBidi } from '@ooxml/text';
import { ARABIC_LABELS, type DemoLanguage } from './i18n/ar.js';
import { AiPanel } from './ai-panel.js';

export interface AppShellOptions {
  readonly root: HTMLElement;
  readonly aiPanel?: AiPanel;
}

/** Main demo shell. UI direction is independent from document paragraph bidi. */
export class AppShell {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  readonly a11y = createAccessibilityMirror();
  readonly latency = new LatencyTracker();
  readonly aiPanel: AiPanel;
  private language: DemoLanguage = 'en';
  private readonly labels = new Map<string, HTMLElement>();

  constructor(options: AppShellOptions) {
    this.root = options.root;
    this.content = document.createElement('main');
    this.content.className = 'demo-shell-content';
    this.aiPanel = options.aiPanel ?? new AiPanel();
    this.root.classList.add('demo-shell');
    const header = document.createElement('header');
    const title = document.createElement('h1');
    this.labels.set('appTitle', title);
    const language = document.createElement('button');
    language.type = 'button';
    language.addEventListener('click', () => this.setLanguage(this.language === 'en' ? 'ar' : 'en'));
    this.labels.set('language', language);
    const menus = document.createElement('nav');
    for (const key of ['file', 'edit', 'view', 'insert', 'format', 'tools'] as const) {
      const item = document.createElement('span');
      this.labels.set(key, item);
      menus.appendChild(item);
    }
    header.append(title, language, menus);
    this.root.append(header, this.content, this.aiPanel.element);
    this.a11y.attach(this.root);
    this.setLanguage('en');
  }

  setLanguage(lang: DemoLanguage): void {
    this.language = lang;
    this.root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    this.root.lang = lang;
    const values = lang === 'ar' ? ARABIC_LABELS : {
      appTitle: 'Document Editor', file: 'File', edit: 'Edit', view: 'View', insert: 'Insert', format: 'Format', tools: 'Tools', language: 'العربية',
    };
    for (const [key, element] of this.labels) element.textContent = values[key as keyof typeof values] ?? key;
  }

  getLanguage(): DemoLanguage { return this.language; }
  getLatencyStats() { return this.latency.getStats(); }
  meetsLatencyBudget(ms = 16): boolean { return this.latency.meetsBudget(ms); }

  updateAccessibility(dirty: Set<number>, texts: Map<number, string>, caret?: Caret, visibleRange?: { first: number; last: number }): void {
    this.a11y.update(dirty as Set<import('@ooxml/wml').NodeId>, texts as Map<import('@ooxml/wml').NodeId, string>, visibleRange);
    if (caret) this.a11y.syncCaret(caret);
  }

  updateSelection(selection: Selection): void {
    // Keep the virtual mirror current; selection geometry remains canvas-owned.
    const text = selection.kind;
    this.root.dataset.selectionKind = text;
  }

  bidiDirection(text: string): 'ltr' | 'rtl' {
    return resolveBidi(text).baseLevel === 1 ? 'rtl' : 'ltr';
  }

  destroy(): void { this.a11y.detach(); this.aiPanel.destroy(); this.root.replaceChildren(); }
}
