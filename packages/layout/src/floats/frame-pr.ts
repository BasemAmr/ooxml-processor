import type { WrapMode } from './exclusions.js';

export type FrameAnchor = 'text' | 'margin' | 'page';
export type FrameWrap = 'auto' | 'around' | 'none' | 'notBeside' | 'through' | 'tight';

export interface FramePr {
  readonly w?: number;
  readonly h?: number;
  readonly hAnchor?: FrameAnchor;
  readonly vAnchor?: FrameAnchor;
  readonly x?: number;
  readonly y?: number;
  readonly xAlign?: string;
  readonly yAlign?: string;
  readonly wrap?: FrameWrap;
  readonly hSpace?: number;
  readonly vSpace?: number;
  readonly dropCap?: 'none' | 'drop' | 'margin';
  readonly lines?: number;
}

export interface FramedParagraph<T = unknown> {
  readonly value: T;
  readonly frame?: FramePr;
}

function canonical(frame: FramePr | undefined): string {
  if (frame === undefined) return '';
  return JSON.stringify(
    Object.keys(frame)
      .sort()
      .map((key) => [key, frame[key as keyof FramePr]]),
  );
}

/** Consecutive paragraphs with the same framePr become one frame. */
export function groupFramedParagraphs<T>(
  paragraphs: readonly FramedParagraph<T>[],
): FramedParagraph<T>[][] {
  const groups: FramedParagraph<T>[][] = [];
  for (const paragraph of paragraphs) {
    const previous = groups[groups.length - 1];
    if (
      previous !== undefined &&
      canonical(previous[0]?.frame) === canonical(paragraph.frame) &&
      paragraph.frame !== undefined
    )
      previous.push(paragraph);
    else groups.push([paragraph]);
  }
  return groups;
}

export function frameWrapToWrapMode(wrap: FrameWrap | undefined): WrapMode {
  switch (wrap) {
    case 'none':
      return 'none';
    case 'through':
      return 'through';
    case 'tight':
      return 'tight';
    case 'notBeside':
      return 'topAndBottom';
    case 'around':
    case 'auto':
    default:
      return 'square';
  }
}

export function resolveFramePosition(
  frame: FramePr,
  container: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const width = frame.w ?? 0;
  const height = frame.h ?? 0;
  const x =
    frame.xAlign === 'center'
      ? container.x + (container.width - width) / 2
      : frame.xAlign === 'right'
        ? container.x + container.width - width
        : container.x + (frame.x ?? 0);
  const y =
    frame.yAlign === 'center'
      ? container.y + (container.height - height) / 2
      : frame.yAlign === 'bottom'
        ? container.y + container.height - height
        : container.y + (frame.y ?? 0);
  return { x, y, width, height };
}
