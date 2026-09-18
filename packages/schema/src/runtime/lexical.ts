/**
 * Lexical codecs for XSD simple types — the string ⇄ value boundary.
 *
 * Both directions live here on purpose. A parser and a formatter that disagree
 * are how a round-trip acquires a drift that only shows up on the third save,
 * and keeping the pair adjacent is the cheapest way to notice.
 *
 * ## What is *not* preserved, and why that is the right call
 *
 * Numeric values are normalized to their canonical lexical form. `"007"`,
 * `"+7"` and `"7"` all read as `7` and write back as `"7"`. Preserving the
 * original spelling would mean carrying a string alongside every number in the
 * document model, which is a permanent cost on the hottest data in the system to
 * defend against a spelling Word does not produce.
 *
 * The guarantee this leaves intact is the one that matters and the one
 * `packages/conformance` actually asserts: **idempotence after one pass**. The
 * first save may canonicalize; every save after that is byte-identical, because
 * `format(parse(x))` is a fixed point. See ADR 0009.
 */

/**
 * XSD `whiteSpace="collapse"`, which applies to every atomic type except
 * `xsd:string` and `xsd:normalizedString`. Tabs and newlines inside an attribute
 * value are already turned into spaces by XML attribute-value normalization;
 * this handles the leading/trailing/internal runs that survive.
 */
export function collapse(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, ' ');
}

const INTEGER = /^[+-]?[0-9]+$/;
const DECIMAL = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;
const DOUBLE = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/**
 * `xsd:integer` and its derivations (`int`, `long`, `unsignedInt`, `byte`, …).
 *
 * Range and sign facets are the validator's job, not this function's: a reader
 * that rejected an out-of-range value would drop it from the round trip, and an
 * out-of-range value is a document defect worth *reporting*, not erasing.
 */
export function parseInteger(value: string): number | undefined {
  const s = collapse(value);
  if (!INTEGER.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** `xsd:decimal`. No exponent — that is `xsd:double`. */
export function parseDecimal(value: string): number | undefined {
  const s = collapse(value);
  if (!DECIMAL.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** `xsd:double` / `xsd:float`, including the three special values. */
export function parseDouble(value: string): number | undefined {
  const s = collapse(value);
  if (s === 'INF') return Number.POSITIVE_INFINITY;
  if (s === '-INF') return Number.NEGATIVE_INFINITY;
  if (s === 'NaN') return Number.NaN;
  return DOUBLE.test(s) ? Number(s) : undefined;
}

/**
 * `xsd:boolean` — `true|false|1|0`, and nothing else.
 *
 * Distinct from `ST_OnOff`, which additionally accepts `on|off` and carries the
 * absent-means-true rule. See `onoff.ts`; confusing the two inverts documents.
 */
export function parseXsdBoolean(value: string): boolean | undefined {
  const s = collapse(value);
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

/**
 * `xsd:list` — whitespace-separated items.
 *
 * Returns `undefined` if *any* item fails to parse, rather than a partial list:
 * a half-read `w:panose1` is worse than an unread one, because the unread one is
 * preserved verbatim in `$unknownAttrs` and the half-read one is not.
 */
export function parseList<T>(
  value: string,
  parseItem: (item: string) => T | undefined,
): readonly T[] | undefined {
  const s = collapse(value);
  if (s === '') return [];
  const out: T[] = [];
  for (const part of s.split(' ')) {
    const item = parseItem(part);
    if (item === undefined) return undefined;
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Canonical lexical form for a number.
 *
 * `Number.prototype.toString` is already canonical for every value OOXML uses,
 * with two exceptions worth handling explicitly: the infinities and NaN, whose
 * XSD spellings are not JavaScript's, and exponent notation, which JavaScript
 * reaches for at 1e21 and which `xsd:decimal`-derived types do not permit.
 */
export function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'INF';
  if (value === Number.NEGATIVE_INFINITY) return '-INF';
  if (Number.isInteger(value) && Math.abs(value) >= 1e21) return BigInt(value).toString();
  return String(value);
}

export function formatXsdBoolean(value: boolean): string {
  return value ? 'true' : 'false';
}

export function formatList<T>(items: readonly T[], formatItem: (item: T) => string): string {
  return items.map(formatItem).join(' ');
}
