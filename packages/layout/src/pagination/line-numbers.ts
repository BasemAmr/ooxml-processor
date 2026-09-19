export type LineNumberRestart = 'newPage' | 'newSection' | 'continuous';

export interface LineNumberOptions {
  readonly countBy?: number;
  readonly start?: number;
  readonly restart?: LineNumberRestart;
}

/** Returns the displayed number for a physical line, or undefined when suppressed. */
export function lineNumberFor(
  lineIndex: number,
  options: LineNumberOptions = {},
  context: { readonly pageLineIndex?: number; readonly sectionLineIndex?: number } = {},
  suppressed = false,
): number | undefined {
  if (suppressed) return undefined;
  const countBy = Math.max(1, Math.floor(options.countBy ?? 1));
  const base =
    options.restart === 'newPage'
      ? (context.pageLineIndex ?? lineIndex)
      : options.restart === 'newSection'
        ? (context.sectionLineIndex ?? lineIndex)
        : lineIndex;
  const start = options.start ?? 1;
  if (base % countBy !== 0) return undefined;
  return start + base;
}
