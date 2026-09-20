import { DisplayList } from '@ooxml/paint';
import type { Line, GlyphRun } from '@ooxml/layout';

export interface DisplayListPage {
  readonly displayList: DisplayList;
  readonly width: number;
  readonly height: number;
}

export interface DisplayListBuildOptions {
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly defaultColor?: string;
}

function styleValue(style: unknown, key: string): unknown {
  return typeof style === 'object' && style !== null ? (style as Record<string, unknown>)[key] : undefined;
}

function colorFor(run: GlyphRun, fallback: string): string {
  const style = run.style;
  const color = styleValue(style, 'color') ?? styleValue(style, 'foreground') ?? styleValue(style, 'textColor');
  return typeof color === 'string' ? color : fallback;
}

function fontFor(run: GlyphRun): string | number {
  const font = styleValue(run.style, 'fontFamily') ?? styleValue(run.style, 'font') ?? run.fontKey;
  return typeof font === 'string' || typeof font === 'number' ? font : run.fontKey;
}

/** Converts layout snapshots into paint-only data; no AST/model reference crosses this boundary. */
export function buildDisplayList(lines: readonly Line[], options: DisplayListBuildOptions): DisplayListPage {
  const list = new DisplayList();
  list.pushRect(0, 0, options.width, options.height, options.background ?? '#ffffff');
  const defaultColor = options.defaultColor ?? '#000000';

  for (const line of lines) {
    for (const segment of line.segments) {
      let x = segment.x;
      for (const run of segment.runs) {
        const count = run.clusters.clusterCount;
        const glyphs = new Uint32Array(count);
        const positions = new Float64Array(count * 2);
        for (let i = 0; i < count; i += 1) {
          glyphs[i] = run.clusters.glyphId(i);
          positions[i * 2] = run.clusters.xOffset(i);
          positions[i * 2 + 1] = run.clusters.yOffset(i);
        }
        const color = colorFor(run, defaultColor);
        list.pushGlyphRun(fontFor(run), run.size / 2, color, x, line.top + line.baseline, glyphs, positions);
        const width = run.clusters.totalAdvance;
        const style = run.style;
        const underline = styleValue(style, 'underline');
        if (typeof underline === 'string' && underline !== 'none') {
          list.pushLine(x, line.top + line.baseline + 2, x + width, line.top + line.baseline + 2, '#000000', 1);
        }
        if (styleValue(style, 'strike') === true) {
          list.pushLine(x, line.top + line.baseline - line.baseline / 2.5, x + width, line.top + line.baseline - line.baseline / 2.5, '#000000', 1);
        }
        x += width;
      }
    }
  }
  return { displayList: list, width: options.width, height: options.height };
}

export const buildPageDisplayList = buildDisplayList;
