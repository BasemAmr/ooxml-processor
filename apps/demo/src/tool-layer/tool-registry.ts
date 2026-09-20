import type { DocumentModel, Transaction, UndoHistory, Selection } from '@ooxml/editor';
import type { NodeId } from '@ooxml/wml';
import { editingTools } from './editing-tools.js';
import { insertionTools } from './insertion-tools.js';
import { formattingTools } from './formatting-tools.js';

export type JsonSchema = {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, { readonly type: string; readonly enum?: readonly unknown[] }>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
};
export interface ToolDefinition { readonly name: string; readonly description: string; readonly parameters: JsonSchema; }
export interface ToolResult { readonly ok: boolean; readonly value?: unknown; readonly error?: string; readonly transaction?: Transaction; }
export interface ToolContext {
  readonly model: DocumentModel;
  readonly history: UndoHistory;
  readonly getSelection: () => Selection;
  readonly setSelection: (selection: Selection) => void;
  readonly onTransaction?: (tx: Transaction) => void;
  readonly callbacks?: Readonly<Record<string, (...args: any[]) => unknown>>;
}
export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;

export class AiToolRegistry {
  private readonly tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();
  constructor(private readonly context: ToolContext) {
    for (const tool of [...editingTools, ...insertionTools, ...formattingTools]) this.tools.set(tool.definition.name, tool);
  }
  getSchemas(): ToolDefinition[] { return [...this.tools.values()].map((entry) => entry.definition); }
  async executeTool(name: string, args: unknown): Promise<ToolResult> {
    const entry = this.tools.get(name);
    if (!entry) return { ok: false, error: `Unknown tool: ${name}` };
    const validation = validateSchema(entry.definition.parameters, args);
    if (!validation.ok) return validation;
    try { return await entry.handler(args as Record<string, unknown>, this.context); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}

export function validateSchema(schema: JsonSchema, value: unknown): ToolResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'Arguments must be an object' };
  const object = value as Record<string, unknown>;
  for (const key of schema.required ?? []) if (!(key in object)) return { ok: false, error: `Missing required argument: ${key}` };
  if (schema.additionalProperties === false) for (const key of Object.keys(object)) if (!(key in (schema.properties ?? {}))) return { ok: false, error: `Unknown argument: ${key}` };
  for (const [key, descriptor] of Object.entries(schema.properties ?? {})) {
    if (!(key in object)) continue;
    const actual = object[key];
    const valid = descriptor.type === 'string' ? typeof actual === 'string' : descriptor.type === 'number' ? typeof actual === 'number' && Number.isFinite(actual) : descriptor.type === 'boolean' ? typeof actual === 'boolean' : descriptor.type === 'object' ? typeof actual === 'object' && actual !== null : true;
    if (!valid) return { ok: false, error: `Invalid type for argument: ${key}` };
    if (descriptor.enum && !descriptor.enum.includes(actual)) return { ok: false, error: `Invalid value for argument: ${key}` };
  }
  return { ok: true };
}

export function nodeId(value: unknown): NodeId { if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('nodeId must be an integer'); return value as NodeId; }

export function commit(ctx: ToolContext, tx: Transaction): ToolResult {
  ctx.history.push(tx); ctx.setSelection(tx.selAfter); ctx.onTransaction?.(tx); return { ok: true, transaction: tx };
}
