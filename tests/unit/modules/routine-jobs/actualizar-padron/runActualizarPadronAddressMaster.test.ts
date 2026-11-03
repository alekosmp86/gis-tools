import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildReportSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportSql";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import { referenceScanOf } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { referenceTablesScanSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { buildMaxAddressMasterIdSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { runActualizarPadron } from "@/modules/routine-jobs/jobs/actualizar-padron/services/runActualizarPadron";
import type { ActualizarPadronOptions, ActualizarPadronParams, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import {
  buildAddressMasterApplySql,
  buildAddressMasterClassifySql,
  buildAddressMasterRemainingSql,
} from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSql";
import { PADRON_SUBJECT_SPEC } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

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

vi.mock("@/modules/routine-jobs/jobs/shared/addressMasterLinkPreflight", () => ({
  addressMasterIssuesOf: vi.fn(async () => []),
}));

/* The revert writer touches the filesystem; these tests replace it so no file is written under the OS temp directory. */
vi.mock("@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup")>()),
  writeRevertBackup: vi.fn(async () => undefined),
}));

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const BEGIN_READ_ONLY_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const PASSWORD = "Actualizar-pw!7";
const ADDRESS_MASTER_TABLE = "addresses_master";
const CLASSIFIED_NEW = 2;
const PLAN_ID_PATTERN = /^[0-9a-f]{32}$/;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", [...Object.values(DESTINATION_COLUMN), "id_address_master"]),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const ADDRESS_MASTER: WritableTargetLayout = {
  ...tableOf("carto", ADDRESS_MASTER_TABLE, ["addresses_master_id", "urn", "latitud", "longitud"]),
  srid: 0,
  idColumn: "addresses_master_id",
  idSequence: "carto.addresses_master_addresses_master_id_seq",
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "loc", Object.values(LOCALITY_COLUMN)),
  addressMaster: ADDRESS_MASTER,
};

const OPTIONS: ActualizarPadronOptions = { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: true, linkAddressMaster: true, pairChoices: [] };

const ADDRESS_LAYOUTS = { subject: TARGET, addressMaster: ADDRESS_MASTER };

/* Two padrones are unlinked before the pass: one NEW, one already had a record; none ambiguous. */
const ADDRESS_CLASSIFICATION_ROW: Record<string, unknown> = {
  without_address_master: 2,
  to_create: 1,
  already_had_record: 1,
  ambiguous: 0,
  ambiguous_samples: [],
};

const ADDRESS_REMAINING_ROW: Record<string, unknown> = { remaining: 0 };

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
  addressMasterTable: ADDRESS_MASTER_TABLE,
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

const SCAN_ROWS = [{ schema: "carto", table: "access_point", readable: true }];
const SCAN = referenceScanOf(SCAN_ROWS);

/** The session answers the statements of the padron stage and of the address master pass; the address master apply reports the given counts. */
function sessionOf(
  appliedAddressMaster: Record<string, unknown>,
  maxIdAnswer: Array<Record<string, unknown>> = [{ max_id: 0 }]
): { session: RunSession; log: string[] } {
  const log: string[] = [];
  const applyAnswer = [{ inserted: CLASSIFIED_NEW, updated: 0, inserted_list: [] }];
  const answers = new Map<string, Array<Record<string, unknown>>>([
    [buildReportSql(LAYOUTS), [REPORT_ROW]],
    [referenceTablesScanSql("carto", "padron"), SCAN_ROWS.map((row) => ({ ...row }))],
    [buildPadronClassifySql(LAYOUTS, OPTIONS, SCAN, { report: true }), [classificationRowOf()]],
    [buildPadronClassifySql(LAYOUTS, OPTIONS, SCAN, { report: false, persistDeletable: true }), [classificationRowOf()]],
    [buildPadronDeleteSql(LAYOUTS, SCAN.tables), [{ surviving: 0, deleted: 0, revert_rows: 0, removed_list: [] }]],
    [buildPadronApplySql(LAYOUTS, OPTIONS), applyAnswer],
    [buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }), applyAnswer],
    [buildAddressMasterClassifySql(ADDRESS_LAYOUTS, PADRON_SUBJECT_SPEC), [ADDRESS_CLASSIFICATION_ROW]],
    [buildAddressMasterApplySql(ADDRESS_LAYOUTS, PADRON_SUBJECT_SPEC), [appliedAddressMaster]],
    [buildAddressMasterRemainingSql(ADDRESS_LAYOUTS, PADRON_SUBJECT_SPEC), [ADDRESS_REMAINING_ROW]],
    [buildMaxAddressMasterIdSql(ADDRESS_MASTER), maxIdAnswer],
  ]);
  const session: RunSession = {
    async query(sql: string) {
      log.push(sql);
      await Promise.resolve();
      const known = answers.get(sql);
      if (known !== undefined) return { rows: known };
      if (/has_table_privilege/i.test(sql)) return { rows: [{ has_privilege: true }] };
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
  tempRoot.directory = await mkdtemp(path.join(tmpdir(), "gis-actualizar-address-"));
});

afterEach(async () => {
  await rm(tempRoot.directory, { recursive: true, force: true });
});

/** The analysis of the same parameters, run on its own session, so the real run that follows starts with a clean log. */
async function analysisPlanIdOf(): Promise<string> {
  const { session } = sessionOf({ created: 1, linked: 2, linked_list: [] });
  const result = await runActualizarPadron(PARAMS_OF({ dryRun: true, confirm: false }), depsOf(session));
  expect(result.planId).toMatch(PLAN_ID_PATTERN);
  return result.planId as string;
}

describe("runActualizarPadron address master analysis (AP-56, AP-88)", () => {
  it("should classify the address master links READ ONLY, never run the address master apply, and end with ROLLBACK when the run is a dry run", async () => {
    const { session, log } = sessionOf({ created: 1, linked: 2, linked_list: [] });
    const params = PARAMS_OF({ dryRun: true, confirm: false });

    const result = await runActualizarPadron(params, depsOf(session));

    const classifyIndex = log.indexOf(buildAddressMasterClassifySql(ADDRESS_LAYOUTS, PADRON_SUBJECT_SPEC));
    const beginIndex = log.indexOf(BEGIN_READ_ONLY_SQL);
    expect(beginIndex).toBeGreaterThan(-1);
    expect(beginIndex).toBeLessThan(classifyIndex);
    expect(log).not.toContain(BEGIN_SQL);
    expect(log).not.toContain(buildAddressMasterApplySql(ADDRESS_LAYOUTS, PADRON_SUBJECT_SPEC));
    expect(log).not.toContain(buildMaxAddressMasterIdSql(ADDRESS_MASTER));
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
    expect(result.targetModified).toBe(false);
    expect(result.addressMaster?.counts.linked).toBe(2);
    expect(result.planId).toMatch(PLAN_ID_PATTERN);
  });
});

describe("runActualizarPadron address master count check (AP-55)", () => {
  it.each([
    {
      caseName: "created",
      applied: { created: 0, linked: 2, linked_list: [] },
      message: /Los registros de dirección maestra creados para padrones \(0\) no coinciden con los esperados \(1\)/,
    },
    {
      caseName: "linked",
      applied: { created: 1, linked: 1, linked_list: [] },
      message: /Los padrones enlazados \(1\) no coinciden con los esperados \(2\)/,
    },
  ])("should ROLLBACK, never COMMIT, and throw when the address master $caseName count differs from the classification", async ({ applied, message }) => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(applied);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOf(session)));

    expect(failure.message).toMatch(message);
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });
});

describe("runActualizarPadron revert backup fail closed on the max address master id (AP-70a, AP-68)", () => {
  it("should ROLLBACK, never COMMIT, and throw the backup message before the link pass when the max id cannot be read", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf({ created: 1, linked: 2, linked_list: [] }, []);

    const failure = await failureOf(runActualizarPadron(PARAMS_OF({ planId }), depsOf(session)));

    expect(failure.message).toMatch(/No se pudo generar el respaldo para revertir: No se pudo leer el máximo id/);
    expect(log).not.toContain(buildAddressMasterApplySql(ADDRESS_LAYOUTS, PADRON_SUBJECT_SPEC));
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
  });
});

describe("runActualizarPadron deletion before the address master pass (AP-106)", () => {
  it("should run the delete statement after the padron apply and before the address master apply in a real run", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf({ created: 1, linked: 2, linked_list: [] });

    await runActualizarPadron(PARAMS_OF({ planId }), depsOf(session));

    const applyIndex = log.indexOf(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }));
    const deleteIndex = log.indexOf(buildPadronDeleteSql(LAYOUTS, SCAN.tables));
    const addressApplyIndex = log.indexOf(buildAddressMasterApplySql(ADDRESS_LAYOUTS, PADRON_SUBJECT_SPEC));
    expect(applyIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(applyIndex);
    expect(addressApplyIndex).toBeGreaterThan(deleteIndex);
  });
});
