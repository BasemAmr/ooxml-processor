/**
 * Realistic 500-paragraph synthetic document fixture for the ADR 0003 Spike.
 *
 * Contains:
 *   - 500 paragraphs, each containing multiple runs with differing rPr (plain, bold, italic)
 *   - Tables with rows and cells
 *   - Non-nesting bookmark ranges spanning paragraph and table boundaries
 *   - Unknown vendor extension elements ($raw in pContent)
 *   - Unknown attributes on elements ($unknownAttrs)
 */

import type { CT_Document, CT_P, RawNode, XmlAttr } from '@ooxml/schema';

export function createSpikeFixture(paragraphCount = 500): CT_Document {
  const bodyElts: CT_Document['body']['blockLevelElts'] = [];

  for (let i = 0; i < paragraphCount; i++) {
    // Every 50 paragraphs, insert a table
    if (i > 0 && i % 50 === 0) {
      bodyElts.push({
        kind: 'tbl',
        value: {
          rangeMarkupElements: [],
          tblGrid: {
            gridCol: [{ w: 4000 }, { w: 4000 }],
          },
          contentRowContent: [
            {
              kind: 'tr',
              value: {
                contentCellContent: [
                  {
                    kind: 'tc',
                    value: {
                      blockLevelElts: [
                        {
                          kind: 'p',
                          value: {
                            pContent: [
                              {
                                kind: 'r',
                                value: {
                                  rPr: { rPrBase: [{ kind: 'b', value: { val: true } }] },
                                  runInnerContent: [
                                    {
                                      kind: 't',
                                      value: { $value: `Table Cell ${i}-1 Header` },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  {
                    kind: 'tc',
                    value: {
                      blockLevelElts: [
                        {
                          kind: 'p',
                          value: {
                            pContent: [
                              {
                                kind: 'r',
                                value: {
                                  runInnerContent: [
                                    {
                                      kind: 't',
                                      value: { $value: `Table Cell ${i}-2 Content` },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      });
    }

    // Bookmark starts at paragraph 240 and ends at paragraph 260 (spanning the 10k insertion point)
    const isBookmarkStart = i === 240;
    const isBookmarkEnd = i === 260;

    const pContent: CT_P['pContent'] = [];

    if (isBookmarkStart) {
      pContent.push({
        kind: 'bookmarkStart',
        value: { id: 42, name: 'TargetRangeBookmark' },
      });
    }

    // Run 1: Plain prefix
    pContent.push({
      kind: 'r',
      value: {
        runInnerContent: [
          {
            kind: 't',
            value: {
              $value: `Paragraph ${i}: Standard section introduction with introductory text. `,
            },
          },
        ],
      },
    });

    // Run 2: Bold run
    pContent.push({
      kind: 'r',
      value: {
        rPr: { rPrBase: [{ kind: 'b', value: { val: true } }] },
        runInnerContent: [
          {
            kind: 't',
            value: { $value: `Key bold assertion for paragraph ${i}. ` },
          },
        ],
      },
    });

    // Run 3: Italic run
    pContent.push({
      kind: 'r',
      value: {
        rPr: { rPrBase: [{ kind: 'i', value: { val: true } }] },
        runInnerContent: [
          {
            kind: 't',
            value: { $value: `Emphasized italic commentary following assertion ${i}.` },
          },
        ],
      },
    });

    if (isBookmarkEnd) {
      pContent.push({
        kind: 'bookmarkEnd',
        value: { id: 42 },
      });
    }

    // Every 25th paragraph carries unknown attributes and unknown extension nodes (ADR 0009 fidelity test)
    const unknownAttrs: XmlAttr[] | undefined =
      i % 25 === 0
        ? [
            {
              uri: 'http://schemas.custom.org/office/custom',
              localName: 'customMetaTag',
              value: `meta-${i}`,
            },
          ]
        : undefined;

    if (i % 25 === 0) {
      pContent.push({
        kind: '$raw',
        value: {
          type: 'element',
          uri: 'http://schemas.custom.org/office/custom',
          prefix: 'ns',
          localName: 'customBlockExtension',
          attrs: [{ uri: '', localName: 'id', prefix: '', value: `ext-${i}` }],
          children: [{ kind: 'text', value: `Custom raw data for p${i}`, cdata: false }],
          nsDeclarations: new Map([['ns', 'http://schemas.custom.org/office/custom']]),
        } as RawNode,
      });
    }

    bodyElts.push({
      kind: 'p',
      value: {
        pPr: {
          pStyle: { val: i === 0 ? 'Title' : 'Normal' },
        },
        pContent,
        $unknownAttrs: unknownAttrs,
      },
    });
  }

  return {
    body: {
      blockLevelElts: bodyElts,
    },
  };
}
