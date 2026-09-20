export interface ColorChoice {
  readonly name: string;
  readonly value: string;
}

// Kept in the demo because @ooxml/paint does not expose its decoration palette.
export const COLOR_PALETTE: readonly ColorChoice[] = [
  { name: 'Black', value: '#000000' },
  { name: 'Dark gray', value: '#666666' },
  { name: 'Gray', value: '#999999' },
  { name: 'Light gray', value: '#D9E1F2' },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Red', value: '#FF0000' },
  { name: 'Orange', value: '#F4B183' },
  { name: 'Yellow', value: '#FFFF00' },
  { name: 'Green', value: '#00B050' },
  { name: 'Cyan', value: '#00FFFF' },
  { name: 'Blue', value: '#0000FF' },
  { name: 'Purple', value: '#7030A0' },
];

export interface ColorPickerOptions {
  readonly label?: string;
  readonly colors?: readonly ColorChoice[];
  readonly onSelect: (hex: string) => void;
}

/** Small DOM picker that keeps color selection explicit and keyboard accessible. */
export class ColorPicker {
  readonly element: HTMLDivElement;
  private readonly options: ColorPickerOptions;

  constructor(options: ColorPickerOptions) {
    this.options = options;
    this.element = document.createElement('div');
    this.element.className = 'demo-color-picker';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', options.label ?? 'Color');
    this.render();
  }

  private render(): void {
    const colors = this.options.colors ?? COLOR_PALETTE;
    for (const color of colors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = color.name;
      button.setAttribute('aria-label', color.name);
      button.dataset.color = color.value;
      button.style.backgroundColor = color.value;
      button.addEventListener('click', () => this.options.onSelect(color.value));
      this.element.append(button);
    }
  }

  destroy(): void {
    this.element.replaceChildren();
  }
}
