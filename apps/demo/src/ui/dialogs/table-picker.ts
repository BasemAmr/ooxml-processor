export interface TablePickerOptions { readonly maxRows?: number; readonly maxColumns?: number; readonly onPick: (rows: number, columns: number) => void; }

/** Keyboard-accessible grid picker; insertion remains in InsertionService so UI cannot create partial AST. */
export class TablePicker {
  readonly element: HTMLDivElement;
  constructor(options: TablePickerOptions) {
    const rows = options.maxRows ?? 10, columns = options.maxColumns ?? 10;
    this.element = document.createElement('div'); this.element.className = 'demo-table-picker'; this.element.setAttribute('role', 'grid');
    for (let r = 1; r <= rows; r += 1) for (let c = 1; c <= columns; c += 1) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `${r} × ${c}`; button.setAttribute('aria-label', `Insert ${r} by ${c} table`);
      button.addEventListener('click', () => options.onPick(r, c)); this.element.append(button);
    }
  }
  destroy(): void { this.element.replaceChildren(); }
}

export function showTablePicker(container: HTMLElement, options: TablePickerOptions): TablePicker { const picker = new TablePicker(options); container.append(picker.element); return picker; }
