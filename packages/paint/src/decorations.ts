import type { DisplayList } from './displaylist.js';

// ST_Highlight colors (17 values)
export const HIGHLIGHT_COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#0000FF',
  cyan: '#00FFFF',
  green: '#008000',
  magenta: '#FF00FF',
  red: '#FF0000',
  yellow: '#FFFF00',
  white: '#FFFFFF',
  darkBlue: '#00008B',
  darkCyan: '#008B8B',
  darkGreen: '#006400',
  darkMagenta: '#8B008B',
  darkRed: '#8B0000',
  darkYellow: '#8B8B00',
  darkGray: '#A9A9A9',
  lightGray: '#D3D3D3',
  none: 'transparent',
};

// 18 underline values (P5-18 constraint: no string concatenation, explicit enum)
export type ST_Underline =
  | 'single'
  | 'words'
  | 'double'
  | 'thick'
  | 'dotted'
  | 'dottedHeavy'
  | 'dash'
  | 'dashedHeavy'
  | 'dashLong'
  | 'dashLongHeavy'
  | 'dotDash'
  | 'dashDotHeavy'
  | 'dotDotDash'
  | 'dashDotDotHeavy'
  | 'wave'
  | 'wavyHeavy'
  | 'wavyDouble'
  | 'none';

export type ST_Em = 'none' | 'dot' | 'comma' | 'circle' | 'underDot';

export type ST_TextEffect =
  'blinkBackground' | 'lights' | 'antsBlack' | 'antsRed' | 'shimmer' | 'sparkle' | 'none';

export interface DecorationStyle {
  underline?: ST_Underline;
  underlineColor?: string;
  strike?: boolean;
  dstrike?: boolean;
  highlight?: string; // from 17 colors
  shd?: string; // e.g. color string for fill
  bdr?: { color: string; width: number; type: string };
  em?: ST_Em;
  effect?: ST_TextEffect;
}

/**
 * Paints text decorations onto the provided DisplayList.
 *
 * @param dl The display list to paint to.
 * @param style The resolved decoration style for the run.
 * @param x The start X coordinate of the run/cluster.
 * @param y The Y coordinate (baseline or top, context dependent. Assumed top here for rects, baseline for text).
 * @param w The width of the run/cluster.
 * @param h The height of the run.
 * @param ascent The ascent of the font (used for strike/em positioning).
 * @param isWhitespace True if the run is pure whitespace (used for 'words' underline).
 */
export function paintDecorations(
  dl: DisplayList,
  style: DecorationStyle,
  x: number,
  y: number,
  w: number,
  h: number,
  ascent: number,
  isWhitespace: boolean,
): void {
  // Highlight (background, behind everything else)
  if (style.highlight && style.highlight !== 'none') {
    const hex = HIGHLIGHT_COLORS[style.highlight] || HIGHLIGHT_COLORS.none;
    if (hex !== 'transparent') {
      dl.pushRect(x, y - ascent, w, h, hex);
    }
  }

  // Shading (w:shd, painted after highlight usually, or vice versa, but background)
  if (style.shd && style.shd !== 'none' && style.shd !== 'transparent') {
    dl.pushRect(x, y - ascent, w, h, style.shd);
  }

  // Underlines
  if (style.underline && style.underline !== 'none') {
    if (style.underline !== 'words' || !isWhitespace) {
      const ulColor = style.underlineColor || '#000000';
      // Default positions/widths. A real implementation would pull these from OS2 metrics.
      const ulOffset = y + 2;
      const ulWidth = 1;

      switch (style.underline) {
        case 'single':
        case 'words':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth);
          break;
        case 'double':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth);
          dl.pushLine(x, ulOffset + 2, x + w, ulOffset + 2, ulColor, ulWidth);
          break;
        case 'thick':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth * 2);
          break;
        case 'dotted':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth, [2, 2]);
          break;
        case 'dottedHeavy':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth * 2, [2, 2]);
          break;
        case 'dash':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth, [4, 4]);
          break;
        case 'dashedHeavy':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth * 2, [4, 4]);
          break;
        case 'dashLong':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth, [8, 4]);
          break;
        case 'dashLongHeavy':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth * 2, [8, 4]);
          break;
        case 'dotDash':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth, [2, 2, 4, 2]);
          break;
        case 'dashDotHeavy': // Note asymmetry in naming!
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth * 2, [4, 2, 2, 2]);
          break;
        case 'dotDotDash':
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth, [2, 2, 2, 2, 4, 2]);
          break;
        case 'dashDotDotHeavy': // Note asymmetry!
          dl.pushLine(x, ulOffset, x + w, ulOffset, ulColor, ulWidth * 2, [4, 2, 2, 2, 2, 2]);
          break;
        case 'wave':
        case 'wavyHeavy':
        case 'wavyDouble':
          // Approximated as a line for display list primitives without bezier.
          // In a full implementation, we'd emit a pushPath here.
          dl.pushLine(
            x,
            ulOffset,
            x + w,
            ulOffset,
            ulColor,
            style.underline === 'wavyHeavy' ? ulWidth * 2 : ulWidth,
          );
          if (style.underline === 'wavyDouble') {
            dl.pushLine(x, ulOffset + 2, x + w, ulOffset + 2, ulColor, ulWidth);
          }
          break;
      }
    }
  }

  // Strikethrough
  if (style.strike) {
    const strikeOffset = y - ascent / 2.5; // approximate midline
    dl.pushLine(x, strikeOffset, x + w, strikeOffset, '#000000', 1);
  }
  if (style.dstrike) {
    const strikeOffset = y - ascent / 2.5;
    dl.pushLine(x, strikeOffset - 1, x + w, strikeOffset - 1, '#000000', 1);
    dl.pushLine(x, strikeOffset + 1, x + w, strikeOffset + 1, '#000000', 1);
  }

  // Borders
  if (style.bdr) {
    // bdr drawn around the run box
    dl.pushRect(x, y - ascent, w, h, undefined, style.bdr.color, style.bdr.width);
  }

  // Emphasis marks (CJK w:em)
  if (style.em && style.em !== 'none') {
    const emOffset = style.em === 'underDot' ? y + 4 : y - ascent - 4;
    // Approximated with a small rect or we could emit text/paths.
    dl.pushRect(x + w / 2 - 1, emOffset, 2, 2, '#000');
  }

  // Text effects (static approximation)
  if (style.effect && style.effect !== 'none') {
    // Record in manifest: painted: 'static-approximation'
    // E.g. blinkBackground can be drawn as a static gray rect
    if (style.effect === 'blinkBackground') {
      dl.pushRect(x, y - ascent, w, h, '#cccccc');
    } else {
      // Just a marker line for the others
      dl.pushLine(x, y, x + w, y, '#ff00ff', 1, [1, 2]);
    }
  }
}
