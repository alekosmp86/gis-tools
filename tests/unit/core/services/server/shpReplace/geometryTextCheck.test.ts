import { describe, expect, it } from "vitest";
import { assertStagedGeometriesParse } from "@/core/services/server/shpReplace/geometryTextCheck";
import type { ShpQuerySession } from "@/core/services/server/shpReplace/shpReplaceTypes";

function fakeSession(invalidRows: Array<Record<string, unknown>> = []) {
  const sqlLog: string[] = [];
  const session: ShpQuerySession = {
    async query(sql: string) {
      sqlLog.push(sql);
      const isFind = /^SELECT\b/.test(sql);
      return { rows: isFind ? invalidRows : [], rowCount: isFind ? invalidRows.length : 0 };
    },
  };
  return { session, sqlLog };
}

describe("geometryTextCheck", () => {
  describe("CR-10: assertStagedGeometriesParse", () => {
    it("should create a pg_temp check function first and then look for invalid rows", async () => {
      const { session, sqlLog } = fakeSession();

      await assertStagedGeometriesParse(session);

      expect(sqlLog).toHaveLength(2);
      expect(sqlLog[0]).toMatch(
        /^CREATE FUNCTION pg_temp\.gis_tools_geometry_text_ok\("geom_json" text\) RETURNS boolean/
      );
      expect(sqlLog[1]).toMatch(/^SELECT /);
    });

    it("should build a plpgsql function that parses with the same expression as the insert and swallows every error", async () => {
      const { session, sqlLog } = fakeSession();

      await assertStagedGeometriesParse(session);

      expect(sqlLog[0]).toContain("LANGUAGE plpgsql");
      expect(sqlLog[0]).toContain(`ST_GeomFromEWKB(decode(NULLIF("geom_json",''),'hex'))`);
      expect(sqlLog[0]).toContain(`ST_GeomFromEWKT(NULLIF("geom_json",''))`);
      expect(sqlLog[0]).toContain("EXCEPTION WHEN OTHERS THEN RETURN false");
      expect(sqlLog[0]).toContain("RETURN true");
    });

    it("should search the stage for non-null geometries the function rejects, lowest rec first, limited to one row", async () => {
      const { session, sqlLog } = fakeSession();

      await assertStagedGeometriesParse(session);

      expect(sqlLog[1]).toBe(
        'SELECT "rec" AS rec FROM "shp_replace_stage" WHERE "geom_json" IS NOT NULL AND NOT pg_temp.gis_tools_geometry_text_ok("geom_json") ORDER BY "rec" LIMIT 1'
      );
    });

    it("should resolve without error when no staged geometry is invalid", async () => {
      const { session } = fakeSession([]);

      await expect(assertStagedGeometriesParse(session)).resolves.toBeUndefined();
    });

    it("should throw a Spanish error naming the row number when a geometry does not parse", async () => {
      const { session } = fakeSession([{ rec: 7 }]);

      await expect(assertStagedGeometriesParse(session)).rejects.toThrowError(
        "La geometría de la fila 7 no se pudo interpretar (se esperaba EWKB hexadecimal, WKT o EWKT)."
      );
    });

    it("should read the row number when the driver returns it as a string", async () => {
      const { session } = fakeSession([{ rec: "12" }]);

      await expect(assertStagedGeometriesParse(session)).rejects.toThrowError(/fila 12 /);
    });

    it("should propagate the database error when creating the function fails", async () => {
      const session: ShpQuerySession = {
        async query() {
          throw new Error("permiso denegado");
        },
      };

      await expect(assertStagedGeometriesParse(session)).rejects.toThrowError("permiso denegado");
    });
  });
});
