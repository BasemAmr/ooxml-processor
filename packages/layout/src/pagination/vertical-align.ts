export type VerticalAlignment = 'top' | 'center' | 'both' | 'bottom';

export function verticalOffsets(
  alignment: VerticalAlignment,
  available: number,
  content: readonly number[],
): readonly number[] {
  const extra = Math.max(0, available - content.reduce((sum, height) => sum + height, 0));
  if (content.length === 0 || alignment === 'top') return content.map(() => 0);
  if (alignment === 'bottom') return content.map(() => extra);
  if (alignment === 'center') return content.map(() => extra / 2);
  // SPEC-GAP: Word applies `both` on the final page only; callers decide that
  // page boundary and pass this mode only for the eligible page.
  const gap = content.length > 1 ? extra / (content.length - 1) : 0;
  let offset = 0;
  return content.map((_, index) => {
    const current = offset;
    if (index < content.length - 1) offset += gap;
    return current;
  });
}
