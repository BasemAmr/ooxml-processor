/**
 * Style table, style inheritance graph, and w:basedOn cycle detection.
 *
 * Implements Ticket P3-04 (Style Graph & basedOn Cycle Detection).
 *
 * Key architectural invariants:
 *   1. A style's pPr is `CT_PPrGeneral`, NOT `CT_PPr`. A style cannot carry
 *      paragraph-mark run properties (rPr) or section properties (sectPr).
 *   2. `w:basedOn` inheritance chain resolution: self first, then ancestors.
 *   3. Cycle detection: if a cycle is detected, emit diagnostic (`STYLE_CYCLE`),
 *      truncate chain, DO NOT HANG or throw.
 *   4. Cross-type basedOn: stop at boundary if a paragraph style claims to be
 *      based on a character style (`STYLE_CROSS_TYPE`).
 *   5. Missing basedOn: treat as no basedOn with diagnostic (`STYLE_MISSING_BASE`).
 *   6. `@w:default="1"` is per `ST_StyleType`. First in document order wins on collision
 *      (`STYLE_DUPLICATE_DEFAULT`).
 *   7. Latent styles (`CT_LatentStyles`) affect UI presentation only, never formatting,
 *      and are never consulted by the cascade.
 */

import type {
  CT_Styles,
  CT_Style,
  CT_LatentStyles,
  CT_LsdException,
  ST_StyleType,
  CT_PPrGeneral,
  CT_RPr,
  CT_TblPrBase,
  CT_TrPr,
  CT_TcPr,
  CT_TblStylePr,
} from '@ooxml/schema';
import { runtime, wmlReader, createCursor, createReadContext } from '@ooxml/schema';

const { parseOnOff } = runtime;

export type StyleDiagnosticCode =
  'STYLE_CYCLE' | 'STYLE_CROSS_TYPE' | 'STYLE_MISSING_BASE' | 'STYLE_DUPLICATE_DEFAULT';

export interface StyleDiagnostic {
  readonly code: StyleDiagnosticCode;
  readonly message: string;
  readonly styleId: string;
  readonly targetId?: string | undefined;
}

export interface StyleFlags {
  readonly hidden?: boolean | undefined;
  readonly semiHidden?: boolean | undefined;
  readonly qFormat?: boolean | undefined;
  readonly locked?: boolean | undefined;
  readonly personal?: boolean | undefined;
  readonly personalCompose?: boolean | undefined;
  readonly personalReply?: boolean | undefined;
  readonly autoRedefine?: boolean | undefined;
  readonly unhideWhenUsed?: boolean | undefined;
  readonly customStyle?: boolean | undefined;
}

export interface Style {
  readonly id: string;
  readonly type: ST_StyleType;
  readonly name: string;
  readonly basedOn?: string | undefined;
  readonly next?: string | undefined;
  readonly link?: string | undefined;
  readonly pPr?: CT_PPrGeneral | undefined;
  readonly rPr?: CT_RPr | undefined;
  readonly tblPr?: CT_TblPrBase | undefined;
  readonly trPr?: CT_TrPr | undefined;
  readonly tcPr?: CT_TcPr | undefined;
  readonly tblStylePr: readonly CT_TblStylePr[];
  readonly flags: StyleFlags;
  readonly uiPriority?: number | undefined;
  readonly aliases?: string | undefined;
  readonly raw?: CT_Style | undefined;
}

export interface LatentStyleException {
  readonly name: string;
  readonly locked?: boolean | undefined;
  readonly uiPriority?: number | undefined;
  readonly semiHidden?: boolean | undefined;
  readonly unhideWhenUsed?: boolean | undefined;
  readonly qFormat?: boolean | undefined;
}

export interface LatentStyleTable {
  readonly defLockedState?: boolean | undefined;
  readonly defUIPriority?: number | undefined;
  readonly defSemiHidden?: boolean | undefined;
  readonly defUnhideWhenUsed?: boolean | undefined;
  readonly defQFormat?: boolean | undefined;
  readonly count?: number | undefined;
  readonly exceptions: ReadonlyMap<string, LatentStyleException>;
}

export class StyleTable {
  readonly byId: Map<string, Style>;
  readonly defaults: Map<ST_StyleType, string>;
  readonly latent: LatentStyleTable;
  readonly diagnostics: StyleDiagnostic[];

  constructor(
    byId: Map<string, Style>,
    defaults: Map<ST_StyleType, string>,
    latent: LatentStyleTable,
    diagnostics: StyleDiagnostic[] = [],
  ) {
    this.byId = byId;
    this.defaults = defaults;
    this.latent = latent;
    this.diagnostics = diagnostics;
  }

  /**
   * Returns the inheritance chain starting with `styleId` (self first),
   * followed by `w:basedOn` ancestors in sequence.
   *
   * Guards:
   *   - Cycles: truncated at repeat with `STYLE_CYCLE` diagnostic.
   *   - Missing targets: treated as no basedOn with `STYLE_MISSING_BASE` diagnostic.
   *   - Cross-type basedOn: stops at type boundary with `STYLE_CROSS_TYPE` diagnostic.
   */
  chain(styleId: string, onDiagnostic?: (diag: StyleDiagnostic) => void): readonly Style[] {
    const out: Style[] = [];
    const root = this.byId.get(styleId);
    if (!root) {
      return out;
    }

    const seen = new Set<string>();
    let cur: Style | undefined = root;
    const initialType = root.type;

    while (cur !== undefined && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.push(cur);

      const basedOn = cur.basedOn;
      if (basedOn === undefined || basedOn === '') {
        break;
      }

      if (seen.has(basedOn)) {
        const diag: StyleDiagnostic = {
          code: 'STYLE_CYCLE',
          message: `Cycle detected in basedOn chain: style "${cur.id}" references ancestor "${basedOn}"`,
          styleId: cur.id,
          targetId: basedOn,
        };
        this.diagnostics.push(diag);
        onDiagnostic?.(diag);
        break; // Truncate chain; DO NOT HANG or throw
      }

      const next = this.byId.get(basedOn);
      if (!next) {
        const diag: StyleDiagnostic = {
          code: 'STYLE_MISSING_BASE',
          message: `Style "${cur.id}" references unknown basedOn target "${basedOn}"`,
          styleId: cur.id,
          targetId: basedOn,
        };
        this.diagnostics.push(diag);
        onDiagnostic?.(diag);
        break; // Degrade to no basedOn
      }

      if (next.type !== initialType) {
        const diag: StyleDiagnostic = {
          code: 'STYLE_CROSS_TYPE',
          message: `Cross-type basedOn: style "${cur.id}" (${initialType}) references "${next.id}" (${next.type})`,
          styleId: cur.id,
          targetId: next.id,
        };
        this.diagnostics.push(diag);
        onDiagnostic?.(diag);
        break; // Stop at boundary
      }

      cur = next;
    }

    return out;
  }
}

function coerceOnOff(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return parseOnOff(val);
  return false;
}

function parseOnOffElement(elem?: { val?: unknown }): boolean | undefined {
  if (!elem) return undefined;
  if (elem.val === undefined) return true;
  return coerceOnOff(elem.val);
}

function parseStyleFlags(style: CT_Style): StyleFlags {
  const flags: {
    hidden?: boolean | undefined;
    semiHidden?: boolean | undefined;
    qFormat?: boolean | undefined;
    locked?: boolean | undefined;
    personal?: boolean | undefined;
    personalCompose?: boolean | undefined;
    personalReply?: boolean | undefined;
    autoRedefine?: boolean | undefined;
    unhideWhenUsed?: boolean | undefined;
    customStyle?: boolean | undefined;
  } = {};

  if (style.hidden !== undefined) flags.hidden = parseOnOffElement(style.hidden);
  if (style.semiHidden !== undefined) flags.semiHidden = parseOnOffElement(style.semiHidden);
  if (style.qFormat !== undefined) flags.qFormat = parseOnOffElement(style.qFormat);
  if (style.locked !== undefined) flags.locked = parseOnOffElement(style.locked);
  if (style.personal !== undefined) flags.personal = parseOnOffElement(style.personal);
  if (style.personalCompose !== undefined)
    flags.personalCompose = parseOnOffElement(style.personalCompose);
  if (style.personalReply !== undefined)
    flags.personalReply = parseOnOffElement(style.personalReply);
  if (style.autoRedefine !== undefined) flags.autoRedefine = parseOnOffElement(style.autoRedefine);
  if (style.unhideWhenUsed !== undefined)
    flags.unhideWhenUsed = parseOnOffElement(style.unhideWhenUsed);
  if (style.customStyle !== undefined) flags.customStyle = coerceOnOff(style.customStyle);

  return flags;
}

function parseLatentStyles(ctLatent?: CT_LatentStyles): LatentStyleTable {
  if (!ctLatent) {
    return {
      exceptions: new Map(),
    };
  }

  const exceptions = new Map<string, LatentStyleException>();
  for (const exc of ctLatent.lsdException) {
    const name = exc.name ?? '';
    if (!name) continue;

    const parsedExc: {
      name: string;
      locked?: boolean | undefined;
      uiPriority?: number | undefined;
      semiHidden?: boolean | undefined;
      unhideWhenUsed?: boolean | undefined;
      qFormat?: boolean | undefined;
    } = { name };

    if (exc.locked !== undefined) parsedExc.locked = coerceOnOff(exc.locked);
    if (exc.uiPriority !== undefined) parsedExc.uiPriority = exc.uiPriority;
    if (exc.semiHidden !== undefined) parsedExc.semiHidden = coerceOnOff(exc.semiHidden);
    if (exc.unhideWhenUsed !== undefined)
      parsedExc.unhideWhenUsed = coerceOnOff(exc.unhideWhenUsed);
    if (exc.qFormat !== undefined) parsedExc.qFormat = coerceOnOff(exc.qFormat);

    exceptions.set(name, parsedExc);
  }

  const table: {
    defLockedState?: boolean | undefined;
    defUIPriority?: number | undefined;
    defSemiHidden?: boolean | undefined;
    defUnhideWhenUsed?: boolean | undefined;
    defQFormat?: boolean | undefined;
    count?: number | undefined;
    exceptions: ReadonlyMap<string, LatentStyleException>;
  } = {
    exceptions,
  };

  if (ctLatent.defLockedState !== undefined)
    table.defLockedState = coerceOnOff(ctLatent.defLockedState);
  if (ctLatent.defUIPriority !== undefined) table.defUIPriority = ctLatent.defUIPriority;
  if (ctLatent.defSemiHidden !== undefined)
    table.defSemiHidden = coerceOnOff(ctLatent.defSemiHidden);
  if (ctLatent.defUnhideWhenUsed !== undefined)
    table.defUnhideWhenUsed = coerceOnOff(ctLatent.defUnhideWhenUsed);
  if (ctLatent.defQFormat !== undefined) table.defQFormat = coerceOnOff(ctLatent.defQFormat);
  if (ctLatent.count !== undefined) table.count = ctLatent.count;

  return table;
}

/**
 * Parses a `CT_Styles` structure into a `StyleTable`.
 */
export function parseStyles(ctStyles: CT_Styles): StyleTable {
  const byId = new Map<string, Style>();
  const defaults = new Map<ST_StyleType, string>();
  const diagnostics: StyleDiagnostic[] = [];

  for (const s of ctStyles.style) {
    const id = s.styleId ?? s.name?.val ?? '';
    const type: ST_StyleType = s.type ?? 'paragraph';
    const name = s.name?.val ?? id;

    const flags = parseStyleFlags(s);

    const styleObj: {
      id: string;
      type: ST_StyleType;
      name: string;
      basedOn?: string | undefined;
      next?: string | undefined;
      link?: string | undefined;
      pPr?: CT_PPrGeneral | undefined;
      rPr?: CT_RPr | undefined;
      tblPr?: CT_TblPrBase | undefined;
      trPr?: CT_TrPr | undefined;
      tcPr?: CT_TcPr | undefined;
      tblStylePr: readonly CT_TblStylePr[];
      flags: StyleFlags;
      uiPriority?: number | undefined;
      aliases?: string | undefined;
      raw?: CT_Style | undefined;
    } = {
      id,
      type,
      name,
      tblStylePr: s.tblStylePr,
      flags,
      raw: s,
    };

    if (s.basedOn?.val !== undefined) styleObj.basedOn = s.basedOn.val;
    if (s.next?.val !== undefined) styleObj.next = s.next.val;
    if (s.link?.val !== undefined) styleObj.link = s.link.val;
    if (s.pPr !== undefined) styleObj.pPr = s.pPr;
    if (s.rPr !== undefined) styleObj.rPr = s.rPr;
    if (s.tblPr !== undefined) styleObj.tblPr = s.tblPr;
    if (s.trPr !== undefined) styleObj.trPr = s.trPr;
    if (s.tcPr !== undefined) styleObj.tcPr = s.tcPr;
    if (s.uiPriority?.val !== undefined) styleObj.uiPriority = s.uiPriority.val;
    if (s.aliases?.val !== undefined) styleObj.aliases = s.aliases.val;

    byId.set(id, styleObj);

    // Track default per style type (@w:default="1")
    if (s.default !== undefined && coerceOnOff(s.default)) {
      const existing = defaults.get(type);
      if (existing !== undefined) {
        diagnostics.push({
          code: 'STYLE_DUPLICATE_DEFAULT',
          message: `Multiple default styles for type "${type}": already "${existing}", ignoring "${id}"`,
          styleId: id,
          targetId: existing,
        });
      } else {
        defaults.set(type, id);
      }
    }
  }

  const latent = parseLatentStyles(ctStyles.latentStyles);
  return new StyleTable(byId, defaults, latent, diagnostics);
}

/**
 * Parses raw XML string of `styles.xml` into a `StyleTable`.
 */
export function parseStylesXml(xml: string): StyleTable {
  const readCtx = createReadContext('transitional', {
    wml: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  });
  const cursor = createCursor(xml);
  while (cursor.current && cursor.current.type !== 'startElement') {
    cursor.next();
  }
  const ctStyles = wmlReader.readCT_Styles(cursor, readCtx);
  return parseStyles(ctStyles);
}
