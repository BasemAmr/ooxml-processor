import type { CT_HdrFtrRef, CT_SectPr } from '@ooxml/schema';

export type HeaderFooterKind = 'header' | 'footer';
export type HeaderFooterType = 'default' | 'first' | 'even';

export interface HeaderFooterSelection {
  readonly kind: HeaderFooterKind;
  readonly type: HeaderFooterType;
  readonly reference: CT_HdrFtrRef;
}

export interface HeaderFooterOptions {
  readonly titlePage?: boolean;
  readonly evenAndOddHeaders?: boolean;
  readonly firstPageOfSection?: boolean;
  readonly previous?: HeaderFooterSelection | undefined;
}

function references(section: CT_SectPr, kind: HeaderFooterKind): readonly CT_HdrFtrRef[] {
  return section.hdrFtrReferences.flatMap((entry) =>
    entry.kind === `${kind}Reference` && entry.value !== undefined && 'type' in entry.value
      ? [entry.value as CT_HdrFtrRef]
      : [],
  );
}

/** Selects first/even/default references, inheriting the previous section when absent. */
export function resolveHeaderFooter(
  section: CT_SectPr,
  kind: HeaderFooterKind,
  options: HeaderFooterOptions = {},
): HeaderFooterSelection | undefined {
  const refs = references(section, kind);
  const byType = (type: HeaderFooterType) => refs.find((ref) => (ref.type ?? 'default') === type);
  const candidates: HeaderFooterType[] = [];
  if (options.titlePage && options.firstPageOfSection) candidates.push('first');
  if (options.evenAndOddHeaders) candidates.push('even');
  candidates.push('default');
  for (const type of candidates) {
    const reference = byType(type);
    if (reference) return { kind, type, reference };
  }
  return options.previous;
}
