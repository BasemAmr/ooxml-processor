import {
  applyRunProperty,
  toggleRunProperty,
  type DocumentModel,
  type Selection,
  type Transaction,
} from '@ooxml/editor';
import { isToggleProperty } from '@ooxml/wml';
import { ColorPicker, COLOR_PALETTE } from './dialogs/color-picker.js';

export interface FormattingToolbarOptions {
  readonly model: DocumentModel;
  readonly getSelection: () => Selection;
  /** The host records the transaction, updates selection, and requests relayout/paint. */
  readonly onTransaction?: (transaction: Transaction) => void;
  readonly fonts?: readonly string[];
}

export const DEFAULT_FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana'];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;

/**
 * Vanilla DOM formatting controls. Mutations deliberately go through the public editor API so
 * toggle properties retain the package's inheritance/XOR semantics and remain undoable by the host.
 */
export class FormattingToolbar {
  readonly element: HTMLDivElement;
  private readonly options: FormattingToolbarOptions;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly colorPicker: ColorPicker;

  constructor(options: FormattingToolbarOptions) {
    this.options = options;
    this.element = document.createElement('div');
    this.element.className = 'demo-formatting-toolbar';
    this.element.setAttribute('role', 'toolbar');
    this.colorPicker = new ColorPicker({ label: 'Text color', onSelect: (hex) => this.setColor(hex) });
    this.render();
  }

  private render(): void {
    this.addToggle('bold', 'Bold', 'b');
    this.addToggle('italic', 'Italic', 'i');
    this.addToggle('underline', 'Underline', 'u');
    this.addToggle('strikethrough', 'Strikethrough', 'strike');
    this.addToggle('superscript', 'Superscript', 'vertAlign', 'superscript');
    this.addToggle('subscript', 'Subscript', 'vertAlign', 'subscript');

    const fonts = document.createElement('select');
    fonts.title = 'Font family';
    fonts.setAttribute('aria-label', 'Font family');
    for (const family of this.options.fonts ?? DEFAULT_FONTS) {
      const option = document.createElement('option');
      option.value = family;
      option.textContent = family;
      fonts.append(option);
    }
    fonts.addEventListener('change', () => this.setFont(fonts.value));
    this.element.append(fonts);

    const sizes = document.createElement('select');
    sizes.title = 'Font size';
    sizes.setAttribute('aria-label', 'Font size');
    for (const size of FONT_SIZES) {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = String(size);
      sizes.append(option);
    }
    sizes.addEventListener('change', () => this.setSize(Number(sizes.value)));
    this.element.append(sizes);

    const color = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Text color';
    color.append(summary, this.colorPicker.element);
    this.element.append(color);

    const highlight = document.createElement('details');
    const highlightSummary = document.createElement('summary');
    highlightSummary.textContent = 'Highlight';
    const highlightPicker = new ColorPicker({
      label: 'Highlight color',
      colors: COLOR_PALETTE,
      onSelect: (hex) => this.apply('highlight', hex),
    });
    highlight.append(highlightSummary, highlightPicker.element);
    this.element.append(highlight);
  }

  private addToggle(id: string, label: string, property: string, value?: unknown): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.dataset.command = id;
    button.addEventListener('click', () => {
      if (value === undefined) this.toggle(property);
      else this.apply(property, value);
    });
    this.buttons.set(id, button);
    this.element.append(button);
  }

  toggleBold(): void { this.toggle('b'); }
  toggleItalic(): void { this.toggle('i'); }
  toggleUnderline(): void { this.apply('u', { val: 'single' }); }
  toggleStrikethrough(): void { this.toggle('strike'); }
  toggleSuperscript(): void { this.apply('vertAlign', 'superscript'); }
  toggleSubscript(): void { this.apply('vertAlign', 'subscript'); }

  setFont(family: string): void { this.apply('rFonts', family); }
  setSize(size: number): void {
    if (!Number.isFinite(size) || size <= 0) return;
    this.apply('sz', size);
  }
  setColor(hex: string): void {
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) this.apply('color', hex.slice(1).toUpperCase());
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
    switch (event.key.toLowerCase()) {
      case 'b': event.preventDefault(); this.toggleBold(); return true;
      case 'i': event.preventDefault(); this.toggleItalic(); return true;
      case 'u': event.preventDefault(); this.toggleUnderline(); return true;
      default: return false;
    }
  }

  destroy(): void {
    this.colorPicker.destroy();
    this.element.replaceChildren();
    this.buttons.clear();
  }

  private toggle(property: string): void {
    // Guarding here documents the allowed path and prevents accidental XOR bypasses for buttons.
    if (!isToggleProperty(property)) return;
    this.options.onTransaction?.(toggleRunProperty(this.options.model, this.options.getSelection(), property));
  }

  private apply(property: string, value: unknown): void {
    this.options.onTransaction?.(applyRunProperty(this.options.model, this.options.getSelection(), property, value));
  }
}
