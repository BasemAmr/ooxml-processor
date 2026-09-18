import { describe, expect, it } from 'vitest';
import { PositionedRawQueue, sortPositioned } from './preserve.js';
import type { PositionedRaw } from './preserve.js';
import { createStringSink } from './sink.js';
import type { RawNode } from './xml.js';

const node = (localName: string): RawNode => ({
  uri: 'urn:test',
  localName,
  prefix: 't',
  attrs: [],
  nsDeclarations: new Map(),
  children: [],
});

describe('PositionedRaw ordering', () => {
  it('interleaves raw content between repetitions of a slot', () => {
    const entries: PositionedRaw[] = [
      { afterSlot: 0, afterIndex: 1, node: node('after-second') },
      { afterSlot: 0, afterIndex: 0, node: node('between-first-second') },
      { afterSlot: -1, node: node('leading') },
      { afterSlot: 0, node: node('after-slot') },
    ];
    expect(sortPositioned(entries).map((entry) => entry.node.localName)).toEqual([
      'leading',
      'between-first-second',
      'after-second',
      'after-slot',
    ]);
  });

  it('drains entries through PositionedRawQueue in slot and index sequence', () => {
    const entries: PositionedRaw[] = [
      { afterSlot: 0, afterIndex: 1, node: node('after-second') },
      { afterSlot: 0, afterIndex: 0, node: node('between-first-second') },
      { afterSlot: -1, node: node('leading') },
      { afterSlot: 0, node: node('after-slot-0') },
      { afterSlot: 1, node: node('after-slot-1') },
    ];

    const q = new PositionedRawQueue(entries);
    const { sink, toString } = createStringSink();

    sink.startElement('urn:test', 'root');

    // Before any slots
    q.flush(sink, -1);

    // Slot 0 (repeated: item 0, item 1, item 2)
    sink.startElement('urn:test', 'item');
    sink.endElement();
    q.flush(sink, 0, 0);

    sink.startElement('urn:test', 'item');
    sink.endElement();
    q.flush(sink, 0, 1);

    sink.startElement('urn:test', 'item');
    sink.endElement();
    q.flush(sink, 0, 2);

    // End of slot 0
    q.flush(sink, 0);

    // Slot 1 (non-repeated)
    sink.startElement('urn:test', 'single');
    sink.endElement();
    q.flush(sink, 1);

    // Trailing
    q.flushRemaining(sink);

    sink.endElement();

    expect(toString()).toBe(
      '<root xmlns="urn:test">' +
        '<t:leading xmlns:t="urn:test"/>' +
        '<item/>' +
        '<t:between-first-second xmlns:t="urn:test"/>' +
        '<item/>' +
        '<t:after-second xmlns:t="urn:test"/>' +
        '<item/>' +
        '<t:after-slot-0 xmlns:t="urn:test"/>' +
        '<single/>' +
        '<t:after-slot-1 xmlns:t="urn:test"/>' +
        '</root>',
    );
  });
});
