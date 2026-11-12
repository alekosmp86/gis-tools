import { describe, expect, it } from "vitest";
import { readEjesCallesGeometryMap } from "@/modules/routine-jobs/api/ejesGeometryMap";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";

const PASSWORD = "Mapa!secreto-2026";
const NOW = 1_700_000_000_000;
const MAP_URL = "http://localhost/api/modules/routine-jobs/ejes-calles/geometry-map";
const BEGIN_READ_ONLY = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const STATEMENT_TIMEOUT_SQL = "SET LOCAL statement_timeout = '20s'";
const READ_FAILED_PREFIX = "No se pudieron leer las geometrías";
const TIMEOUT_MESSAGE = "La lectura de las geometrías tardó demasiado. Pruebe de nuevo.";
const INVALID_JSON_MESSAGE = "El cuerpo de la petición no es JSON válido.";
const READ_ONLY_STATEMENT = /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|SET LOCAL |SELECT |WITH |ROLLBACK$)/;
const WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT)\b/i;
const STAGING_TABLE = "ide_ejesviacirculacion";
const ROAD_SECTION_TABLE = "road_section";
const PADRONES_TABLE = "padron";
const METRE_SPATIAL_REF = {
  srtext: 'PROJCS["WGS 84 / UTM zone 21S",UNIT["metre",1]]',
  proj4text: "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs",
};
const OLD_OUTLINE = { type: "LineString", coordinates: [[-56.1, -34.9], [-56.0, -34.9]] };
const ZONE_OUTLINE = { type: "Polygon", coordinates: [[[-56.1, -34.9], [-56.0, -34.9], [-56.0, -34.8], [-56.1, -34.9]]] };
const NEW_OUTLINE = { type: "LineString", coordinates: [[-56.1, -34.9], [-56.05, -34.9]] };

type Row = Record<string, unknown>;

interface FakeSession {
  session: RunSession;
  statements: string[];
  closed(): boolean;
}

interface FakeOptions {
  oldRows?: Row[];
  newRows?: Row[];
  zoneRows?: Row[];
  failOn?: (sql: string) => Error | undefined;
}

const column = (column_name: string, data_type = "text"): Row => ({ column_name, data_type, is_nullable: true, column_default: null });

const STAGING_COLUMNS: Row[] = [
  column("reftramo"),
  column("idcalle"),
  column("nombre"),
  column("tipo_vialidad"),
  column("fuente"),
  column("localidad"),
  column("departamento"),
  column("geom", "geometry(MultiLineString,32721)"),
];

const ROAD_SECTION_COLUMNS: Row[] = [
  column("id", "integer"),
  column("reftramo_ideuy", "integer"),
  column("id_circulation_way", "integer"),
  column("id_road_section_type", "integer"),
  column("id_font", "integer"),
  column("id_address_master", "integer"),
  column("source", "integer"),
  column("target", "integer"),
  column("distance", "text"),
  column("geometry", "geometry(LineString,32721)"),
];

const PADRONES_COLUMNS: Row[] = [column("type_padron"), column("geometry", "geometry(MultiPolygon,32721)")];

const columnsOf = (table: string): Row[] => {
  if (table === STAGING_TABLE) return STAGING_COLUMNS;
  if (table === ROAD_SECTION_TABLE) return ROAD_SECTION_COLUMNS;
  if (table === PADRONES_TABLE) return PADRONES_COLUMNS;
  return [];
};

/**
 * A scripted session: the catalog answers for the two tables, the old-section query answers `oldRows`, the new-section
 * query (the one that labels the SRID) answers `newRows`, and every other statement answers no row. Every statement is recorded.
 */
function fakeSessionOf({ oldRows = [], newRows = [], zoneRows = [], failOn }: FakeOptions = {}): FakeSession {
  const statements: string[] = [];
  let closed = false;
  const session: RunSession = {
    async query(sql: string, values?: unknown[]) {
      statements.push(sql);
      const failure = failOn?.(sql);
      if (failure !== undefined) throw failure;
      if (sql.includes("format_type(a.atttypid")) return { rows: columnsOf(String(values?.[1])) };
      if (sql.includes("FROM spatial_ref_sys")) return { rows: [METRE_SPATIAL_REF] };
      if (sql.includes("ST_AsGeoJSON")) {
        if (sql.includes("ST_Union")) return { rows: zoneRows };
        return { rows: sql.includes("ST_SetSRID") ? newRows : oldRows };
      }
      return { rows: [] };
    },
    async close() {
      closed = true;
    },
  };
  return { session, statements, closed: () => closed };
}

/** The deps hand out the fake session, or refuse to open it with `openError`. */
function depsOf(fake: FakeSession, openError?: Error): RunDeps {
  return {
    now: () => NOW,
    openSession: async () => {
      if (openError !== undefined) throw openError;
      return fake.session;
    },
  };
}

const mapRequestOf = (body: unknown): Request =>
  new Request(MAP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validBody = (items: unknown[] = [{ oldRef: 1001634 }]): Record<string, unknown> => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: {
    "ejes-origen": { schema: "bdj_carto", table: STAGING_TABLE },
    "ejes-tramos": { schema: "carto", table: ROAD_SECTION_TABLE },
    "ejes-padrones": { schema: "carto", table: PADRONES_TABLE },
  },
  items,
});

interface MapResponseBody {
  success?: boolean;
  error?: string;
  features?: unknown[];
}

const bodyOf = async (response: Response): Promise<MapResponseBody> => (await response.json()) as MapResponseBody;

describe("readEjesCallesGeometryMap (EM-6 to EM-9)", () => {
  describe("read-only transaction", () => {
    it("should run every read inside one READ ONLY transaction, set the statement timeout, and roll back at the end", async () => {
      const fake = fakeSessionOf({ oldRows: [{ idcalle: "72006", geojson: OLD_OUTLINE }] });

      await readEjesCallesGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(fake.statements[0]).toBe(BEGIN_READ_ONLY);
      expect(fake.statements).toContain(STATEMENT_TIMEOUT_SQL);
      expect(fake.statements.at(-1)).toBe("ROLLBACK");
      expect(fake.closed()).toBe(true);
    });

    it("should issue no write statement", async () => {
      const fake = fakeSessionOf({
        oldRows: [{ idcalle: "72006", geojson: OLD_OUTLINE }],
        newRows: [{ idcalle: "72006", geojson: NEW_OUTLINE }],
      });

      await readEjesCallesGeometryMap(mapRequestOf(validBody([{ oldRef: 1001634 }, { newRef: "1035386" }])), depsOf(fake));

      expect(fake.statements.length).toBeGreaterThan(0);
      expect(fake.statements.every((sql) => READ_ONLY_STATEMENT.test(sql))).toBe(true);
      expect(fake.statements.some((sql) => WRITE_KEYWORD.test(sql))).toBe(false);
    });
  });

  describe("zone items (ET-7)", () => {
    const zoneItem = (type: string): Record<string, unknown> => ({ zoneOf: "1035386", type });

    it("should answer 200 with a feature of role zone, its item index and the label of the padron type", async () => {
      const urban = fakeSessionOf({ zoneRows: [{ geojson: ZONE_OUTLINE }] });
      const rural = fakeSessionOf({ newRows: [{ idcalle: "1", geojson: NEW_OUTLINE }], zoneRows: [{ geojson: ZONE_OUTLINE }] });

      const urbanResponse = await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("URBANO")])), depsOf(urban));
      const ruralResponse = await readEjesCallesGeometryMap(mapRequestOf(validBody([{ newRef: "1" }, zoneItem("RURAL")])), depsOf(rural));

      expect(urbanResponse.status).toBe(200);
      expect(await bodyOf(urbanResponse)).toEqual({
        success: true,
        features: [{ itemIndex: 0, role: "zone", label: "Padrones urbanos cercanos", geometry: ZONE_OUTLINE }],
      });
      expect(await bodyOf(ruralResponse)).toEqual({
        success: true,
        features: [
          { itemIndex: 0, role: "new", label: "Tramo nuevo 1", geometry: NEW_OUTLINE },
          { itemIndex: 1, role: "zone", label: "Padrones rurales cercanos", geometry: ZONE_OUTLINE },
        ],
      });
    });

    it("should answer 200 with no feature and no error when no padron is near", async () => {
      const fake = fakeSessionOf({ zoneRows: [] });

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("URBANO")])), depsOf(fake));

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toEqual({ success: true, features: [] });
    });

    it("should answer 200 with no feature when the union comes back as a null outline", async () => {
      const fake = fakeSessionOf({ zoneRows: [{ geojson: null }] });

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("RURAL")])), depsOf(fake));

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toEqual({ success: true, features: [] });
    });

    it("should keep the other features of the row when one zone has no padron near", async () => {
      const fake = fakeSessionOf({ newRows: [{ idcalle: "1", geojson: NEW_OUTLINE }], zoneRows: [] });

      const response = await readEjesCallesGeometryMap(
        mapRequestOf(validBody([zoneItem("URBANO"), { newRef: "1035386" }])),
        depsOf(fake)
      );

      expect((await bodyOf(response)).features).toEqual([
        { itemIndex: 1, role: "new", label: "Tramo nuevo 1035386", geometry: NEW_OUTLINE },
      ]);
    });

    it("should pass the reftramo and the type as parameters, never inside the statement", async () => {
      const values: unknown[][] = [];
      const fake = fakeSessionOf({ zoneRows: [{ geojson: ZONE_OUTLINE }] });
      const inner = fake.session.query.bind(fake.session);
      fake.session.query = async (sql: string, params?: unknown[]) => {
        if (sql.includes("ST_Union")) values.push(params ?? []);
        return inner(sql, params);
      };

      await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("URBANO")])), depsOf(fake));

      expect(values).toEqual([["1035386", "URBANO"]]);
      expect(fake.statements.filter((sql) => sql.includes("ST_Union"))[0]).not.toContain("1035386");
    });

    it("should read the padrones table inside the same read-only transaction and issue no write", async () => {
      const fake = fakeSessionOf({ zoneRows: [{ geojson: ZONE_OUTLINE }] });

      await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("URBANO")])), depsOf(fake));

      expect(fake.statements[0]).toBe(BEGIN_READ_ONLY);
      expect(fake.statements.at(-1)).toBe("ROLLBACK");
      expect(fake.statements.some((sql) => sql.includes('"carto"."padron"'))).toBe(true);
      expect(fake.statements.every((sql) => READ_ONLY_STATEMENT.test(sql))).toBe(true);
      expect(fake.statements.some((sql) => WRITE_KEYWORD.test(sql))).toBe(false);
    });

    it("should answer 500 and never show the password when a zone item meets a generic SRID 0 padrones geometry", async () => {
      const generic = [column("type_padron"), column("geometry", "geometry(MultiPolygon,0)")];
      const fake = fakeSessionOf();
      const inner = fake.session.query.bind(fake.session);
      fake.session.query = async (sql: string, params?: unknown[]) =>
        sql.includes("format_type(a.atttypid") && params?.[1] === PADRONES_TABLE ? { rows: generic } : inner(sql, params);

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("URBANO")])), depsOf(fake));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).toContain("SRID 0");
      expect(text).not.toContain(PASSWORD);
    });

    it("should answer 500 and never show the password when a zone item meets a padrones table that does not exist", async () => {
      const fake = fakeSessionOf();
      const inner = fake.session.query.bind(fake.session);
      fake.session.query = async (sql: string, params?: unknown[]) =>
        sql.includes("format_type(a.atttypid") && params?.[1] === PADRONES_TABLE ? { rows: [] } : inner(sql, params);

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("URBANO")])), depsOf(fake));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).toContain("carto.padron");
      expect(text).not.toContain(PASSWORD);
    });

    it("should not touch the padrones table when the request has only old and new items, even if that table is broken", async () => {
      const wrong = [column("geometry", "geometry(MultiPolygon,4326)")];
      const fake = fakeSessionOf({
        oldRows: [{ idcalle: "72006", geojson: OLD_OUTLINE }],
        newRows: [{ idcalle: "72006", geojson: NEW_OUTLINE }],
      });
      const inner = fake.session.query.bind(fake.session);
      const asked: unknown[] = [];
      fake.session.query = async (sql: string, params?: unknown[]) => {
        if (sql.includes("format_type(a.atttypid")) asked.push(params?.[1]);
        return sql.includes("format_type(a.atttypid") && params?.[1] === PADRONES_TABLE ? { rows: wrong } : inner(sql, params);
      };

      const response = await readEjesCallesGeometryMap(
        mapRequestOf(validBody([{ oldRef: 1001634 }, { newRef: "1035386" }])),
        depsOf(fake)
      );

      expect(response.status).toBe(200);
      expect((await bodyOf(response)).features).toHaveLength(2);
      expect(asked).not.toContain(PADRONES_TABLE);
      expect(fake.statements.some((sql) => sql.includes("ST_Union"))).toBe(false);
    });

    it("should succeed for old and new items when the padrones table is missing from the catalog", async () => {
      const fake = fakeSessionOf({ oldRows: [{ idcalle: "72006", geojson: OLD_OUTLINE }] });
      const inner = fake.session.query.bind(fake.session);
      fake.session.query = async (sql: string, params?: unknown[]) =>
        sql.includes("format_type(a.atttypid") && params?.[1] === PADRONES_TABLE ? { rows: [] } : inner(sql, params);

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(response.status).toBe(200);
    });

    it("should check the padrones table once a zone item is mixed with old and new items", async () => {
      const wrong = [column("type_padron"), column("geometry", "geometry(MultiPolygon,4326)")];
      const fake = fakeSessionOf({ oldRows: [{ idcalle: "1", geojson: OLD_OUTLINE }] });
      const inner = fake.session.query.bind(fake.session);
      fake.session.query = async (sql: string, params?: unknown[]) =>
        sql.includes("format_type(a.atttypid") && params?.[1] === PADRONES_TABLE ? { rows: wrong } : inner(sql, params);

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([{ oldRef: 1 }, zoneItem("RURAL")])), depsOf(fake));

      expect(response.status).toBe(500);
    });

    it("should answer 500 naming the table and never the password when the padrones table has a wrong SRID", async () => {
      const wrong = [column("type_padron"), column("geometry", "geometry(MultiPolygon,4326)")];
      const fake = fakeSessionOf();
      const inner = fake.session.query.bind(fake.session);
      fake.session.query = async (sql: string, params?: unknown[]) =>
        sql.includes("format_type(a.atttypid") && params?.[1] === PADRONES_TABLE ? { rows: wrong } : inner(sql, params);

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("URBANO")])), depsOf(fake));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).toContain("SRID 4326");
      expect(text).not.toContain(PASSWORD);
    });

    it("should answer 400 and open no session when the request carries no padrones table", async () => {
      const fake = fakeSessionOf();
      const body = validBody([zoneItem("URBANO")]);
      body.tables = { "ejes-origen": { schema: "bdj_carto", table: STAGING_TABLE }, "ejes-tramos": { schema: "carto", table: ROAD_SECTION_TABLE } };

      const response = await readEjesCallesGeometryMap(mapRequestOf(body), depsOf(fake));

      expect(response.status).toBe(400);
      expect(fake.statements).toEqual([]);
    });

    it("should answer 400 for a zone type outside URBANO and RURAL", async () => {
      const fake = fakeSessionOf();

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([zoneItem("COMERCIAL")])), depsOf(fake));

      expect(response.status).toBe(400);
      expect(fake.statements).toEqual([]);
    });
  });

  describe("outcomes", () => {
    it("should answer 200 with the old and the new outline, labelled, with their item index", async () => {
      const fake = fakeSessionOf({
        oldRows: [{ idcalle: "72006", geojson: OLD_OUTLINE }],
        newRows: [{ idcalle: "72006", geojson: NEW_OUTLINE }],
      });

      const response = await readEjesCallesGeometryMap(
        mapRequestOf(validBody([{ oldRef: 1001634 }, { newRef: "1035386" }])),
        depsOf(fake)
      );

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toEqual({
        success: true,
        features: [
          { itemIndex: 0, role: "old", label: "Tramo anterior 1001634", geometry: OLD_OUTLINE },
          { itemIndex: 1, role: "new", label: "Tramo nuevo 1035386", geometry: NEW_OUTLINE },
        ],
      });
    });

    it("should pass the reference as a parameter, never inside the statement", async () => {
      const fake = fakeSessionOf({ newRows: [{ idcalle: "72006", geojson: NEW_OUTLINE }] });
      const reference = "1035386";

      await readEjesCallesGeometryMap(mapRequestOf(validBody([{ newRef: reference }])), depsOf(fake));

      const selects = fake.statements.filter((sql) => sql.includes("ST_AsGeoJSON"));
      expect(selects).toHaveLength(1);
      expect(selects[0]).not.toContain(reference);
    });

    it("should answer 404 naming the reftramo when no road section has it", async () => {
      const fake = fakeSessionOf({ oldRows: [] });

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(response.status).toBe(404);
      expect(await bodyOf(response)).toEqual({
        success: false,
        error: "No existe el tramo con reftramo 1001634 o no tiene geometría.",
      });
    });

    it("should answer 404 naming the reftramo when no staging row has it", async () => {
      const fake = fakeSessionOf({ newRows: [] });

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody([{ newRef: "1035386" }])), depsOf(fake));

      expect(response.status).toBe(404);
      expect((await bodyOf(response)).error).toContain("1035386");
    });

    it("should answer 500 with a message that never contains the password when a statement fails", async () => {
      const fake = fakeSessionOf({
        failOn: (sql) => (sql.includes("format_type(a.atttypid") ? new Error(`autenticación fallida para ${PASSWORD}`) : undefined),
      });

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody()), depsOf(fake));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).toContain(READ_FAILED_PREFIX);
      expect(text).not.toContain(PASSWORD);
      expect(fake.statements.at(-1)).toBe("ROLLBACK");
    });

    it("should answer 500 without the password when the connection cannot be opened", async () => {
      const fake = fakeSessionOf();
      const openError = new Error(`no se pudo conectar con ${PASSWORD}`);

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody()), depsOf(fake, openError));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).not.toContain(PASSWORD);
      expect(fake.statements).toEqual([]);
    });

    it("should answer 500 with the Spanish timeout message when the statement timeout fires", async () => {
      const fake = fakeSessionOf({
        failOn: (sql) => (sql.startsWith("SELECT") ? new Error("canceling statement due to statement timeout") : undefined),
      });

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(response.status).toBe(500);
      expect((await bodyOf(response)).error).toBe(TIMEOUT_MESSAGE);
    });

    it("should answer 400 and open no session when the body is not JSON", async () => {
      const fake = fakeSessionOf();

      const response = await readEjesCallesGeometryMap(mapRequestOf("{ not json"), depsOf(fake));

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error).toBe(INVALID_JSON_MESSAGE);
      expect(fake.statements).toEqual([]);
    });

    it("should answer 400 and open no session when there are more than 30 items", async () => {
      const fake = fakeSessionOf();
      const items = Array.from({ length: 31 }, () => ({ oldRef: 1 }));

      const response = await readEjesCallesGeometryMap(mapRequestOf(validBody(items)), depsOf(fake));

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error).toMatch(/items debe ser una lista de 1 a 30 elementos/);
      expect(fake.statements).toEqual([]);
    });
  });
});
