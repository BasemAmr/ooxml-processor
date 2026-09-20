import { presetNames, type InsertionService } from '../../adapters/insertion-service.js';

export interface DrawingDialogOptions { readonly service: InsertionService; readonly onInserted?: (result: unknown) => void; }
export class DrawingDialog {
  readonly element: HTMLDivElement;
  constructor(options: DrawingDialogOptions) {
    this.element = document.createElement('div'); this.element.className = 'demo-drawing-dialog';
    for (const preset of presetNames().filter((name) => ['rect', 'roundRect', 'ellipse', 'star5', 'wedgeRoundRectCallout'].includes(name))) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = preset;
      button.addEventListener('click', () => options.onInserted?.(options.service.insertShape(preset))); this.element.append(button);
    }
  }
  destroy(): void { this.element.replaceChildren(); }
}
export function showDrawingDialog(container: HTMLElement, options: DrawingDialogOptions): DrawingDialog { const dialog = new DrawingDialog(options); container.append(dialog.element); return dialog; }
