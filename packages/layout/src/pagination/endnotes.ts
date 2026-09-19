export type EndnotePosition = 'sectEnd' | 'docEnd';
export type NumberRestart = 'continuous' | 'eachSect' | 'eachPage';

export interface EndnotePlacement<T> {
  readonly position: EndnotePosition;
  readonly items: readonly T[];
  readonly firstNumber: number;
}

export function placeEndnotes<T>(
  items: readonly T[],
  position: EndnotePosition,
  firstNumber = 1,
): EndnotePlacement<T> {
  return { position, items: [...items], firstNumber: Math.max(1, Math.floor(firstNumber)) };
}

export function restartNumber(
  previous: number,
  restart: NumberRestart,
  pageOrSectionStart: number,
): number {
  return restart === 'continuous' ? previous : pageOrSectionStart;
}
