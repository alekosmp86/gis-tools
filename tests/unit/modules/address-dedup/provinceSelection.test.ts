import { describe, expect, it } from "vitest";
import { INITIAL_DB_CONFIG } from "@/core/constants/dbConfigDefaults";
import {
  canLoadProvinces,
  findProvinceName,
  isProvinceLoaded,
  parseProvinceId,
  toConnectionPayload,
} from "@/modules/address-dedup/domain/provinceSelection";

const READY_CONFIG = { ...INITIAL_DB_CONFIG, db_name: "carto", user: "reader", password: "s3cret" };

describe("provinceSelection", () => {
  describe("parseProvinceId", () => {
    it.each([
      ["7", 7],
      ["1", 1],
    ])("should parse the selected id %j", (text, expected) => {
      // Arrange & Act & Assert
      expect(parseProvinceId(text)).toBe(expected);
    });

    it.each(["", "0", "-3", "1.5", "abc"])("should return null for %j", (text) => {
      // Arrange & Act & Assert
      expect(parseProvinceId(text)).toBeNull();
    });
  });

  describe("isProvinceLoaded", () => {
    const LOADED = [
      { id: 1, name: "MONTEVIDEO" },
      { id: 7, name: "FLORES" },
    ];

    it("should accept an id present in the loaded list", () => {
      // Arrange & Act & Assert
      expect(isProvinceLoaded(LOADED, 7)).toBe(true);
    });

    it("should reject an id absent from the loaded list", () => {
      // Arrange & Act & Assert
      expect(isProvinceLoaded(LOADED, 9)).toBe(false);
    });

    it("should reject every id when nothing is loaded", () => {
      // Arrange & Act & Assert
      expect(isProvinceLoaded([], 7)).toBe(false);
    });
  });

  describe("findProvinceName", () => {
    const LOADED = [
      { id: 1, name: "MONTEVIDEO" },
      { id: 7, name: "FLORES" },
    ];

    it("should return the name of a loaded id", () => {
      // Arrange & Act & Assert
      expect(findProvinceName(LOADED, 7)).toBe("FLORES");
    });

    it("should return undefined for an absent id", () => {
      // Arrange & Act & Assert
      expect(findProvinceName(LOADED, 9)).toBeUndefined();
    });

    it("should return undefined when nothing is loaded", () => {
      // Arrange & Act & Assert
      expect(findProvinceName([], 7)).toBeUndefined();
    });
  });

  describe("canLoadProvinces", () => {
    it("should allow loading when database, user and password are filled", () => {
      // Arrange & Act & Assert
      expect(canLoadProvinces(READY_CONFIG)).toBe(true);
    });

    it.each([
      ["db_name", { db_name: "" }],
      ["db_name blank", { db_name: "  " }],
      ["user", { user: "" }],
      ["password", { password: "" }],
      ["password missing", { password: undefined }],
    ])("should refuse loading when %s is empty", (_label, override) => {
      // Arrange
      const config = { ...READY_CONFIG, ...override };

      // Act & Assert
      expect(canLoadProvinces(config)).toBe(false);
    });
  });

  describe("toConnectionPayload", () => {
    it("should copy only the connection fields and default a missing password to empty", () => {
      // Arrange
      const config = { ...READY_CONFIG, password: undefined };

      // Act
      const payload = toConnectionPayload(config);

      // Assert
      expect(payload).toEqual({
        host: config.host,
        port: config.port,
        db_name: "carto",
        user: "reader",
        password: "",
      });
    });
  });
});
