import { WmlDocumentModel } from '../src/adapters/document-model.js';
import { IdTable } from '@ooxml/wml';
import type { CT_Document } from '@ooxml/schema';
export function probeApp(doc: CT_Document): WmlDocumentModel { return new WmlDocumentModel(new IdTable(), doc); }
