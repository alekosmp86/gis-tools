import { describe, expect, it } from "vitest";
import { runShpReplace } from "@/core/services/server/shpReplace/runShpReplace";
import {
  GeometrySourceKind,
} from "@/core/services/server/shpReplace/replaceSql";
import type { ReplaceRecordRow, ReplaceRecordSource } from "@/core/services/server/shpReplace/replaceRecordSource";
import type {
  RunShpReplaceParams,
  ShpReplaceSession,
} from "@/core/services/server/shpReplace/shpReplaceTypes";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";

interface Column {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: boolean;
  column_default: string | null;
}

const TEXT_COLUMN = (name: string): Column => ({
  column_name: name,
  data_type: "text",
  udt_name: "text",
  is_nullable: true,
  column_default: null,
});

const GEOM_COLUMN: Column = {
  column_name: "geom",
  data_type: "USER-DEFINED",
  udt_name: "geometry",
  is_nullable: true,
  column_default: null,
};

interface FakeOptions {
  columns: Column[];
  geometryType: string;
  targetSrid: number;
  invalidGeometryRec?: number;
  insertError?: Error;
  previousRows?: number;
}

type Kind =
  | "BEGIN"
  | "CATALOG"
  | "CREATE_STAGE"
  | "COPY"
  | "STAGE_COUNT"
  | "CHECK_CREATE"
  | "CHECK_FIND"
  | "LOCK"
  | "TARGET_COUNT"
  | "DELETE"
  | "INSERT"
  | "COMMIT"
  | "ROLLBACK"
  | "ANALYZE"
  | "OTHER";

function classify(sql: string): Kind {
  const text = sql.trim();
  if (/^BEGIN\b/i.test(text)) return "BEGIN";
  if (/^COMMIT\b/i.test(text)) return "COMMIT";
  if (/^ROLLBACK\b/i.test(text)) return "ROLLBACK";
  if (/^INSERT INTO\b/i.test(text)) return "INSERT";
  if (/^DELETE FROM\b/i.test(text)) return "DELETE";
  if (/^LOCK TABLE\b/i.test(text)) return "LOCK";
  if (/^ANALYZE\b/i.test(text)) return "ANALYZE";
  if (/^CREATE FUNCTION pg_temp/i.test(text)) return "CHECK_CREATE";
  if (/gis_tools_geometry_text_ok\("geom_json"\)/.test(text)) return "CHECK_FIND";
  if (/^CREATE TEMP TABLE\b/i.test(text)) return "CREATE_STAGE";
  if (/information_schema\.columns|geometry_columns|spatial_ref_sys/i.test(text)) return "CATALOG";
  if (/count\(\*\)/i.test(text)) return text.includes("shp_replace_stage") ? "STAGE_COUNT" : "OTHER";
  return "OTHER";
}

class FakeSession implements ShpReplaceSession {
  readonly sqlLog: string[] = [];
  readonly kinds: Kind[] = [];
  readonly copiedLines: string[] = [];
  closeCount = 0;
  private staged = 0;

  constructor(private readonly options: FakeOptions) {}

  async query(sql: string) {
    const kind = classify(sql);
    this.sqlLog.push(sql);
    this.kinds.push(kind);
    const rows = (list: object[]) => ({ rows: list as Array<Record<string, unknown>>, rowCount: list.length });
    if (kind === "CATALOG") {
      if (sql.includes("information_schema.columns")) return rows(this.options.columns);
      if (sql.includes("geometry_columns")) return rows([{ srid: this.options.targetSrid, type: this.options.geometryType }]);
      return rows([{ srid: 32721, geographic: false }]);
    }
    if (kind === "STAGE_COUNT") return rows([{ count: this.staged }]);
    if (kind === "CHECK_FIND") {
      return rows(this.options.invalidGeometryRec === undefined ? [] : [{ rec: this.options.invalidGeometryRec }]);
    }
    if (kind === "OTHER" && /count\(\*\)/i.test(sql)) return rows([{ count: this.options.previousRows ?? 5 }]);
    if (kind === "INSERT") {
      if (this.options.insertError) throw this.options.insertError;
      return { rows: [], rowCount: this.staged };
    }
    return { rows: [], rowCount: 0 };
  }

  async copyIn(sql: string, lines: Iterable<string>) {
    this.sqlLog.push(sql);
    this.kinds.push("COPY");
    let copied = 0;
    for (const line of lines) {
      this.copiedLines.push(line);
      copied += 1;
    }
    this.staged = copied;
    return copied;
  }

  async close() {
    this.closeCount += 1;
  }

  sqlOf(kind: Kind): string {
    return this.sqlLog[this.kinds.indexOf(kind)];
  }
}

const DEFAULT_OPTIONS: FakeOptions = {
  columns: [TEXT_COLUMN("nombre"), GEOM_COLUMN],
  geometryType: "MULTIPOLYGON",
  targetSrid: 4326,
};

const GEOM_HEX = "0103000020E6100000";

const ROWS: ReplaceRecordRow[] = [
  { rec: 1, values: { nombre: "Ana", obs: "a" }, geometryJson: GEOM_HEX },
  { rec: 2, values: { nombre: "Beto", obs: "b" }, geometryJson: "POINT(1 2)" },
  { rec: 3, values: { nombre: "Cata", obs: null }, geometryJson: null },
];

function csvSource(overrides: Partial<ReplaceRecordSource> = {}, rows: ReplaceRecordRow[] = ROWS): ReplaceRecordSource {
  return {
    fieldNames: ["nombre", "obs"],
    recordCount: rows.length,
    hasGeometry: true,
    geometryFormat: GeometrySourceKind.TEXT,
    wording: {
      missingFields: "Columnas del CSV",
      geometryName: "CSV",
      noGeometry: "El CSV no tiene una columna de geometría (EWKB, WKT) ni un par de columnas de latitud y longitud.",
    },
    records: () => rows,
    ...overrides,
  };
}

const GEOMETRY_MAPPING: ReplaceColumnMapping = {
  sourceByTarget: { nombre: "nombre", geom: SHP_GEOMETRY_SOURCE },
  defaults: {},
};

const ATTRIBUTE_MAPPING: ReplaceColumnMapping = { sourceByTarget: { nombre: "nombre" }, defaults: {} };

function params(overrides: Partial<RunShpReplaceParams> = {}): RunShpReplaceParams {
  return {
    target: { schema_name: "public", table_name: "parcelas" },
    shapefile: csvSource(),
    mapping: GEOMETRY_MAPPING,
    sourceSrid: 32721,
    resetSequences: false,
    sequences: [],
    ...overrides,
  };
}

const run = (session: FakeSession, runParams: RunShpReplaceParams) => runShpReplace(async () => session, runParams);

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the replace to reject");
}

const collapse = (kinds: Kind[]): Kind[] => kinds.filter((kind, index) => index === 0 || kinds[index - 1] !== kind);

describe("runShpReplace with a CSV-style source", () => {
  describe("CR-8: staging and insert", () => {
    it("should stage the geometry text in geom_json and copy one line per row with the raw geometry text", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      await run(session, params());

      expect(session.sqlOf("CREATE_STAGE")).toBe(
        'CREATE TEMP TABLE "shp_replace_stage" ("rec" integer, "c0" text, "geom_json" text) ON COMMIT DROP'
      );
      expect(session.sqlOf("COPY")).toBe('COPY "shp_replace_stage" ("rec","c0","geom_json") FROM STDIN');
      expect(session.copiedLines).toEqual([`1\tAna\t${GEOM_HEX}\n`, "2\tBeto\tPOINT(1 2)\n", "3\tCata\t\\N\n"]);
    });

    it("should insert parsing the stage text as EWKB or EWKT and not as GeoJSON", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      await run(session, params());

      const insert = session.sqlOf("INSERT");
      expect(insert).toContain("ST_GeomFromEWKB(decode(");
      expect(insert).toContain("ST_GeomFromEWKT(");
      expect(insert).not.toContain("ST_GeomFromGeoJSON");
      expect(insert).toContain("ST_Multi(ST_Transform(");
    });

    it("should not wrap the geometry in ST_Multi when the target type is a plain polygon", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, geometryType: "POLYGON" });

      await run(session, params());

      expect(session.sqlOf("INSERT")).not.toContain("ST_Multi");
    });

    it("should skip ST_Transform when the target column is unconstrained with SRID 0", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, targetSrid: 0, geometryType: "GEOMETRY" });

      await run(session, params());

      expect(session.sqlOf("INSERT")).not.toContain("ST_Transform");
    });

    it("should report the CSV row count as sourceRows and the inserted rows in the result", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      const result = await run(session, params());

      expect(result).toMatchObject({ sourceRows: 3, stagedRows: 3, insertedRows: 3, previousRows: 5, dryRun: false });
    });

    it("should omit geom_json from the stage when the target geometry column is not mapped even though the CSV has geometry", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, columns: [TEXT_COLUMN("nombre")] });

      await run(session, params({ mapping: ATTRIBUTE_MAPPING }));

      expect(session.sqlOf("CREATE_STAGE")).not.toContain("geom_json");
      expect(session.kinds).not.toContain("CHECK_CREATE");
    });
  });

  describe("CR-10: geometry check", () => {
    it("should run the geometry check after counting the staged rows and before LOCK and DELETE", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      await run(session, params());

      expect(collapse(session.kinds)).toEqual([
        "BEGIN",
        "CATALOG",
        "CREATE_STAGE",
        "COPY",
        "STAGE_COUNT",
        "CHECK_CREATE",
        "CHECK_FIND",
        "LOCK",
        "OTHER",
        "DELETE",
        "INSERT",
        "COMMIT",
        "ANALYZE",
      ]);
    });

    it("should fail with the row number, roll back and never lock, delete, insert or commit when a geometry does not parse", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, invalidGeometryRec: 2 });

      const error = await rejectionOf(run(session, params()));

      expect(error.message).toContain("La geometría de la fila 2 no se pudo interpretar");
      expect(session.kinds).toContain("ROLLBACK");
      for (const kind of ["LOCK", "DELETE", "INSERT", "COMMIT"] as const) {
        expect(session.kinds, kind).not.toContain(kind);
      }
      expect(session.kinds.indexOf("CHECK_FIND")).toBeLessThan(session.kinds.indexOf("ROLLBACK"));
      expect(session.closeCount).toBe(1);
    });

    it("should not run the geometry check for a source that is not TEXT", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);
      const source = csvSource({ geometryFormat: undefined, hasGeometry: undefined });

      await run(session, params({ shapefile: source }));

      expect(session.kinds).not.toContain("CHECK_CREATE");
      expect(session.sqlOf("INSERT")).toContain("ST_GeomFromGeoJSON");
    });

    it("should run the geometry check in a dry run, roll back and leave the target untouched", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      const result = await run(session, params({ dryRun: true }));

      expect(session.kinds).toContain("CHECK_FIND");
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.kinds).toContain("ROLLBACK");
      expect(result).toMatchObject({ dryRun: true, targetModified: false, insertedRows: 0 });
    });

    it("should fail a dry run when a geometry does not parse", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, invalidGeometryRec: 1 });

      await expect(run(session, params({ dryRun: true }))).rejects.toThrowError(/fila 1 /);
    });
  });

  describe("CR-8: hasGeometry false", () => {
    const NO_GEOMETRY = { hasGeometry: false, geometryFormat: GeometrySourceKind.TEXT } as const;

    it("should refuse with the CSV wording before staging when a target column maps to the geometry but the CSV has none", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      const error = await rejectionOf(run(session, params({ shapefile: csvSource(NO_GEOMETRY) })));

      expect(error.message).toContain("El CSV no tiene una columna de geometría");
      expect(session.kinds).toContain("ROLLBACK");
      for (const kind of ["CREATE_STAGE", "COPY", "DELETE", "INSERT", "COMMIT"] as const) {
        expect(session.kinds, kind).not.toContain(kind);
      }
    });

    it("should replace the attribute columns normally when the CSV has no geometry and no geometry column is mapped", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, columns: [TEXT_COLUMN("nombre")] });

      const result = await run(session, params({ shapefile: csvSource(NO_GEOMETRY), mapping: ATTRIBUTE_MAPPING }));

      expect(result.insertedRows).toBe(3);
      expect(session.sqlOf("COPY")).toBe('COPY "shp_replace_stage" ("rec","c0") FROM STDIN');
      expect(session.sqlOf("INSERT")).not.toContain("ST_");
      expect(session.kinds).not.toContain("CHECK_CREATE");
    });
  });

  describe("CR-11: CSV wording of errors", () => {
    it("should name Columnas del CSV when a mapped source column is missing from the file", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);
      const mapping: ReplaceColumnMapping = { sourceByTarget: { nombre: "falta" }, defaults: {} };

      const error = await rejectionOf(run(session, params({ mapping })));

      expect(error.message).toContain("Columnas del CSV no encontrados: falta.");
    });

    it("should name the CSV when two target columns are mapped to the geometry", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, columns: [GEOM_COLUMN, { ...GEOM_COLUMN, column_name: "geom2" }] });
      const mapping: ReplaceColumnMapping = {
        sourceByTarget: { geom: SHP_GEOMETRY_SOURCE, geom2: SHP_GEOMETRY_SOURCE },
        defaults: {},
      };

      const error = await rejectionOf(run(session, params({ mapping })));

      expect(error.message).toContain("geometría del CSV");
    });

    it("should refuse a source with no records and never touch the target", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      const error = await rejectionOf(run(session, params({ shapefile: csvSource({}, []) })));

      expect(error.message).toContain("El archivo no contiene registros.");
      expect(session.kinds).not.toContain("DELETE");
    });

    it("should not require equal shape and attribute counts for a CSV source", async () => {
      const session = new FakeSession(DEFAULT_OPTIONS);

      await expect(run(session, params())).resolves.toMatchObject({ insertedRows: 3 });
    });
  });

  describe("CR-12: rollback on failure", () => {
    it("should roll back, skip the commit and close the session when the insert fails", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, insertError: new Error("fallo al insertar") });

      const error = await rejectionOf(run(session, params()));

      expect(error.message).toContain("fallo al insertar");
      expect(session.kinds).toContain("ROLLBACK");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.closeCount).toBe(1);
    });

    it("should have issued the DELETE inside the transaction that is rolled back when the insert fails", async () => {
      const session = new FakeSession({ ...DEFAULT_OPTIONS, insertError: new Error("fallo") });

      await rejectionOf(run(session, params()));

      expect(session.kinds.indexOf("BEGIN")).toBeLessThan(session.kinds.indexOf("DELETE"));
      expect(session.kinds.indexOf("DELETE")).toBeLessThan(session.kinds.indexOf("ROLLBACK"));
    });
  });
});
