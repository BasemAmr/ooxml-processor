import { describe, expect, it } from 'vitest';
import { AppState } from './app-state.js';
import { createBlankDocument } from '../fixtures/blank-doc.js';

class MemoryFile {
  readonly name = 'blank.docx';
  constructor(private readonly bytes: Uint8Array) {}
  async arrayBuffer(): Promise<ArrayBuffer> {
    const result = new ArrayBuffer(this.bytes.byteLength);
    new Uint8Array(result).set(this.bytes);
    return result;
  }
}

describe('AppState package I/O', () => {
  it('opens the synthetic package and saves an idempotent result', async () => {
    const state = new AppState({ alert: () => undefined });
    await state.openFile(new MemoryFile(createBlankDocument()) as unknown as File);
    const generation2 = await state.saveFile();
    const reopened = new AppState({ alert: () => undefined });
    await reopened.openFile(new MemoryFile(generation2) as unknown as File);
    const generation3 = await reopened.saveFile();
    expect(Array.from(generation3)).toEqual(Array.from(generation2));
    expect(reopened.package?.mainDocument.name).toBe('/word/document.xml');
  });
});
