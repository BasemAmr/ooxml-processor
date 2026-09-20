import { createCaret, createRange, createHistory, LatencyTracker, type DocumentModel } from '@ooxml/editor';
export function probeEditor(model: DocumentModel): void { const id = model.idTable.mint('paragraph'); const c = createCaret({ node: id, offset: 0 }); void createRange(c.pos, c.pos); void createHistory; void new LatencyTracker(); }
