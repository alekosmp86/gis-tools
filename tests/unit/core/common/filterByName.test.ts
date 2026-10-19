import { describe, expect, it } from "vitest";
import { filterByName } from "@/core/common/filterByName";

const named = (...names: string[]) => names.map((name) => ({ name }));
const namesOf = (items: { name: string }[]) => items.map((item) => item.name);

describe("filterByName", () => {
  describe("matching", () => {
    it("should find an accented name from an unaccented query", () => {
      const items = named("Conexión Prod", "Otra");

      expect(namesOf(filterByName(items, "conexion"))).toEqual(["Conexión Prod"]);
    });

    it("should find an unaccented name from an accented query", () => {
      const items = named("conexion dev", "Otra");

      expect(namesOf(filterByName(items, "Conexión"))).toEqual(["conexion dev"]);
    });

    it("should fold ñ and ü to their base letters", () => {
      const items = named("Año Nuevo", "Pingüino", "Zeta");

      expect(namesOf(filterByName(items, "ano"))).toEqual(["Año Nuevo"]);
      expect(namesOf(filterByName(items, "pinguino"))).toEqual(["Pingüino"]);
      expect(namesOf(filterByName(items, "AÑO"))).toEqual(["Año Nuevo"]);
    });

    it("should ignore case in both directions", () => {
      const items = named("PRODUCCION", "desarrollo");

      expect(namesOf(filterByName(items, "produccion"))).toEqual(["PRODUCCION"]);
      expect(namesOf(filterByName(items, "DESARROLLO"))).toEqual(["desarrollo"]);
    });

    it("should match a substring in the middle of a name", () => {
      const items = named("Servidor Central GIS", "Otro");

      expect(namesOf(filterByName(items, "central"))).toEqual(["Servidor Central GIS"]);
    });

    it("should ignore surrounding whitespace on the query", () => {
      const items = named("Dev", "Prod");

      expect(namesOf(filterByName(items, "  dev  "))).toEqual(["Dev"]);
    });

    it("should ignore surrounding whitespace on the names", () => {
      const items = named("  Dev  ", "Prod");

      expect(namesOf(filterByName(items, "dev"))).toEqual(["  Dev  "]);
    });

    it("should preserve input order", () => {
      const items = named("db-c", "db-a", "x", "db-b");

      expect(namesOf(filterByName(items, "db"))).toEqual(["db-c", "db-a", "db-b"]);
    });
  });

  describe("no-match and empty states", () => {
    it("should return an empty array when nothing matches", () => {
      expect(filterByName(named("Dev", "Prod"), "zzz")).toEqual([]);
    });

    it("should return an empty array for an empty list", () => {
      expect(filterByName([], "dev")).toEqual([]);
      expect(filterByName([], "")).toEqual([]);
    });

    it.each(["", "   ", "\t\n"])("should return all items for blank query %j", (query) => {
      const items = named("Dev", "Prod");

      expect(filterByName(items, query)).toEqual(items);
    });

    it("should return a new array, not the input reference, for a blank query", () => {
      const items = named("Dev", "Prod");

      const result = filterByName(items, "");

      expect(result).not.toBe(items);
      expect(result[0]).toBe(items[0]);
    });
  });

  describe("purity and typing", () => {
    it("should not mutate the input list", () => {
      const items = named("b", "a", "ab");
      const snapshot = [...items];

      filterByName(items, "a");

      expect(items).toEqual(snapshot);
      expect(items).toHaveLength(3);
    });

    it("should return the original item objects with their extra fields", () => {
      const first = { id: "1", name: "Dev", host: "h1" };
      const second = { id: "2", name: "Prod", host: "h2" };

      const result = filterByName([first, second], "prod");

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(second);
      expect(result[0].host).toBe("h2");
    });
  });
});
