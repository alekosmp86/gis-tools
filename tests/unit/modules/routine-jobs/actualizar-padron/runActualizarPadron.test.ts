import { describe, expect, it, vi } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { buildReportSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportSql";
import { runActualizarPadron } from "@/modules/routine-jobs/jobs/actualizar-padron/services/runActualizarPadron";
import type { ActualizarPadronOptions, ActualizarPadronParams, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { writeRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup";

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
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const PASSWORD = "Actualizar-pw!7";
const CLASSIFIED_NEW = 2;
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

const OPTIONS: ActualizarPadronOptions = { tolerance: 1, updateGeometries: true, linkAddressMaster: false };

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

const classificationRowOf = (): Record<string, unknown> => ({
  new: CLASSIFIED_NEW,
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

/** The session answers the exact statements the stage builds; the apply reports the given insert count. Statements it does not know answer no rows. */
function sessionOf(appliedInserted: number): { session: RunSession; log: string[] } {
  const log: string[] = [];
  const applyAnswer = [{ inserted: appliedInserted, updated: 0, inserted_list: [] }];
  const answers = new Map<string, Array<Record<string, unknown>>>([
    [buildReportSql(LAYOUTS), [REPORT_ROW]],
    [buildPadronClassifySql(LAYOUTS, OPTIONS), [classificationRowOf()]],
    [buildPadronApplySql(LAYOUTS, OPTIONS), applyAnswer],
    [buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }), applyAnswer],
  ]);
  const session: RunSession = {
    async query(sql: string) {
      log.push(sql);
      await Promise.resolve();
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

describe("runActualizarPadron dry run (AP-17, AP-19)", () => {
  it("should end with ROLLBACK and never COMMIT when the run is a dry run", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW);
    const params = PARAMS_OF({ dryRun: true, confirm: false });

    const result = await runActualizarPadron(params, depsOf(session));

    expect(log).toContain(BEGIN_SQL);
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
    expect(result.dryRun).toBe(true);
    expect(result.targetModified).toBe(false);
  });
});

describe("runActualizarPadron count check (AP-48)", () => {
  it("should ROLLBACK, never COMMIT, and throw when the inserted rows differ from the NEW count", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW - 1);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF(), depsOf(session)));

    expect(failure.message).toMatch(/Los padrones insertados \(1\) no coinciden con los nuevos del análisis \(2\)/);
    expect(log).toContain(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });
});

describe("runActualizarPadron revert backup failure (AP-68)", () => {
  it("should ROLLBACK, never COMMIT, and throw the backup message when the revert writer rejects", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW);
    vi.mocked(writeRevertBackup).mockRejectedValueOnce(new Error(REVERT_BACKUP_FAILURE));

    const failure = await failureOf(runActualizarPadron(PARAMS_OF(), depsOf(session)));

    expect(failure.message).toMatch(/No se pudo generar el respaldo para revertir/);
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });
});
