import { describe, expect, it } from "vitest";
import type { SafeDbConfig, SavedDbProfile } from "@/core/types/db";
import {
  connectionKey,
  connectionProfileName,
  findConnectionProfile,
  toConnectionProfiles,
} from "@/modules/address-dedup/domain/connectionProfiles";

const CONFIG: SafeDbConfig = {
  host: "db.local",
  port: "5432",
  db_name: "carto",
  user: "reader",
  schema_name: "bdj_carto",
  table_name: "ide_direccion",
};

function profile(id: string, updatedAt: number, overrides: Partial<SafeDbConfig> = {}): SavedDbProfile {
  return { id, name: `table profile ${id}`, config: { ...CONFIG, ...overrides }, updatedAt };
}

describe("connectionProfiles", () => {
  describe("connectionKey", () => {
    it("should ignore schema and table and trim the connection fields", () => {
      // Arrange
      const other = { ...CONFIG, host: " db.local ", schema_name: "x", table_name: "y" };

      // Act & Assert
      expect(connectionKey(other)).toBe(connectionKey(CONFIG));
    });

    it("should differ when any connection field differs", () => {
      // Arrange & Act & Assert
      expect(connectionKey({ ...CONFIG, user: "writer" })).not.toBe(connectionKey(CONFIG));
      expect(connectionKey({ ...CONFIG, port: "5433" })).not.toBe(connectionKey(CONFIG));
    });
  });

  describe("connectionProfileName", () => {
    it("should format database, address and user", () => {
      // Arrange & Act & Assert
      expect(connectionProfileName(CONFIG)).toBe("carto @ db.local:5432 (reader)");
    });

    it("should omit empty pieces", () => {
      // Arrange & Act & Assert
      expect(connectionProfileName({ ...CONFIG, user: "" })).toBe("carto @ db.local:5432");
      expect(connectionProfileName({ ...CONFIG, port: "" })).toBe("carto @ db.local (reader)");
      expect(connectionProfileName({ ...CONFIG, host: "", port: "" })).toBe("carto (reader)");
      expect(connectionProfileName({ ...CONFIG, host: "", user: "" })).toBe("carto @ 5432");
    });
  });

  describe("toConnectionProfiles", () => {
    it("should return an empty list for no profiles", () => {
      // Arrange & Act & Assert
      expect(toConnectionProfiles([])).toEqual([]);
    });

    it("should collapse table profiles of one connection into the newest one", () => {
      // Arrange
      const profiles = [
        profile("old", 1, { table_name: "a" }),
        profile("new", 3, { table_name: "b" }),
        profile("mid", 2, { schema_name: "other" }),
      ];

      // Act
      const result = toConnectionProfiles(profiles);

      // Assert
      expect(result.map((entry) => entry.id)).toEqual(["new"]);
    });

    it("should blank schema and table and rename to the connection label", () => {
      // Arrange & Act
      const [entry] = toConnectionProfiles([profile("one", 1)]);

      // Assert
      expect(entry.name).toBe("carto @ db.local:5432 (reader)");
      expect(entry.config).toEqual({ ...CONFIG, schema_name: "", table_name: "" });
      expect(entry.updatedAt).toBe(1);
    });

    it("should drop entries without a database name", () => {
      // Arrange
      const profiles = [profile("blank", 5, { db_name: "  " }), profile("ok", 1)];

      // Act & Assert
      expect(toConnectionProfiles(profiles).map((entry) => entry.id)).toEqual(["ok"]);
    });

    it("should order distinct connections newest first without mutating the input", () => {
      // Arrange
      const profiles = [
        profile("a", 1, { db_name: "alpha" }),
        profile("c", 3, { db_name: "gamma" }),
        profile("b", 2, { db_name: "beta" }),
      ];
      const snapshot = profiles.map((entry) => entry.id);

      // Act
      const result = toConnectionProfiles(profiles);

      // Assert
      expect(result.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
      expect(profiles.map((entry) => entry.id)).toEqual(snapshot);
    });
  });

  describe("findConnectionProfile", () => {
    it("should find the entry of the same connection regardless of table fields", () => {
      // Arrange
      const entries = toConnectionProfiles([profile("one", 1), profile("two", 2, { user: "x" })]);

      // Act
      const tableProfileConfig = { ...CONFIG, table_name: "zzz" };
      const found = findConnectionProfile(entries, tableProfileConfig);

      // Assert
      expect(found?.id).toBe("one");
    });

    it("should return undefined when the connection is unknown", () => {
      // Arrange & Act & Assert
      expect(findConnectionProfile([], CONFIG)).toBeUndefined();
    });
  });
});
