import { describe, it, expect, vi } from "vitest";
import {
  buildKeyMemoryId,
  loadRememberedKey,
  saveRememberedKey,
  type KeyStorage,
} from "@/core/services/geometryKeyMemory";

const TARGET = {
  host: "localhost",
  port: "5432",
  db_name: "gis",
  schema_name: "catastro",
  table_name: "padron",
};

const createMemoryStorage = (seed: Record<string, string> = {}) => {
  const data = new Map<string, string>(Object.entries(seed));
  const setItem = vi.fn((key: string, value: string) => {
    data.set(key, value);
  });
  const storage: KeyStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem,
  };
  return { storage, data, setItem };
};

const createThrowingStorage = (): KeyStorage => ({
  getItem: () => {
    throw new Error("storage unavailable");
  },
  setItem: () => {
    throw new Error("quota exceeded");
  },
});

describe("geometryKeyMemory", () => {
  describe("buildKeyMemoryId", () => {
    it("should return the prefixed id with host, port, database, schema and table when all parts are given", () => {
      expect(buildKeyMemoryId(TARGET)).toBe("gis-tools.shp-replace.key.localhost:5432|gis|catastro|padron");
    });

    it("should default the schema segment to public when the schema is an empty string", () => {
      expect(buildKeyMemoryId({ ...TARGET, schema_name: "" })).toBe(
        "gis-tools.shp-replace.key.localhost:5432|gis|public|padron"
      );
    });

    it("should produce a different id when only the schema differs", () => {
      expect(buildKeyMemoryId({ ...TARGET, schema_name: "otro" })).not.toBe(buildKeyMemoryId(TARGET));
    });

    it("should produce a different id when only the database differs", () => {
      expect(buildKeyMemoryId({ ...TARGET, db_name: "otra" })).not.toBe(buildKeyMemoryId(TARGET));
    });

    it("should produce a different id when only the port differs", () => {
      expect(buildKeyMemoryId({ ...TARGET, port: "5433" })).not.toBe(buildKeyMemoryId(TARGET));
    });

    it("should produce the same id for the same target when it is built twice", () => {
      expect(buildKeyMemoryId(TARGET)).toBe(buildKeyMemoryId({ ...TARGET }));
    });
  });

  describe("loadRememberedKey", () => {
    const ID = "gis-tools.shp-replace.key.localhost:5432|gis|catastro|padron";

    it("should return null when the storage is null", () => {
      expect(loadRememberedKey(null, ID)).toBeNull();
    });

    it("should return null when no value is stored for the id", () => {
      const { storage } = createMemoryStorage();

      expect(loadRememberedKey(storage, ID)).toBeNull();
    });

    it("should return null when the storage throws on read", () => {
      expect(loadRememberedKey(createThrowingStorage(), ID)).toBeNull();
    });

    it.each([
      ["an empty string", ""],
      ["truncated JSON", '["DEPTO"'],
      ["plain text", "DEPTO,PADRON"],
    ])("should return null when the stored value is %s", (_label, raw) => {
      const { storage } = createMemoryStorage({ [ID]: raw });

      expect(loadRememberedKey(storage, ID)).toBeNull();
    });

    it.each([
      ["a JSON object", '{"0":"DEPTO"}'],
      ["a JSON string", '"DEPTO"'],
      ["a JSON number", "5"],
      ["the JSON null literal", "null"],
    ])("should return null when the stored value is %s instead of an array", (_label, raw) => {
      const { storage } = createMemoryStorage({ [ID]: raw });

      expect(loadRememberedKey(storage, ID)).toBeNull();
    });

    it.each([
      ["a number item", '["DEPTO", 1]'],
      ["a null item", '["DEPTO", null]'],
      ["a nested array item", '[["DEPTO"]]'],
      ["an object item", '["DEPTO", {"name":"PADRON"}]'],
      ["a boolean item", '[true]'],
    ])("should return null when the array contains %s", (_label, raw) => {
      const { storage } = createMemoryStorage({ [ID]: raw });

      expect(loadRememberedKey(storage, ID)).toBeNull();
    });

    it("should return null when the stored array is empty", () => {
      const { storage } = createMemoryStorage({ [ID]: "[]" });

      expect(loadRememberedKey(storage, ID)).toBeNull();
    });

    it("should return the field names in order when the stored value is a JSON array of strings", () => {
      const { storage } = createMemoryStorage({ [ID]: '["PADRON","DEPTO"]' });

      expect(loadRememberedKey(storage, ID)).toEqual(["PADRON", "DEPTO"]);
    });

    it("should read only the value stored under the requested id", () => {
      const { storage } = createMemoryStorage({ [`${ID}-other`]: '["AREA"]' });

      expect(loadRememberedKey(storage, ID)).toBeNull();
    });
  });

  describe("saveRememberedKey", () => {
    const ID = "gis-tools.shp-replace.key.localhost:5432|gis|catastro|padron";

    it("should do nothing without throwing when the storage is null", () => {
      expect(() => saveRememberedKey(null, ID, ["DEPTO"])).not.toThrow();
    });

    it("should not throw when the storage throws on write", () => {
      expect(() => saveRememberedKey(createThrowingStorage(), ID, ["DEPTO"])).not.toThrow();
    });

    it("should write nothing when the field list is empty", () => {
      const { storage, setItem } = createMemoryStorage();

      saveRememberedKey(storage, ID, []);

      expect(setItem).not.toHaveBeenCalled();
    });

    it("should keep the previously stored key unchanged when the field list is empty", () => {
      const { storage } = createMemoryStorage({ [ID]: '["DEPTO"]' });

      saveRememberedKey(storage, ID, []);

      expect(loadRememberedKey(storage, ID)).toEqual(["DEPTO"]);
    });

    it("should round trip the same field names in the same order when saved then loaded", () => {
      const { storage } = createMemoryStorage();
      const fields = ["DEPTO", "LOCALIDAD", "PADRON"];

      saveRememberedKey(storage, ID, fields);

      expect(loadRememberedKey(storage, ID)).toEqual(fields);
    });

    it("should store a JSON array of strings under the given id", () => {
      const { storage, data } = createMemoryStorage();

      saveRememberedKey(storage, ID, ["DEPTO", "PADRON"]);

      expect(JSON.parse(data.get(ID) ?? "null")).toEqual(["DEPTO", "PADRON"]);
    });

    it("should replace the previously remembered key when saved again for the same id", () => {
      const { storage } = createMemoryStorage();

      saveRememberedKey(storage, ID, ["DEPTO"]);
      saveRememberedKey(storage, ID, ["AREA", "PADRON"]);

      expect(loadRememberedKey(storage, ID)).toEqual(["AREA", "PADRON"]);
    });

    it("should leave the key of another target untouched when saving for a different id", () => {
      const otherId = buildKeyMemoryId({ ...TARGET, table_name: "urbano" });
      const { storage } = createMemoryStorage();

      saveRememberedKey(storage, otherId, ["LOCALIDAD"]);
      saveRememberedKey(storage, ID, ["DEPTO"]);

      expect(loadRememberedKey(storage, otherId)).toEqual(["LOCALIDAD"]);
    });
  });
});
