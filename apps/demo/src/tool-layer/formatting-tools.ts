import { applyRunProperty } from '@ooxml/editor';
import type { ToolDefinition, ToolHandler } from './tool-registry.js';
import { commit } from './tool-registry.js';
const obj = (required: readonly string[] = [], properties: Record<string, { type: string }> = {}): ToolDefinition['parameters'] => ({type:'object',required,properties,additionalProperties:false});
const property = (name:string, prop:string, valueType:string): {definition:ToolDefinition;handler:ToolHandler} => ({definition:{name,description:`Apply ${prop}`,parameters:obj(['value'],{value:{type:valueType}})},handler:(args,ctx)=>commit(ctx,applyRunProperty(ctx.model,ctx.getSelection(),prop,args.value))});
export const formattingTools = [
 property('apply_paragraph_style','pStyle','string'),
 property('set_alignment','jc','string'),
 property('set_line_spacing','spacing','object'),
 property('set_columns','columns','number'),
 property('apply_bullets_numbering','numPr','object'),
 property('set_text_direction','bidi','boolean'),
] satisfies readonly {definition:ToolDefinition;handler:ToolHandler}[];
