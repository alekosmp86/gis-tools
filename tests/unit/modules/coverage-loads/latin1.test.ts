import { describe, expect, it } from "vitest";
import { decodeLatin1, encodeLatin1 } from "@/modules/coverage-loads/indicators/domain/latin1";

describe("latin1 (AC-2, AC-17)", () => {
  describe("decodeLatin1", () => {
    it("should map every byte value to the code point with the same value", () => {
      // Arrange
      const allBytes = Uint8Array.from({ length: 256 }, (_, value) => value);

      // Act
      const text = decodeLatin1(allBytes);

      // Assert
      expect(text).toHaveLength(256);
      for (let value = 0; value < 256; value += 1) expect(text.charCodeAt(value)).toBe(value);
    });

    it("should decode accented capitals the way ISO-8859-1 defines them", () => {
      // Arrange
      const bytes = Uint8Array.from([0xd1, 0x41, 0x4e, 0x44, 0xda]);

      // Act & Assert
      expect(decodeLatin1(bytes)).toBe("ÑANDÚ");
    });

    it("should decode inputs larger than one internal chunk without losing bytes", () => {
      // Arrange
      const size = 8192 * 2 + 17;
      const bytes = new Uint8Array(size).fill(0xe9);

      // Act
      const text = decodeLatin1(bytes);

      // Assert
      expect(text).toHaveLength(size);
      expect(text).toBe("é".repeat(size));
    });

    it("should return an empty string for no bytes", () => {
      // Arrange, Act & Assert
      expect(decodeLatin1(new Uint8Array(0))).toBe("");
    });
  });

  describe("encodeLatin1", () => {
    it("should encode accented characters as single bytes", () => {
      // Arrange & Act
      const bytes = encodeLatin1("ÑANDÚ é");

      // Assert
      expect(Array.from(bytes)).toEqual([0xd1, 0x41, 0x4e, 0x44, 0xda, 0x20, 0xe9]);
    });

    it("should replace characters outside ISO-8859-1 with a question mark", () => {
      // Arrange & Act
      const bytes = encodeLatin1("a€b中c");

      // Assert
      expect(Array.from(bytes)).toEqual([0x61, 0x3f, 0x62, 0x3f, 0x63]);
    });

    it("should round-trip with decodeLatin1 for every byte value", () => {
      // Arrange
      const allBytes = Uint8Array.from({ length: 256 }, (_, value) => value);

      // Act
      const roundTrip = encodeLatin1(decodeLatin1(allBytes));

      // Assert
      expect(Array.from(roundTrip)).toEqual(Array.from(allBytes));
    });

    it("should return zero bytes for an empty string", () => {
      // Arrange, Act & Assert
      expect(encodeLatin1("")).toHaveLength(0);
    });
  });
});
