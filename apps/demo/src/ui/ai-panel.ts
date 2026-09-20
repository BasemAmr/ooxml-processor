import type { AiToolRegistry, ToolResult } from '../tool-layer/tool-registry.js';

export interface AiPanelOptions {
  readonly registry?: AiToolRegistry;
  readonly title?: string;
}

/** Small host-side assistant panel; tool execution remains behind AiToolRegistry. */
export class AiPanel {
  readonly element: HTMLElement;
  private readonly messages: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly registry: AiToolRegistry | undefined;

  constructor(options: AiPanelOptions = {}) {
    this.registry = options.registry;
    this.element = document.createElement('aside');
    this.element.className = 'demo-ai-panel';
    this.element.setAttribute('aria-label', options.title ?? 'AI Assistant');
    const heading = document.createElement('h2');
    heading.textContent = options.title ?? 'AI Assistant';
    this.messages = document.createElement('div');
    this.messages.setAttribute('role', 'log');
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'Ask the assistant';
    this.sendButton = document.createElement('button');
    this.sendButton.type = 'button';
    this.sendButton.textContent = 'Send';
    this.sendButton.addEventListener('click', () => void this.submit());
    this.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') void this.submit(); });
    const row = document.createElement('div');
    row.append(this.input, this.sendButton);
    this.element.append(heading, this.messages, row);
  }

  async submit(prompt = this.input.value): Promise<ToolResult | undefined> {
    const text = prompt.trim();
    if (!text) return undefined;
    this.addMessage('user', text);
    this.input.value = '';
    // The panel intentionally does not invent a network AI provider. A registry
    // command can be supplied by the host; otherwise the visible response explains the fallback.
    const result = this.registry === undefined
      ? { ok: false, error: 'No AI tool registry is configured.' }
      : await this.registry.executeTool(text, {});
    this.addMessage('assistant', result.ok ? 'Done.' : (result.error ?? 'The tool could not be executed.'));
    return result;
  }

  addMessage(role: 'user' | 'assistant', text: string): void {
    const item = document.createElement('p');
    item.dataset.role = role;
    item.textContent = text;
    this.messages.appendChild(item);
  }

  destroy(): void { this.element.remove(); }
}
