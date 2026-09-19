import { describe, expect, it } from 'vitest';
import type { RawNode } from '@ooxml/schema';
import { describeVmlShape } from './vml-shapes.js';

const node = (localName: string, children: readonly RawNode[] = []): RawNode => ({
  uri: 'urn:vml',
  localName,
  prefix: 'v',
  attrs: [],
  nsDeclarations: new Map(),
  children,
});
describe('VML shape extraction', () => {
  it('extracts image relationships and path/style data', () => {
    const shape = {
      ...node('shape', [
        {
          ...node('imagedata'),
          attrs: [{ uri: 'urn:r', localName: 'id', prefix: 'r', value: 'rId7' }],
        },
      ]),
      attrs: [
        { uri: '', localName: 'style', prefix: '', value: 'width: 1in' },
        { uri: '', localName: 'path', prefix: '', value: 'm 0,0 l 1,1 e' },
      ],
    };
    const described = describeVmlShape(shape);
    expect(described).toMatchObject({ imageRelationship: 'rId7', style: { width: 72 } });
    expect(described.path[0]?.op).toBe('moveTo');
  });
});
