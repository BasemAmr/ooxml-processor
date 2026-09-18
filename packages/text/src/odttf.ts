/**
 * Embedded Font De-obfuscation (ODTTF / Obfuscated OpenType Font) (P4-04).
 *
 * Implements Ticket P4-04.
 *
 * OOXML Embedding Obfuscation Algorithm (ECMA-376 Part 2 / Part 4 §2.8.1):
 *
 * 1. The font file part (typically with `.odttf` extension in the OPC package) is
 *    obfuscated by XORing its first 32 bytes against a 16-byte key derived from
 *    `w:fontKey` (an RFC 4122 GUID).
 * 2. Binary Endianness Derivation:
 *    The GUID string format is `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`.
 *    Per the Windows GUID memory layout (`struct _GUID`):
 *      - Field 1 (Data1, 8 hex digits, 4 bytes): stored in LITTLE-ENDIAN order.
 *      - Field 2 (Data2, 4 hex digits, 2 bytes): stored in LITTLE-ENDIAN order.
 *      - Field 3 (Data3, 4 hex digits, 2 bytes): stored in LITTLE-ENDIAN order.
 *      - Field 4 (Data4[0..1], 4 hex digits, 2 bytes): stored in BIG-ENDIAN (sequential) order.
 *      - Field 5 (Data4[2..7], 12 hex digits, 6 bytes): stored in BIG-ENDIAN (sequential) order.
 *
 *    Parsing by stripping hyphens and reading left-to-right is WRONG and produces corrupted font data.
 *    The first 8 bytes must reverse byte order within their respective integer fields.
 *
 * 3. 32-Byte XOR Application:
 *    The 16-byte key is applied twice over the first 32 bytes of the font data:
 *      `deobfuscated[i] = obfuscated[i] ^ key[i % 16]` for i = 0..31.
 *    All bytes starting at offset 32 remain completely untouched.
 *
 * 4. Verification:
 *    A correctly de-obfuscated font MUST begin with a valid sfnt version tag:
 *      - `0x00010000` for TrueType outlines
 *      - `0x4F54544F` ('OTTO') for OpenType / CFF outlines
 *      - `0x74727565` ('true') for Apple TrueType
 *      - `0x74797031` ('typ1') for Apple Type 1
 *    If the de-obfuscated tag does not match, an error is thrown detecting the key mismatch.
 */

/**
 * Valid OpenType / TrueType sfnt version tags in big-endian 32-bit integer representation.
 */
export const SFNT_TAG_TRUETYPE = 0x00010000;
export const SFNT_TAG_OTTO = 0x4f54544f; // 'OTTO'
export const SFNT_TAG_TRUE = 0x74727565; // 'true'
export const SFNT_TAG_TYP1 = 0x74797031; // 'typ1'

export const VALID_SFNT_TAGS: ReadonlySet<number> = new Set([
  SFNT_TAG_TRUETYPE,
  SFNT_TAG_OTTO,
  SFNT_TAG_TRUE,
  SFNT_TAG_TYP1,
]);

/**
 * Checks whether a 32-bit unsigned integer is a valid sfnt version tag.
 */
export function isValidSfntTag(tag: number): boolean {
  return VALID_SFNT_TAGS.has(tag);
}

/**
 * Parses a GUID string into its 16-byte binary key representation adhering to
 * Windows GUID memory layout endianness.
 *
 * @param guid GUID string, with or without surrounding curly braces (e.g. "{12345678-ABCD-EF01-2345-6789ABCDEF01}")
 * @returns 16-byte Uint8Array key.
 */
export function parseFontKeyGuid(guid: string): Uint8Array {
  const clean = guid.trim().replace(/^\{|\}$/g, '');
  const parts = clean.split('-');

  if (parts.length !== 5) {
    throw new Error(
      `Invalid GUID format for fontKey: "${guid}". Expected 5 hyphen-separated groups.`,
    );
  }

  const [f1, f2, f3, f4, f5] = parts as [string, string, string, string, string];

  if (
    f1.length !== 8 ||
    f2.length !== 4 ||
    f3.length !== 4 ||
    f4.length !== 4 ||
    f5.length !== 12 ||
    !/^[0-9a-fA-F]+$/.test(clean.replace(/-/g, ''))
  ) {
    throw new Error(`Invalid GUID group lengths or non-hex characters in fontKey: "${guid}".`);
  }

  const key = new Uint8Array(16);

  // Field 1: Data1 (4 bytes) - LITTLE-ENDIAN
  // Hex string "12345678" -> bytes [0x78, 0x56, 0x34, 0x12]
  key[0] = parseInt(f1.slice(6, 8), 16);
  key[1] = parseInt(f1.slice(4, 6), 16);
  key[2] = parseInt(f1.slice(2, 4), 16);
  key[3] = parseInt(f1.slice(0, 2), 16);

  // Field 2: Data2 (2 bytes) - LITTLE-ENDIAN
  // Hex string "ABCD" -> bytes [0xCD, 0xAB]
  key[4] = parseInt(f2.slice(2, 4), 16);
  key[5] = parseInt(f2.slice(0, 2), 16);

  // Field 3: Data3 (2 bytes) - LITTLE-ENDIAN
  // Hex string "EF01" -> bytes [0x01, 0xEF]
  key[6] = parseInt(f3.slice(2, 4), 16);
  key[7] = parseInt(f3.slice(0, 2), 16);

  // Field 4: Data4[0..1] (2 bytes) - BIG-ENDIAN (in sequential appearance order)
  key[8] = parseInt(f4.slice(0, 2), 16);
  key[9] = parseInt(f4.slice(2, 4), 16);

  // Field 5: Data4[2..7] (6 bytes) - BIG-ENDIAN (in sequential appearance order)
  for (let i = 0; i < 6; i++) {
    key[10 + i] = parseInt(f5.slice(i * 2, i * 2 + 2), 16);
  }

  return key;
}

/**
 * Reads the 32-bit big-endian sfnt version tag from the first 4 bytes of font data.
 */
export function readSfntVersion(data: Uint8Array): number {
  if (data.length < 4) return 0;
  return (
    (((data[0] ?? 0) << 24) | ((data[1] ?? 0) << 16) | ((data[2] ?? 0) << 8) | (data[3] ?? 0)) >>> 0
  );
}

/**
 * De-obfuscates an embedded OOXML font (.odttf) using the provided GUID font key.
 *
 * @param fontData Raw binary data of the obfuscated font.
 * @param fontKey GUID string from `w:fontKey` attribute.
 * @returns A new Uint8Array containing the de-obfuscated TrueType/OpenType font data.
 * @throws Error if the font data is too short, the GUID format is invalid, or the resulting sfnt tag is invalid.
 */
export function deobfuscateFont(fontData: Uint8Array, fontKey: string): Uint8Array {
  if (fontData.length < 32) {
    throw new Error(
      `Font data is too short to be an obfuscated sfnt font (${fontData.length} bytes, minimum 32 bytes required).`,
    );
  }

  const key = parseFontKeyGuid(fontKey);
  const result = new Uint8Array(fontData);

  // XOR de-obfuscation: 16-byte key applied twice over first 32 bytes
  for (let i = 0; i < 32; i++) {
    const orig = fontData[i] ?? 0;
    const k = key[i % 16] ?? 0;
    result[i] = orig ^ k;
  }

  // Validate sfnt header tag
  const sfntTag = readSfntVersion(result);
  if (!isValidSfntTag(sfntTag)) {
    const hexTag = sfntTag.toString(16).padStart(8, '0').toUpperCase();
    throw new Error(
      `Invalid sfnt version tag 0x${hexTag} after de-obfuscation with key "${fontKey}". ` +
        `Expected 0x00010000 (TrueType) or 0x4F54544F ('OTTO'). The fontKey may be invalid or corrupt.`,
    );
  }

  return result;
}

/**
 * Obfuscates a TrueType/OpenType font using a GUID key, producing an OOXML .odttf payload.
 * Useful for synthesizing test fixtures and embedding fonts.
 *
 * @param fontData Raw binary data of the valid sfnt font.
 * @param fontKey GUID string to obfuscate with.
 * @returns A new Uint8Array with the first 32 bytes obfuscated.
 */
export function obfuscateFont(fontData: Uint8Array, fontKey: string): Uint8Array {
  if (fontData.length < 32) {
    throw new Error(
      `Font data is too short to obfuscate (${fontData.length} bytes, minimum 32 bytes required).`,
    );
  }

  const key = parseFontKeyGuid(fontKey);
  const result = new Uint8Array(fontData);

  // XOR is symmetric: applying the key to the original font produces the obfuscated stream
  for (let i = 0; i < 32; i++) {
    const orig = fontData[i] ?? 0;
    const k = key[i % 16] ?? 0;
    result[i] = orig ^ k;
  }

  return result;
}
