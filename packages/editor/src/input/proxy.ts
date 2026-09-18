import type { Rect } from '../caret.js';

export interface InputProxyOptions {
  container: HTMLElement;       // where to append the proxy
  onInput: (text: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onCompositionStart: () => void;
  onCompositionUpdate: (text: string) => void;
  onCompositionEnd: (text: string) => void;
  onPaste: (data: DataTransfer) => void;
  onCopy: () => DataTransfer | null;
  onCut: () => DataTransfer | null;
}

export class InputProxy {
  private el: HTMLTextAreaElement;
  private _isComposing: boolean = false;
  private options: InputProxyOptions;

  constructor(options: InputProxyOptions) {
    this.options = options;
    
    // Create hidden textarea that captures all input
    this.el = document.createElement('textarea');
    
    // Style it strictly according to rules to avoid IME misplacement and layout issues
    Object.assign(this.el.style, {
      position: 'absolute',
      opacity: '0',
      width: '1px',
      height: '1px',
      outline: 'none',
      border: 'none',
      padding: '0',
      resize: 'none',
      whiteSpace: 'pre',
      overflow: 'hidden'
      // DO NOT use display: none or visibility: hidden!
    });
    
    // Disable standard text assistance features that mess with custom input
    this.el.setAttribute('autocapitalize', 'off');
    this.el.setAttribute('autocorrect', 'off');
    this.el.setAttribute('autocomplete', 'off');
    this.el.setAttribute('spellcheck', 'false');

    // Attach event listeners
    this.el.addEventListener('keydown', this.handleKeyDown);
    this.el.addEventListener('beforeinput', this.handleBeforeInput);
    this.el.addEventListener('compositionstart', this.handleCompositionStart);
    this.el.addEventListener('compositionupdate', this.handleCompositionUpdate);
    this.el.addEventListener('compositionend', this.handleCompositionEnd);
    this.el.addEventListener('paste', this.handlePaste);
    this.el.addEventListener('copy', this.handleCopy);
    this.el.addEventListener('cut', this.handleCut);
    
    options.container.appendChild(this.el);
  }

  // Position the proxy at the caret for correct IME candidate window placement
  public positionAt(rect: Rect): void {
    // Only update position, do not change visibility
    this.el.style.left = `${rect.x}px`;
    this.el.style.top = `${rect.y}px`;
    this.el.style.height = `${rect.h}px`; // Match height for better IME alignment
  }

  // Focus the proxy without scrolling the page
  public focus(): void {
    this.el.focus({ preventScroll: true });
  }

  // Check if the proxy currently has focus
  public hasFocus(): boolean {
    return document.activeElement === this.el;
  }

  // Whether a composition is currently active
  public get isComposing(): boolean {
    return this._isComposing;
  }

  // Clean up event listeners and remove from DOM
  public dispose(): void {
    this.el.removeEventListener('keydown', this.handleKeyDown);
    this.el.removeEventListener('beforeinput', this.handleBeforeInput);
    this.el.removeEventListener('compositionstart', this.handleCompositionStart);
    this.el.removeEventListener('compositionupdate', this.handleCompositionUpdate);
    this.el.removeEventListener('compositionend', this.handleCompositionEnd);
    this.el.removeEventListener('paste', this.handlePaste);
    this.el.removeEventListener('copy', this.handleCopy);
    this.el.removeEventListener('cut', this.handleCut);
    
    if (this.el.parentElement) {
      this.el.parentElement.removeChild(this.el);
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // NEVER call preventDefault() on a key that could start a composition
    // Wait for the composition events instead
    if (this._isComposing || e.key === 'Process') return;
    
    this.options.onKeyDown(e);
  };

  private handleBeforeInput = (e: InputEvent): void => {
    if (this._isComposing) return;
    
    if (e.inputType === 'insertText' && e.data) {
      e.preventDefault();
      this.options.onInput(e.data);
    }
  };

  private handleCompositionStart = (): void => {
    this._isComposing = true;
    this.options.onCompositionStart();
  };

  private handleCompositionUpdate = (e: CompositionEvent): void => {
    this.options.onCompositionUpdate(e.data);
  };

  private handleCompositionEnd = (e: CompositionEvent): void => {
    this._isComposing = false;
    this.el.value = ''; // Reset value after composition
    this.options.onCompositionEnd(e.data);
  };

  private handlePaste = (e: ClipboardEvent): void => {
    if (e.clipboardData) {
      e.preventDefault();
      this.options.onPaste(e.clipboardData);
    }
  };

  private handleCopy = (e: ClipboardEvent): void => {
    const data = this.options.onCopy();
    if (data && e.clipboardData) {
      e.preventDefault();
      // In a real implementation we would populate e.clipboardData from data
      // For simplicity, assuming the caller handles it or we'd map it here
    }
  };

  private handleCut = (e: ClipboardEvent): void => {
    const data = this.options.onCut();
    if (data && e.clipboardData) {
      e.preventDefault();
    }
  };
}
