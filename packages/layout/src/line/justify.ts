import type { RunDirection } from '@ooxml/text';

export type ST_Jc =
  | 'start'
  | 'center'
  | 'end'
  | 'both'
  | 'mediumKashida'
  | 'distribute'
  | 'numTab'
  | 'highKashida'
  | 'lowKashida'
  | 'thaiDistribute'
  | 'left'
  | 'right';

export interface JustificationResult {
  alignment: 'left' | 'center' | 'right' | 'justify';
  justifyType?: 'spaces' | 'distribute' | 'thaiDistribute' | 'kashida';
  isFallback?: boolean;
}

/**
 * Resolves justification taking into account bidi, last-line exceptions, and fallbacks.
 *
 * @param jc The requested ST_Jc value
 * @param direction Paragraph base direction
 * @param isLastLine Whether this is the last line of the paragraph
 * @param hasKashidaSupport Whether the current shaper/font supports Arabic kashida
 */
export function resolveJustification(
  jc: ST_Jc,
  direction: RunDirection,
  isLastLine: boolean,
  hasKashidaSupport: boolean,
): JustificationResult {
  // Base logical resolution
  let isStart =
    jc === 'start' ||
    (jc === 'left' && direction === 'ltr') ||
    (jc === 'right' && direction === 'rtl') ||
    jc === 'numTab';
  let isEnd =
    jc === 'end' ||
    (jc === 'right' && direction === 'ltr') ||
    (jc === 'left' && direction === 'rtl');

  if (isStart) return { alignment: direction === 'rtl' ? 'right' : 'left' };
  if (isEnd) return { alignment: direction === 'rtl' ? 'left' : 'right' };
  if (jc === 'center') return { alignment: 'center' };

  // Justified alignments
  let justifyType: JustificationResult['justifyType'];
  let alignment: JustificationResult['alignment'] = 'justify';
  let isFallback = false;

  switch (jc) {
    case 'distribute':
      // 'distribute' expands inter-character spacing, and importantly,
      // it DOES justify the last line as well.
      justifyType = 'distribute';
      break;
    case 'thaiDistribute':
      justifyType = 'thaiDistribute';
      break;
    case 'lowKashida':
    case 'mediumKashida':
    case 'highKashida':
      if (hasKashidaSupport) {
        justifyType = 'kashida';
      } else {
        // G3: Fallback to 'both' and record it visibly if font has no kashida support.
        justifyType = 'spaces';
        isFallback = true;
      }
      break;
    case 'both':
    default:
      justifyType = 'spaces';
      break;
  }

  // Last-line asymmetry (commonest justification bug)
  // Only 'distribute' (and thaiDistribute) justify the last line.
  // 'both' and kashidas revert to start alignment on the last line.
  if (isLastLine && justifyType !== 'distribute' && justifyType !== 'thaiDistribute') {
    return { alignment: direction === 'rtl' ? 'right' : 'left' };
  }

  return { alignment, justifyType, isFallback };
}
