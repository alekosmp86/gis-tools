import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as plainPost } from "@/app/api/db/records/route";
import { POST as streamPost } from "@/app/api/db/records/stream/route";
import {
  DEFAULT_COLUMNS,
  FakeClient,
  geomColumns,
  jsonReq,
  script,
  type ColumnRow,
  type DbScript,
} from "./pgFake";

vi.mock("pg", async () => {
  const m = await import("./pgFake");
  return { Client: m.FakeClient };
});

const BASE = { db_name: "db", user: "u", table_name: "t" };
const GEO_EXPR = (g: string) =>
  `CASE WHEN "${g}" IS NULL THEN NULL WHEN ST_SRID("${g}") = 4326 THEN ST_AsGeoJSON("${g}") WHEN ST_SRID("${g}") > 0 THEN ST_AsGeoJSON(ST_Transform("${g}", 4326)) ELSE ST_AsGeoJSON("${g}") END AS "${g}"`;

const variants = [
  { name: "plain route", post: plainPost },
  { name: "stream route", post: streamPost },
];

describe.each(variants)("records API shared query building ($name)", ({ post }) => {
  beforeEach(() => {
    FakeClient.reset();
  });

  // Plain route returns one JSON object; stream route returns NDJSON whose first line is META.
  // Both expose columnTypes and detectedSrid on that first JSON object.
  const run = async (body: Record<string, unknown>, s: DbScript = {}) => {
    FakeClient.responder = script({ count: 1, ...s });
    const res = await post(jsonReq({ ...BASE, ...body }));
    const text = await res.text();
    const meta = JSON.parse(text.trim().split("\n")[0]);
    const client = FakeClient.instances[0];
    return { res, client, meta, dataSql: client.sqls[client.sqls.length - 1] };
  };

  describe("client construction", () => {
    it("should use localhost, 5432 and 5000ms timeout when host and port are absent", async () => {
      const { client } = await run({ password: "pw" });

      expect(client.config).toEqual({
        host: "localhost",
        port: 5432,
        database: "db",
        user: "u",
        password: "pw",
        connectionTimeoutMillis: 5000,
      });
      expect(client.connect).toHaveBeenCalledTimes(1);
    });

    it("should fall back to 5432 when port is NaN", async () => {
      const { client } = await run({ port: "abc" });
      expect(client.config.port).toBe(5432);
    });

    it("should fall back to 5432 when port is 0", async () => {
      const { client } = await run({ port: 0 });
      expect(client.config.port).toBe(5432);
    });

    it("should honour explicit host and numeric-string port", async () => {
      const { client } = await run({ host: "dbhost", port: "6543" });
      expect(client.config.host).toBe("dbhost");
      expect(client.config.port).toBe(6543);
    });

    it("should default schema_name to public in types query params and table reference", async () => {
      const { client, dataSql } = await run({});

      expect(client.query.mock.calls[0][1]).toEqual(["public", "t"]);
      expect(dataSql).toContain('FROM "public"."t"');
    });

    it("should use explicit schema_name", async () => {
      const { client, dataSql } = await run({ schema_name: "gis" });

      expect(client.query.mock.calls[0][1]).toEqual(["gis", "t"]);
      expect(dataSql).toContain('FROM "gis"."t"');
    });
  });

  describe("column selection", () => {
    it("should select all table columns when nothing is selected", async () => {
      const { dataSql } = await run({});
      expect(dataSql).toContain('SELECT "id", "name"\n');
    });

    it("should select suid_column alone", async () => {
      const { dataSql } = await run({ suid_column: "name" });
      expect(dataSql).toContain('SELECT "name"\n');
    });

    it("should prefer non-empty suid_columns array over suid_column", async () => {
      const { dataSql } = await run({ suid_columns: ["a", "b"], suid_column: "z" });
      expect(dataSql).toContain('SELECT "a", "b"\n');
      expect(dataSql).not.toContain('"z"');
    });

    it("should fall back to suid_column when suid_columns is empty", async () => {
      const { dataSql } = await run({ suid_columns: [], suid_column: "z" });
      expect(dataSql).toContain('SELECT "z"\n');
    });

    it("should merge suid, fields_to_compare and primary key de-duplicated in that order", async () => {
      const { dataSql } = await run({
        suid_columns: ["a", "b"],
        fields_to_compare: ["b", "c"],
        primary_key_column: "a",
      });
      expect(dataSql).toContain('SELECT "a", "b", "c"\n');
    });

    it("should append primary key after other columns", async () => {
      const { dataSql } = await run({ fields_to_compare: ["c"], primary_key_column: "pk" });
      expect(dataSql).toContain('SELECT "c", "pk"\n');
    });

    it("should escape double quotes in identifiers by doubling them", async () => {
      const { dataSql } = await run({
        schema_name: 's"x',
        table_name: 't"y',
        suid_column: 'c"d',
      });
      expect(dataSql).toContain('SELECT "c""d"');
      expect(dataSql).toContain('FROM "s""x"."t""y"');
    });

    it("should fall back to SELECT * when the table has no columns and none are selected", async () => {
      const { dataSql } = await run({}, { columns: [] });
      expect(dataSql).toContain("SELECT *\n");
    });
  });

  describe("geometry column handling", () => {
    it("should not run SRID queries when there is no geometry column", async () => {
      const { client } = await run({});
      expect(client.sqls.some((s) => s.includes("Find_SRID"))).toBe(false);
      expect(client.sqls.filter((s) => s.trim().startsWith("SELECT ST_SRID(")).length).toBe(0);
    });

    it.each(["geom", "geometry", "wkb_geometry", "GEOM", "Wkb_Geometry"])(
      "should detect geometry column by name %s",
      async (name) => {
        const columns: ColumnRow[] = [
          ...DEFAULT_COLUMNS,
          { column_name: name, data_type: "text", udt_name: "text", full_data_type: "text" },
        ];
        const { dataSql } = await run({}, { columns });
        expect(dataSql).toContain(GEO_EXPR(name));
      }
    );

    it("should detect geometry column by udt_name", async () => {
      const columns: ColumnRow[] = [
        ...DEFAULT_COLUMNS,
        { column_name: "shape", data_type: "USER-DEFINED", udt_name: "Geometry", full_data_type: "x" },
      ];
      const { dataSql } = await run({}, { columns });
      expect(dataSql).toContain(GEO_EXPR("shape"));
    });

    it("should detect geometry column by full_data_type", async () => {
      const columns: ColumnRow[] = [
        ...DEFAULT_COLUMNS,
        { column_name: "shape", data_type: "USER-DEFINED", udt_name: "x", full_data_type: "geometry(Point,4326)" },
      ];
      const { dataSql } = await run({}, { columns });
      expect(dataSql).toContain(GEO_EXPR("shape"));
    });

    it("should replace the selected geometry column in place with the GeoJSON expression", async () => {
      const { dataSql } = await run(
        { fields_to_compare: ["id", "geom", "name"] },
        { columns: geomColumns() }
      );
      expect(dataSql).toContain(`SELECT "id", ${GEO_EXPR("geom")}, "name"\n`);
    });

    it("should append the GeoJSON expression when the geometry column is not selected", async () => {
      const { dataSql } = await run({ fields_to_compare: ["id"] }, { columns: geomColumns() });
      expect(dataSql).toContain(`SELECT "id", ${GEO_EXPR("geom")}\n`);
    });

    it("should use the last detected geometry column when several match", async () => {
      const columns: ColumnRow[] = [
        { column_name: "geom", data_type: "x", udt_name: "geometry", full_data_type: "geometry" },
        { column_name: "geometry", data_type: "x", udt_name: "geometry", full_data_type: "geometry" },
      ];
      const { dataSql } = await run({ fields_to_compare: ["geom"] }, { columns });
      expect(dataSql).toContain(`SELECT "geom", ${GEO_EXPR("geometry")}\n`);
    });
  });

  describe("SRID detection", () => {
    const sridOf = async (s: DbScript, type = "geometry", body: Record<string, unknown> = {}) => {
      const { meta } = await run(body, { columns: geomColumns(type), ...s });
      return meta.detectedSrid as number;
    };

    it("should query Find_SRID with schema, table and geom column params", async () => {
      await sridOf({ find: 25830 }, "geometry", { schema_name: "gis" });

      const call = FakeClient.instances[0].query.mock.calls.find((c) => String(c[0]).includes("Find_SRID"));
      expect(call?.[1]).toEqual(["gis", "t", "geom"]);
    });

    it("should use Find_SRID result when positive", async () => {
      expect(await sridOf({ find: 25830 })).toBe(25830);
    });

    it("should keep 4326 when Find_SRID returns 0 and type has no modifier", async () => {
      expect(await sridOf({ find: 0 })).toBe(4326);
    });

    it("should keep 4326 when Find_SRID returns no rows", async () => {
      expect(await sridOf({ find: undefined })).toBe(4326);
    });

    it("should keep 4326 when Find_SRID returns null srid", async () => {
      expect(await sridOf({ find: null })).toBe(4326);
    });

    it("should use fallback ST_SRID query when Find_SRID throws", async () => {
      expect(await sridOf({ find: new Error("no find"), fallback: 3857 })).toBe(3857);
    });

    it("should not run fallback when Find_SRID succeeds", async () => {
      await sridOf({ find: 3857 });
      const sqls = FakeClient.instances[0].sqls;
      expect(sqls.filter((s) => s.trim().startsWith("SELECT ST_SRID(")).length).toBe(0);
    });

    it("should keep default when both Find_SRID and fallback throw", async () => {
      expect(await sridOf({ find: new Error("a"), fallback: new Error("b") })).toBe(4326);
    });

    it("should keep default when fallback returns 0", async () => {
      expect(await sridOf({ find: new Error("a"), fallback: 0 })).toBe(4326);
    });

    it("should parse SRID from column type modifier when detection stays 4326", async () => {
      expect(await sridOf({ find: 0 }, "geometry(MultiPolygon,5381)")).toBe(5381);
    });

    it("should parse SRID from type modifier when both queries throw", async () => {
      expect(
        await sridOf({ find: new Error("a"), fallback: new Error("b") }, "geometry(MultiPolygon,5381)")
      ).toBe(5381);
    });

    it("should ignore type modifier when a non-4326 SRID was already detected", async () => {
      expect(await sridOf({ find: 25830 }, "geometry(MultiPolygon,5381)")).toBe(25830);
    });

    it("should keep 4326 when type modifier SRID is 0", async () => {
      expect(await sridOf({ find: 0 }, "geometry(Point,0)")).toBe(4326);
    });

    it("should report 4326 when there is no geometry column", async () => {
      const { meta } = await run({});
      expect(meta.detectedSrid).toBe(4326);
    });
  });

  describe("columnTypes map", () => {
    it("should use full_data_type and fall back to data_type", async () => {
      const columns: ColumnRow[] = [
        { column_name: "a", data_type: "integer", udt_name: "int4", full_data_type: "int4(10)" },
        { column_name: "b", data_type: "text", udt_name: "text", full_data_type: "" },
        { column_name: "c", data_type: "date", udt_name: "date" },
      ];
      const { meta } = await run({}, { columns });

      expect(meta.columnTypes).toEqual({ a: "int4(10)", b: "text", c: "date" });
    });
  });

  describe("LIMIT and OFFSET", () => {
    it("should end the query with a semicolon and no LIMIT/OFFSET by default", async () => {
      const { dataSql } = await run({});
      expect(dataSql).toMatch(/"public"\."t"\s*;\s*$/);
      expect(dataSql).not.toContain("LIMIT");
      expect(dataSql).not.toContain("OFFSET");
    });

    it("should append LIMIT then OFFSET when both are positive numbers", async () => {
      const { dataSql } = await run({ limit: 10, offset: 20 });
      expect(dataSql).toMatch(/"public"\."t"\s+LIMIT 10 OFFSET 20;\s*$/);
    });

    it("should append only LIMIT", async () => {
      const { dataSql } = await run({ limit: 5 });
      expect(dataSql).toMatch(/"public"\."t"\s+LIMIT 5;\s*$/);
    });

    it("should append only OFFSET", async () => {
      const { dataSql } = await run({ offset: 7 });
      expect(dataSql).toMatch(/"public"\."t"\s+OFFSET 7;\s*$/);
    });

    it.each([0, -1, "10", null, undefined])("should ignore non-positive or non-number limit %s", async (limit) => {
      const { dataSql } = await run({ limit, offset: limit });
      expect(dataSql).not.toContain("LIMIT");
      expect(dataSql).not.toContain("OFFSET");
    });
  });
});
