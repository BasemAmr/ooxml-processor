import type { CT_SectPr } from '@ooxml/schema';

export type PageOrientation = 'portrait' | 'landscape';

export interface PageMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly header: number;
  readonly footer: number;
  readonly gutter: number;
}

export interface PageGeometry {
  readonly size: { readonly w: number; readonly h: number; readonly orient: PageOrientation };
  readonly margins: PageMargins;
  readonly mirror: boolean;
  readonly gutterAtTop: boolean;
}

export interface TextArea {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface GeometryOptions {
  readonly mirrorMargins?: boolean;
  readonly gutterAtTop?: boolean;
}

const DEFAULT_SIZE = { w: 12240, h: 15840, orient: 'portrait' as const };
const DEFAULT_MARGINS: PageMargins = {
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
  header: 720,
  footer: 720,
  gutter: 0,
};

/** Resolves actual page dimensions and margins; absent schema values use Word defaults. */
export function pageGeometry(
  sectPr: CT_SectPr | undefined,
  options: GeometryOptions = {},
): PageGeometry {
  const pgSz = sectPr?.pgSz;
  const pgMar = sectPr?.pgMar;
  const w = Number(pgSz?.w ?? DEFAULT_SIZE.w);
  const h = Number(pgSz?.h ?? DEFAULT_SIZE.h);
  // Word uses the actual dimensions as authoritative; @orient is metadata and
  // can disagree in files produced by other writers.
  const orient: PageOrientation = w > h ? 'landscape' : 'portrait';
  return {
    size: { w, h, orient },
    margins: {
      top: Number(pgMar?.top ?? DEFAULT_MARGINS.top),
      right: Number(pgMar?.right ?? DEFAULT_MARGINS.right),
      bottom: Number(pgMar?.bottom ?? DEFAULT_MARGINS.bottom),
      left: Number(pgMar?.left ?? DEFAULT_MARGINS.left),
      header: Number(pgMar?.header ?? DEFAULT_MARGINS.header),
      footer: Number(pgMar?.footer ?? DEFAULT_MARGINS.footer),
      gutter: Number(pgMar?.gutter ?? DEFAULT_MARGINS.gutter),
    },
    mirror: options.mirrorMargins ?? false,
    gutterAtTop: options.gutterAtTop ?? false,
  };
}

export function textArea(
  geometry: PageGeometry,
  pageNumber = 1,
  headerHeight = 0,
  footerHeight = 0,
): TextArea {
  const { margins, size } = geometry;
  const bindingGutter = margins.gutter;
  const mirrored = geometry.mirror && pageNumber % 2 === 0;
  const leftGutter = geometry.gutterAtTop ? 0 : mirrored ? 0 : bindingGutter;
  const rightGutter = geometry.gutterAtTop ? 0 : mirrored ? bindingGutter : 0;
  const topGutter = geometry.gutterAtTop ? bindingGutter : 0;
  const left = margins.left + leftGutter;
  const right = margins.right + rightGutter;
  const top = Math.max(margins.top, margins.header + headerHeight) + topGutter;
  const bottom = Math.max(margins.bottom, margins.footer + footerHeight);
  return {
    x: left,
    y: top,
    w: Math.max(0, size.w - left - right),
    h: Math.max(0, size.h - top - bottom),
  };
}
