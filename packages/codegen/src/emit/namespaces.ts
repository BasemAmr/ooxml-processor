/**
 * Emit the namespace binding table for runtime use.
 *
 * This is the single source of truth for logical-token ↔ dialect-URI ↔ conventional-prefix
 * mappings. The runtime's `CONVENTIONAL_PREFIXES` was hand-maintained and has been removed
 * to prevent drift (P1-07).
 */

import type { LogicalNs } from '../ir.js';
import { NAMESPACES } from '../namespaces.js';
import { generatedBanner, SourceFile, stringLiteral } from './source.js';
import type { EmittedModule } from './types.js';

export function emitNamespaces(): EmittedModule {
  const file = new SourceFile(
    generatedBanner('the namespace binding table for the ECMA-376 5th edition schema set'),
  );

  file.blank();

  // Sort by token for deterministic output (C1)
  const sorted = [...NAMESPACES].sort((a, b) => a.token.localeCompare(b.token));

  // Individual binding constants
  file.line('/** Namespace bindings: logical token → prefix and dialect URIs. */');
  file.blank();

  for (const ns of sorted) {
    if (!ns.transitional) continue; // Skip any binding with no URIs (none exist currently)

    const fields: string[] = [];
    fields.push(`token: ${stringLiteral(ns.token)}`);
    fields.push(`prefix: ${stringLiteral(ns.prefix)}`);
    fields.push(`transitional: ${stringLiteral(ns.transitional)}`);
    if (ns.strict) {
      fields.push(`strict: ${stringLiteral(ns.strict)}`);
    }

    const typeFields = fields.join('; ');
    const valueFields = fields.join(', ');
    file.line(
      `export const ${nsConstName(ns.token)}: Readonly<{ ${typeFields} }> = { ${valueFields} };`,
    );
  }

  file.blank();

  // NAMESPACES array
  file.line('/** All namespace bindings, sorted by token. */');
  file.line('export const NAMESPACES = [');
  file.indent(() => {
    for (const ns of sorted) {
      file.line(`${nsConstName(ns.token)},`);
    }
  });
  file.line('] as const;');
  file.blank();

  // NS_BY_TOKEN map
  file.line('/** Logical token → binding. O(1) lookup for reader context construction. */');
  file.line(
    'export const NS_BY_TOKEN: ReadonlyMap<string, (typeof NAMESPACES)[number]> = new Map<string, (typeof NAMESPACES)[number]>([',
  );
  file.indent(() => {
    for (const ns of sorted) {
      file.line(`[${stringLiteral(ns.token)}, ${nsConstName(ns.token)}] as const,`);
    }
  });
  file.line(']);');
  file.blank();

  // NS_BY_URI map (both transitional and strict)
  file.line(
    '/** URI → logical token. O(1) reverse lookup for unknown-element namespace resolution. */',
  );
  file.line('export const NS_BY_URI: ReadonlyMap<string, string> = new Map([');
  file.indent(() => {
    for (const ns of sorted) {
      if (ns.transitional) {
        file.line(`[${stringLiteral(ns.transitional)}, ${stringLiteral(ns.token)}],`);
      }
      if (ns.strict) {
        file.line(`[${stringLiteral(ns.strict)}, ${stringLiteral(ns.token)}],`);
      }
    }
  });
  file.line(']);');
  file.blank();

  // TRANSITIONAL_ONLY set (VML namespaces with no Strict equivalent)
  file.line(
    '/** Namespaces that exist only in Transitional (VML and companions). Strict packages must not contain elements from these. */',
  );
  file.line('export const TRANSITIONAL_ONLY: ReadonlySet<string> = new Set([');
  file.indent(() => {
    for (const ns of sorted) {
      if (ns.strict === undefined) {
        file.line(`${stringLiteral(ns.token)},`);
      }
    }
  });
  file.line(']);');
  file.blank();

  // CONVENTIONAL_PREFIXES map (replaces runtime's hand-maintained version)
  file.line(
    '/** URI → conventional prefix. Used by writers to emit familiar xmlns declarations. */',
  );
  file.line('export const CONVENTIONAL_PREFIXES: ReadonlyMap<string, string> = new Map([');
  file.indent(() => {
    for (const ns of sorted) {
      if (ns.transitional) {
        file.line(`[${stringLiteral(ns.transitional)}, ${stringLiteral(ns.prefix)}],`);
      }
      if (ns.strict) {
        file.line(`[${stringLiteral(ns.strict)}, ${stringLiteral(ns.prefix)}],`);
      }
    }
  });
  file.line(']);');
  file.blank();

  // Helper for conventional prefix lookup
  file.line('/** Look up the conventional prefix for a URI, if one exists. */');
  file.line('export function conventionalPrefix(uri: string): string | undefined {');
  file.indent(() => {
    file.line('return CONVENTIONAL_PREFIXES.get(uri);');
  });
  file.line('}');

  return { path: 'namespaces.ts', contents: file.toString() };
}

function nsConstName(token: LogicalNs): string {
  // Convert dml-main → NS_DML_MAIN, relationships → NS_RELATIONSHIPS
  return `NS_${token.toUpperCase().replace(/-/g, '_')}`;
}
