import type { ImageInput, InsertionService } from '../../adapters/insertion-service.js';

export interface ImageGuidanceOptions { readonly service: InsertionService; readonly onInserted?: (result: unknown) => void; }

/** Explicit image import dialog. URLs are intentionally not fetched: OPC has no network resolver. */
export class ImageGuidanceDialog {
  readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  constructor(options: ImageGuidanceOptions) {
    this.element = document.createElement('div'); this.element.className = 'demo-image-guidance';
    this.input = document.createElement('input'); this.input.type = 'file'; this.input.accept = 'image/*';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Insert image';
    button.addEventListener('click', () => { const file = this.input.files?.[0]; if (!file) return; void options.service.insertImage(file as ImageInput).then(options.onInserted); });
    this.element.append(this.input, button);
  }
  destroy(): void { this.element.replaceChildren(); }
}

export function showImageGuidance(container: HTMLElement, options: ImageGuidanceOptions): ImageGuidanceDialog { const dialog = new ImageGuidanceDialog(options); container.append(dialog.element); return dialog; }
