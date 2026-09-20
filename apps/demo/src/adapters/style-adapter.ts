import type { CT_P, CT_R, CT_NumPr, CT_PPr } from '@ooxml/schema';
import type { OpcPackage } from '@ooxml/opc';
import {
  buildCacheKey,
  hashDirectProps,
  inspectProperties,
  parseNumberingXml,
  parseStylesXml,
  parseThemeXml,
  resolveDocDefaults,
  resolveNumbering,
  resolveParagraphProperties,
  resolveRunProperties,
  ResolvedPropertyCache,
  type ColorMap,
  type InspectionReport,
  type NumberingTable,
  type ResolvedProperties,
  type StyleTable,
  type Theme,
  type ThemeDiagnostic,
  type FontScheme,
  type ColorScheme,
} from '@ooxml/wml';
import { resolveSchemeColor, resolveThemeFont } from '@ooxml/wml';

/** Inputs accepted by the demo adapter when no OPC package is available. */
export interface StyleManagerSource {
  readonly stylesXml?: string | undefined;
  readonly themeXml?: string | undefined;
  readonly numberingXml?: string | undefined;
}

/**
 * The demo's package-boundary style service. XML is parsed once and property
 * results are cached by semantic inputs plus the package cache generations.
 */
export class DocumentStyleManager {
  readonly styleTable: StyleTable;
  readonly theme: Theme | undefined;
  readonly numbering: NumberingTable;
  readonly docDefaults: ReturnType<typeof resolveDocDefaults>;
  readonly cache: ResolvedPropertyCache;
  readonly diagnostics: ThemeDiagnostic[] = [];

  constructor(source?: OpcPackage | StyleManagerSource) {
    const parts = source && 'wordParts' in source ? source.wordParts : undefined;
    const stylesXml = parts?.styles?.text() ?? (source as StyleManagerSource | undefined)?.stylesXml;
    const themeXml = parts?.theme?.text() ?? (source as StyleManagerSource | undefined)?.themeXml;
    const numberingXml = parts?.numbering?.text() ?? (source as StyleManagerSource | undefined)?.numberingXml;

    // An absent styles part is valid OOXML; use an empty table rather than
    // manufacturing style attributes in the AST or throwing during rendering.
    this.styleTable = stylesXml === undefined
      ? parseStylesXml('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')
      : parseStylesXml(stylesXml);
    this.theme = themeXml === undefined ? undefined : parseThemeXml(themeXml);
    this.numbering = numberingXml === undefined
      ? { abstractNums: new Map(), nums: new Map() }
      : parseNumberingXml(numberingXml);
    // resolveDocDefaults applies application fallback at cascade time, not XML
    // read time, preserving the distinction between absent and explicit attrs.
    this.docDefaults = resolveDocDefaults(undefined);
    this.cache = new ResolvedPropertyCache();
  }

  resolveParagraph(p: CT_P): ResolvedProperties {
    const direct = p.pPr;
    const styleId = direct?.pStyle?.val === undefined ? undefined : String(direct.pStyle.val);
    const numbering = resolveNumbering(direct?.numPr, this.numbering, this.styleTable);
    const contextHash = numbering === undefined
      ? this.cache.computeContextHash()
      : this.cache.computeContextHash({ numberingKey: `${numbering.numId}:${numbering.ilvl}` });
    const key = buildCacheKey(styleId, hashDirectProps(direct), `p:${contextHash}`);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const resolved = resolveParagraphProperties({
      docDefaults: this.docDefaults,
      styleTable: this.styleTable,
      ...(direct === undefined ? {} : { directPPr: direct }),
      ...(numbering === undefined ? {} : { numbering }),
    });
    this.cache.set(key, resolved, { hasNumbering: numbering !== undefined });
    return resolved;
  }

  /** Resolve a run; paragraph is optional but enables paragraph-style inheritance. */
  resolveRun(r: CT_R, paragraph?: CT_P | CT_PPr | string): ResolvedProperties {
    const direct = r.rPr;
    const paragraphStyleId = typeof paragraph === 'string'
      ? paragraph
      : paragraph === undefined
        ? undefined
        : 'pPr' in paragraph
          ? paragraph.pPr?.pStyle?.val
          : 'pStyle' in paragraph
            ? paragraph.pStyle?.val
            : undefined;
    const styleId = direct?.rPrBase.find((item) => item.kind === 'rStyle')?.value.val;
    const key = buildCacheKey(
      paragraphStyleId === undefined ? styleId : `${paragraphStyleId}/${styleId ?? ''}`,
      hashDirectProps(direct),
      `r:${this.cache.computeContextHash()}`,
    );
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const resolved = resolveRunProperties({
      docDefaults: this.docDefaults,
      styleTable: this.styleTable,
      ...(paragraphStyleId === undefined ? {} : { paragraphStyleId: String(paragraphStyleId) }),
      ...(direct === undefined ? {} : { directRPr: direct }),
    });
    this.cache.set(key, resolved);
    return resolved;
  }

  inspect(resolved: ResolvedProperties): InspectionReport {
    return inspectProperties(resolved);
  }

  resolveThemeFont(slot: Parameters<typeof resolveThemeFont>[0], script?: string): string {
    return resolveThemeFont(slot, this.theme?.fontScheme, script, (diag) => this.diagnostics.push(diag));
  }

  resolveSchemeColor(token: string, clrMap?: ColorMap): string {
    return resolveSchemeColor(token, this.theme?.colorScheme, clrMap, (diag) => this.diagnostics.push(diag));
  }

  invalidateStyles(): void { this.cache.invalidateStyles(); }
  invalidateTheme(): void { this.cache.invalidateTheme(); }
  invalidateNumbering(): void { this.cache.invalidateNumbering(); }
  invalidateDocDefaults(): void { this.cache.invalidateDocDefaults(); }
  invalidateTable(tableId: string): void { this.cache.invalidateTable(tableId); }
}

export type { ColorMap, ColorScheme, FontScheme, InspectionReport, NumberingTable, ResolvedProperties, StyleTable, Theme };
