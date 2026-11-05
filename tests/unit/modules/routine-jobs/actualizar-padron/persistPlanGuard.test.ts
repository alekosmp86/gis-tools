import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { PLAN_TTL_MS } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plan";
import { runActualizarPadron } from "@/modules/routine-jobs/jobs/actualizar-padron/services/runActualizarPadron";
import { readPlanRecord } from "@/modules/routine-jobs/jobs/actualizar-padron/services/planStore";
import type { ActualizarPadronOptions, ActualizarPadronParams, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

type Row = Record<string, unknown>;

/* The plan folder lives under os.tmpdir(): the default export is redirected to a fresh temp root per test. */
const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

vi.mock("@/modules/routine-jobs/jobs/actualizar-padron/services/resolveLayouts", () => ({
  resolvePadronLayouts: vi.fn(async () => LAYOUTS),
}));

vi.mock("@/modules/routine-jobs/jobs/shared/preflightAsserts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/routine-jobs/jobs/shared/preflightAsserts")>()),
  assertWriteTargetsReady: vi.fn(async () => undefined),
  assertSourceTablesReady: vi.fn(async () => undefined),
}));

/* The revert writer writes a gzip file; this suite checks the write transaction, not the backup file. */
vi.mock("@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup")>()),
  writeRevertBackup: vi.fn(async () => REVERT_BACKUP),
}));

const SETUP_TIMEOUT_MS = 30000;
const NOW_MS = 1_000_000;
const PASSWORD = "Actualizar-pw!7";
const PLAN_CHANGED_MESSAGE = "El plan cambió desde el análisis; vuelva a analizar.";
const PLAN_UNKNOWN_MESSAGE = "El plan del análisis no existe: vuelva a analizar.";
const PLAN_EXPIRED_MESSAGE = "El plan del análisis caducó: vuelva a analizar.";
const PLAN_PARAMS_MESSAGE = "El plan del análisis corresponde a otros parámetros: vuelva a analizar.";
const PLAN_MISSING_MESSAGE = "Para guardar la carga primero analice la actualización: falta el plan del análisis.";
const UNTOUCHED_MESSAGE = "Las tablas de destino no fueron modificadas.";
const PLAN_ID_PATTERN = /^[0-9a-f]{32}$/;
const UNKNOWN_PLAN_ID = "f".repeat(32);
const REVERT_BACKUP = {
  token: "00000000-0000-4000-8000-000000000000",
  fileName: "padron-revert-carto-padron-20261030-120000.sql.gz",
  bytes: 1,
  counts: { updated: 1, paired: 0, inserted: 1, addressMasterRows: 0 },
};

/* Stand-ins for the PostGIS functions: geometries are numeric text, so distances and areas are plain differences. */
const POSTGIS_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION ST_IsValid(geometry) RETURNS boolean AS 'SELECT $1 <> ''bad''' LANGUAGE sql;
  CREATE FUNCTION ST_MakeValid(geometry) RETURNS geometry AS 'SELECT ''5''::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_CollectionExtract(geometry, int) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION GeometryType(geometry) RETURNS text AS 'SELECT ''MULTIPOLYGON''' LANGUAGE sql;
  CREATE FUNCTION ST_SRID(geometry) RETURNS int AS 'SELECT 32721' LANGUAGE sql;
  CREATE FUNCTION ST_Transform(geometry, int) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Multi(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Force2D(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS 'SELECT $1 = ''''' LANGUAGE sql;
  CREATE FUNCTION ST_Normalize(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_SnapToGrid(geometry, numeric) RETURNS geometry AS 'SELECT round($1::numeric, 3)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_HausdorffDistance(geometry, geometry) RETURNS float8 AS 'SELECT abs($1::numeric - $2::numeric)::float8' LANGUAGE sql;
  CREATE FUNCTION ST_SymDifference(geometry, geometry) RETURNS geometry AS 'SELECT abs($1::numeric - $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Union(geometry, geometry) RETURNS geometry AS 'SELECT greatest($1::numeric, $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION st_union_first(geometry, geometry) RETURNS geometry AS 'SELECT COALESCE($1, $2)' LANGUAGE sql;
  CREATE AGGREGATE ST_Union(geometry) (SFUNC = st_union_first, STYPE = geometry);
  CREATE FUNCTION ST_Area(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_Intersection(geometry, geometry) RETURNS geometry AS 'SELECT least($1::numeric, $2::numeric)::text::geometry' LANGUAGE sql;
  CREATE FUNCTION ST_Centroid(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_X(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION ST_Y(geometry) RETURNS float8 AS 'SELECT $1::numeric::float8' LANGUAGE sql;
  CREATE FUNCTION geometry_overlaps(geometry, geometry) RETURNS boolean AS 'SELECT true' LANGUAGE sql;
  CREATE OPERATOR && (LEFTARG = geometry, RIGHTARG = geometry, PROCEDURE = geometry_overlaps);
`;

const SCHEMA_SQL = `
  CREATE SCHEMA stg;
  CREATE SCHEMA carto;
  CREATE TABLE stg.padron_staging (unidadcat text, nomdepto text, nomloccat text, padron numeric, geom geometry);
  CREATE TABLE carto.province (id int, name text);
  CREATE TABLE carto.loc (id int, name text, id_province int);
  CREATE TABLE carto.padron (
    id serial PRIMARY KEY, number varchar(10), type_padron varchar(30),
    id_cadastral_locality int, id_province int, geometry geometry, id_address_master int
  );
`;

/* Destination: UNCHANGED (rural, NULL locality), CHANGED (geometry 2 -> staging 4). Staging: one NEW (600), one CHANGED (200), one UNCHANGED (100). */
const SEED_SQL = `
  INSERT INTO carto.province VALUES (1, 'MONTEVIDEO');
  INSERT INTO carto.loc VALUES (10, 'CENTRO', 1);
  INSERT INTO carto.padron (number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
    ('100', 'RURAL', NULL, 1, '1'),
    ('200', 'URBANO', 10, 1, '2');
  INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
    ('RURAL', 'MONTEVIDEO', NULL, 100, '1'),
    ('URBANO', 'Montevideo', 'centro', 200, '4'),
    ('RURAL', 'MONTEVIDEO', NULL, 600, '6');
`;

/* Adds an applied pair: destination 500 (id 3, URBANO) with no staging key, and NEW staging 501 at the same geometry. Destination 999 (id 4) stays MISSING, so the largest id is 4 and moving id 3 keeps every count and the max id. */
const PAIR_ID_SEED_SQL = `
  INSERT INTO carto.padron (id, number, type_padron, id_cadastral_locality, id_province, geometry) VALUES
    (3, '500', 'URBANO', 10, 1, '5'),
    (4, '999', 'URBANO', 10, 1, '9');
  INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom) VALUES
    ('RURAL', 'MONTEVIDEO', NULL, 501, '5');
`;

const SELECT_PADRON_SQL =
  "SELECT id, number, type_padron, id_cadastral_locality, id_province, geometry, id_address_master FROM carto.padron ORDER BY id";

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "loc", Object.values(LOCALITY_COLUMN)),
};

const OPTIONS: ActualizarPadronOptions = {
  tolerance: 1,
  geometryAreaThreshold: 0.05,
  updateGeometries: true, repairSequences: true,
  linkAddressMaster: false,
  pairChoices: [],
};

const PARAMS_OF = (overrides: Partial<ActualizarPadronParams> = {}): ActualizarPadronParams => ({
  config: {
    host: "db.local",
    port: "5432",
    db_name: "gis",
    user: "gis_user",
    password: PASSWORD,
    schema_name: "",
    table_name: "",
  },
  stagingSchema: "stg",
  stagingTable: "padron_staging",
  cartoSchema: "carto",
  targetTable: "padron",
  provinceTable: "province",
  localityTable: "loc",
  options: OPTIONS,
  dryRun: false,
  confirm: true,
  ...overrides,
});

interface TargetRow {
  id: number;
  number: string;
  type_padron: string;
  id_cadastral_locality: number | null;
  id_province: number;
  geometry: string;
  id_address_master: number | null;
}

/** A session on the embedded database: each statement the stage sends runs on the same PGlite connection. Bound
    parameters are forwarded, so AP-5's has_table_privilege(..., 'DELETE') preflight check (and any other parameterized
    query) runs for real against PGlite instead of silently dropping its arguments. */
const sessionOn = (database: PGlite): RunSession => ({
  async query(sql: string, values?: unknown[]) {
    const result = await database.query(sql, values);
    return { rows: result.rows as Row[] };
  },
  async close() {},
});

const depsOn = (database: PGlite, nowMs: number): RunDeps => ({
  openSession: vi.fn(async () => sessionOn(database)),
  now: () => nowMs,
});

async function readPadron(database: PGlite): Promise<TargetRow[]> {
  const result = await database.query<TargetRow>(SELECT_PADRON_SQL);
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

/** The analysis of the given parameters, on its own session: it writes a plan and changes nothing in the database. */
async function analyze(database: PGlite, nowMs: number = NOW_MS, overrides: Partial<ActualizarPadronParams> = {}): Promise<string> {
  const result = await runActualizarPadron(PARAMS_OF({ dryRun: true, confirm: false, ...overrides }), depsOn(database, nowMs));
  expect(result.planId).toMatch(PLAN_ID_PATTERN);
  return result.planId as string;
}

let database: PGlite;

beforeEach(async () => {
  tempRoot.directory = await mkdtemp(path.join(tmpdir(), "gis-persist-guard-"));
  database = new PGlite();
  await database.exec(POSTGIS_STUBS_SQL);
  await database.exec(SCHEMA_SQL);
  await database.exec(SEED_SQL);
}, SETUP_TIMEOUT_MS);

afterEach(async () => {
  await database.close();
  await rm(tempRoot.directory, { recursive: true, force: true });
});

describe("real run refusals before any connection (AP-90)", () => {
  it("should refuse a real run with no planId with the plan-missing message, open no session and write nothing", async () => {
    const before = await readPadron(database);
    const deps = depsOn(database, NOW_MS);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF(), deps));

    expect(failure.message).toBe(PLAN_MISSING_MESSAGE);
    expect(deps.openSession).not.toHaveBeenCalled();
    expect(await readPadron(database)).toEqual(before);
  });

  it("should refuse a real run with an unknown planId with the unknown-plan message, open no session and write nothing", async () => {
    const before = await readPadron(database);
    const deps = depsOn(database, NOW_MS);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId: UNKNOWN_PLAN_ID }), deps));

    expect(failure.message).toBe(PLAN_UNKNOWN_MESSAGE);
    expect(deps.openSession).not.toHaveBeenCalled();
    expect(await readPadron(database)).toEqual(before);
  });

  it("should refuse a real run whose plan has expired with the expired message, keep the plan and write nothing", async () => {
    const planId = await analyze(database, NOW_MS);
    const before = await readPadron(database);
    const deps = depsOn(database, NOW_MS + PLAN_TTL_MS);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), deps));

    expect(failure.message).toBe(PLAN_EXPIRED_MESSAGE);
    expect(deps.openSession).not.toHaveBeenCalled();
    expect(await readPadron(database)).toEqual(before);
    expect(await readPlanRecord(planId)).toBeDefined();
  });

  it("should refuse a real run whose parameters differ from the analysis with the parameters message, keep the plan and write nothing", async () => {
    const planId = await analyze(database);
    const before = await readPadron(database);
    const deps = depsOn(database, NOW_MS);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId, options: { ...OPTIONS, tolerance: 2 } }), deps));

    expect(failure.message).toBe(PLAN_PARAMS_MESSAGE);
    expect(deps.openSession).not.toHaveBeenCalled();
    expect(await readPadron(database)).toEqual(before);
    expect(await readPlanRecord(planId)).toBeDefined();
  });

  it("should accept a real run whose only difference from the analysis is the password", async () => {
    const planId = await analyze(database);

    const result = await runActualizarPadron(PARAMS_OF({ planId, config: { ...PARAMS_OF().config, password: "otra-clave" } }), depsOn(database, NOW_MS));

    expect(result.targetModified).toBe(true);
  });
});

describe("persist with a changed plan (AP-90)", () => {
  it.each([
    {
      name: "a staging candidate is added after the analysis",
      mutation: `INSERT INTO stg.padron_staging (unidadcat, nomdepto, nomloccat, padron, geom)
        VALUES ('URBANO', 'Montevideo', 'centro', 700, '7')`,
    },
    {
      name: "a destination row is updated to the staging geometry by another load",
      mutation: "UPDATE carto.padron SET geometry = '4' WHERE number = '200'",
    },
    {
      name: "a destination row is deleted after the analysis",
      mutation: "DELETE FROM carto.padron WHERE number = '100'",
    },
    {
      name: "the staging geometry of the NEW row changes after the analysis with the counts equal",
      mutation: "UPDATE stg.padron_staging SET geom = '66' WHERE padron = 600",
    },
    {
      name: "the staging geometry of the CHANGED row changes to another non-equal value with the counts equal",
      mutation: "UPDATE stg.padron_staging SET geom = '44' WHERE padron = 200",
    },
    {
      name: "the staging number of the NEW row is renumbered after the analysis with the counts equal",
      mutation: "UPDATE stg.padron_staging SET padron = 601 WHERE padron = 600",
    },
  ])("should abort with the changed-plan message, write nothing and keep the plan when $name", async ({ mutation }) => {
    const planId = await analyze(database);
    await database.exec(mutation);
    const before = await readPadron(database);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOn(database, NOW_MS)));

    expect(failure.message).toContain(PLAN_CHANGED_MESSAGE);
    expect(failure.message).toContain(UNTOUCHED_MESSAGE);
    expect(await readPadron(database)).toEqual(before);
    expect(await readPlanRecord(planId)).toBeDefined();
  });

  it("should accept the persist of an applied pair when nothing changed after the analysis, so the pair case below is not vacuous", async () => {
    await database.exec(PAIR_ID_SEED_SQL);
    const planId = await analyze(database);

    const result = await runActualizarPadron(PARAMS_OF({ planId }), depsOn(database, NOW_MS));

    expect(result.target.pairsApplied).toBe(1);
    expect(result.target.inserted).toBe(1);
  });

  it("should abort with the changed-plan message, write nothing and keep the plan when an applied pair's old id changes with the counts and the max id equal", async () => {
    await database.exec(PAIR_ID_SEED_SQL);
    const planId = await analyze(database);
    const analysed = await readPadron(database);
    await database.exec("UPDATE carto.padron SET id = 0 WHERE id = 3");
    const before = await readPadron(database);
    expect(before).toHaveLength(analysed.length);
    expect(Math.max(...before.map((row) => row.id))).toBe(Math.max(...analysed.map((row) => row.id)));
    expect(before.find((row) => row.id === 3)).toBeUndefined();
    expect(before.find((row) => row.id === 0)?.number).toBe("500");

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOn(database, NOW_MS)));

    expect(failure.message).toContain(PLAN_CHANGED_MESSAGE);
    expect(failure.message).toContain(UNTOUCHED_MESSAGE);
    expect(await readPadron(database)).toEqual(before);
    expect(await readPlanRecord(planId)).toBeDefined();
  });
});

describe("analysis then persist (AP-88, AP-89, AP-90)", () => {
  it("should leave the destination unchanged on the analysis and apply the planned writes and delete the plan on the persist", async () => {
    const before = await readPadron(database);
    const planId = await analyze(database);
    expect(await readPadron(database)).toEqual(before);

    const result = await runActualizarPadron(PARAMS_OF({ planId }), depsOn(database, NOW_MS));

    expect(result.dryRun).toBe(false);
    expect(result.targetModified).toBe(true);
    expect(result.target.inserted).toBe(1);
    expect(result.target.updated).toBe(1);
    const after = await readPadron(database);
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((row) => row.number === "200")?.geometry).toBe("4");
    expect(after.find((row) => row.number === "600")).toBeDefined();
    expect(await readPlanRecord(planId)).toBeUndefined();
  });

  it("should refuse a second persist with the same plan once the first has committed", async () => {
    const planId = await analyze(database);
    await runActualizarPadron(PARAMS_OF({ planId }), depsOn(database, NOW_MS));
    const afterFirst = await readPadron(database);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOn(database, NOW_MS)));

    expect(failure.message).toBe(PLAN_UNKNOWN_MESSAGE);
    expect(await readPadron(database)).toEqual(afterFirst);
  });
});
