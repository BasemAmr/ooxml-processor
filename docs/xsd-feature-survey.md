# What the XSDs actually use

Measured across all 51 vendored schemas before designing the generator, so the IR covers
reality rather than the whole XML Schema specification. Reproduce with
`pnpm --filter @ooxml/codegen run survey`.

## Retired complexity

These XSD features are **not used at all** on any path. The generator does not implement them,
and `survey` fails the build if one appears.

| Feature                            | Count | Consequence                                                                                                                                  |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `xsd:include`                      | 0     | Only `xsd:import`. No chameleon-namespace inclusion.                                                                                         |
| `xsd:redefine`                     | 0     | No override semantics.                                                                                                                       |
| `substitutionGroup`                | 0     | Element identity is structural. No polymorphic dispatch layer.                                                                               |
| `abstract` types                   | 0     | The 3 grep hits are the substring in `abstractNumId`.                                                                                        |
| `nillable`                         | 0     | No `xsi:nil` handling.                                                                                                                       |
| `block`                            | 0     | —                                                                                                                                            |
| **complexContent `restriction`**   | **0** | See below.                                                                                                                                   |
| **simpleContent `restriction`**    | **0** | See below.                                                                                                                                   |
| `mixed="true"` on the `.docx` path | 0     | The single occurrence is `CT_Schema` in `sml.xsd` (SpreadsheetML, out of scope). Text content in WML is always `simpleContent`, never mixed. |

### The restriction finding

The approved plan cautioned that complex-type **restriction** is "rarer but present, and
silently mishandling it produces wrong writers." Measurement retires that concern: all 548
`xsd:restriction` occurrences in Transitional are **simple-type facet restrictions**. Every
one of the 47 complex-content derivations is an `xsd:extension`.

This removes a genuine class of generator complexity — restriction requires re-deriving a
particle list by subtraction, which is where hand-rolled XSD processors usually break. The
`survey` check exists so that if a future schema revision introduces one, we find out at
build time rather than through a corrupted document.

## Special cases the generator must handle explicitly

| Feature                     | Count (T / S) | Notes                                                 |
| --------------------------- | ------------- | ----------------------------------------------------- |
| `xsd:any`                   | 16 / 7        | Only 8 sites on the `.docx` path — enumerated below.  |
| `xsd:all`                   | 4 / 2         | Order-insensitive; emit as an unordered particle set. |
| `xsd:union` / `memberTypes` | 42 / 42       | Needs a discriminating parse function per union.      |
| `xsd:list` / `itemType`     | 7 / 7         | Whitespace-separated; `ST_Panose` and friends.        |
| attribute `default=`        | 1236 / 1217   | **Round-trip hazard** — see below.                    |
| `form="qualified"`          | 6 / 0         | VML only. VML attributes are otherwise unqualified.   |
| `ref=`                      | 622 / 407     | Element, attribute and group references.              |

### Attribute defaults are a round-trip hazard

1,236 attributes carry a schema `default`. An absent attribute and an attribute explicitly
written with its default value are **semantically identical but textually different**. Writing
back the default where the source omitted it produces a diff on every save.

The reader therefore records _presence_, not just value: `undefined` means absent, and the
default is applied at the property-resolution layer (`packages/wml`), never at parse time.
This is why `exactOptionalPropertyTypes` is on in `tsconfig.base.json`.

`ST_OnOff` is the sharp edge of the same rule — an absent `w:val` means **true**, so treating
absent as "unset, fall back to false" silently inverts dozens of properties.

### Every `xsd:any` site on the `.docx` path

| Type                     | Schema                      | Namespace constraint | `processContents`  |
| ------------------------ | --------------------------- | -------------------- | ------------------ |
| `CT_OfficeArtExtension`  | `dml-main.xsd:183`          | (any)                | `lax`              |
| `CT_GraphicalObjectData` | `dml-main.xsd:864`          | (any)                | **`strict`**       |
| `CT_Background`          | `wml.xsd:1149`              | vml + office         | `lax`              |
| `CT_Object`              | `wml.xsd:1167`              | vml + office         | `lax`              |
| `CT_Picture`             | `wml.xsd:1186`              | vml + office         | `lax`              |
| `CT_ShapeDefaults`       | `wml.xsd:3416`              | office               | `lax`              |
| `CT_Textbox`             | `vml-main.xsd:374`          | `##local`            | `skip`             |
| `CT_EquationXml`         | `vml-officeDrawing.xsd:173` | `##any`              | (default `strict`) |

`CT_GraphicalObjectData` is the DrawingML extensibility point — charts, diagrams and pictures
all plug in here. Its `processContents="strict"` is aspirational: we treat every wildcard
uniformly, capturing content as `RawNode[]` and replaying it verbatim on write, because
refusing unrecognized content would reject real documents.

## Scale

|                              | Transitional | Strict |
| ---------------------------- | ------------ | ------ |
| Named definitions            | 5,536        | 5,159  |
| `xsd:element` declarations   | 3,588        | 3,307  |
| `xsd:attribute` declarations | 3,374        | 2,906  |
| `xsd:complexType`            | 1,431        | 1,369  |
| `xsd:simpleType`             | 597          | 525    |
| `xsd:enumeration` values     | 3,263        | 3,010  |
| `xsd:group`                  | 269          | 256    |
| `xsd:attributeGroup`         | 133          | 46     |
