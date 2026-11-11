import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CENTROS_STEP } from "@/modules/routine-jobs/jobs/centros-anep/domain/plannedSteps";
import { CENTROS_CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/centros-anep/constants";
import { COMMIT_UNKNOWN_WARNING, runCentrosAnep } from "@/modules/routine-jobs/jobs/centros-anep/services/runCentrosAnep";
import type { RunDeps, RunProgress } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { CentrosParams } from "@/modules/routine-jobs/jobs/centros-anep/types";
import { centrosTables, column, cleanStaging } from "./centrosFixtures";

type Row = Record<string, unknown>;

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

/*
 * Fake session contract: catalog reads answer the columns of the scenario by table name (values[1]); privilege checks
 * answer per table and privilege; the transaction statements answer by their output alias. Everything else answers nothing.
 */
const PASSWORD = "Centros-run-pw!8";
const GEOMETRY_TYPE = "geometry(Point,32721)";
const SEQUENCE = "carto.ine_centros_anep_id_seq";
const STAGING_TABLE = "ine_centros_anep_stg";
const FINAL_TABLE = "ine_centros_anep";

interface Scenario {
  stagingColumns?: Row[];
  finalColumns?: Row[];
  missing?: string[];
  denied?: string[];
  staging?: ReturnType<typeof cleanStaging>;
  finalRows?: number;
  inserted?: number;
  commitFails?: boolean;
  unsupportedSrid?: number;
}

const baseColumns = (geometryType: string): Row[] =>
  [
    column("ruee", "double precision"),
    column("subsistema", "text"),
    column("nombre", "text"),
    column("geom", geometryType),
  ] as unknown as Row[];

const stagingColumns = (geometryType = GEOMETRY_TYPE): Row[] => baseColumns(geometryType);

const finalColumns = (geometryType = GEOMETRY_TYPE): Row[] =>
  [
    column("id", "integer", { is_nullable: false, column_default: `nextval('${SEQUENCE}'::regclass)` }),
    ...baseColumns(geometryType),
  ] as unknown as Row[];

const stagingRowOf = (staging: ReturnType<typeof cleanStaging>): Row => ({
  rows: staging.rows,
  by_subsistema: staging.bySubsistema,
  empty_geometry: staging.emptyGeometry,
  null_ruee: staging.nullRuee,
  null_subsistema: staging.nullSubsistema,
  repeated_groups: staging.repeatedGroups,
  repeated_rows: staging.repeatedRows,
  repeated_ruee: staging.repeatedRuee,
  damaged_text_rows: staging.damagedTextRows,
});

function answerOf(scenario: Scenario, sql: string, values: unknown[] | undefined): Row[] {
  if (sql === "COMMIT" && scenario.commitFails) throw new Error(`commit rechazado (${PASSWORD})`);
  if (sql.includes("pg_attrdef")) {
    const table = String(values?.[1]);
    if (scenario.missing?.includes(table)) return [];
    return table === STAGING_TABLE ? (scenario.stagingColumns ?? stagingColumns()) : (scenario.finalColumns ?? finalColumns());
  }
  if (sql.includes("relkind::text")) return [{ relkind: "r" }];
  if (sql.includes("pg_inherits")) return [{ has_children: false, is_child: false }];
  if (sql.includes("pg_trigger") || sql.includes("pg_rewrite") || sql.includes("attidentity")) return [];
  if (sql.includes("pg_get_serial_sequence")) return [{ sequence_name: SEQUENCE }];
  if (sql.includes("has_table_privilege")) {
    const key = `${values?.[1]}:${values?.[2]}`;
    return [{ has_privilege: !scenario.denied?.includes(key) }];
  }
  if (sql.includes("has_sequence_privilege")) return [{ has_privilege: !scenario.denied?.includes("sequence") }];
  if (sql.includes('AS "unsupported"')) return [{ unsupported: scenario.unsupportedSrid ?? 0 }];
  if (sql.includes('AS "damaged_text_rows"')) return [stagingRowOf(scenario.staging ?? cleanStaging())];
  if (sql.includes('AS "by_subsistema"')) return [{ rows: scenario.finalRows ?? 0, by_subsistema: [] }];
  if (sql.includes('AS "deleted"')) return [{ deleted: scenario.finalRows ?? 0 }];
  if (sql.includes('AS "inserted"')) return [{ inserted: scenario.inserted ?? (scenario.staging ?? cleanStaging()).rows }];
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

const paramsOf = (overrides: Partial<CentrosParams> = {}): CentrosParams => {
  const tables = centrosTables();
  tables["centros-anep-staging"] = { schema: "bdj_carto", table: STAGING_TABLE };
  tables["centros-anep-final"] = { schema: "carto", table: FINAL_TABLE };
  return {
    config: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD, schema_name: "", table_name: "" },
    tables,
    dryRun: false,
    confirm: true,
    ...overrides,
  };
};

const dryParams = (overrides: Partial<CentrosParams> = {}): CentrosParams => paramsOf({ dryRun: true, confirm: false, ...overrides });

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

const wrote = (log: string[]): boolean =>
  log.some((sql) => /DELETE FROM|INSERT INTO|LOCK TABLE|ANALYZE/.test(sql));

describe("runCentrosAnep", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-centros-run-"));
    tempRoot.directory = directory;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe("guards before any connection (CA-6, CA-10)", () => {
    it("should refuse a real run without confirm before opening a session", async () => {
      const harness = createHarness();

      const failure = await failureOf(runCentrosAnep(paramsOf({ confirm: false }), harness.deps));

      expect(failure.message).toBe(CENTROS_CONFIRM_REQUIRED_MESSAGE);
      expect(harness.openSession).not.toHaveBeenCalled();
    });

    it("should refuse staging and final that are the same table", async () => {
      const harness = createHarness();
      const params = paramsOf();
      params.tables["centros-anep-final"] = { ...params.tables["centros-anep-staging"] };

      const failure = await failureOf(runCentrosAnep(params, harness.deps));

      expect(failure.message).toMatch(/no pueden ser la misma tabla/);
      expect(harness.openSession).not.toHaveBeenCalled();
    });
  });

  describe("dry run (CA-3, CA-8, CA-9)", () => {
    it("should analyze, end with ROLLBACK, write nothing and report the counts and the comparison", async () => {
      const harness = createHarness({ finalRows: 5 });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.dryRun).toBe(true);
      expect(result.targetModified).toBe(false);
      expect(result.outcomeUnknown).toBe(false);
      expect(result.blockers).toEqual([]);
      expect(result.staging.rows).toBe(2902);
      expect(result.comparison.currentRows).toBe(5);
      expect(result.comparison.afterRows).toBe(2902);
      expect(result.finalSrid).toBe(32721);
      expect(result.copiedColumns).toEqual(["geom", "ruee", "subsistema", "nombre"]);
      expect(result.backup).toBeUndefined();
      expect(result.inserted).toBe(0);
      expect(wrote(harness.log)).toBe(false);
      expect(harness.log).not.toContain("COMMIT");
      expect(harness.log).toContain("ROLLBACK");
      expect(harness.state.closed).toBe(1);
      expect(result.tables["centros-anep-final"]).toBe(`carto.${FINAL_TABLE}`);
    });

    it("should list staging blockers without throwing", async () => {
      const harness = createHarness({ staging: cleanStaging({ emptyGeometry: 2, damagedTextRows: 1 }) });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.blockers).toHaveLength(2);
      expect(result.targetModified).toBe(false);
    });

    it("should report an empty staging as a blocker", async () => {
      const harness = createHarness({ staging: cleanStaging({ rows: 0, bySubsistema: [] }) });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.blockers).toEqual([expect.stringContaining("no tiene filas")]);
    });

    it("should not block on repeated or NULL ruee, only warn (CA-8)", async () => {
      const harness = createHarness({ staging: cleanStaging({ repeatedGroups: 3, repeatedRows: 6, nullRuee: 1 }) });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.blockers).toEqual([]);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings.join(" ")).toContain("3 ruee se repiten");
    });

    it("should report missing write privileges as information, not as a blocker (CA-6)", async () => {
      const harness = createHarness({ denied: [`${FINAL_TABLE}:INSERT`, `${FINAL_TABLE}:DELETE`] });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.blockers).toEqual([]);
      expect(result.privilegeInfo).toHaveLength(2);
      expect(result.privilegeInfo[0]).toContain("INSERT");
      expect(result.privilegeInfo[1]).toContain("DELETE");
    });

    it("should report a staging column missing in final as a blocker naming it and a final extra as information (CA-5)", async () => {
      const harness = createHarness({
        stagingColumns: [...stagingColumns(), column("telefono", "text")] as unknown as Row[],
        finalColumns: [...finalColumns(), column("observacion", "text")] as unknown as Row[],
      });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.blockers.join(" ")).toContain('"telefono"');
      expect(result.columnInfo.join(" ")).toContain('"observacion"');
    });

    it("should block a staging geometry without SRID and a final geometry without SRID (CA-7)", async () => {
      const harness = createHarness({
        stagingColumns: stagingColumns("geometry(Point)"),
        finalColumns: finalColumns("geometry(Point)"),
      });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.blockers.filter((blocker) => blocker.includes("no tiene SRID"))).toHaveLength(2);
    });

    it("should read the final SRID from the typmod of the final geometry", async () => {
      const harness = createHarness({ finalColumns: finalColumns("geometry(Point,4326)") });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.finalSrid).toBe(4326);
    });

    it("should count staging geometries with an unknown SRID as a blocker", async () => {
      const harness = createHarness({ unsupportedSrid: 3 });

      const result = await runCentrosAnep(dryParams(), harness.deps);

      expect(result.blockers.join(" ")).toContain("SRID");
    });

    it("should fail when a table does not exist, in Spanish", async () => {
      const harness = createHarness({ missing: [STAGING_TABLE] });

      const failure = await failureOf(runCentrosAnep(dryParams(), harness.deps));

      expect(failure.message).toMatch(/no existe o no tiene columnas/);
      expect(harness.state.closed).toBe(1);
    });
  });

  describe("real run (CA-10 to CA-14)", () => {
    it("should lock, back up, delete, insert, analyze and COMMIT in that order and report the result", async () => {
      const harness = createHarness({ finalRows: 0 });
      const progress: RunProgress[] = [];

      const result = await runCentrosAnep(paramsOf(), harness.deps, (entry) => progress.push(entry));

      const at = (needle: string): number => harness.log.findIndex((sql) => sql.includes(needle));
      expect(at("LOCK TABLE")).toBeLessThan(at('AS "deleted"'));
      expect(at('AS "deleted"')).toBeLessThan(at('AS "inserted"'));
      expect(at('AS "inserted"')).toBeLessThan(at("ANALYZE"));
      expect(at("ANALYZE")).toBeLessThan(harness.log.indexOf("COMMIT"));
      expect(harness.log[harness.log.length - 1]).toBe("COMMIT");
      expect(harness.log).not.toContain("ROLLBACK");
      expect(harness.log.some((sql) => /TRUNCATE/i.test(sql))).toBe(false);
      expect(result.dryRun).toBe(false);
      expect(result.targetModified).toBe(true);
      expect(result.outcomeUnknown).toBe(false);
      expect(result.inserted).toBe(2902);
      expect(result.backup?.fileName).toMatch(/^centros-anep-revert-carto-ine_centros_anep-\d{8}-\d{6}\.sql\.gz$/);
      expect(result.blockers).toEqual([]);
      expect(result.staging.bySubsistema).toHaveLength(4);
      expect(result.stepTimings.map((timing) => timing.label)).toEqual(
        expect.arrayContaining([CENTROS_STEP.LOCK, CENTROS_STEP.BACKUP, CENTROS_STEP.DELETE, CENTROS_STEP.INSERT, CENTROS_STEP.ANALYZE, CENTROS_STEP.COMMIT])
      );
      expect(progress[progress.length - 1]).toMatchObject({ label: CENTROS_STEP.COMMIT, total: 10 });
    });

    it("should refuse the real run with a schema blocker before touching the table", async () => {
      const harness = createHarness({
        stagingColumns: [...stagingColumns(), column("telefono", "text")] as unknown as Row[],
      });

      const failure = await failureOf(runCentrosAnep(paramsOf(), harness.deps));

      expect(failure.message).toContain('"telefono"');
      expect(wrote(harness.log)).toBe(false);
      expect(harness.log).not.toContain("COMMIT");
      expect(harness.state.closed).toBe(1);
    });

    it("should refuse the real run when a write privilege is missing (blocker, not info)", async () => {
      const harness = createHarness({ denied: [`${FINAL_TABLE}:DELETE`] });

      const failure = await failureOf(runCentrosAnep(paramsOf(), harness.deps));

      expect(failure.message).toContain("DELETE");
      expect(wrote(harness.log)).toBe(false);
    });

    it("should refuse the real run when the serial sequence is not usable", async () => {
      const harness = createHarness({ denied: ["sequence"] });

      const failure = await failureOf(runCentrosAnep(paramsOf(), harness.deps));

      expect(failure.message).toMatch(/secuencia/);
      expect(wrote(harness.log)).toBe(false);
    });

    it("should roll back and fail when the inserted rows differ from the staging rows", async () => {
      const harness = createHarness({ inserted: 2900 });

      const failure = await failureOf(runCentrosAnep(paramsOf(), harness.deps));

      expect(failure.message).toContain("Las filas insertadas (2900) no coinciden con las filas de staging (2902)");
      expect(failure.message).toContain("no fue modificada");
      expect(harness.log).toContain("ROLLBACK");
      expect(harness.log).not.toContain("COMMIT");
    });

    it("should roll back when staging has a blocker inside the locked transaction", async () => {
      const harness = createHarness({ staging: cleanStaging({ damagedTextRows: 1 }) });

      const failure = await failureOf(runCentrosAnep(paramsOf(), harness.deps));

      expect(failure.message).toMatch(/caracteres dañados/);
      expect(harness.log.some((sql) => sql.includes('AS "deleted"'))).toBe(false);
      expect(harness.log).toContain("ROLLBACK");
    });

    it("should report outcome unknown with the commit warning and never leak the password when COMMIT fails", async () => {
      const harness = createHarness({ commitFails: true });

      const result = await runCentrosAnep(paramsOf(), harness.deps);

      expect(result.outcomeUnknown).toBe(true);
      expect(result.targetModified).toBe(false);
      expect(result.warnings).toContain(COMMIT_UNKNOWN_WARNING);
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    });

    it("should not leak the password in any failure message", async () => {
      const harness = createHarness({ missing: [FINAL_TABLE] });
      harness.deps.openSession = vi.fn(async () => {
        throw new Error(`password authentication failed for ${PASSWORD}`);
      });

      const failure = await failureOf(runCentrosAnep(paramsOf(), harness.deps));

      expect(failure.message).not.toContain(PASSWORD);
      expect(failure.message).toMatch(/No se pudo abrir la conexión/);
    });
  });
});
