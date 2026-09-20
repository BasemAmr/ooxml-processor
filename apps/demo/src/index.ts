import { AppState } from './state/app-state.js';
import { mountFileMenu } from './ui/menu-bar.js';
import { showDocumentProperties } from './ui/dialogs/doc-properties.js';
import { AppShell } from './ui/shell.js';

export interface DemoApp {
  readonly state: AppState;
  readonly shell: AppShell;
  destroy(): void;
}

/**
 * Mounts the browser-only shell after the DOM exists. Keeping this behind an
 * explicit function lets compiler probes and Node-based tests import the app
 * without touching document during module evaluation.
 */
export function mountDemo(root: HTMLElement = requireRoot()): DemoApp {
  const state = new AppState();
  const shell = new AppShell({ root });
  mountFileMenu(shell.content, state);
  const onProperties = (event: Event): void => {
    const custom = event as CustomEvent<AppState>;
    showDocumentProperties(custom.detail ?? state, root);
  };
  shell.content.addEventListener('demo:document-properties', onProperties);
  root.dataset.demoReady = 'true';
  return {
    state,
    shell,
    destroy: () => {
      shell.content.removeEventListener('demo:document-properties', onProperties);
      shell.destroy();
    },
  };
}

function requireRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>('#app-root');
  if (root === null) throw new Error('Missing #app-root demo mount');
  return root;
}

// Vite loads this module in the browser after index.html has been parsed.
if (typeof document !== 'undefined') mountDemo();
