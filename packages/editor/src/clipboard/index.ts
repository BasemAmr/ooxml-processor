import type { Selection } from '../selection/model.js';
import type { DocumentModel } from '../commands/command.js';

export type ClipboardPolicy = 'keepSource' | 'mergeFormatting' | 'plainText';

export interface ClipboardPayload {
  ooxmlFragment?: string;
  html?: string;
  text: string;
}

export const OOXML_MIME = 'application/x-ooxml-fragment';

/**
 * Serializes the current selection to three clipboard flavours, richest first:
 * 1. application/x-ooxml-fragment
 * 2. text/html
 * 3. text/plain
 */
export function serializeClipboard(
  model: DocumentModel,
  sel: Selection,
): ClipboardPayload {
  let text = '';
  if (sel.kind === 'collapsed') {
    text = '';
  } else if (sel.kind === 'range') {
    if (sel.anchor.node === sel.focus.node) {
      const full = model.getText(sel.anchor.node);
      const start = Math.min(sel.anchor.offset, sel.focus.offset);
      const end = Math.max(sel.anchor.offset, sel.focus.offset);
      text = full.slice(start, end);
    } else {
      text = model.getText(sel.anchor.node) + '\n' + model.getText(sel.focus.node);
    }
  }

  const ooxmlFragment = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
  const html = `<html><body><p>${escapeHtml(text)}</p></body></html>`;

  return {
    ooxmlFragment,
    html,
    text,
  };
}

/**
 * Sanitizes arbitrary clipboard HTML by stripping executable scripts, event attributes, and iframe/object tags.
 */
export function sanitizeHtml(rawHtml: string): string {
  // Remove script tags and contents
  let clean = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove object, embed, iframe tags
  clean = clean.replace(/<(object|embed|iframe)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');
  // Strip on* attributes (e.g. onerror=, onclick=)
  clean = clean.replace(/\s+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
  // Strip javascript: uris
  clean = clean.replace(/href\s*=\s*(?:['"]javascript:[^'"]*['"]|javascript:[^\s>]+)/gi, '');
  return clean;
}

export interface ParsedClipboardContent {
  paragraphs: string[];
  isRich: boolean;
  styleResolution?: 'merged' | 'source' | 'plain';
}

/**
 * Deserializes clipboard data, selecting the richest flavour available:
 * 1. application/x-ooxml-fragment
 * 2. text/html (sanitized)
 * 3. text/plain
 */
export function deserializeClipboard(
  data: { getData(type: string): string },
  policy: ClipboardPolicy = 'mergeFormatting',
): ParsedClipboardContent {
  if (policy === 'plainText') {
    const rawText = data.getData('text/plain') || '';
    return {
      paragraphs: rawText.split(/\r?\n/),
      isRich: false,
      styleResolution: 'plain',
    };
  }

  // 1. Try OOXML fragment
  const fragment = data.getData(OOXML_MIME);
  if (fragment && fragment.trim().length > 0) {
    // Extract text from <w:t> tags
    const matches = Array.from(fragment.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
    const extracted = matches.map((m) => unescapeXml(m[1] ?? '')).join('');
    return {
      paragraphs: extracted.split(/\r?\n/),
      isRich: true,
      styleResolution: policy === 'keepSource' ? 'source' : 'merged',
    };
  }

  // 2. Try HTML
  const html = data.getData('text/html');
  if (html && html.trim().length > 0) {
    const sanitized = sanitizeHtml(html);
    // Extract plain text content from sanitized HTML paragraphs
    const pMatches = Array.from(sanitized.matchAll(/<p\b[^>]*>(.*?)<\/p>/gi));
    let paragraphs: string[];
    if (pMatches.length > 0) {
      paragraphs = pMatches.map((m) => stripTags(m[1] ?? ''));
    } else {
      paragraphs = [stripTags(sanitized)];
    }
    return {
      paragraphs,
      isRich: true,
      styleResolution: policy === 'keepSource' ? 'source' : 'merged',
    };
  }

  // 3. Fallback to text/plain
  const text = data.getData('text/plain') || '';
  return {
    paragraphs: text.split(/\r?\n/),
    isRich: false,
    styleResolution: 'plain',
  };
}

function escapeXml(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function escapeHtml(str: string): string {
  return escapeXml(str);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
