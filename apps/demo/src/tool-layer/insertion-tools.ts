import type { ToolDefinition, ToolHandler } from './tool-registry.js';
const obj = (required: readonly string[] = [], properties: Record<string, { type: string }> = {}): ToolDefinition['parameters'] => ({ type:'object', required, properties, additionalProperties:false });
const host = (name:string, description:string, required:readonly string[], properties:Record<string,{type:string}>): {definition:ToolDefinition;handler:ToolHandler} => ({ definition:{name,description,parameters:obj(required,properties)}, handler: async (args,ctx) => { const fn=ctx.callbacks?.[name]; return fn ? {ok:true,value:await fn(args)} : {ok:false,error:`${name} host callback is unavailable`}; } });
export const insertionTools = [
 host('insert_image','Insert an image through the host insertion pipeline',['source'],{source:{type:'string'}}),
 host('insert_table','Insert a table through the host insertion pipeline',['rows','columns'],{rows:{type:'number'},columns:{type:'number'}}),
 host('insert_equation','Insert an equation through the host insertion pipeline',['omml'],{omml:{type:'string'}}),
 host('insert_page_break','Insert a page break through the host insertion pipeline',[],{}),
 host('insert_toc','Insert a table of contents through the host insertion pipeline',[],{}),
 host('insert_footnote','Insert a footnote through the host insertion pipeline',['text'],{text:{type:'string'}}),
] satisfies readonly {definition:ToolDefinition;handler:ToolHandler}[];
