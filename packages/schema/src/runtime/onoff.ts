/**
 * `ST_OnOff` — the boolean of WordprocessingML, and the single highest-leverage
 * codec in the project.
 *
 * ## The rule that inverts documents if you get it wrong
 *
 * ```xml
 * <w:b/>                  <!-- bold ON  -->
 * <w:b w:val="0"/>        <!-- bold OFF -->
 * <w:b w:val="false"/>    <!-- bold OFF -->
 * <w:b w:val="on"/>       <!-- bold ON  -->
 * <!-- no w:b element -->  bold is UNSPECIFIED: inherit from the style cascade
 * ```
 *
 * **An absent `val` attribute on a present element means TRUE.** Word relies on
 * it: `<w:b/>` is how bold is written in practice. Treating an absent attribute
 * as "unset, therefore false" inverts `w:b`, `w:i`, `w:caps`, `w:strike`,
 * `w:vanish`, `w:noProof`, `w:snapToGrid`, and dozens more, in a way that looks
 * like a styling bug rather than a parsing bug.
 *
 * Note where that rule does *not* come from. `wml.xsd` declares
 * `<xsd:complexType name="CT_OnOff"><xsd:attribute name="val" type="s:ST_OnOff"/></xsd:complexType>`
 * with **no** `default`. The true-when-absent rule is normative prose
 * (ECMA-376 Part 1, the `CT_OnOff/@val` description), not schema, so a generator
 * that reads only the XSDs cannot see it — which is exactly why this codec is
 * hand-written.
 *
 * And it is not a property of `ST_OnOff` the type. DrawingML's `CT_Boolean`
 * uses the same `s:ST_OnOff` with `default="0"`, so an absent `val` there means
 * **false**. `parseOnOff` encodes the WML `CT_OnOff` rule because that is the
 * overwhelming majority of uses; {@link parseOnOffOr} exists for the rest. Never
 * assume the default without knowing which complex type you are reading.
 *
 * ## Three states, not two
 *
 * This is why there are two parse functions rather than one. There are three
 * distinguishable source states and only the caller knows which it is in:
 *
 * | Source                | Meaning                        | What to call                         |
 * |-----------------------|--------------------------------|--------------------------------------|
 * | no `<w:b>` element    | unspecified → inherit          | nothing; leave the property `undefined` |
 * | `<w:b/>`              | **true**                       | `parseOnOff(undefined)` → `true`     |
 * | `<w:b w:val="0"/>`    | false                          | `parseOnOff("0")` → `false`          |
 *
 * `parseOnOff` answers "what is the value of this element?" and is only ever
 * called when the element is present. `parseOnOffAttr` answers the different
 * question "what did the attribute literally say?", returning `undefined` for an
 * absent attribute *without* applying the default — which is what a writer needs
 * in order to leave `<w:b/>` as `<w:b/>` instead of rewriting it to
 * `<w:b w:val="true"/>` and producing a diff on every save. See the
 * attribute-defaults section of `docs/xsd-feature-survey.md`: 1,236 attributes
 * carry a schema default and presence is recorded, never collapsed into value.
 *
 * ## Lexical space, and a real dialect difference
 *
 * Transitional (`shared-commonSimpleTypes.xsd`):
 * ```xml
 * <xsd:simpleType name="ST_OnOff"><xsd:union memberTypes="xsd:boolean ST_OnOff1"/></xsd:simpleType>
 * <xsd:simpleType name="ST_OnOff1">… enumeration "on" | "off" …</xsd:simpleType>
 * ```
 * Strict is `<xsd:union memberTypes="xsd:boolean"/>` — **`on`/`off` are
 * Transitional-only**. We accept all six forms on read regardless of dialect
 * (refusing `on` in a Strict package would reject files that exist), but
 * {@link formatOnOff} never *writes* `on`/`off`, so a value authored by us is
 * valid in both dialects. {@link formatOnOffPreserving} can echo back an `on`
 * that was already there, which keeps a Transitional file byte-stable and cannot
 * introduce `on` into a Strict file that did not already have it.
 *
 * Because the type derives from `xsd:boolean`, XSD whitespace processing applies
 * (`collapse`, inherited from the built-in), so `" true "` is a valid `true`.
 * Casing is not flexible: `xsd:boolean` is `true|false|1|0` exactly, and `"True"`
 * is invalid. Word does not write it; we reject it rather than guess.
 */

/**
 * Raised for a value outside the `ST_OnOff` lexical space.
 *
 * Deliberately not silently coerced. `w:val="yes"` is not something Word writes;
 * seeing it means either the file is from a tool with its own idea of the format
 * or we are parsing the wrong attribute, and both are worth surfacing.
 */
export class OnOffValueError extends Error {
  constructor(readonly value: string) {
    super(
      `${JSON.stringify(value)} is not a valid ST_OnOff value ` +
        '(expected one of: 1, 0, true, false, on, off)',
    );
    this.name = 'OnOffValueError';
  }
}

/** Every lexical form, in the order the schema lists them. */
export const ON_OFF_LEXICAL_FORMS = ['1', '0', 'true', 'false', 'on', 'off'] as const;

/** The Transitional-only forms. Never written by {@link formatOnOff}. */
export const ON_OFF_TRANSITIONAL_ONLY_FORMS = ['on', 'off'] as const;

/**
 * XSD `collapse` whitespace processing: trim, and fold internal whitespace runs
 * to a single space. Inherited by `ST_OnOff` from `xsd:boolean`.
 */
function collapse(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, ' ');
}

/** True if `value` is in the `ST_OnOff` lexical space. */
export function isOnOffLexical(value: string): boolean {
  const v = collapse(value);
  return v === '1' || v === '0' || v === 'true' || v === 'false' || v === 'on' || v === 'off';
}

/**
 * The value of a **present** `CT_OnOff` element.
 *
 * `undefined` means the `val` attribute was absent, which per the schema default
 * is **true**. Do not call this when the element itself is absent — that is not
 * `false`, it is "unspecified", and the property should be left `undefined` so
 * the style cascade can supply a value.
 *
 * @throws {OnOffValueError} if the value is present but not a legal lexical form.
 */
export function parseOnOff(value: string | undefined): boolean {
  if (value === undefined) return true;
  const v = collapse(value);
  switch (v) {
    case '1':
    case 'true':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'off':
      return false;
    default:
      throw new OnOffValueError(value);
  }
}

/**
 * As {@link parseOnOff}, but with the when-absent default named by the caller.
 *
 * For the handful of types whose schema `default` is not `true` — DrawingML's
 * `CT_Boolean` carries `default="0"` — the reader must say so explicitly rather
 * than inherit WML's rule. Making the default a required argument is the point:
 * it cannot be got wrong by omission.
 *
 * @throws {OnOffValueError} if the value is present but not a legal lexical form.
 */
export function parseOnOffOr(value: string | undefined, whenAbsent: boolean): boolean {
  return value === undefined ? whenAbsent : parseOnOff(value);
}

/**
 * What the attribute literally said, with the default **not** applied.
 *
 * - `undefined` in  → `undefined` out: the attribute was absent. The element is
 *   still present and still means **true**; this function reports the source
 *   text, not the value. Call {@link parseOnOff} for the value.
 * - present         → the parsed boolean.
 *
 * This exists so a reader can record *presence* alongside value, which is what
 * lets a writer reproduce `<w:b/>` rather than `<w:b w:val="true"/>`. A reader
 * that only keeps the boolean has already lost the information needed for a
 * clean round-trip.
 *
 * @throws {OnOffValueError} if the value is present but not a legal lexical form.
 */
export function parseOnOffAttr(value: string | undefined): boolean | undefined {
  return value === undefined ? undefined : parseOnOff(value);
}

/**
 * The value we write when authoring one ourselves.
 *
 * `"true"`/`"false"` rather than `"1"`/`"0"`: both are legal in both dialects,
 * and Word writes the words for `w:val` on `CT_OnOff`. Round-trips by
 * construction — `parseOnOff(formatOnOff(x)) === x`.
 */
export function formatOnOff(value: boolean): string {
  return value ? 'true' : 'false';
}

/**
 * The value to write back for an attribute that was read from a source.
 *
 * Preserves the source's spelling when the value has not changed, including the
 * case that matters most: an attribute that was **absent** stays absent, because
 * absent already means `true`. Rewriting `<w:b/>` as `<w:b w:val="true"/>` is
 * semantically identical and textually different, which is a diff on every save
 * of every document — exactly the failure mode `docs/xsd-feature-survey.md`
 * flags for the 1,236 defaulted attributes.
 *
 * Assumes the WML `CT_OnOff` rule that absent means true. For a type whose
 * default is false (DrawingML `CT_Boolean`), omission expresses `false`, not
 * `true`; use {@link formatOnOff} and decide about omission at the call site.
 *
 * @param value    the current value in the model
 * @param original the attribute text as read, or `undefined` if it was absent
 * @returns the attribute text to write, or `undefined` meaning **omit the
 *          attribute**
 *
 * ```ts
 * formatOnOffPreserving(true,  undefined) // undefined  -> <w:b/>            unchanged
 * formatOnOffPreserving(true,  'on')      // 'on'       -> <w:b w:val="on"/> unchanged
 * formatOnOffPreserving(true,  '0')       // 'true'     -> value changed, author it
 * formatOnOffPreserving(false, undefined) // 'false'    -> cannot be expressed by omission
 * ```
 */
export function formatOnOffPreserving(
  value: boolean,
  original: string | undefined,
): string | undefined {
  if (original === undefined) {
    // Absent means true. If that is still the value, keep it absent.
    return value ? undefined : formatOnOff(value);
  }
  // An unparseable original tells us nothing worth preserving.
  if (!isOnOffLexical(original)) return formatOnOff(value);
  return parseOnOff(original) === value ? original : formatOnOff(value);
}
