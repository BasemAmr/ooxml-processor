/**
 * Serialization-time namespace facts: conventional prefixes, and the two W3C
 * built-ins that the XML specification binds implicitly.
 *
 * The authoritative logical-namespace ↔ dialect ↔ URI mapping lives in
 * `packages/codegen` (`src/namespaces.ts`) and is emitted into
 * `packages/schema/src/generated/namespaces.ts` by `pnpm gen`. This runtime
 * module re-exports the generated `CONVENTIONAL_PREFIXES` and `conventionalPrefix`
 * function, and declares the three W3C built-in namespaces that are not in the
 * ECMA-376 asset set.
 */

import type { NamespaceUri } from './xml.js';
import { CONVENTIONAL_PREFIXES, conventionalPrefix } from '../generated/namespaces.js';

/**
 * The XML namespace. Bound to the `xml` prefix implicitly by the Namespaces in
 * XML specification: it must never be declared and must never be rebound.
 * `xml:space="preserve"` on `w:t` is the load-bearing use in WordprocessingML —
 * without it, a run whose text is a single space loses the space on reparse.
 */
export const XML_NAMESPACE: NamespaceUri = 'http://www.w3.org/XML/1998/namespace';

/**
 * The namespace of namespace declarations themselves. `xmlns:w="…"` is an
 * attribute in this namespace. The cursor lifts those out of the attribute list
 * into `XmlStartElement.nsDeclarations`, so this URI should never appear on an
 * `XmlAttr` — it is exported so the sink can assert that.
 */
export const XMLNS_NAMESPACE: NamespaceUri = 'http://www.w3.org/2000/xmlns/';

/** Markup Compatibility (ECMA-376 Part 3). Identical in both dialects. */
export const MC_NAMESPACE: NamespaceUri =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Re-export the generated conventional prefix map and lookup. */
export { CONVENTIONAL_PREFIXES, conventionalPrefix };
