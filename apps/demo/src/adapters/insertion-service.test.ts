import { describe, expect, it } from 'vitest';
import { createCursor, createReadContext, wmlReader, type CT_Document } from '@ooxml/schema';
import { InsertionService } from './insertion-service.js';

const XML = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Heading</w:t></w:r></w:p></w:body></w:document>';
function doc(): CT_Document { return wmlReader.readCT_Document(createCursor(XML), createReadContext('transitional', { wml: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' })); }

describe('InsertionService', () => {
  it('constructs valid tables and visible insertion content', () => {
    const document = doc(); const service = new InsertionService({ document });
    const table = service.insertTable(2, 3); expect(table.contentRowContent).toHaveLength(2); expect(table.tblGrid?.gridCol).toHaveLength(3);
    expect(service.insertShape('roundRect').preset).toBe('roundRect'); expect(service.insertEquation('x').diagnostic).toContain('math-math-table-unavailable');
    service.insertBreak('page'); const toc = service.insertToc(); expect(toc.diagnostic).toBe('toc-no-headings');
  });
});
