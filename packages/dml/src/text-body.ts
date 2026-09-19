import { dmlMainTypes } from '@ooxml/schema';
type CT_TextBody = dmlMainTypes.CT_TextBody;
type CT_TextBodyProperties = dmlMainTypes.CT_TextBodyProperties;

export interface TextBodyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface TextBodyLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}
export interface TextBodyLayout {
  readonly lines: readonly TextBodyLine[];
  readonly bounds: TextBodyRect;
  readonly scale: number;
  readonly orientation: 'horizontal' | 'vertical' | 'vertical270';
}
export interface TextBodyOptions {
  readonly defaultFontSize?: number;
  readonly charWidth?: number;
  readonly lineHeight?: number;
  readonly listStyle?: readonly unknown[];
}

const emu = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v / 9525 : fallback;
const pct = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? v / 100000
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v) / 100000
      : fallback;
const textOf = (p: dmlMainTypes.CT_TextParagraph): string =>
  p.textRun
    .map((r) =>
      r.kind === 'r'
        ? String(r.value.t ?? '')
        : r.kind === 'br'
          ? '\n'
          : r.kind === 'fld'
            ? String(r.value.t ?? '')
            : '',
    )
    .join('');

function paragraphFont(p: dmlMainTypes.CT_TextParagraph, fallback: number): number {
  const run = p.textRun.find((x) => x.kind === 'r');
  const size = run?.kind === 'r' ? run.value.rPr?.sz : undefined;
  return size === undefined ? fallback : Number(size) / 100;
}

/** Lays out DrawingML text using body properties; stored normAutofit values are applied verbatim. */
export function layoutTextBody(
  body: CT_TextBody,
  rect: TextBodyRect,
  options: TextBodyOptions = {},
): TextBodyLayout {
  const pr = body.bodyPr;
  const left = emu(pr?.lIns, 9.6),
    top = emu(pr?.tIns, 4.8),
    right = emu(pr?.rIns, 9.6),
    bottom = emu(pr?.bIns, 4.8);
  const content = {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  };
  const defaultSize = options.defaultFontSize ?? 11;
  let scale = 1;
  if (pr?.textAutofit?.kind === 'normAutofit') scale = pct(pr.textAutofit.value.fontScale, 1);
  const charWidth = options.charWidth ?? 0.55;
  const lineHeight = options.lineHeight ?? 1.2;
  const lines: TextBodyLine[] = [];
  for (const paragraph of body.p) {
    const fontSize = paragraphFont(paragraph, defaultSize) * scale;
    const maxChars = Math.max(1, Math.floor(content.width / (fontSize * charWidth)));
    const text = textOf(paragraph);
    const words = text.split(/(\s+)/);
    let line = '';
    const push = (value: string) => {
      if (!value && lines.length) return;
      lines.push({
        text: value,
        x: content.x,
        y: 0,
        width: value.length * fontSize * charWidth,
        height: fontSize * lineHeight,
        fontSize,
      });
    };
    for (const word of words) {
      if (word.includes('\n')) {
        const parts = word.split('\n');
        for (let i = 0; i < parts.length; i++) {
          line += parts[i] ?? '';
          if (i < parts.length - 1) {
            push(line);
            line = '';
          }
        }
        continue;
      }
      if (line.length + word.length > maxChars && line) {
        push(line.trimEnd());
        line = word.trimStart();
      } else line += word;
    }
    if (line || !text) push(line);
  }
  const lh = lines[0]?.height ?? defaultSize * lineHeight;
  const totalHeight = lines.length * lh;
  let y = content.y;
  const anchor = pr?.anchor ?? 't';
  if (anchor === 'ctr') y += Math.max(0, (content.height - totalHeight) / 2);
  else if (anchor === 'b') y += Math.max(0, content.height - totalHeight);
  else if (anchor === 'just' && lines.length > 1)
    y += Math.max(0, (content.height - totalHeight) / 2);
  const anchored = lines.map((line, i) => ({
    ...line,
    y: y + i * lh,
    x: pr?.anchorCtr ? content.x + Math.max(0, (content.width - line.width) / 2) : line.x,
  }));
  const vert =
    pr?.vert === 'vert270'
      ? 'vertical270'
      : pr?.vert && pr.vert !== 'horz'
        ? 'vertical'
        : 'horizontal';
  return { lines: anchored, bounds: content, scale, orientation: vert };
}

export function textBodyInsets(bodyPr?: CT_TextBodyProperties): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return {
    left: emu(bodyPr?.lIns, 9.6),
    top: emu(bodyPr?.tIns, 4.8),
    right: emu(bodyPr?.rIns, 9.6),
    bottom: emu(bodyPr?.bIns, 4.8),
  };
}
