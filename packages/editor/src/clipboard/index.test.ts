import { describe, it, expect } from 'vitest';
import {
  serializeClipboard,
  deserializeClipboard,
  sanitizeHtml,
  OOXML_MIME,
} from './index.js';
import { createRange } from '../selection/model.js';
import { IdTable } from '@ooxml/wml';
import type { NodeId } from '@ooxml/wml';
import type { DocumentModel } from '../commands/command.js';

function createMockModel(text: string): { model: DocumentModel; id: NodeId } {
  const table = new IdTable();
  const id = table.mint('paragraph');
  return {
    id,
    model: {
      idTable: table,
      getText: () => text,
      setText: () => {},
      getProperty: () => undefined,
      setProperty: () => {},
      insertNode: () => {},
      removeNode: () => {},
    },
  };
}

describe('Clipboard Integration (P6-15)', () => {
  it('serializes selection to 3 flavours (OOXML fragment, HTML, text)', () => {
    const { model, id } = createMockModel('Hello World');
    const sel = createRange({ node: id, offset: 0 }, { node: id, offset: 5 });

    const payload = serializeClipboard(model, sel);

    expect(payload.text).toBe('Hello');
    expect(payload.ooxmlFragment).toContain('<w:t>Hello</w:t>');
    expect(payload.html).toContain('<p>Hello</p>');
  });

  it('sanitizes HTML containing script tags or event handlers without executing code', () => {
    const malicious = `<div>Safe <script>alert("xss")</script><img src="invalid" onerror="evil()"/> text</div>`;
    const clean = sanitizeHtml(malicious);

    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert');
    expect(clean).not.toContain('onerror');
    expect(clean).toContain('Safe');
    expect(clean).toContain('text');
  });

  it('deserializes richest flavour: chooses OOXML fragment when available', () => {
    const mockData = {
      getData: (type: string) => {
        if (type === OOXML_MIME) {
          return '<w:p><w:r><w:t>OOXML Rich Text</w:t></w:r></w:p>';
        }
        if (type === 'text/html') return '<p>HTML Text</p>';
        if (type === 'text/plain') return 'Plain Text';
        return '';
      },
    };

    const res = deserializeClipboard(mockData);
    expect(res.isRich).toBe(true);
    expect(res.paragraphs).toEqual(['OOXML Rich Text']);
  });

  it('falls back to HTML when fragment is absent, then plain text', () => {
    const mockHtmlOnly = {
      getData: (type: string) => {
        if (type === 'text/html') return '<p>From Browser</p>';
        if (type === 'text/plain') return 'From Browser';
        return '';
      },
    };

    const res1 = deserializeClipboard(mockHtmlOnly);
    expect(res1.isRich).toBe(true);
    expect(res1.paragraphs).toEqual(['From Browser']);

    const mockPlainOnly = {
      getData: (type: string) => {
        if (type === 'text/plain') return 'Line 1\nLine 2';
        return '';
      },
    };

    const res2 = deserializeClipboard(mockPlainOnly);
    expect(res2.isRich).toBe(false);
    expect(res2.paragraphs).toEqual(['Line 1', 'Line 2']);
  });

  it('respects plainText policy even when rich formats are present', () => {
    const mockData = {
      getData: (type: string) => {
        if (type === OOXML_MIME) return '<w:t>Rich</w:t>';
        if (type === 'text/plain') return 'Plain';
        return '';
      },
    };

    const res = deserializeClipboard(mockData, 'plainText');
    expect(res.isRich).toBe(false);
    expect(res.paragraphs).toEqual(['Plain']);
    expect(res.styleResolution).toBe('plain');
  });
});
