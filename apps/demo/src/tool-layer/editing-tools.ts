import { createCaret, createCollapsed, createRange, deleteRange, insertText } from '@ooxml/editor';
import type { ToolDefinition, ToolHandler, ToolContext } from './tool-registry.js';
import { commit, nodeId } from './tool-registry.js';

const obj = (required: readonly string[] = [], properties: Record<string, { type: string }> = {}): ToolDefinition['parameters'] => ({ type: 'object', required, properties, additionalProperties: false });
const tool = (name: string, description: string, parameters: ToolDefinition['parameters'], handler: ToolHandler) => ({ definition: { name, description, parameters }, handler });
const pos = (args: Record<string, unknown>, key: string) => ({ node: nodeId(args[`${key}Node`]), offset: Number(args[`${key}Offset`]) });

export const editingTools = [
  tool('undo', 'Undo the latest transaction', obj(), (_a, c) => { const tx = c.history.undo(c.model); if (!tx) return { ok: false, error: 'Nothing to undo' }; c.setSelection(tx.selBefore); c.onTransaction?.(tx); return { ok: true, transaction: tx }; }),
  tool('redo', 'Redo the latest transaction', obj(), (_a, c) => { const tx = c.history.redo(c.model); if (!tx) return { ok: false, error: 'Nothing to redo' }; c.setSelection(tx.selAfter); c.onTransaction?.(tx); return { ok: true, transaction: tx }; }),
  tool('select_range', 'Select a document range', obj(['anchorNode','anchorOffset','focusNode','focusOffset'], { anchorNode: {type:'number'}, anchorOffset:{type:'number'}, focusNode:{type:'number'}, focusOffset:{type:'number'} }), (a, c) => { const selection = createRange(pos(a, 'anchor'), pos(a, 'focus')); c.setSelection(selection); return { ok: true, value: selection }; }),
  tool('delete_range', 'Delete the current selection or one direction', obj([], { direction:{type:'string'} }), (a, c) => commit(c, deleteRange(c.model, c.getSelection(), a.direction === 'fwd' ? 'fwd' : 'back'))),
  tool('insert_text', 'Insert text at the current selection', obj(['text'], { text:{type:'string'} }), (a, c) => { const sel = c.getSelection(); if (sel.kind !== 'collapsed') return { ok:false, error:'insert_text requires a collapsed selection' }; return commit(c, insertText(c.model, sel.caret.pos, String(a.text), sel)); }),
  tool('find_replace', 'Replace text through a host-provided operation', obj(['find','replace'], {find:{type:'string'}, replace:{type:'string'}}), async (a,c) => { const fn = c.callbacks?.find_replace; if (!fn) return {ok:false,error:'find_replace host callback is unavailable'}; return {ok:true,value:await fn(a.find,a.replace)}; }),
  tool('copy', 'Copy selection through a host-provided operation', obj(), async (_a,c) => { const fn=c.callbacks?.copy; return fn ? {ok:true,value:await fn(c.getSelection())} : {ok:false,error:'copy host callback is unavailable'}; }),
  tool('cut', 'Cut selection through a host-provided operation', obj(), async (_a,c) => { const fn=c.callbacks?.cut; return fn ? {ok:true,value:await fn(c.getSelection())} : {ok:false,error:'cut host callback is unavailable'}; }),
  tool('paste', 'Paste plain text through a host-provided operation', obj(['text'], {text:{type:'string'}}), (a,c) => { const fn=c.callbacks?.paste; return fn ? Promise.resolve(fn(a.text)).then(value=>({ok:true,value})) : {ok:false,error:'paste host callback is unavailable'}; }),
] satisfies readonly { definition: ToolDefinition; handler: ToolHandler }[];
