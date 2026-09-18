/**
 * Property inspector reading cascade provenance (P3-12).
 *
 * Provides structured inspection and human-readable diagnostic formatting
 * of resolved properties, cascade origin levels, and toggle contribution chains.
 */

import type { ResolvedProperties } from './cascade.js';
import type { OnOffState } from './toggle.js';

export interface InspectedProperty {
  readonly name: string;
  readonly value: any;
  readonly originLayer: string;
  readonly toggleHistory?:
    readonly { readonly layer: string; readonly value: OnOffState }[] | undefined;
  readonly formatted: string;
}

export interface InspectionReport {
  readonly properties: ReadonlyMap<string, InspectedProperty>;
  readonly lines: readonly string[];
  toString(): string;
}

/**
 * Format a property value into a clean human-readable representation.
 */
function formatPropertyValue(val: unknown): string {
  if (val === undefined) return 'undefined';
  if (typeof val === 'object' && val !== null) {
    if ('val' in val) {
      return String((val as any).val);
    }
    return JSON.stringify(val);
  }
  return String(val);
}

/**
 * Inspect a ResolvedProperties bag produced by P3-06 cascade resolution.
 */
export function inspectProperties(resolved: ResolvedProperties): InspectionReport {
  const propertyMap = new Map<string, InspectedProperty>();
  const lines: string[] = [];

  // Sort properties alphabetically for stable output
  const sortedNames = Array.from(resolved.values.keys()).sort();

  for (const name of sortedNames) {
    const value = resolved.values.get(name);
    const prov = resolved.provenance.get(name);
    const originLayer = prov?.layer ?? 'unknown';
    const valStr = formatPropertyValue(value);

    let line = `${name.padEnd(12)} = ${valStr.padEnd(8)} <- ${originLayer}`;

    if (prov?.toggleHistory && prov.toggleHistory.length > 0) {
      const historySummary = prov.toggleHistory.map((h) => `${h.layer} = ${h.value}`).join(', ');
      line += ` (XOR over: ${historySummary})`;
    }

    const inspected: InspectedProperty = {
      name,
      value,
      originLayer,
      toggleHistory: prov?.toggleHistory,
      formatted: line,
    };

    propertyMap.set(name, inspected);
    lines.push(line);
  }

  return {
    properties: propertyMap,
    lines,
    toString(): string {
      return lines.join('\n');
    },
  };
}
