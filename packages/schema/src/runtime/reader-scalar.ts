/**
 * The scalar-element reader every generated module shares.
 *
 * Emitted as its own runtime module (rather than inlined per generated file)
 * because dozens of modules import it and it must behave identically in all of
 * them. On entry the cursor is on the element's `startElement`; on return it is
 * on the event after the matching `endElement` — the same contract as every
 * generated `readCT_*` and as `XmlCursor.skipToRaw()`, which is what lets the
 * child loop that dispatched here keep looping without special cases.
 *
 * Text is returned verbatim; parsing it against the declared type is the
 * caller's job (the generated reader knows the type, this module does not).
 * `ctx` is accepted for signature parity with the generated readers and is
 * deliberately unused here.
 */

import type { ReadContext } from './read.js';
import type { XmlCursor } from './xml.js';

export function readScalar(cur: XmlCursor, _ctx: ReadContext): string {
  const ev = cur.current;
  if (ev?.type === 'startElement') {
    cur.next();
    let text: string | undefined;
    const textEv = cur.current;
    if (textEv?.type === 'text') {
      text = textEv.value;
      cur.next();
    }
    // Consume to the end of this element, ignoring comments and PIs; a child
    // element inside a scalar-typed slot is schema-invalid and the child loop
    // has already reported it — the reader's job is to keep its cursor promise.
    while (cur.current !== undefined && cur.current.type !== 'endElement') cur.next();
    cur.next();
    return text ?? '';
  }
  return '';
}
