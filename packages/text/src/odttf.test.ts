import { describe, it, expect } from 'vitest';
import {
  parseFontKeyGuid,
  deobfuscateFont,
  obfuscateFont,
  readSfntVersion,
  SFNT_TAG_TRUETYPE,
  SFNT_TAG_OTTO,
} from './odttf.js';

describe('P4-04: Embedded Font De-obfuscation (ODTTF)', () => {
  describe('GUID Endianness Parsing', () => {
    it('parses GUID into 16 bytes with first 3 fields little-endian and last 2 big-endian', () => {
      // Test GUID: {12345678-ABCD-EF01-2345-6789ABCDEF01}
      // Field 1: 12345678 -> [0x78, 0x56, 0x34, 0x12] (little-endian)
      // Field 2: ABCD     -> [0xCD, 0xAB]             (little-endian)
      // Field 3: EF01     -> [0x01, 0xEF]             (little-endian)
      // Field 4: 2345     -> [0x23, 0x45]             (big-endian)
      // Field 5: 6789ABCDEF01 -> [0x67, 0x89, 0xAB, 0xCD, 0xEF, 0x01] (big-endian)
      const guid = '{12345678-ABCD-EF01-2345-6789ABCDEF01}';
      const key = parseFontKeyGuid(guid);

      expect(Array.from(key)).toEqual([
        0x78,
        0x56,
        0x34,
        0x12, // Field 1 (LE)
        0xcd,
        0xab, // Field 2 (LE)
        0x01,
        0xef, // Field 3 (LE)
        0x23,
        0x45, // Field 4 (BE)
        0x67,
        0x89,
        0xab,
        0xcd,
        0xef,
        0x01, // Field 5 (BE)
      ]);
    });

    it('handles GUID without curly braces and case insensitivity', () => {
      const guid = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';
      const key = parseFontKeyGuid(guid);

      expect(key[0]).toBe(0xd4);
      expect(key[1]).toBe(0xc3);
      expect(key[2]).toBe(0xb2);
      expect(key[3]).toBe(0xa1);
      expect(key[4]).toBe(0xf6);
      expect(key[5]).toBe(0xe5);
      expect(key[6]).toBe(0x90);
      expect(key[7]).toBe(0x78);
      expect(key[8]).toBe(0x12);
      expect(key[9]).toBe(0x34);
      expect(key[10]).toBe(0x56);
      expect(key[11]).toBe(0x78);
      expect(key[12]).toBe(0x9a);
      expect(key[13]).toBe(0xbc);
      expect(key[14]).toBe(0xde);
      expect(key[15]).toBe(0xf0);
    });

    it('rejects invalid GUID strings', () => {
      expect(() => parseFontKeyGuid('invalid-guid')).toThrow(/Invalid GUID format/);
      expect(() => parseFontKeyGuid('{12345678-1234-1234-1234-12345678901Z}')).toThrow(
        /non-hex characters/,
      );
      expect(() => parseFontKeyGuid('{123-12-12-12-123}')).toThrow(/Invalid GUID group lengths/);
    });
  });

  describe('De-obfuscation round-trip', () => {
    function createMockSfntFont(tag: number, length = 64): Uint8Array {
      const data = new Uint8Array(length);
      // sfnt version tag (big-endian 4 bytes)
      data[0] = (tag >>> 24) & 0xff;
      data[1] = (tag >>> 16) & 0xff;
      data[2] = (tag >>> 8) & 0xff;
      data[3] = tag & 0xff;

      // Fill remaining bytes with pattern
      for (let i = 4; i < length; i++) {
        data[i] = (i * 7 + 13) & 0xff;
      }
      return data;
    }

    const testGuid = '{A4B3C2D1-E6F5-7890-B2A1-FEDCBA098765}';

    it('obfuscates and de-obfuscates TrueType font (0x00010000)', () => {
      const original = createMockSfntFont(SFNT_TAG_TRUETYPE, 128);
      const obfuscated = obfuscateFont(original, testGuid);

      // Verify that bytes were modified in first 32 bytes
      expect(readSfntVersion(obfuscated)).not.toBe(SFNT_TAG_TRUETYPE);

      // Verify that bytes >= 32 were NOT modified
      expect(obfuscated.slice(32)).toEqual(original.slice(32));

      // De-obfuscate
      const deobfuscated = deobfuscateFont(obfuscated, testGuid);

      // Verify sfnt tag matches
      expect(readSfntVersion(deobfuscated)).toBe(SFNT_TAG_TRUETYPE);
      // Verify complete payload matches original
      expect(deobfuscated).toEqual(original);
    });

    it('obfuscates and de-obfuscates OpenType/CFF font (0x4F54544F / "OTTO")', () => {
      const original = createMockSfntFont(SFNT_TAG_OTTO, 96);
      const obfuscated = obfuscateFont(original, testGuid);

      expect(readSfntVersion(obfuscated)).not.toBe(SFNT_TAG_OTTO);
      expect(obfuscated.slice(32)).toEqual(original.slice(32));

      const deobfuscated = deobfuscateFont(obfuscated, testGuid);
      expect(readSfntVersion(deobfuscated)).toBe(SFNT_TAG_OTTO);
      expect(deobfuscated).toEqual(original);
    });

    it('detects and rejects incorrect key', () => {
      const original = createMockSfntFont(SFNT_TAG_TRUETYPE, 64);
      const correctGuid = '{11111111-2222-3333-4444-555555555555}';
      const wrongGuid = '{99999999-8888-7777-6666-555555555555}';

      const obfuscated = obfuscateFont(original, correctGuid);

      // De-obfuscating with wrong key should produce corrupted sfnt tag and throw
      expect(() => deobfuscateFont(obfuscated, wrongGuid)).toThrow(
        /Invalid sfnt version tag.*fontKey may be invalid/i,
      );
    });

    it('rejects font data shorter than 32 bytes', () => {
      const shortData = new Uint8Array(20);
      expect(() => deobfuscateFont(shortData, testGuid)).toThrow(/too short/);
      expect(() => obfuscateFont(shortData, testGuid)).toThrow(/too short/);
    });
  });
});
