import { describe, expect, it } from "vitest";
import { readActualizarGeometryMap } from "@/modules/routine-jobs/api/actualizarGeometryMap";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";

const PASSWORD = "Mapa!secreto-2026";
const NOW = 1_700_000_000_000;
const MAP_URL = "http://localhost/api/modules/routine-jobs/actualizar-padron/geometries";
const BEGIN_READ_ONLY = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const STATEMENT_TIMEOUT_SQL = "SET LOCAL statement_timeout = '20s'";
const NOT_FOUND_MESSAGE = "No existe un padrón de destino con id 999 y geometría.";
const READ_FAILED_PREFIX = "No se pudieron leer las geometrías";
const TIMEOUT_MESSAGE = "La lectura de las geometrías tardó demasiado. Pruebe de nuevo con menos padrones.";
const INVALID_JSON_MESSAGE = "El cuerpo de la petición no es JSON válido.";
const READ_ONLY_STATEMENT = /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|SET LOCAL |SELECT |WITH |ROLLBACK$)/;
const WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT)\b/i;
const STAGING_TABLE = "catastro_paispadron_stg";
const TARGET_TABLE = "padron_tmp_actualizacion";
const METRE_SPATIAL_REF = {
  srtext: 'PROJCS["WGS 84 / UTM zone 21S",UNIT["metre",1]]',
  proj4text: "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs",
};
const OUTLINE = { type: "Polygon", coordinates: [[[-64.1, -31.4], [-64.0, -31.4], [-64.0, -31.3], [-64.1, -31.4]]] };

type Row = Record<string, unknown>;

interface FakeSession {
  session: RunSession;
  statements: string[];
  closed(): boolean;
}

interface FakeOptions {
  oldRows?: Row[];
  failOn?: (sql: string) => Error | undefined;
}

const STAGING_COLUMNS: Row[] = [
  { column_name: "unidadcat", data_type: "text", is_nullable: true, column_default: null },
  { column_name: "nomdepto", data_type: "text", is_nullable: true, column_default: null },
  { column_name: "nomloccat", data_type: "text", is_nullable: true, column_default: null },
  { column_name: "padron", data_type: "numeric", is_nullable: true, column_default: null },
  { column_name: "geom", data_type: "geometry(MultiPolygon,32721)", is_nullable: true, column_default: null },
];

const TARGET_COLUMNS: Row[] = [
  {
    column_name: "id",
    data_type: "integer",
    is_nullable: false,
    column_default: "nextval('carto.padron_tmp_actualizacion_id_seq'::regclass)",
  },
  { column_name: "number", data_type: "character varying", is_nullable: true, column_default: null },
  { column_name: "type_padron", data_type: "character varying", is_nullable: true, column_default: null },
  { column_name: "id_cadastral_locality", data_type: "integer", is_nullable: true, column_default: null },
  { column_name: "id_province", data_type: "integer", is_nullable: true, column_default: null },
  { column_name: "geometry", data_type: "geometry(MultiPolygon,32721)", is_nullable: true, column_default: null },
];

const columnsOf = (table: string): Row[] => {
  if (table === STAGING_TABLE) return STAGING_COLUMNS;
  if (table === TARGET_TABLE) return TARGET_COLUMNS;
  return [];
};

/**
 * A scripted session: the catalog answers for the two tables, the outline query answers `oldRows`, the new-padron
 * query answers no match, and every other statement answers no row. Every statement is recorded.
 */
function fakeSessionOf({ oldRows = [], failOn }: FakeOptions = {}): FakeSession {
  const statements: string[] = [];
  let closed = false;
  const session: RunSession = {
    async query(sql: string, values?: unknown[]) {
      statements.push(sql);
      const failure = failOn?.(sql);
      if (failure !== undefined) throw failure;
      if (sql.includes("format_type(a.atttypid")) return { rows: columnsOf(String(values?.[1])) };
      if (sql.includes("FROM spatial_ref_sys")) return { rows: [METRE_SPATIAL_REF] };
      if (sql.includes("pg_get_serial_sequence")) return { rows: [{ sequence_name: "carto.padron_tmp_actualizacion_id_seq" }] };
      if (sql.includes('AS "matches"')) return { rows: [{ matches: 0, geojson: null }] };
      if (sql.includes("ST_AsGeoJSON")) return { rows: oldRows };
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

const validBody = (items: unknown[] = [{ oldId: 999 }]): Record<string, unknown> => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  stagingSchema: "stg",
  stagingTable: STAGING_TABLE,
  cartoSchema: "carto",
  targetTable: TARGET_TABLE,
  items,
});

interface MapResponseBody {
  success?: boolean;
  error?: string;
  features?: unknown[];
}

const bodyOf = async (response: Response): Promise<MapResponseBody> => (await response.json()) as MapResponseBody;

describe("readActualizarGeometryMap (AP-97, read-only geometries endpoint)", () => {
  describe("read-only transaction", () => {
    it("should run every read inside one READ ONLY transaction, set the statement timeout, and roll back at the end", async () => {
      const fake = fakeSessionOf({ oldRows: [{ typePadron: "URBANO", number: "999", geojson: OUTLINE }] });

      await readActualizarGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(fake.statements[0]).toBe(BEGIN_READ_ONLY);
      expect(fake.statements).toContain(STATEMENT_TIMEOUT_SQL);
      expect(fake.statements.at(-1)).toBe("ROLLBACK");
      expect(fake.closed()).toBe(true);
    });

    it("should issue no write statement: every statement is a transaction control, a SET LOCAL, or a read", async () => {
      const fake = fakeSessionOf({ oldRows: [{ typePadron: "URBANO", number: "999", geojson: OUTLINE }] });

      await readActualizarGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(fake.statements.length).toBeGreaterThan(0);
      expect(fake.statements.every((sql) => READ_ONLY_STATEMENT.test(sql))).toBe(true);
      expect(fake.statements.some((sql) => WRITE_KEYWORD.test(sql))).toBe(false);
    });
  });

  describe("outcomes", () => {
    it("should answer 200 with the outline, its label and its item index when the destination id has a geometry", async () => {
      const fake = fakeSessionOf({ oldRows: [{ typePadron: "URBANO", number: "999", geojson: OUTLINE }] });

      const response = await readActualizarGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toEqual({
        success: true,
        features: [{ itemIndex: 0, role: "old", label: "Padrón anterior URBANO 999 (id 999)", geometry: OUTLINE }],
      });
    });

    it("should answer 404 with the Spanish message when no destination row has the requested id", async () => {
      const fake = fakeSessionOf({ oldRows: [] });

      const response = await readActualizarGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(response.status).toBe(404);
      expect(await bodyOf(response)).toEqual({ success: false, error: NOT_FOUND_MESSAGE });
    });

    it("should answer 500 with a message that never contains the password when a statement fails", async () => {
      const fake = fakeSessionOf({
        failOn: (sql) => (sql.includes("format_type(a.atttypid") ? new Error(`autenticación fallida para ${PASSWORD}`) : undefined),
      });

      const response = await readActualizarGeometryMap(mapRequestOf(validBody()), depsOf(fake));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).toContain(READ_FAILED_PREFIX);
      expect(text).not.toContain(PASSWORD);
      expect(fake.statements.at(-1)).toBe("ROLLBACK");
    });

    it("should answer 500 without the password when the connection cannot be opened", async () => {
      const fake = fakeSessionOf();
      const openError = new Error(`no se pudo conectar con ${PASSWORD}`);

      const response = await readActualizarGeometryMap(mapRequestOf(validBody()), depsOf(fake, openError));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).not.toContain(PASSWORD);
      expect(fake.statements).toEqual([]);
    });

    it("should answer 500 with the Spanish timeout message when the statement timeout fires", async () => {
      const fake = fakeSessionOf({
        failOn: (sql) => (sql.startsWith("SELECT") ? new Error("canceling statement due to statement timeout") : undefined),
      });

      const response = await readActualizarGeometryMap(mapRequestOf(validBody()), depsOf(fake));

      expect(response.status).toBe(500);
      expect((await bodyOf(response)).error).toBe(TIMEOUT_MESSAGE);
    });

    it("should answer 400 and open no session when the body is not JSON", async () => {
      const fake = fakeSessionOf();

      const response = await readActualizarGeometryMap(mapRequestOf("{ not json"), depsOf(fake));

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error).toBe(INVALID_JSON_MESSAGE);
      expect(fake.statements).toEqual([]);
    });

    it("should answer 400 and open no session when the items list is out of range", async () => {
      const fake = fakeSessionOf();

      const response = await readActualizarGeometryMap(mapRequestOf(validBody([])), depsOf(fake));

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error).toMatch(/items debe ser una lista de 1 a 6 elementos/);
      expect(fake.statements).toEqual([]);
    });
  });
});
