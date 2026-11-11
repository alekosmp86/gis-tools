import { describe, expect, it } from "vitest";
import { decodeCsvBytes, detectCsvEncoding, isValidUtf8 } from "@/core/common/csvTextDecoding";

const bytesOf = (...values: number[]) => new Uint8Array(values);

describe("csvTextDecoding", () => {
  describe("isValidUtf8", () => {
    it("should accept well-formed multi-byte UTF-8", () => {
      expect(isValidUtf8(new TextEncoder().encode("Ñandú"))).toBe(true);
    });

    it("should reject a lone Latin-1 byte", () => {
      expect(isValidUtf8(bytesOf(0x61, 0xd1))).toBe(false);
    });

    it("should reject a truncated multi-byte sequence", () => {
      expect(isValidUtf8(bytesOf(0x61, 0xc3))).toBe(false);
    });
  });

  describe("detectCsvEncoding", () => {
    it.each([
      ["empty input", bytesOf(), "utf-8"],
      ["pure ASCII", new TextEncoder().encode("id,nombre\n1,a"), "utf-8"],
      ["UTF-8 with accents", new TextEncoder().encode("Ñ"), "utf-8"],
      ["UTF-8 with BOM", bytesOf(0xef, 0xbb, 0xbf, 0x61), "utf-8"],
      ["Latin-1 D1", bytesOf(0x61, 0xd1, 0x62), "windows-1252"],
      ["Latin-1 D3", bytesOf(0x61, 0xd3, 0x62), "windows-1252"],
      ["Latin-1 DC", bytesOf(0x61, 0xdc, 0x62), "windows-1252"],
    ])("should detect %s", (_label, bytes, expected) => {
      expect(detectCsvEncoding(bytes)).toBe(expected);
    });
  });

  describe("decodeCsvBytes", () => {
    it("should return an empty string for empty input", () => {
      expect(decodeCsvBytes(bytesOf())).toBe("");
    });

    it("should return pure ASCII unchanged", () => {
      expect(decodeCsvBytes(new TextEncoder().encode("id,nombre\n1,a"))).toBe("id,nombre\n1,a");
    });

    it("should decode UTF-8 without altering accents", () => {
      expect(decodeCsvBytes(new TextEncoder().encode("ÑÓÜ"))).toBe("ÑÓÜ");
    });

    it("should strip the UTF-8 BOM", () => {
      expect(decodeCsvBytes(bytesOf(0xef, 0xbb, 0xbf, 0x69, 0x64))).toBe("id");
    });

    it("should decode Latin-1 bytes D1, D3 and DC as Ñ, Ó and Ü without replacement characters", () => {
      const text = decodeCsvBytes(bytesOf(0xd1, 0xd3, 0xdc));

      expect(text).toBe("ÑÓÜ");
      expect(text).not.toContain("�");
    });

    it("should decode windows-1252 specific bytes such as the euro sign", () => {
      expect(decodeCsvBytes(bytesOf(0x80, 0xd1))).toBe("€Ñ");
    });
  });
});
