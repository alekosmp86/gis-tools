import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { buildReportSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportSql";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import { buildCreateDeleteIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteIdsTable";
import { referenceScanOf, type ReferenceScanRow } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { referenceTablesScanSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { runActualizarPadron } from "@/modules/routine-jobs/jobs/actualizar-padron/services/runActualizarPadron";
import type { ActualizarPadronOptions, ActualizarPadronParams, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { writeRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup";

/* The plan file lives under os.tmpdir(): the default export is redirected to a fresh temp root per test. */
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

/* The revert writer touches the filesystem; these tests replace it so no file is written under the OS temp directory. */
vi.mock("@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup")>()),
  writeRevertBackup: vi.fn(async () => REVERT_BACKUP),
}));

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const BEGIN_READ_ONLY_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const PASSWORD = "Actualizar-pw!7";
const CLASSIFIED_NEW = 2;
const PLAN_ID_PATTERN = /^[0-9a-f]{32}$/;
const REVERT_BACKUP_FAILURE = "No se pudo generar el respaldo para revertir: disco lleno.";
const REVERT_BACKUP = {
  token: "00000000-0000-4000-8000-000000000000",
  fileName: "padron-revert-carto-padron-20261030-120000.sql.gz",
  bytes: 1,
  counts: { updated: 0, paired: 0, inserted: CLASSIFIED_NEW, addressMasterRows: 0 },
};

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

const OPTIONS: ActualizarPadronOptions = { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: true, linkAddressMaster: false, pairChoices: [] };

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

const REPORT_ROW = {
  rowsRead: 5,
  repaired: 0,
  skipped: 0,
  collidingKeys: 0,
  byReason: [],
  byDepartment: [],
  byLocality: [],
  samples: [],
  collidingKeyList: [],
  byLocalityAndReason: [],
};

const READABLE_SCAN_ROWS: ReferenceScanRow[] = [{ schema: "carto", table: "access_point", readable: true }];

const classificationRowOf = (removed = 0): Record<string, unknown> => ({
  new: CLASSIFIED_NEW,
  removed,
  unchanged: 1,
  within_tolerance: 0,
  changed: 0,
  ambiguous: 0,
  missing: 0,
  updates: 0,
  missing_samples: [],
  ambiguous_samples: [],
  geometry_changes: [],
});

const HAS_TABLE_PRIVILEGE_PATTERN = /has_table_privilege/i;

/** The session answers the exact statements the stage builds; the apply reports the given insert count. Statements it
    does not know answer no rows. AP-5's has_table_privilege(..., 'DELETE') preflight check matches by pattern, not by
    exact text (its bound parameters differ from every other mocked statement), and is granted unless the test says
    otherwise. */
interface SessionOptions {
  deletePrivilegeGranted?: boolean;
  scanRows?: ReferenceScanRow[];
  removed?: number;
  deleted?: number;
  surviving?: number;
}

function sessionOf(
  appliedInserted: number,
  { deletePrivilegeGranted = true, scanRows = READABLE_SCAN_ROWS, removed = 0, deleted = removed, surviving = removed }: SessionOptions = {}
): { session: RunSession; log: string[] } {
  const log: string[] = [];
  const scan = referenceScanOf(scanRows);
  const applyAnswer = [{ inserted: appliedInserted, updated: 0, inserted_list: [] }];
  const answers = new Map<string, Array<Record<string, unknown>>>([
    [buildReportSql(LAYOUTS), [REPORT_ROW]],
    [referenceTablesScanSql("carto", "padron"), scanRows.map((row) => ({ ...row }))],
    [buildPadronClassifySql(LAYOUTS, OPTIONS, scan, { report: true }), [classificationRowOf(removed)]],
    [buildPadronClassifySql(LAYOUTS, OPTIONS, scan, { report: false, persistDeletable: true }), [classificationRowOf(removed)]],
    [buildPadronDeleteSql(LAYOUTS, scan.tables), [{ surviving, deleted, revert_rows: deleted, removed_list: [] }]],
    [buildPadronApplySql(LAYOUTS, OPTIONS), applyAnswer],
    [buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }), applyAnswer],
  ]);
  const session: RunSession = {
    async query(sql: string) {
      log.push(sql);
      await Promise.resolve();
      if (HAS_TABLE_PRIVILEGE_PATTERN.test(sql)) return { rows: [{ has_privilege: deletePrivilegeGranted }] };
      return { rows: answers.get(sql) ?? [] };
    },
    async close() {},
  };
  return { session, log };
}

function depsOf(session: RunSession): RunDeps {
  return { openSession: vi.fn(async () => session), now: () => 0 };
}

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

beforeEach(async () => {
  tempRoot.directory = await mkdtemp(path.join(tmpdir(), "gis-actualizar-run-"));
});

afterEach(async () => {
  await rm(tempRoot.directory, { recursive: true, force: true });
});

/** The analysis of the same parameters, run on its own session, so the real run that follows starts with a clean log. */
async function analysisPlanIdOf(): Promise<string> {
  const { session } = sessionOf(CLASSIFIED_NEW);
  const result = await runActualizarPadron(PARAMS_OF({ dryRun: true, confirm: false }), depsOf(session));
  expect(result.planId).toMatch(PLAN_ID_PATTERN);
  return result.planId as string;
}

describe("runActualizarPadron dry run (AP-17, AP-19, AP-88)", () => {
  it("should run READ ONLY, never apply, and end with ROLLBACK and never COMMIT when the run is a dry run", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW);
    const params = PARAMS_OF({ dryRun: true, confirm: false });

    const result = await runActualizarPadron(params, depsOf(session));

    expect(log).toContain(BEGIN_READ_ONLY_SQL);
    expect(log).not.toContain(BEGIN_SQL);
    expect(log).not.toContain(buildPadronApplySql(LAYOUTS, OPTIONS));
    expect(log).not.toContain(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }));
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
    expect(result.dryRun).toBe(true);
    expect(result.targetModified).toBe(false);
    expect(result.planId).toMatch(PLAN_ID_PATTERN);
  });
});

describe("runActualizarPadron DELETE privilege preflight (AP-5, AP-106)", () => {
  it("should refuse before BEGIN, open no transaction and write nothing when the connecting role has no DELETE on the destination", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW, { deletePrivilegeGranted: false });
    const params = PARAMS_OF({ dryRun: true, confirm: false });

    const failure = await failureOf(runActualizarPadron(params, depsOf(session)));

    expect(failure.message).toMatch(/No tiene privilegio DELETE sobre la tabla carto\.padron/);
    expect(log).not.toContain(BEGIN_SQL);
    expect(log).not.toContain(BEGIN_READ_ONLY_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });
});

describe("runActualizarPadron count check (AP-48)", () => {
  it("should ROLLBACK, never COMMIT, and throw when the inserted rows differ from the NEW count", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW - 1);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOf(session)));

    expect(failure.message).toMatch(/Los padrones insertados \(1\) no coinciden con los nuevos del análisis \(2\)/);
    expect(log).toContain(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });
});

describe("runActualizarPadron revert backup failure (AP-68)", () => {
  it("should ROLLBACK, never COMMIT, and throw the backup message when the revert writer rejects", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW);
    vi.mocked(writeRevertBackup).mockRejectedValueOnce(new Error(REVERT_BACKUP_FAILURE));

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOf(session)));

    expect(failure.message).toMatch(/No se pudo generar el respaldo para revertir/);
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });
});

describe("runActualizarPadron automatic removal (AP-102, AP-106, AP-107)", () => {
  const CREATE_TEMP_SQL = buildCreateDeleteIdsTableSql();
  const deleteSqlOf = (rows: ReferenceScanRow[] = READABLE_SCAN_ROWS): string => buildPadronDeleteSql(LAYOUTS, referenceScanOf(rows).tables);
  const persistClassifyOf = (rows: ReferenceScanRow[] = READABLE_SCAN_ROWS): string =>
    buildPadronClassifySql(LAYOUTS, OPTIONS, referenceScanOf(rows), { report: false, persistDeletable: true });

  it("should create the temp table, classify into it, apply, delete and analyze, in that order, in a real run", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW, { removed: 2 });

    const result = await runActualizarPadron(PARAMS_OF({ planId }), depsOf(session));

    const order = [
      log.indexOf(CREATE_TEMP_SQL),
      log.indexOf(persistClassifyOf()),
      log.indexOf(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true })),
      log.indexOf(deleteSqlOf()),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(log.some((sql) => sql.startsWith("ANALYZE") && log.indexOf(sql) > order[3])).toBe(true);
    expect(log).toContain(COMMIT_SQL);
    expect(result.target.removed).toBe(2);
  });

  it("should scan the reference tables once in the analysis and once in the real run, both before the classify", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW);
    const scanSql = referenceTablesScanSql("carto", "padron");

    await runActualizarPadron(PARAMS_OF({ planId }), depsOf(session));

    expect(log.filter((sql) => sql === scanSql)).toHaveLength(1);
    expect(log.indexOf(scanSql)).toBeLessThan(log.indexOf(persistClassifyOf()));
  });

  it("should never create the temp table nor delete in an analysis, and report the planned removed count", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW, { removed: 3 });

    const result = await runActualizarPadron(PARAMS_OF({ dryRun: true, confirm: false }), depsOf(session));

    expect(log).not.toContain(CREATE_TEMP_SQL);
    expect(log).not.toContain(deleteSqlOf());
    expect(log.some((sql) => /\bDELETE FROM\b/.test(sql))).toBe(false);
    expect(result.target.removed).toBe(3);
    expect(result.targetModified).toBe(false);
  });

  it("should report the deleted count of the delete statement as removed in the real run result", async () => {
    const planId = await analysisPlanIdOf();
    const { session } = sessionOf(CLASSIFIED_NEW, { removed: 3, deleted: 2, surviving: 2 });

    const result = await runActualizarPadron(PARAMS_OF({ planId }), depsOf(session));

    expect(result.target.removed).toBe(2);
    expect(result.target.removalsSkipped?.byReason.NOW_REFERENCED).toBe(1);
  });

  it("should ROLLBACK, never COMMIT, and throw when the deleted rows differ from the surviving candidates", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW, { removed: 3, deleted: 2, surviving: 3 });

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOf(session)));

    expect(failure.message).toMatch(/Los padrones eliminados \(2\) no coinciden con los que seguían siendo eliminables \(3\)/);
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });

  it("should delete nothing and report the blocked reason when the scan finds no reference table", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW, { scanRows: [] });
    const result = await runActualizarPadron(PARAMS_OF({ planId }), depsOf(session));

    expect(log).toContain(COMMIT_SQL);
    expect(result.target.removed).toBe(0);
    expect(result.target.removalBlockedReason).toBe("No se encontraron tablas que referencien padrones: no se eliminan padrones faltantes.");
    expect(result.warnings).toContain(result.target.removalBlockedReason);
  });

  it("should delete nothing and name the table in the warning when the role cannot read a reference table", async () => {
    const rows: ReferenceScanRow[] = [
      { schema: "carto", table: "access_point", readable: true },
      { schema: "carto", table: "secret_refs", readable: false },
    ];
    const { session } = sessionOf(CLASSIFIED_NEW, { scanRows: rows });

    const result = await runActualizarPadron(PARAMS_OF({ dryRun: true, confirm: false }), depsOf(session));

    expect(result.target.removed).toBe(0);
    expect(result.target.removalBlockedReason).toContain("carto.secret_refs");
    expect(result.warnings.some((warning) => warning.includes("carto.secret_refs"))).toBe(true);
  });
});
