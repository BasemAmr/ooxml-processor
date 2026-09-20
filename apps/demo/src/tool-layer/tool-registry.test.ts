import { describe, expect, it } from 'vitest';
import { createCaret, createCollapsed, createHistory } from '@ooxml/editor';
import { IdTable } from '@ooxml/wml';
import { AiToolRegistry } from './tool-registry.js';
import { WmlDocumentModel } from '../adapters/document-model.js';

function context() {
  const idTable = new IdTable();
  const doc = { body:{ blockLevelElts:[{kind:'p',value:{pContent:[{kind:'r',value:{runInnerContent:[{kind:'t',value:{$value:'hello'}}]}}]}}] } } as any;
  const model = new WmlDocumentModel(idTable, doc);
  const paragraph = [...idTable.generation.keys()].find((id) => idTable.kindOf(id) === 'paragraph')!;
  const selection = createCollapsed(createCaret({node:paragraph,offset:0}));
  return { model, history:createHistory(), selection, getSelection:()=>selection, setSelection:()=>undefined };
}
describe('AiToolRegistry', () => {
  it('validates schemas and exposes all tool definitions', async () => {
    const ctx = context(); const registry = new AiToolRegistry(ctx);
    expect(registry.getSchemas().length).toBe(21);
    expect((await registry.executeTool('insert_table', {rows:'2',columns:2})).ok).toBe(false);
    expect((await registry.executeTool('nope', {})).ok).toBe(false);
  });
  it('commits one transaction for insertion text and supports undo', async () => {
    const ctx = context(); const registry = new AiToolRegistry(ctx);
    const result = await registry.executeTool('insert_text',{text:'x'});
    expect(result.ok).toBe(true); expect(ctx.history.undoCount).toBe(1);
  });
});
