import { describe, expect, it } from 'vitest';
import type { CT_Document } from '@ooxml/schema';
import { IdTable } from '@ooxml/wml';
import { WmlDocumentModel } from './document-model.js';

function documentFixture(): CT_Document {
  return {
    $unknownAttrs: [{ localName: 'flag', prefix: 'vendor', value: 'keep', namespaceUri: 'urn:vendor' }],
    $unknown: [{ afterSlot: 'background', node: { kind: 'element', name: 'vendor:extension', attrs: [], children: [] } }],
    body: {
      $unknownAttrs: [{ localName: 'body', prefix: 'vendor', value: 'keep', namespaceUri: 'urn:vendor' }],
      blockLevelElts: [{ kind: 'p', value: {
        $unknownAttrs: [{ localName: 'p', prefix: 'vendor', value: 'keep', namespaceUri: 'urn:vendor' }],
        pContent: [{ kind: 'r', value: { runInnerContent: [{ kind: 't', value: { $value: 'hello' } }] } }],
      } }],
    },
  } as unknown as CT_Document;
}

describe('WmlDocumentModel', () => {
  it('indexes and mutates paragraph text without replacing unknown data', () => {
    const doc = documentFixture();
    const model = new WmlDocumentModel(new IdTable(), doc);
    const paragraphId = [...model.idTable.generation.keys()].find((id) => model.idTable.kindOf(id) === 'paragraph');
    expect(paragraphId).toBeDefined();
    expect(model.getText(paragraphId!)).toBe('hello');
    model.setText(paragraphId!, 'changed');
    expect(model.getText(paragraphId!)).toBe('changed');
    expect(doc.$unknownAttrs?.[0]?.value).toBe('keep');
    expect(doc.body?.$unknownAttrs?.[0]?.value).toBe('keep');
    const paragraphItem = doc.body?.blockLevelElts[0];
    expect(paragraphItem?.kind).toBe('p');
    if (paragraphItem?.kind === 'p') expect(paragraphItem.value.$unknownAttrs?.[0]?.value).toBe('keep');
  });
});
