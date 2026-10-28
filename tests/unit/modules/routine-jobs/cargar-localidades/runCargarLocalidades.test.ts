import { describe, it, expect, vi } from "vitest";
import { runCargarLocalidades } from "@/modules/routine-jobs/jobs/cargar-localidades/services/runCargarLocalidades";
import { CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/cargar-localidades/services/preflight";
import type { CargarLocalidadesParams } from "@/modules/routine-jobs/jobs/cargar-localidades/types";
import type { RunDeps } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { DbColumnMetadata } from "@/core/types/db";

/*
 * Fake session contract: catalog reads answer the columns of the scenario's tables (by table name, bound as values[1]);
 * the transaction reads answer by the statement's output alias (rows_read, geometry_changes, inserted_list). BEGIN,
 * ROLLBACK, COMMIT, sequence repair and ANALYZE answer nothing. Every statement is logged in order.
 */
const PASSWORD = "Ru7-pw!secreto";
const SCHEMA_STAGING = "stg";
const SCHEMA_CARTO = "carto";
const PADRON_STAGING = "padron_stg";
const LOCALITY_STAGING = "localidades_stg";
const PROVINCE = "province";
const TARGET = "cadastral_locality";
const TARGET_SEQUENCE = `${SCHEMA_CARTO}.${TARGET}_id_seq`;
const GEOMETRY_TYPE = "geometry(MultiPolygon,32721)";
const PROJ4_METRE = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";

type Row = Record<string, unknown>;

interface Scenario {
  newLocalities?: number;
  changedLocalities?: number;
  appliedInserts?: number;
  appliedUpdates?: number;
  commitFails?: boolean;
}

const column = (name: string, dataType: string, overrides: Partial<DbColumnMetadata> = {}): Row => ({
  column_name: name,
  data_type: dataType,
  is_nullable: true,
  column_default: null,
  ...overrides,
});

const CATALOGS: Record<string, Row[]> = {
  [PADRON_STAGING]: [
    column("unidadcat", "text"),
    column("nomdepto", "text"),
    column("coddepto", "text"),
    column("nomloccat", "text"),
    column("codloccat", "integer"),
    column("padron", "numeric"),
  ],
  [LOCALITY_STAGING]: [column("localidad", "text"), column("coddepto", "text"), column("geom", GEOMETRY_TYPE)],
  [PROVINCE]: [column("id", "integer"), column("name", "text")],
  [TARGET]: [
    column("id", "integer", { is_nullable: false, column_default: `nextval('${TARGET_SEQUENCE}'::regclass)` }),
    column("code", "integer"),
    column("name", "text"),
    column("geometry", GEOMETRY_TYPE),
    column("id_font_type", "integer"),
    column("id_province", "integer"),
  ],
};

const SOURCE_REPORT_ROW: Row = {
  rows_read: 10,
  groups: 8,
  repaired: 0,
  candidates: 8,
  by_reason: {},
  samples: [],
};

function classifyRowOf(scenario: Scenario): Row {
  return {
    new: scenario.newLocalities ?? 2,
    unchanged: 5,
    within_tolerance: 0,
    changed: scenario.changedLocalities ?? 0,
    ambiguous: 0,
    missing: 0,
    code_differs: 0,
    missing_samples: [],
    ambiguous_samples: [],
    code_differs_samples: [],
    geometry_changes: [],
  };
}

function applyRowOf(scenario: Scenario, sql: string): Row {
  const updatesGeometries = sql.includes(`UPDATE "${SCHEMA_CARTO}"`);
  return {
    inserted: scenario.appliedInserts ?? scenario.newLocalities ?? 2,
    updated: scenario.appliedUpdates ?? (updatesGeometries ? (scenario.changedLocalities ?? 0) : 0),
    inserted_list: [],
  };
}

function answerOf(scenario: Scenario, sql: string, values: unknown[] | undefined): Row[] {
  if (sql === COMMIT_SQL && scenario.commitFails) throw new Error("commit rechazado por el servidor");
  if (sql.includes("pg_attrdef")) return CATALOGS[String(values?.[1])] ?? [];
  if (sql.includes("relkind::text")) return [{ relkind: "r" }];
  if (sql.includes("pg_inherits")) return [{ has_children: false, is_child: false }];
  if (sql.includes("pg_trigger") || sql.includes("pg_rewrite") || sql.includes("attidentity")) return [];
  if (sql.includes("pg_get_serial_sequence")) return [{ sequence_name: TARGET_SEQUENCE }];
  if (sql.includes("has_table_privilege") || sql.includes("has_sequence_privilege")) return [{ has_privilege: true }];
  if (sql.includes("AS present")) return [{ present: true }];
  if (sql.includes('AS "unsupported"')) return [{ unsupported: 0 }];
  if (sql.includes("srtext")) return [{ srtext: 'PROJCS["UTM 21S",UNIT["metre",1]]', proj4text: PROJ4_METRE }];
  if (sql.includes('AS "rows_read"')) return [SOURCE_REPORT_ROW];
  if (sql.includes('AS "geometry_changes"')) return [classifyRowOf(scenario)];
  if (sql.includes('AS "inserted_list"')) return [applyRowOf(scenario, sql)];
  return [];
}

function createHarness(scenario: Scenario = {}) {
  const log: string[] = [];
  const state = { closed: 0 };
  const session = {
    async query(sql: string, values?: unknown[]) {
      log.push(sql);
      await Promise.resolve();
      return { rows: answerOf(scenario, sql, values) };
    },
    async close() {
      state.closed += 1;
    },
  };
  const openSession = vi.fn(async () => session);
  const deps: RunDeps = { openSession, now: () => 0 };
  return { deps, log, state, openSession };
}

const defaultParams = (overrides: Partial<CargarLocalidadesParams> = {}): CargarLocalidadesParams => ({
  config: {
    host: "db.local",
    port: "5432",
    db_name: "gis",
    user: "gis_user",
    password: PASSWORD,
    schema_name: "",
    table_name: "",
  },
  stagingSchema: SCHEMA_STAGING,
  padronTable: PADRON_STAGING,
  localityStagingTable: LOCALITY_STAGING,
  provinceSchema: SCHEMA_CARTO,
  provinceTable: PROVINCE,
  targets: [{ schema: SCHEMA_CARTO, table: TARGET }],
  options: { tolerance: 1, updateGeometries: false },
  dryRun: false,
  confirm: true,
  ...overrides,
});

const dryRunParams = (overrides: Partial<CargarLocalidadesParams> = {}): CargarLocalidadesParams =>
  defaultParams({ dryRun: true, confirm: false, ...overrides });

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

const endsWith = (log: string[], sql: string): boolean => log[log.length - 1] === sql;

describe("runCargarLocalidades transaction end (MJ-13)", () => {
  describe("dry run", () => {
    it("should end with ROLLBACK and never issue COMMIT when dryRun is true", async () => {
      const harness = createHarness();

      const result = await runCargarLocalidades(dryRunParams(), harness.deps);

      expect(endsWith(harness.log, ROLLBACK_SQL)).toBe(true);
      expect(harness.log).not.toContain(COMMIT_SQL);
      expect(result.dryRun).toBe(true);
      expect(result.targetsModified).toBe(false);
      expect(result.outcomeUnknown).toBe(false);
    });

    it("should still run the insert inside the dry run transaction before rolling back", async () => {
      const harness = createHarness();

      await runCargarLocalidades(dryRunParams(), harness.deps);

      const insertAt = harness.log.findIndex((sql) => /^\s*WITH/.test(sql) && sql.includes('AS "inserted_list"'));
      expect(insertAt).toBeGreaterThan(-1);
      expect(insertAt).toBeLessThan(harness.log.indexOf(ROLLBACK_SQL));
    });

    it("should still end with ROLLBACK and never COMMIT when a dry run carries confirm true", async () => {
      const harness = createHarness();

      const result = await runCargarLocalidades(dryRunParams({ confirm: true }), harness.deps);

      expect(endsWith(harness.log, ROLLBACK_SQL)).toBe(true);
      expect(harness.log).not.toContain(COMMIT_SQL);
      expect(result.targetsModified).toBe(false);
    });
  });

  describe("real run", () => {
    it("should issue COMMIT as the last statement and never ROLLBACK when dryRun is false and confirm is true", async () => {
      const harness = createHarness();

      const result = await runCargarLocalidades(defaultParams(), harness.deps);

      expect(endsWith(harness.log, COMMIT_SQL)).toBe(true);
      expect(harness.log).not.toContain(ROLLBACK_SQL);
      expect(result.dryRun).toBe(false);
      expect(result.targetsModified).toBe(true);
      expect(result.outcomeUnknown).toBe(false);
    });

    it("should report the inserted rows of the apply for the target", async () => {
      const harness = createHarness({ newLocalities: 2 });

      const result = await runCargarLocalidades(defaultParams(), harness.deps);

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({ inserted: 2, updated: 0 });
    });

    it("should refuse a real run without confirm before opening a session and write nothing", async () => {
      const harness = createHarness();

      const failure = await failureOf(runCargarLocalidades(defaultParams({ confirm: false }), harness.deps));

      expect(failure.message).toBe(CONFIRM_REQUIRED_MESSAGE);
      expect(harness.openSession).not.toHaveBeenCalled();
      expect(harness.log).toEqual([]);
    });
  });

  describe("count mismatch rolls back", () => {
    it("should ROLLBACK, never COMMIT, and reject when inserted rows differ from the new localities of the analysis", async () => {
      const harness = createHarness({ newLocalities: 2, appliedInserts: 3 });

      const failure = await failureOf(runCargarLocalidades(defaultParams(), harness.deps));

      expect(failure.message).toMatch(/no coinciden/);
      expect(harness.log).toContain(ROLLBACK_SQL);
      expect(harness.log).not.toContain(COMMIT_SQL);
      expect(harness.state.closed).toBe(1);
    });

    it("should ROLLBACK, never COMMIT, and reject when updated geometries differ from the changed localities", async () => {
      const harness = createHarness({ changedLocalities: 2, appliedUpdates: 1 });

      const failure = await failureOf(
        runCargarLocalidades(defaultParams({ options: { tolerance: 1, updateGeometries: true } }), harness.deps)
      );

      expect(failure.message).toMatch(/no coinciden/);
      expect(harness.log).toContain(ROLLBACK_SQL);
      expect(harness.log).not.toContain(COMMIT_SQL);
    });
  });

  describe("COMMIT failure", () => {
    it("should report outcomeUnknown and targetsModified false without throwing when COMMIT fails", async () => {
      const harness = createHarness({ commitFails: true });

      const result = await runCargarLocalidades(defaultParams(), harness.deps);

      expect(harness.log).toContain(COMMIT_SQL);
      expect(result.outcomeUnknown).toBe(true);
      expect(result.targetsModified).toBe(false);
      expect(result.dryRun).toBe(false);
    });

    it("should keep the password out of the result when COMMIT fails", async () => {
      const harness = createHarness({ commitFails: true });

      const result = await runCargarLocalidades(defaultParams(), harness.deps);

      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    });
  });
});
