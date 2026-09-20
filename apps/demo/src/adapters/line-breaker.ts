import type { NodeId } from '@ooxml/wml';
import { ExclusionStore, type AvailableSegment, type Line, type Segment, type GlyphRun } from '@ooxml/layout';
import type { ShapedRun, TextEngine, ParagraphRunInput } from '@ooxml/text';

export interface LineBreakerRun {
  readonly srcNode: NodeId;
  readonly text: string;
  readonly options?: ParagraphRunInput['options'];
  readonly style?: unknown;
}

export interface LineBreakerOptions {
  readonly textEngine: TextEngine;
  readonly exclusions?: ExclusionStore;
  readonly container: { readonly x: number; readonly width: number };
  readonly paragraphTop?: number;
  readonly lineHeight?: number;
  readonly baseLevel?: 0 | 1 | 'auto';
  readonly onDiagnostic?: (message: string) => void;
}

interface ShapedPart {
  readonly srcNode: NodeId;
  readonly style: unknown;
  readonly text: string;
  /** Paragraph-global source offset of this itemized sub-run. */
  readonly sourceOffset: number;
  readonly shaped: ShapedRun;
}
interface Cursor { part: number; cluster: number; }

/** Demo-local greedy breaker. It deliberately does not implement auto-hyphenation or tabs. */
export function breakParagraphToLines(
  paraId: NodeId,
  runs: readonly LineBreakerRun[],
  options: LineBreakerOptions,
): Line[] {
  const inputs: ParagraphRunInput[] = runs.map((run) => ({ text: run.text, ...(run.options === undefined ? {} : { options: run.options }) }));
  const shaped = options.textEngine.shapeParagraph(inputs, options.baseLevel);
  const parts: ShapedPart[] = shaped.runs.map((result) => {
    // `shapeParagraph` returns paragraph-global source offsets. Resolve the owning
    // input run once, rather than treating an itemized sub-run offset as local.
    let sourceOffset = 0;
    let source: LineBreakerRun | undefined;
    for (const run of runs) {
      const end = sourceOffset + run.text.length;
      if (result.subRun.srcOffset >= sourceOffset && result.subRun.srcOffset < end) {
        source = run;
        break;
      }
      sourceOffset = end;
    }
    return {
      srcNode: source?.srcNode ?? paraId,
      style: source?.style,
      text: source?.text ?? '',
      sourceOffset,
      shaped: result.shapedRun,
    };
  });
  const lineHeight = options.lineHeight ?? 240;
  const exclusions = options.exclusions ?? new ExclusionStore();
  const lines: Line[] = [];
  let cursor: Cursor = { part: 0, cluster: 0 };
  let y = options.paragraphTop ?? 0;

  const hasContent = (at: Cursor): boolean => at.part < parts.length && at.cluster < parts[at.part]!.shaped.clusterCount;
  while (hasContent(cursor)) {
    let segments = exclusions.availableSegments(y, lineHeight, options.container);
    if (segments.length === 0) { y += lineHeight; continue; }
    const start = { ...cursor };
    const segmentRuns: Segment[] = [];
    let consumed = false;
    for (const available of segments) {
      if (!hasContent(cursor)) break;
      const runGroups: GlyphRun[] = [];
      let width = 0;
      let lastBreak: Cursor | undefined;
      let lastBreakWidth = 0;
      const segmentStart = { ...cursor };
      while (hasContent(cursor)) {
        const part = parts[cursor.part]!;
        const shapedRun = part.shaped;
        const advance = shapedRun.xAdvance(cursor.cluster);
        if (width > 0 && width + advance > available.width) {
          if (lastBreak !== undefined) {
            cursor = lastBreak;
            width = lastBreakWidth;
          } else {
            options.onDiagnostic?.('unbreakable-overflow');
            cursor = { part: cursor.part, cluster: cursor.cluster + 1 };
            if (cursor.cluster >= shapedRun.clusterCount) cursor = { part: cursor.part + 1, cluster: 0 };
          }
          break;
        }
        width += advance;
        const end = { part: cursor.part, cluster: cursor.cluster + 1 };
        const logical = part.sourceOffset + shapedRun.srcOffset(cursor.cluster);
        const len = shapedRun.srcLength(cursor.cluster);
        if (/\s/.test(part.text.slice(Math.max(0, logical - part.sourceOffset), logical - part.sourceOffset + len))) {
          lastBreak = end;
          lastBreakWidth = width;
        }
        cursor = end;
        if (cursor.cluster >= shapedRun.clusterCount) cursor = { part: cursor.part + 1, cluster: 0 };
        consumed = true;
      }
      if (consumed && (cursor.part !== segmentStart.part || cursor.cluster !== segmentStart.cluster)) {
        // Slices preserve packed cluster storage; no glyph data is copied.
        let at = segmentStart;
        while (at.part < cursor.part || (at.part === cursor.part && at.cluster < cursor.cluster)) {
          const part = parts[at.part]!;
          const end = at.part === cursor.part ? cursor.cluster : part.shaped.clusterCount;
          if (end > at.cluster) runGroups.push({ fontKey: part.shaped.faceId, size: part.shaped.fontSize, srcNode: part.srcNode, style: part.style, clusters: part.shaped.slice(at.cluster, end) as any });
          at = { part: at.part + 1, cluster: 0 };
        }
        segmentRuns.push({ x: available.x, width, direction: (runGroups[0]?.clusters.direction ?? 'ltr') as Segment['direction'], runs: runGroups });
      }
    }
    if (!consumed) { options.onDiagnostic?.('line-break-no-progress'); break; }
    lines.push({ paraId, top: y, height: lineHeight, baseline: Math.round(lineHeight * 0.8), breakKind: hasContent(cursor) ? 'wrap' : 'paraEnd', isFirst: lines.length === 0, isLast: !hasContent(cursor), segments: segmentRuns });
    y += lineHeight;
    if (cursor.part === start.part && cursor.cluster === start.cluster) break;
  }
  if (lines.length > 0) lines[lines.length - 1]!.isLast = true;
  return lines;
}

export type { AvailableSegment };
