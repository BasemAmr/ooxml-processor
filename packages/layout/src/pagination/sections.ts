import type { CT_Body, CT_Body_BlockLevelElts, CT_P, CT_SectPr } from '@ooxml/schema';

export interface SectionModel {
  /** Blocks are inclusive of the paragraph carrying a section terminator. */
  readonly blocks: readonly CT_Body_BlockLevelElts[];
  readonly sectPr?: CT_SectPr | undefined;
  readonly startBlock: number;
  readonly endBlock: number;
}

/**
 * Splits body content at paragraph section terminators.
 * `w:sectPr` terminates the paragraph's section; it is not an opener.
 */
export function enumerateSections(body: CT_Body): readonly SectionModel[] {
  const sections: SectionModel[] = [];
  let start = 0;
  body.blockLevelElts.forEach((block, index) => {
    if (block.kind !== 'p') return;
    const paragraph = block.value as CT_P;
    const sectPr = paragraph.pPr?.sectPr;
    if (sectPr === undefined) return;
    if (index > start)
      sections.push({
        blocks: body.blockLevelElts.slice(start, index),
        sectPr: undefined,
        startBlock: start,
        endBlock: index - 1,
      });
    sections.push({
      blocks: body.blockLevelElts.slice(index, index + 1),
      sectPr,
      startBlock: index,
      endBlock: index,
    });
    start = index + 1;
  });
  sections.push({
    blocks: body.blockLevelElts.slice(start),
    sectPr: body.sectPr,
    startBlock: start,
    endBlock: body.blockLevelElts.length - 1,
  });
  return sections;
}
