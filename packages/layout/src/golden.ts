import type { Line } from './line/linebox';

/**
 * Serializes a list of line boxes into a deterministic, diffable golden format.
 * Format per line box:
 * p=<nodeId> l=<n> y=<twips> h=<twips> base=<twips> seg=[<x>+<w>,...] "<text-snippet>"
 *
 * Invariants:
 * - Deterministic output.
 * - Sub-twip differences are rounded away.
 * - Keyed by NodeId so paragraph insertions don't churn later IDs.
 * - Glyph IDs are NOT serialized (font version independence).
 */
export function serializeLayoutGolden(lines: readonly Line[]): string {
  const linesByPara = new Map<number, number>();
  let out = '';

  for (const line of lines) {
    const paraId = line.paraId;
    const lineIdx = linesByPara.get(paraId) ?? 0;
    linesByPara.set(paraId, lineIdx + 1);

    // Round coordinates to whole twips to eliminate float noise
    const y = Math.round(line.top);
    const h = Math.round(line.height);
    const base = Math.round(line.baseline);

    const segStrs = line.segments.map((seg) => {
      const x = Math.round(seg.x);
      const w = Math.round(seg.width);
      return `${x}+${w}`;
    });
    const segStr = segStrs.join(',');

    const textSnippet = '[text]';

    out += `p=${paraId} l=${lineIdx} y=${y} h=${h} base=${base} seg=[${segStr}] "${textSnippet}"\n`;
  }

  return out;
}
