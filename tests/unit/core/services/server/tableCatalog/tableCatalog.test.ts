import { describe, it, expect } from "vitest";
import {
  listTables,
  resolveColumns,
  type CatalogQuerySession,
} from "@/core/services/server/tableCatalog/tableCatalog";

/*
 * Fake catalog session. Row-shape contract assumed by these tests:
 *  - schema existence query (mentions pg_namespace / information_schema.schemata, not tables): 1 row when it exists, 0 rows otherwise.
 *  - table listing query: rows { name, kind } with kind "TABLE" | "VIEW".
 *  - column query (when script.columns is set, every query answers it): rows { column_name, data_type }; no rows when the table does not exist.
 */
interface RecordedQuery {
  sql: string;
  values: unknown[] | undefined;
}

interface CatalogScript {
  schemaExists?: boolean;
  tables?: { name: string; kind: "TABLE" | "VIEW" }[];
  columns?: { column_name: string; data_type: string }[];
}

const SCHEMA_QUERY = /pg_namespace|information_schema\.schemata/i;
const TABLE_QUERY = /pg_class|information_schema\.tables|pg_tables|pg_views/i;

function createSession(script: CatalogScript): { session: CatalogQuerySession; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const session: CatalogQuerySession = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (script.columns !== undefined) {
        return { rows: [...script.columns] };
      }
      const schemaExists = script.schemaExists ?? true;
      if (SCHEMA_QUERY.test(sql) && !TABLE_QUERY.test(sql)) {
        return { rows: schemaExists ? [{ schema_name: "x" }] : [] };
      }
      return { rows: schemaExists ? [...(script.tables ?? [])] : [] };
    },
  };
  return { session, queries };
}

const col = (column_name: string, data_type = "text") => ({ column_name, data_type });

describe("tableCatalog", () => {
  describe("listTables", () => {
    it("AC-1: should return tables and views with name and kind when the schema exists", async () => {
      const { session } = createSession({
        tables: [
          { name: "paisrural", kind: "TABLE" },
          { name: "v_padron", kind: "VIEW" },
        ],
      });

      const result = await listTables(session, "cat");

      expect(result.schemaExists).toBe(true);
      expect(result.tables).toEqual([
        { name: "paisrural", kind: "TABLE" },
        { name: "v_padron", kind: "VIEW" },
      ]);
    });

    it("AC-1: should order the tables by name when the catalog returns them unordered", async () => {
      const { session } = createSession({
        tables: [
          { name: "zeta", kind: "TABLE" },
          { name: "alfa", kind: "VIEW" },
          { name: "medio", kind: "TABLE" },
        ],
      });

      const result = await listTables(session, "cat");

      expect(result.tables.map((table) => table.name)).toEqual(["alfa", "medio", "zeta"]);
    });

    it("AC-1: should return schemaExists false and an empty list when the schema does not exist", async () => {
      const { session } = createSession({ schemaExists: false });

      const result = await listTables(session, "nope");

      expect(result).toEqual({ schemaExists: false, tables: [] });
    });

    it("AC-1: should return schemaExists true and an empty list when the schema has no tables", async () => {
      const { session } = createSession({ schemaExists: true, tables: [] });

      const result = await listTables(session, "vacio");

      expect(result).toEqual({ schemaExists: true, tables: [] });
    });

    it("AC-1: should pass the schema name as a query parameter and never interpolate it into the SQL text", async () => {
      const hostileSchema = `cat"; DROP TABLE x; --`;
      const { session, queries } = createSession({ tables: [] });

      await listTables(session, hostileSchema);

      expect(queries.length).toBeGreaterThan(0);
      for (const query of queries) {
        expect(query.sql).not.toContain("DROP TABLE");
        expect(query.sql).not.toContain(hostileSchema);
        expect(query.values).toContain(hostileSchema);
      }
    });
  });

  describe("resolveColumns", () => {
    it("AC-2: should resolve an exact match with its real name and data type", async () => {
      const { session } = createSession({ columns: [col("padron", "integer"), col("nomdepto")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["padron"]);

      expect(result).toEqual([{ logical: "padron", status: "resolved", column: "padron", dataType: "integer" }]);
    });

    it("AC-2: should resolve a case-insensitive match to the real column name", async () => {
      const { session } = createSession({ columns: [col("NOMDEPTO", "character varying")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["nomdepto"]);

      expect(result[0]).toMatchObject({
        logical: "nomdepto",
        status: "resolved",
        column: "NOMDEPTO",
        dataType: "character varying",
      });
    });

    it("AC-2: should resolve a normalized match ignoring case, underscores and accents", async () => {
      const { session } = createSession({ columns: [col("Nom_Depto"), col("Área_Ha", "numeric")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["nomdepto", "areaha"]);

      expect(result.map((entry) => [entry.logical, entry.status, entry.column])).toEqual([
        ["nomdepto", "resolved", "Nom_Depto"],
        ["areaha", "resolved", "Área_Ha"],
      ]);
    });

    it("AC-2: should return the entries in the order of the required list", async () => {
      const { session } = createSession({ columns: [col("a1"), col("b2"), col("c3")] });

      const result = await resolveColumns(session, "cat", "t", ["c3", "a1", "b2"]);

      expect(result.map((entry) => entry.logical)).toEqual(["c3", "a1", "b2"]);
    });

    it("AC-2: should report missing when no column matches", async () => {
      const { session } = createSession({ columns: [col("otra")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["valreal"]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ logical: "valreal", status: "missing" });
      expect(result[0].column).toBeUndefined();
    });

    it("AC-2: should report ambiguous and pick none when several columns match the same normalized name", async () => {
      const { session } = createSession({ columns: [col("Sec_Cat"), col("SEC-CAT")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["seccat"]);

      expect(result[0].status).toBe("ambiguous");
      expect(result[0].column).toBeUndefined();
    });

    it("AC-2: should not resolve a truncated match and should suggest the candidate column", async () => {
      const { session } = createSession({ columns: [col("nombre_ofi")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["nombre_oficial_largo"]);

      expect(result[0].status).toBe("missing");
      expect(result[0].column).toBeUndefined();
      expect(result[0].suggestion).toBe("nombre_ofi");
    });

    it("AC-2: should not resolve a similar match and should suggest the candidate column", async () => {
      const { session } = createSession({ columns: [col("valaream3", "numeric")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["valaream2"]);

      expect(result[0].status).toBe("missing");
      expect(result[0].column).toBeUndefined();
      expect(result[0].suggestion).toBe("valaream3");
    });

    it("AC-2: should mark every required column missing when the table does not exist", async () => {
      const { session } = createSession({ columns: [] });

      const result = await resolveColumns(session, "cat", "no_existe", ["gid", "geom"]);

      expect(result.map((entry) => [entry.logical, entry.status])).toEqual([
        ["gid", "missing"],
        ["geom", "missing"],
      ]);
    });

    it("AC-2: should return an empty list when no column is required", async () => {
      const { session } = createSession({ columns: [col("gid")] });

      const result = await resolveColumns(session, "cat", "paisrural", []);

      expect(result).toEqual([]);
    });

    it("AC-2: should resolve a missing geom to the only geometry-typed column of the table", async () => {
      const { session } = createSession({ columns: [col("gid", "integer"), col("the_geom", "geometry(MultiPolygon,32721)")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["geom"]);

      expect(result[0]).toMatchObject({ logical: "geom", status: "resolved", column: "the_geom" });
    });

    it("AC-2: should not resolve a missing geom when the table has several geometry-typed columns", async () => {
      const { session } = createSession({
        columns: [col("geom_a", "geometry(Polygon,32721)"), col("geom_b", "geometry(Point,32721)")],
      });

      const result = await resolveColumns(session, "cat", "paisrural", ["geom"]);

      expect(result[0].status).not.toBe("resolved");
      expect(result[0].column).toBeUndefined();
    });

    it("AC-2: should apply the geometry fallback only to the logical geom column", async () => {
      const { session } = createSession({ columns: [col("the_geom", "geometry(MultiPolygon,32721)")] });

      const result = await resolveColumns(session, "cat", "paisrural", ["gid"]);

      expect(result[0]).toMatchObject({ logical: "gid", status: "missing" });
    });

    it("AC-2: should restrict the column query to real relations through pg_class relkind and keep parameters", async () => {
      const { session, queries } = createSession({ columns: [col("gid")] });

      await resolveColumns(session, "cat", "paisrural", ["gid"]);

      const columnQuery = queries.find((query) => query.values?.includes("paisrural"));
      expect(columnQuery).toBeDefined();
      expect(columnQuery?.sql).toMatch(/pg_class/i);
      expect(columnQuery?.sql).toMatch(/relkind/i);
      expect(columnQuery?.values).toEqual(expect.arrayContaining(["cat", "paisrural"]));
    });

    it("AC-2: should pass schema and table as query parameters and never interpolate them into the SQL text", async () => {
      const hostileTable = `t"; DROP TABLE y; --`;
      const { session, queries } = createSession({ columns: [] });

      await resolveColumns(session, "cat", hostileTable, ["gid"]);

      expect(queries.length).toBeGreaterThan(0);
      for (const query of queries) {
        expect(query.sql).not.toContain("DROP TABLE");
        expect(query.sql).not.toContain(hostileTable);
      }
      expect(queries.some((query) => query.values?.includes(hostileTable) && query.values.includes("cat"))).toBe(true);
    });
  });
});
