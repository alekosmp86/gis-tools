import { describe, it, expect, vi } from "vitest";
import { runUnidadTerritorial } from "@/modules/routine-jobs/jobs/unidad-territorial/services/runUnidadTerritorial";
import { CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/unidad-territorial/services/preflight";
import type { UnitParams } from "@/modules/routine-jobs/jobs/unidad-territorial/types";
import type { RunDeps } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { DbColumnMetadata } from "@/core/types/db";

/*
 * Fake session contract: catalog reads answer the columns of the scenario's tables (by table name, bound as values[1]);
 * the type lookup answers the match count; the transaction reads answer by the statement's output alias (rows_read,
 * geometry_changes, inserted_list). BEGIN, ROLLBACK, COMMIT, sequence repair and ANALYZE answer nothing.
 */
const PASSWORD = "Unidad-pw!7";
const SCHEMA_STAGING = "stg";
const SCHEMA_CARTO = "carto";
const LOCALITY = "localidades_catastrales_stg";
const TYPE = "tipo_unidad";
const TARGET = "territorial_unit";
const TARGET_SEQUENCE = `${SCHEMA_CARTO}.${TARGET}_id_seq`;
const GEOMETRY_TYPE = "geometry(MultiPolygon,32721)";
const PROJ4_METRE = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";
const RESOLVED_TYPE_ID = 42;
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";

type Row = Record<string, unknown>;

interface Scenario {
  newRows?: number;
  updates?: number;
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
  [LOCALITY]: [
    column("name", "text"),
    column("id_font_type", "integer"),
    column("id_province", "integer"),
    column("geometry", GEOMETRY_TYPE),
  ],
  [TYPE]: [column("id", "integer"), column("name", "text")],
  [TARGET]: [
    column("id", "integer", { is_nullable: false, column_default: `nextval('${TARGET_SEQUENCE}'::regclass)` }),
    column("name", "text"),
    column("id_territorial_unit_type", "integer"),
    column("id_font", "integer"),
    column("id_province", "integer"),
    column("geometry", GEOMETRY_TYPE),
  ],
};

const SOURCE_REPORT_ROW: Row = {
  rows_read: 10,
  candidates: 8,
  by_reason: {},
  samples: [],
};

function classifyRowOf(scenario: Scenario): Row {
  return {
    new: scenario.newRows ?? 2,
    unchanged: 5,
    within_tolerance: 0,
    changed: scenario.updates ?? 0,
    ambiguous: 0,
    missing: 0,
    font_differs: 0,
    updates: scenario.updates ?? 0,
    missing_samples: [],
    ambiguous_samples: [],
    geometry_changes: [],
  };
}

function applyRowOf(scenario: Scenario): Row {
  return {
    inserted: scenario.appliedInserts ?? scenario.newRows ?? 2,
    updated: scenario.appliedUpdates ?? scenario.updates ?? 0,
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
  if (sql.includes('AS "matches"')) return [{ matches: 1, id: RESOLVED_TYPE_ID }];
  if (sql.includes('AS "rows_read"')) return [SOURCE_REPORT_ROW];
  if (sql.includes('AS "geometry_changes"')) return [classifyRowOf(scenario)];
  if (sql.includes('AS "inserted_list"')) return [applyRowOf(scenario)];
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

const defaultParams = (overrides: Partial<UnitParams> = {}): UnitParams => ({
  config: {
    host: "db.local",
    port: "5432",
    db_name: "gis",
    user: "gis_user",
    password: PASSWORD,
    schema_name: "",
    table_name: "",
  },
  localitySchema: SCHEMA_STAGING,
  localityTable: LOCALITY,
  typeSchema: SCHEMA_CARTO,
  typeTable: TYPE,
  targetSchema: SCHEMA_CARTO,
  targetTable: TARGET,
  options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true },
  dryRun: false,
  confirm: true,
  ...overrides,
});

const dryRunParams = (overrides: Partial<UnitParams> = {}): UnitParams =>
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

describe("runUnidadTerritorial transaction end (MJ-13)", () => {
  describe("dry run", () => {
    it("should end with ROLLBACK and never issue COMMIT when dryRun is true", async () => {
      const harness = createHarness();

      const result = await runUnidadTerritorial(dryRunParams(), harness.deps);

      expect(endsWith(harness.log, ROLLBACK_SQL)).toBe(true);
      expect(harness.log).not.toContain(COMMIT_SQL);
      expect(result.dryRun).toBe(true);
      expect(result.targetModified).toBe(false);
      expect(result.outcomeUnknown).toBe(false);
    });

    it("should still run the insert and update inside the dry run transaction before rolling back", async () => {
      const harness = createHarness();

      await runUnidadTerritorial(dryRunParams(), harness.deps);

      const applyAt = harness.log.findIndex((sql) => /^\s*WITH/.test(sql) && sql.includes('AS "inserted_list"'));
      expect(applyAt).toBeGreaterThan(-1);
      expect(applyAt).toBeLessThan(harness.log.indexOf(ROLLBACK_SQL));
    });

    it("should still end with ROLLBACK and never COMMIT when a dry run carries confirm true", async () => {
      const harness = createHarness();

      const result = await runUnidadTerritorial(dryRunParams({ confirm: true }), harness.deps);

      expect(endsWith(harness.log, ROLLBACK_SQL)).toBe(true);
      expect(harness.log).not.toContain(COMMIT_SQL);
      expect(result.targetModified).toBe(false);
    });
  });

  describe("real run", () => {
    it("should issue COMMIT as the last statement and never ROLLBACK when dryRun is false and confirm is true", async () => {
      const harness = createHarness();

      const result = await runUnidadTerritorial(defaultParams(), harness.deps);

      expect(endsWith(harness.log, COMMIT_SQL)).toBe(true);
      expect(harness.log).not.toContain(ROLLBACK_SQL);
      expect(result.dryRun).toBe(false);
      expect(result.targetModified).toBe(true);
      expect(result.outcomeUnknown).toBe(false);
    });

    it("should report the inserted rows of the apply for the target", async () => {
      const harness = createHarness({ newRows: 2 });

      const result = await runUnidadTerritorial(defaultParams(), harness.deps);

      expect(result.target).toMatchObject({ inserted: 2, updated: 0 });
    });

    it("should refuse a real run without confirm before opening a session and write nothing", async () => {
      const harness = createHarness();

      const failure = await failureOf(runUnidadTerritorial(defaultParams({ confirm: false }), harness.deps));

      expect(failure.message).toBe(CONFIRM_REQUIRED_MESSAGE);
      expect(harness.openSession).not.toHaveBeenCalled();
      expect(harness.log).toEqual([]);
    });
  });

  describe("count mismatch rolls back", () => {
    it("should ROLLBACK, never COMMIT, and reject when inserted rows differ from the new localities of the analysis", async () => {
      const harness = createHarness({ newRows: 2, appliedInserts: 3 });

      const failure = await failureOf(runUnidadTerritorial(defaultParams(), harness.deps));

      expect(failure.message).toMatch(/no coinciden/);
      expect(harness.log).toContain(ROLLBACK_SQL);
      expect(harness.log).not.toContain(COMMIT_SQL);
      expect(harness.state.closed).toBe(1);
    });

    it("should ROLLBACK, never COMMIT, and reject when updated rows differ from the expected updates", async () => {
      const harness = createHarness({ updates: 2, appliedUpdates: 1 });

      const failure = await failureOf(runUnidadTerritorial(defaultParams(), harness.deps));

      expect(failure.message).toMatch(/no coinciden/);
      expect(harness.log).toContain(ROLLBACK_SQL);
      expect(harness.log).not.toContain(COMMIT_SQL);
    });
  });

  describe("COMMIT failure", () => {
    it("should report outcomeUnknown and targetModified false without throwing when COMMIT fails", async () => {
      const harness = createHarness({ commitFails: true });

      const result = await runUnidadTerritorial(defaultParams(), harness.deps);

      expect(harness.log).toContain(COMMIT_SQL);
      expect(result.outcomeUnknown).toBe(true);
      expect(result.targetModified).toBe(false);
      expect(result.dryRun).toBe(false);
    });

    it("should keep the password out of the result when COMMIT fails", async () => {
      const harness = createHarness({ commitFails: true });

      const result = await runUnidadTerritorial(defaultParams(), harness.deps);

      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    });
  });
});
