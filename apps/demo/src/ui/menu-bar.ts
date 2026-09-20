import { AppState } from '../state/app-state.js';

/** Minimal File menu wiring; callers own the surrounding shell and styling. */
export function mountFileMenu(container: HTMLElement, state: AppState): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file !== undefined) void state.openFile(file);
  });

  const open = button('Open', () => input.click());
  const save = button('Download', () => state.downloadFile());
  const details = button('Document details', () => {
    const event = new CustomEvent('demo:document-properties', { detail: state });
    container.dispatchEvent(event);
  });
  container.append(open, save, details, input);
}

function button(label: string, action: () => void): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.textContent = label;
  result.addEventListener('click', action);
  return result;
}
