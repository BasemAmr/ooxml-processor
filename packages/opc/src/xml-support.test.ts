import { describe, expect, it } from 'vitest';
import type { XmlAttr, XmlCursor } from '@ooxml/schema';

import { fakeXmlSupport } from './testing/fake-xml.js';
import {
  attributeValue,
  forEachChildElement,
  otherAttributes,
  primeCursor,
  readRootElement,
  writeAttributes,
} from './xml-support.js';

describe('xml-support helpers', () => {
  describe('primeCursor', () => {
    it('advances a cursor if current is undefined', () => {
      const xml = '<test>hello</test>';
      const cursor = fakeXmlSupport.createCursor(xml);

      // Initially, cursor is at index 0 and FakeCursor.current returns the first event,
      // but let's test a cursor that starts with current === undefined.
      let currentEvent: unknown = undefined;
      const mockCursor: XmlCursor = {
        get current() {
          return currentEvent as any;
        },
        next() {
          currentEvent = {
            type: 'startElement',
            uri: '',
            localName: 'test',
            prefix: '',
            attrs: [],
            nsDeclarations: new Map(),
            selfClosing: false,
          };
          return currentEvent as any;
        },
        get position() {
          return { offset: 0, line: 1, column: 1 };
        },
        skip() {},
        skipToRaw() {
          return {
            uri: '',
            localName: 'test',
            prefix: '',
            attrs: [],
            nsDeclarations: new Map(),
            children: [],
          };
        },
      };

      expect(mockCursor.current).toBeUndefined();
      primeCursor(mockCursor);
      expect(mockCursor.current).toBeDefined();

      // Calling again when already primed should not call next()
      let nextCalls = 0;
      const origNext = mockCursor.next;
      mockCursor.next = () => {
        nextCalls += 1;
        return origNext();
      };
      primeCursor(mockCursor);
      expect(nextCalls).toBe(0);
    });

    it('handles a normal cursor created by fakeXmlSupport', () => {
      const cursor = fakeXmlSupport.createCursor('<root/>');
      primeCursor(cursor);
      expect(cursor.current?.type).toBe('startElement');
    });
  });

  describe('readRootElement', () => {
    it('skips prolog processing instructions and comments to find root startElement', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- A comment in prolog -->
<?pi instruction?>
<myRoot id="123">
  <child/>
</myRoot>`;
      const cursor = fakeXmlSupport.createCursor(xml);
      const root = readRootElement(cursor);

      expect(root).toBeDefined();
      expect(root?.localName).toBe('myRoot');
      expect(root?.type).toBe('startElement');
      expect(attributeValue(root!, 'id')).toBe('123');
    });

    it('returns undefined if there is no root element', () => {
      const xml = `<?xml version="1.0"?><!-- only comments here -->`;
      const cursor = fakeXmlSupport.createCursor(xml);
      const root = readRootElement(cursor);

      expect(root).toBeUndefined();
    });

    it('returns undefined for empty document', () => {
      const cursor = fakeXmlSupport.createCursor('');
      const root = readRootElement(cursor);

      expect(root).toBeUndefined();
    });
  });

  describe('forEachChildElement', () => {
    it('visits direct child elements and accumulates direct text', () => {
      const xml = `
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <!-- comment -->
  <Default Extension="png" ContentType="image/png">Some text</Default>
  <Override PartName="/word/document.xml" ContentType="application/xml"/>
  <Complex>Direct text <nested>nested text</nested> more direct text</Complex>
</Types>`;
      const cursor = fakeXmlSupport.createCursor(xml);
      const root = readRootElement(cursor);
      expect(root?.localName).toBe('Types');

      const visited: Array<{
        name: string;
        text: string;
        attrs: Record<string, string | undefined>;
      }> = [];

      forEachChildElement(cursor, (start, text) => {
        visited.push({
          name: start.localName,
          text,
          attrs: {
            Extension: attributeValue(start, 'Extension'),
            PartName: attributeValue(start, 'PartName'),
            ContentType: attributeValue(start, 'ContentType'),
          },
        });
      });

      expect(visited).toEqual([
        {
          name: 'Default',
          text: 'Some text',
          attrs: {
            Extension: 'png',
            PartName: undefined,
            ContentType: 'image/png',
          },
        },
        {
          name: 'Override',
          text: '',
          attrs: {
            Extension: undefined,
            PartName: '/word/document.xml',
            ContentType: 'application/xml',
          },
        },
        {
          name: 'Complex',
          text: 'Direct text  more direct text',
          attrs: {
            Extension: undefined,
            PartName: undefined,
            ContentType: undefined,
          },
        },
      ]);
    });

    it('does nothing for an empty element', () => {
      const xml = '<EmptyRoot/>';
      const cursor = fakeXmlSupport.createCursor(xml);
      readRootElement(cursor);

      let callCount = 0;
      forEachChildElement(cursor, () => {
        callCount += 1;
      });
      expect(callCount).toBe(0);
    });
  });

  describe('attributeValue', () => {
    it('returns value of unqualified attribute', () => {
      const xml = '<el simple="val" xmlns:ns="urn:custom" ns:qualified="customVal"/>';
      const cursor = fakeXmlSupport.createCursor(xml);
      const start = readRootElement(cursor)!;

      expect(attributeValue(start, 'simple')).toBe('val');
      expect(attributeValue(start, 'missing')).toBeUndefined();
      // Namespaced attribute is not returned because attributeValue checks uri === ''
      expect(attributeValue(start, 'qualified')).toBeUndefined();
    });
  });

  describe('otherAttributes', () => {
    it('returns attributes not in the known list', () => {
      const xml =
        '<el known1="k1" known2="k2" extra1="e1" extra2="e2" xmlns:x="urn:x" x:known1="xk1"/>';
      const cursor = fakeXmlSupport.createCursor(xml);
      const start = readRootElement(cursor)!;

      const others = otherAttributes(start, ['known1', 'known2']);
      expect(others.length).toBe(3);

      const localNames = others.map((a) => a.localName);
      expect(localNames).toContain('extra1');
      expect(localNames).toContain('extra2');
      expect(localNames).toContain('known1'); // x:known1 has uri="urn:x", so not filtered out
    });
  });

  describe('writeAttributes', () => {
    it('replays unknown attributes onto a sink', () => {
      const attrs: XmlAttr[] = [
        { uri: '', localName: 'foo', prefix: '', value: 'bar' },
        { uri: 'urn:example', localName: 'baz', prefix: 'ex', value: 'qux' },
      ];

      const { sink, toString } = fakeXmlSupport.createStringSink();
      sink.startElement('', 'test');
      sink.declareNamespace('ex', 'urn:example');
      writeAttributes(sink, attrs);
      sink.endElement();

      const result = toString();
      expect(result).toContain('foo="bar"');
      expect(result).toContain('baz="qux"');
    });
  });
});
