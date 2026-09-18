/**
 * The context every generated writer threads through, and its lookup rule.
 *
 * Mirrors {@link ReadContext}'s namespace handling on purpose: writers resolve
 * every element and attribute namespace by *token* — `ctx.uris['wml']` — never
 * by spelling a URI literal, so one generated writer serves both dialects and
 * ADR 0008's "write back in the dialect the file arrived in" is a property of
 * the context, not of 2,800 generated functions.
 */

import type { NamespaceUri } from './xml.js';
import type { Dialect, NsUris } from './read.js';

export interface WriteContext {
  /** Which dialect this part is being written in. Decides every namespace URI. */
  readonly dialect: Dialect;

  /**
   * Namespace URIs for {@link dialect}. Populate from the same table the reader
   * used, so a round-trip writes the URIs it read.
   */
  readonly uris: NsUris;
}

export function createWriteContext(dialect: Dialect, uris: NsUris): WriteContext {
  return { dialect, uris };
}

/**
 * Resolve one namespace token to its URI for this document's dialect, or throw.
 *
 * A missing entry is a caller bug — the writer was handed a context that does
 * not know the dialect's URI for a namespace the schema requires. That is not a
 * document problem, so it throws rather than reporting (the reader reports
 * document problems; this is not one). The alternative — quietly emitting the
 * element with no namespace — would corrupt the document invisibly, which is
 * the single worst outcome a writer can produce (A1).
 *
 * This exists rather than a bare `ctx.uris[token]` because
 * `noUncheckedIndexedAccess` makes that `string | undefined`, and `?? ''` would
 * turn a missing entry into a silently un-namespaced element.
 */
export function uriFor(ctx: WriteContext, token: string): NamespaceUri {
  const uri = ctx.uris[token];
  if (uri === undefined) {
    throw new Error(`WriteContext has no URI for namespace token '${token}' (dialect: ${ctx.dialect})`);
  }
  return uri;
}
