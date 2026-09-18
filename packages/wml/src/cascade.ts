/**
 * Six-level property cascade resolution for paragraphs, runs, and paragraph-marks (P3-06).
 *
 * ## The Cascade Architecture
 *
 * Paragraph resolution order (bottom to top, later wins except toggles):
 * 1. `docDefaults/pPrDefault/pPr` (P3-05)
 * 2. table style conditional layers `pPr` (P3-09)
 * 3. numbering style `pPr` (P3-08)
 * 4. paragraph style chain, ROOT-FIRST (reversed from chain())
 * 5. numbering level `pPr` (`ind`/`jc` from level)
 * 6. direct `w:pPr` on the paragraph
 *
 * Run resolution order (bottom to top):
 * 1. `docDefaults/rPrDefault/rPr` (P3-05)
 * 2. table style conditional layers `rPr` (P3-09)
 * 3. numbering style `rPr` (P3-08)
 * 4. paragraph style chain `rPr`, ROOT-FIRST
 * 5. character style chain `rPr` (`w:rStyle`), ROOT-FIRST
 * 6. direct `w:rPr` on the run
 *
 * Paragraph-mark run resolution (formats the pilcrow glyph and end-of-paragraph metrics):
 * Terminates at paragraph mark's own `rPr` (`w:pPr/w:rPr`).
 */

import type { CT_PPr, CT_PPrGeneral, CT_ParaRPr, CT_RPr } from '@ooxml/schema';
import type { DocDefaults } from './defaults.js';
import type { ResolvedNumbering } from './numbering.js';
import type { Style, StyleTable } from './styles.js';
import type { TableCellPosition } from './table-style.js';
import { resolveTableConditionalLayers } from './table-style.js';
import { isToggleProperty, toOnOffState, toggleCombine, type OnOffState } from './toggle.js';

export interface PropertyOrigin {
  readonly layer: string;
  readonly value: any;
  /** For toggle properties, records contribution sequence */
  readonly toggleHistory?: readonly { readonly layer: string; readonly value: OnOffState }[];
}

export interface ResolvedProperties {
  readonly values: ReadonlyMap<string, any>;
  readonly provenance: ReadonlyMap<string, PropertyOrigin>;
}

/**
 * Property layer contributing to the cascade stack.
 */
export interface PropertyLayer {
  readonly name: string;
  readonly properties: Record<string, any>;
}

/**
 * Generic cascade accumulator resolving an ordered stack of property layers.
 */
export function resolveCascadeStack(layers: readonly PropertyLayer[]): ResolvedProperties {
  const values = new Map<string, any>();
  const provenance = new Map<string, PropertyOrigin>();
  const toggleHistories = new Map<string, { layer: string; value: OnOffState }[]>();

  for (const layer of layers) {
    for (const [propName, rawValue] of Object.entries(layer.properties)) {
      if (rawValue === undefined) continue;

      if (isToggleProperty(propName)) {
        const directState = toOnOffState(rawValue);
        if (directState === 'absent') continue;

        const existingState = values.get(propName) as OnOffState | undefined;
        const combined = toggleCombine(existingState, directState);
        values.set(propName, combined);

        let history = toggleHistories.get(propName);
        if (history === undefined) {
          history = [];
          toggleHistories.set(propName, history);
        }
        history.push({ layer: layer.name, value: directState });

        provenance.set(propName, {
          layer: layer.name,
          value: combined,
          toggleHistory: [...history],
        });
      } else {
        // Normal property overwrites
        values.set(propName, rawValue);
        provenance.set(propName, {
          layer: layer.name,
          value: rawValue,
        });
      }
    }
  }

  return { values, provenance };
}

/* -------------------------------------------------------------------------- */
/* Extract property bags from schema ASTs                                     */
/* -------------------------------------------------------------------------- */

function pPrToBag(pPr: CT_PPr | CT_PPrGeneral | undefined): Record<string, any> {
  if (pPr === undefined) return {};
  const bag: Record<string, any> = {};
  if (pPr.jc !== undefined) bag.jc = pPr.jc.val;
  if (pPr.spacing !== undefined) bag.spacing = pPr.spacing;
  if (pPr.ind !== undefined) bag.ind = pPr.ind;
  if (pPr.outlineLvl !== undefined) bag.outlineLvl = pPr.outlineLvl.val;
  if (pPr.keepNext !== undefined) bag.keepNext = pPr.keepNext;
  if (pPr.keepLines !== undefined) bag.keepLines = pPr.keepLines;
  if (pPr.pageBreakBefore !== undefined) bag.pageBreakBefore = pPr.pageBreakBefore;
  if (pPr.widowControl !== undefined) bag.widowControl = pPr.widowControl;
  if (pPr.textAlignment !== undefined) bag.textAlignment = pPr.textAlignment.val;
  return bag;
}

function rPrToBag(rPr: CT_RPr | CT_ParaRPr | undefined): Record<string, any> {
  if (rPr === undefined) return {};
  const bag: Record<string, any> = {};

  // Walk rPrBase choice items if present
  if (Array.isArray(rPr.rPrBase)) {
    for (const item of rPr.rPrBase) {
      if (item && item.kind) {
        bag[item.kind] = item.value;
      }
    }
  }

  // Also check top-level properties
  if ((rPr as any).rFonts !== undefined) bag.rFonts = (rPr as any).rFonts;
  if ((rPr as any).sz !== undefined) bag.sz = (rPr as any).sz;
  if ((rPr as any).color !== undefined) bag.color = (rPr as any).color;
  if ((rPr as any).b !== undefined) bag.b = (rPr as any).b;
  if ((rPr as any).i !== undefined) bag.i = (rPr as any).i;

  return bag;
}

/* -------------------------------------------------------------------------- */
/* Paragraph Cascade                                                          */
/* -------------------------------------------------------------------------- */

export interface ParagraphCascadeContext {
  readonly docDefaults: DocDefaults;
  readonly styleTable: StyleTable;
  readonly directPPr?: CT_PPr;
  readonly tableStyle?: Style;
  readonly tableCellPosition?: TableCellPosition;
  readonly numbering?: ResolvedNumbering;
}

export function resolveParagraphProperties(ctx: ParagraphCascadeContext): ResolvedProperties {
  const layers: PropertyLayer[] = [];

  // Level 1: docDefaults
  if (ctx.docDefaults.pPr) {
    layers.push({ name: 'docDefaults', properties: pPrToBag(ctx.docDefaults.pPr) });
  }

  // Level 2: table style conditional layers (if inside table)
  if (ctx.tableStyle) {
    const tableLayers = resolveTableConditionalLayers(
      ctx.tableStyle,
      undefined,
      ctx.tableCellPosition,
    );
    for (const tl of tableLayers) {
      if (tl.pPr) {
        layers.push({ name: `tableStyle:${tl.type}`, properties: pPrToBag(tl.pPr) });
      }
    }
  }

  // Level 3: numbering style pPr
  if (ctx.numbering?.numberingStyle?.pPr) {
    layers.push({
      name: `numberingStyle:${ctx.numbering.numberingStyle.id}`,
      properties: pPrToBag(ctx.numbering.numberingStyle.pPr),
    });
  }

  // Level 4: paragraph style chain, ROOT-FIRST (reversed from chain())
  const pStyleId = ctx.directPPr?.pStyle?.val;
  if (pStyleId) {
    const chain = [...ctx.styleTable.chain(String(pStyleId))].reverse();
    for (const style of chain) {
      if (style.pPr) {
        layers.push({ name: `paragraphStyle:${style.id}`, properties: pPrToBag(style.pPr) });
      }
    }
  }

  // Level 5: numbering level pPr (ind/jc)
  if (ctx.numbering?.levelPPr) {
    layers.push({ name: 'numberingLevel', properties: pPrToBag(ctx.numbering.levelPPr) });
  }

  // Level 6: direct w:pPr on the paragraph
  if (ctx.directPPr) {
    layers.push({ name: 'direct', properties: pPrToBag(ctx.directPPr) });
  }

  return resolveCascadeStack(layers);
}

/* -------------------------------------------------------------------------- */
/* Run Cascade                                                                */
/* -------------------------------------------------------------------------- */

export interface RunCascadeContext {
  readonly docDefaults: DocDefaults;
  readonly styleTable: StyleTable;
  readonly paragraphStyleId?: string;
  readonly directRPr?: CT_RPr;
  readonly tableStyle?: Style;
  readonly tableCellPosition?: TableCellPosition;
  readonly numbering?: ResolvedNumbering;
}

export function resolveRunProperties(ctx: RunCascadeContext): ResolvedProperties {
  const layers: PropertyLayer[] = [];

  // Level 1: docDefaults
  if (ctx.docDefaults.rPr) {
    layers.push({ name: 'docDefaults', properties: rPrToBag(ctx.docDefaults.rPr) });
  }

  // Level 2: table style conditional layers (if inside table)
  if (ctx.tableStyle) {
    const tableLayers = resolveTableConditionalLayers(
      ctx.tableStyle,
      undefined,
      ctx.tableCellPosition,
    );
    for (const tl of tableLayers) {
      if (tl.rPr) {
        layers.push({ name: `tableStyle:${tl.type}`, properties: rPrToBag(tl.rPr) });
      }
    }
  }

  // Level 3: numbering style rPr
  if (ctx.numbering?.numberingStyle?.rPr) {
    layers.push({
      name: `numberingStyle:${ctx.numbering.numberingStyle.id}`,
      properties: rPrToBag(ctx.numbering.numberingStyle.rPr),
    });
  }

  // Level 4: paragraph style chain rPr, ROOT-FIRST
  if (ctx.paragraphStyleId) {
    const chain = [...ctx.styleTable.chain(ctx.paragraphStyleId)].reverse();
    for (const style of chain) {
      if (style.rPr) {
        layers.push({ name: `paragraphStyle:${style.id}`, properties: rPrToBag(style.rPr) });
      }
    }
  }

  // Level 5: character style chain rPr (w:rStyle), ROOT-FIRST
  const rStyleId = (ctx.directRPr as any)?.rStyle?.val;
  if (rStyleId) {
    const chain = [...ctx.styleTable.chain(String(rStyleId))].reverse();
    for (const style of chain) {
      if (style.rPr) {
        layers.push({ name: `characterStyle:${style.id}`, properties: rPrToBag(style.rPr) });
      }
    }
  }

  // Level 6: direct w:rPr on the run
  if (ctx.directRPr) {
    layers.push({ name: 'direct', properties: rPrToBag(ctx.directRPr) });
  }

  return resolveCascadeStack(layers);
}

/* -------------------------------------------------------------------------- */
/* Paragraph-Mark Run Cascade                                                 */
/* -------------------------------------------------------------------------- */

export interface ParagraphMarkRunContext {
  readonly docDefaults: DocDefaults;
  readonly styleTable: StyleTable;
  readonly paragraphStyleId?: string;
  readonly paraRPr?: CT_ParaRPr;
  readonly tableStyle?: Style;
  readonly tableCellPosition?: TableCellPosition;
  readonly numbering?: ResolvedNumbering;
}

export function resolveParagraphMarkRunProperties(
  ctx: ParagraphMarkRunContext,
): ResolvedProperties {
  const layers: PropertyLayer[] = [];

  // Level 1: docDefaults
  if (ctx.docDefaults.rPr) {
    layers.push({ name: 'docDefaults', properties: rPrToBag(ctx.docDefaults.rPr) });
  }

  // Level 2: table style conditional layers
  if (ctx.tableStyle) {
    const tableLayers = resolveTableConditionalLayers(
      ctx.tableStyle,
      undefined,
      ctx.tableCellPosition,
    );
    for (const tl of tableLayers) {
      if (tl.rPr) {
        layers.push({ name: `tableStyle:${tl.type}`, properties: rPrToBag(tl.rPr) });
      }
    }
  }

  // Level 3: numbering style rPr
  if (ctx.numbering?.numberingStyle?.rPr) {
    layers.push({
      name: `numberingStyle:${ctx.numbering.numberingStyle.id}`,
      properties: rPrToBag(ctx.numbering.numberingStyle.rPr),
    });
  }

  // Level 4: paragraph style chain rPr, ROOT-FIRST
  if (ctx.paragraphStyleId) {
    const chain = [...ctx.styleTable.chain(ctx.paragraphStyleId)].reverse();
    for (const style of chain) {
      if (style.rPr) {
        layers.push({ name: `paragraphStyle:${style.id}`, properties: rPrToBag(style.rPr) });
      }
    }
  }

  // Level 6: paragraph mark's own rPr (w:pPr/w:rPr)
  // Note: Level 5 (character style) does not exist for a paragraph mark!
  if (ctx.paraRPr) {
    layers.push({ name: 'directParaRPr', properties: rPrToBag(ctx.paraRPr) });
  }

  return resolveCascadeStack(layers);
}
