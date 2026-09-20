import type { AppState } from '../../state/app-state.js';

/** Renders read-only OPC metadata without exposing package internals to the UI. */
export function showDocumentProperties(state: AppState, container: HTMLElement): HTMLElement {
  const dialog = document.createElement('dialog');
  const properties = state.properties;
  dialog.innerHTML = '<form method="dialog"><h2>Document details</h2><div data-properties></div><button>Close</button></form>';
  const target = dialog.querySelector<HTMLElement>('[data-properties]');
  if (target === null) throw new Error('Document properties dialog template is incomplete');
  if (properties === undefined) {
    target.textContent = 'No document is loaded.';
  } else {
    appendSection(target, 'Core properties', properties.core);
    appendSection(target, 'Application properties', properties.extended);
    appendSection(target, 'Custom properties', properties.custom);
  }
  container.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  return dialog;
}

function appendSection(target: HTMLElement, title: string, value: unknown): void {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading);
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(value ?? {}, (_key, item: unknown) => item instanceof Date ? item.toISOString() : item, 2);
  section.append(pre);
  target.append(section);
}
