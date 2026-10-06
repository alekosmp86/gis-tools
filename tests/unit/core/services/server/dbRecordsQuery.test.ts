import { beforeEach, describe, expect, it, vi } from "vitest";

const { ctor } = vi.hoisted(() => ({ ctor: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    constructor(cfg: unknown) {
      ctor(cfg);
    }
  },
}));

import {
  REQUIRED_PARAMS_MESSAGE,
  appendPaging,
  buildRecordsDataQuery,
  createPgClient,
  hasRequiredConnectionParams,
  inspectRecordsTable,
  parseRecordsRequest,
  type RecordsRequestParams,
} from "@/core/services/server/dbRecordsQuery";
import type { Client } from "pg";

type Col = { column_name: string; data_type: string; udt_name?: string; full_data_type?: string };
type Srid = number | null | Error | "norows";

const col = (name: string, type = "text", udt?: string, full?: string): Col => ({
  column_name: name,
  data_type: type,
  udt_name: udt,
  full_data_type: full,
});

function makeClient(columns: Col[], find?: Srid, fallback?: Srid) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const res = (v: Srid | undefined) => {
    if (v instanceof Error) throw v;
    return { rows: v === undefined || v === "norows" ? [] : [{ srid: v }] };
  };
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const t = sql.trim();
    if (t.includes("information_schema.columns")) return { rows: columns };
    if (t.includes("Find_SRID")) return res(find);
    if (t.startsWith("SELECT ST_SRID(")) return res(fallback);
    return { rows: [] };
  });
  return { client: { query } as unknown as Client, calls };
}

const P = (o: Partial<RecordsRequestParams> = {}): RecordsRequestParams => ({
  schema_name: "public",
  fields_to_compare: [],
  table_name: "t",
  ...o,
});

const geoExpr = (g: string) =>
  `CASE WHEN "${g}" IS NULL THEN NULL WHEN ST_SRID("${g}") = 4326 THEN ST_AsGeoJSON("${g}") WHEN ST_SRID("${g}") > 0 THEN ST_AsGeoJSON(ST_Transform("${g}", 4326)) ELSE ST_AsGeoJSON("${g}") END AS "${g}"`;

describe("parseRecordsRequest", () => {
  it("should apply defaults when schema_name and fields_to_compare are absent", () => {
    const r = parseRecordsRequest({});
    expect(r.schema_name).toBe("public");
    expect(r.fields_to_compare).toEqual([]);
    expect(r.table_name).toBeUndefined();
  });

  it("should pass through all provided fields", () => {
    const body = {
      host: "h",
      port: "6543",
      db_name: "d",
      user: "u",
      password: "p",
      schema_name: "s",
      table_name: "t",
      suid_column: "a",
      suid_columns: ["a", "b"],
      fields_to_compare: ["x"],
      primary_key_column: "pk",
      limit: 5,
      offset: 10,
    };
    expect(parseRecordsRequest(body)).toEqual(body);
  });

  it("should preserve suid_column and suid_columns independently", () => {
    expect(parseRecordsRequest({ suid_column: "a" })).toMatchObject({ suid_column: "a", suid_columns: undefined });
    expect(parseRecordsRequest({ suid_columns: ["b"] })).toMatchObject({ suid_column: undefined, suid_columns: ["b"] });
  });
});

describe("hasRequiredConnectionParams", () => {
  const full = P({ db_name: "d", user: "u", table_name: "t" });

  it("should return true when all required params are present", () => {
    expect(hasRequiredConnectionParams(full)).toBe(true);
  });

  it.each(["db_name", "user", "table_name"] as const)("should return false when %s is missing", (k) => {
    expect(hasRequiredConnectionParams({ ...full, [k]: undefined })).toBe(false);
  });

  it.each(["db_name", "user", "table_name"] as const)("should return false when %s is empty", (k) => {
    expect(hasRequiredConnectionParams({ ...full, [k]: "" })).toBe(false);
  });

  it("should expose the exact Spanish message", () => {
    expect(REQUIRED_PARAMS_MESSAGE).toBe(
      "Los parámetros de conexión (base de datos, usuario y tabla) son obligatorios."
    );
  });
});

describe("createPgClient", () => {
  beforeEach(() => ctor.mockClear());

  it("should build config from params with 5000ms timeout", () => {
    createPgClient(P({ host: "h", port: 6000, db_name: "d", user: "u", password: "p" }));
    expect(ctor).toHaveBeenCalledWith({
      host: "h",
      port: 6000,
      database: "d",
      user: "u",
      password: "p",
      connectionTimeoutMillis: 5000,
    });
  });

  it("should fall back to localhost when host is absent or empty", () => {
    createPgClient(P());
    createPgClient(P({ host: "" }));
    expect(ctor.mock.calls[0][0].host).toBe("localhost");
    expect(ctor.mock.calls[1][0].host).toBe("localhost");
  });

  it.each([[undefined], [0], ["abc"]])("should fall back to port 5432 when port is %s", (port) => {
    createPgClient(P({ port }));
    expect(ctor.mock.calls[0][0].port).toBe(5432);
  });

  it("should convert a numeric-string port to a number", () => {
    createPgClient(P({ port: "6543" }));
    expect(ctor.mock.calls[0][0].port).toBe(6543);
  });
});

describe("appendPaging", () => {
  it("should only append the semicolon when no paging given", () => {
    expect(appendPaging("SELECT 1", undefined, undefined)).toBe("SELECT 1;");
  });

  it("should append LIMIT before OFFSET", () => {
    expect(appendPaging("Q", 10, 20)).toBe("Q LIMIT 10 OFFSET 20;");
  });

  it("should append only LIMIT or only OFFSET", () => {
    expect(appendPaging("Q", 5, undefined)).toBe("Q LIMIT 5;");
    expect(appendPaging("Q", undefined, 7)).toBe("Q OFFSET 7;");
  });

  it.each([["10"], [0], [-1], [null], [undefined]])("should ignore invalid value %s", (v) => {
    expect(appendPaging("Q", v, v)).toBe("Q;");
  });
});

describe("buildRecordsDataQuery", () => {
  const info = { columnTypes: {}, detectedSrid: 4326, selectClause: '"a", "b"', qualifiedTable: '"s"."t"' };
  const base = `
      SELECT "a", "b"
      FROM "s"."t"
    `;

  it("should build the exact query without paging", () => {
    expect(buildRecordsDataQuery(info, undefined, undefined)).toBe(`${base};`);
  });

  it("should build the exact query with paging", () => {
    expect(buildRecordsDataQuery(info, 3, 6)).toBe(`${base} LIMIT 3 OFFSET 6;`);
  });
});

describe("inspectRecordsTable", () => {
  it("should prefer suid_columns over suid_column", async () => {
    const { client } = makeClient([col("a"), col("b")]);
    const r = await inspectRecordsTable(client, P({ suid_columns: ["a"], suid_column: "b" }));
    expect(r.selectClause).toBe('"a"');
  });

  it("should use suid_column when suid_columns is empty", async () => {
    const { client } = makeClient([col("a"), col("b")]);
    const r = await inspectRecordsTable(client, P({ suid_columns: [], suid_column: "b" }));
    expect(r.selectClause).toBe('"b"');
  });

  it("should merge and dedupe suid, fields and pk", async () => {
    const { client } = makeClient([col("a")]);
    const r = await inspectRecordsTable(
      client,
      P({ suid_columns: ["a", "b"], fields_to_compare: ["b", "c"], primary_key_column: "a" })
    );
    expect(r.selectClause).toBe('"a", "b", "c"');
  });

  it("should select all table columns when nothing is selected", async () => {
    const { client } = makeClient([col("x"), col("y")]);
    const r = await inspectRecordsTable(client, P());
    expect(r.selectClause).toBe('"x", "y"');
  });

  it("should select * for an empty table with no selection", async () => {
    const { client } = makeClient([]);
    const r = await inspectRecordsTable(client, P());
    expect(r.selectClause).toBe("*");
    expect(r.detectedSrid).toBe(4326);
  });

  it("should pass schema and table as params to the types query", async () => {
    const { client, calls } = makeClient([]);
    await inspectRecordsTable(client, P({ schema_name: "s", table_name: "t" }));
    expect(calls[0].params).toEqual(["s", "t"]);
  });

  it("should double quotes in identifiers", async () => {
    const { client } = makeClient([]);
    const r = await inspectRecordsTable(client, P({ schema_name: 's"x', table_name: 't"y', fields_to_compare: ['c"d'] }));
    expect(r.selectClause).toBe('"c""d"');
    expect(r.qualifiedTable).toBe('"s""x"."t""y"');
  });

  it("should record columnTypes using full_data_type else data_type", async () => {
    const { client } = makeClient([col("a", "integer", "int4", "integer"), col("b", "text"), col("c", "numeric", "numeric", "numeric(10,2)")]);
    const r = await inspectRecordsTable(client, P());
    expect(r.columnTypes).toEqual({ a: "integer", b: "text", c: "numeric(10,2)" });
  });

  describe("geometry detection", () => {
    it.each([["geom"], ["geometry"], ["wkb_geometry"], ["GEOM"], ["Wkb_Geometry"]])(
      "should detect geometry by name %s",
      async (name) => {
        const { client, calls } = makeClient([col("id"), col(name)], 4326);
        const r = await inspectRecordsTable(client, P());
        expect(r.selectClause).toContain(geoExpr(name));
        expect(calls.some((c) => c.sql.includes("Find_SRID"))).toBe(true);
      }
    );

    it("should detect geometry by udt_name", async () => {
      const { client } = makeClient([col("shape", "USER-DEFINED", "Geometry")], 4326);
      const r = await inspectRecordsTable(client, P());
      expect(r.selectClause).toBe(geoExpr("shape"));
    });

    it("should detect geometry by full_data_type", async () => {
      const { client } = makeClient([col("shape", "USER-DEFINED", "x", "geometry(Point,4326)")], 4326);
      const r = await inspectRecordsTable(client, P());
      expect(r.selectClause).toBe(geoExpr("shape"));
    });

    it("should let the last matching column win", async () => {
      const { client } = makeClient([col("geom"), col("shape", "USER-DEFINED", "geometry")], 4326);
      const r = await inspectRecordsTable(client, P());
      expect(r.selectClause).toBe(`"geom", ${geoExpr("shape")}`);
    });

    it("should replace the selected geometry column in place", async () => {
      const { client } = makeClient([col("id"), col("geom"), col("name")], 4326);
      const r = await inspectRecordsTable(client, P({ fields_to_compare: ["id", "geom", "name"] }));
      expect(r.selectClause).toBe(`"id", ${geoExpr("geom")}, "name"`);
    });

    it("should append the geometry expression when not selected", async () => {
      const { client } = makeClient([col("id"), col("geom")], 4326);
      const r = await inspectRecordsTable(client, P({ fields_to_compare: ["id"] }));
      expect(r.selectClause).toBe(`"id", ${geoExpr("geom")}`);
    });

    it("should sanitize quotes in the geometry column name", async () => {
      const { client } = makeClient([col('g"eom', "USER-DEFINED", "geometry")], 4326);
      const r = await inspectRecordsTable(client, P());
      expect(r.selectClause).toBe(geoExpr('g""eom'));
    });
  });

  describe("SRID detection", () => {
    const geo = (type = "geometry(Geometry)") => [col("geom", "USER-DEFINED", "geometry", type)];

    it("should not query SRID when there is no geometry column", async () => {
      const { client, calls } = makeClient([col("a")]);
      const r = await inspectRecordsTable(client, P());
      expect(calls).toHaveLength(1);
      expect(r.detectedSrid).toBe(4326);
    });

    it("should use Find_SRID result when > 0 and pass params", async () => {
      const { client, calls } = makeClient(geo(), 5381);
      const r = await inspectRecordsTable(client, P({ schema_name: "s", table_name: "t" }));
      expect(r.detectedSrid).toBe(5381);
      expect(calls[1].params).toEqual(["s", "t", "geom"]);
      expect(calls).toHaveLength(2);
    });

    it.each([[0], [null], ["norows" as const]])("should keep 4326 when Find_SRID gives %s", async (v) => {
      const { client } = makeClient(geo(), v);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(4326);
    });

    it("should keep 4326 when the srid is not a number", async () => {
      const { client } = makeClient(geo(), "abc" as unknown as number);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(4326);
    });

    it("should use the fallback query when Find_SRID throws", async () => {
      const { client, calls } = makeClient(geo(), new Error("boom"), 3857);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(3857);
      expect(calls).toHaveLength(3);
    });

    it.each([[0], [null], ["norows" as const]])("should keep 4326 when fallback gives %s", async (v) => {
      const { client } = makeClient(geo(), new Error("boom"), v);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(4326);
    });

    it("should keep 4326 when both queries throw", async () => {
      const { client } = makeClient(geo(), new Error("a"), new Error("b"));
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(4326);
    });

    it("should parse the SRID from the type modifier when still 4326", async () => {
      const { client } = makeClient(geo("geometry(MultiPolygon,5381)"), 0);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(5381);
    });

    it("should parse the type modifier with whitespace", async () => {
      const { client } = makeClient(geo("geometry(Point, 3006 )"), null);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(3006);
    });

    it("should ignore a type modifier SRID of 0", async () => {
      const { client } = makeClient(geo("geometry(Point,0)"), null);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(4326);
    });

    it("should not override a detected SRID with the type modifier", async () => {
      const { client } = makeClient(geo("geometry(MultiPolygon,5381)"), 3857);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(3857);
    });

    it("should skip modifier parsing when columnTypes has no entry for the geometry", async () => {
      const { client } = makeClient([{ column_name: "geom", data_type: "", udt_name: "geometry" }], null);
      const r = await inspectRecordsTable(client, P());
      expect(r.detectedSrid).toBe(4326);
    });
  });
});
