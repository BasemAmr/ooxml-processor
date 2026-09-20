import { type InsertionService } from '../../adapters/insertion-service.js';

export interface EquationDialogOptions { readonly service: InsertionService; readonly onInserted?: (result: unknown) => void; }
export class EquationDialog {
  readonly element: HTMLDivElement;
  constructor(options: EquationDialogOptions) {
    this.element = document.createElement('div'); this.element.className = 'demo-equation-dialog';
    const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'x^2 + y^2'; input.setAttribute('aria-label', 'Equation');
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Insert equation';
    button.addEventListener('click', () => options.onInserted?.(options.service.insertEquation(input.value || ''))); this.element.append(input, button);
  }
  destroy(): void { this.element.replaceChildren(); }
}
export function showEquationDialog(container: HTMLElement, options: EquationDialogOptions): EquationDialog { const dialog = new EquationDialog(options); container.append(dialog.element); return dialog; }
