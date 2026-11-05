import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSequenceRepairSql } from "@/modules/routine-jobs/jobs/shared/transaction";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { buildPadronApplySql, buildPadronClassifySql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/targetSql";
import { buildReportSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportSql";
import { buildMaxAddressMasterIdSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import { buildPadronReassignSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignSql";
import { buildCreateInsertedIdsTableSql, buildCreateReassignIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignTables";
import { buildPadronReassignChangedSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignChangedSql";
import { buildPadronDeleteSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteSql";
import { buildCreateDeleteIdsTableSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/deleteIdsTable";
import { referenceScanOf, type ReferenceScanRow } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { referenceTablesScanSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { runActualizarPadron } from "@/modules/routine-jobs/jobs/actualizar-padron/services/runActualizarPadron";
import type { ActualizarPadronOptions, ActualizarPadronParams, PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { sequenceStateRows, type FakeSequenceState } from "../shared/sequenceStateFake";
import { writeRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup";

/* The plan file lives under os.tmpdir(): the default export is redirected to a fresh temp root per test. */
const tempRoot = vi.hoisted(() => ({ directory: "" }));
const activeLayouts = vi.hoisted(() => ({ current: undefined as unknown as PadronLayouts }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

vi.mock("@/modules/routine-jobs/jobs/actualizar-padron/services/resolveLayouts", () => ({
  resolvePadronLayouts: vi.fn(async () => activeLayouts.current),
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

const ADDRESS_MASTER: WritableTargetLayout = {
  ...tableOf("carto", "addresses_master", ["addresses_master_id", "urn", "latitud", "longitud"]),
  srid: 0,
  idColumn: "addresses_master_id",
  idSequence: "carto.addresses_master_addresses_master_id_seq",
  identityColumns: [],
  catalog: [],
};

const LAYOUTS_WITH_MASTER: PadronLayouts = {
  ...LAYOUTS,
  target: { ...TARGET, columns: { ...TARGET.columns, id_address_master: "id_address_master" } },
  addressMaster: ADDRESS_MASTER,
};

const OPTIONS: ActualizarPadronOptions = { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: true, repairSequences: true, linkAddressMaster: false, pairChoices: [] };

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

/** AP-114: the scan reads the reassign facts only when an address master table is defined. */
const scanOf = (rows: ReferenceScanRow[], layouts: PadronLayouts = LAYOUTS) =>
  referenceScanOf(rows, { reassignAllowed: layouts.addressMaster !== undefined });

const scanCatalogRowOf = (row: ReferenceScanRow): Record<string, unknown> => ({
  schema: row.schema,
  table: row.table,
  readable: row.readable,
  updatable: row.updatable,
  pk_columns: row.primaryKeyColumns,
  pk_column: row.primaryKeyColumn,
  geometry_columns: row.geometryColumns,
  geometry_column: row.geometryColumn,
  geometry_type: row.geometryType,
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
  layouts?: PadronLayouts;
  options?: ActualizarPadronOptions;
  classification?: Record<string, unknown>;
  reassignMoved?: { moved: number; byTable?: Record<string, number> };
  changedMoved?: { moved: number; selected?: number; ambiguous?: number; byTable?: Record<string, number> };
  masterDeleted?: number;
  sequenceStates?: readonly FakeSequenceState[];
}

function sessionOf(
  appliedInserted: number,
  {
    deletePrivilegeGranted = true,
    scanRows = READABLE_SCAN_ROWS,
    removed = 0,
    deleted = removed,
    surviving = removed,
    layouts = LAYOUTS,
    options = OPTIONS,
    classification = {},
    reassignMoved = { moved: 0 },
    changedMoved = { moved: 0 },
    masterDeleted = 0,
    sequenceStates = [],
  }: SessionOptions = {}
): { session: RunSession; log: string[] } {
  const log: string[] = [];
  const scan = scanOf(scanRows, layouts);
  const classified = { ...classificationRowOf(removed), ...classification };
  const reassignStored = Number(classification.subdivided_deleted ?? 0) > 0;
  const applyAnswer = [{ inserted: appliedInserted, updated: 0, inserted_list: [] }];
  const answers = new Map<string, Array<Record<string, unknown>>>([
    [buildReportSql(layouts), [REPORT_ROW]],
    [referenceTablesScanSql("carto", "padron"), scanRows.map((row) => scanCatalogRowOf(row))],
    [buildPadronClassifySql(layouts, options, scan, { report: true }), [classified]],
    [buildPadronClassifySql(layouts, options, scan, { report: false, persistDeletable: true }), [classified]],
    [
      buildPadronDeleteSql(layouts, scan.tables),
      [{ surviving, deleted, revert_rows: deleted, master_deleted: masterDeleted, removed_list: [] }],
    ],
    [
      buildPadronReassignSql(layouts, scan.tables),
      [{ moved: reassignMoved.moved, by_table: reassignMoved.byTable ?? {}, padrones: 1, revert_rows: reassignMoved.moved }],
    ],
    [
      buildPadronReassignChangedSql(layouts, scan.tables),
      [
        {
          moved: changedMoved.moved,
          selected: changedMoved.selected ?? changedMoved.moved,
          ambiguous: changedMoved.ambiguous ?? 0,
          by_table: changedMoved.byTable ?? {},
          revert_rows: changedMoved.moved,
        },
      ],
    ],
    [buildPadronApplySql(layouts, options), applyAnswer],
    [buildPadronApplySql(layouts, options, { captureRevert: true, storeInsertedIds: reassignStored }), applyAnswer],
    ...(layouts.addressMaster === undefined ? [] : [[buildMaxAddressMasterIdSql(layouts.addressMaster), [{ max_id: 0 }]] as [string, Array<Record<string, unknown>>]]),
  ]);
  activeLayouts.current = layouts;
  const session: RunSession = {
    async query(sql: string, params?: unknown[]) {
      log.push(sql);
      await Promise.resolve();
      const known = answers.get(sql);
      if (known !== undefined) return { rows: known };
      const state = sequenceStateRows(sql, params, sequenceStates);
      if (state !== undefined) return { rows: state };
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
async function analysisPlanIdOf(sessionOptions: SessionOptions = {}, applied = CLASSIFIED_NEW): Promise<string> {
  const { session } = sessionOf(applied, sessionOptions);
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
  const deleteSqlOf = (rows: ReferenceScanRow[] = READABLE_SCAN_ROWS): string => buildPadronDeleteSql(LAYOUTS, scanOf(rows).tables);
  const persistClassifyOf = (rows: ReferenceScanRow[] = READABLE_SCAN_ROWS): string =>
    buildPadronClassifySql(LAYOUTS, OPTIONS, scanOf(rows), { report: false, persistDeletable: true });

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

describe("runActualizarPadron reassignment of subdivided padrones (AP-109 to AP-115)", () => {
  const REASSIGNABLE_ROWS: ReferenceScanRow[] = [
    {
      schema: "carto",
      table: "access_point",
      readable: true,
      updatable: true,
      primaryKeyColumns: 1,
      primaryKeyColumn: "gid",
      geometryColumns: 1,
      geometryColumn: "geom",
      geometryType: "geometry",
    },
  ];
  const MASTER_OPTIONS: ActualizarPadronOptions = { ...OPTIONS, linkAddressMaster: true };
  const MASTER_PARAMS = (overrides: Partial<ActualizarPadronParams> = {}): ActualizarPadronParams => PARAMS_OF({ addressMasterTable: "addresses_master", options: MASTER_OPTIONS, ...overrides });
  const SUBDIVIDED = { subdivided_deleted: 1, reassigned: 4, reassigned_by_table: { "carto.access_point": 4 } };
  const sessionWithReassign = (overrides: SessionOptions = {}) =>
    sessionOf(CLASSIFIED_NEW, {
      layouts: LAYOUTS_WITH_MASTER,
      options: MASTER_OPTIONS,
      scanRows: REASSIGNABLE_ROWS,
      removed: 2,
      classification: SUBDIVIDED,
      reassignMoved: { moved: 4, byTable: { "carto.access_point": 4 } },
      masterDeleted: 2,
      ...overrides,
    });
  const scan = () => scanOf(REASSIGNABLE_ROWS, LAYOUTS_WITH_MASTER);
  const reassignSql = (): string => buildPadronReassignSql(LAYOUTS_WITH_MASTER, scan().tables);
  const planIdWithMaster = async (): Promise<string> => {
    const { session } = sessionWithReassign();
    const result = await runActualizarPadron(MASTER_PARAMS({ dryRun: true, confirm: false }), depsOf(session));
    return result.planId as string;
  };

  it("should create both id temp tables before the classify, the inserted-ids one before the apply, then reassign between the apply and the delete", async () => {
    const planId = await planIdWithMaster();
    const { session, log } = sessionWithReassign();

    await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session));

    const persistClassify = buildPadronClassifySql(LAYOUTS_WITH_MASTER, MASTER_OPTIONS, scan(), { report: false, persistDeletable: true });
    const apply = buildPadronApplySql(LAYOUTS_WITH_MASTER, MASTER_OPTIONS, { captureRevert: true, storeInsertedIds: true });
    const order = [
      log.indexOf(buildCreateReassignIdsTableSql()),
      log.indexOf(persistClassify),
      log.indexOf(buildCreateInsertedIdsTableSql()),
      log.indexOf(apply),
      log.indexOf(reassignSql()),
      log.indexOf(buildPadronDeleteSql(LAYOUTS_WITH_MASTER, scan().tables)),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(log).toContain(COMMIT_SQL);
  });

  it("should report the rows the reassign statement moved, per table, and pass the moved and master counts to the revert backup", async () => {
    const planId = await planIdWithMaster();
    const { session } = sessionWithReassign();

    const result = await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session));

    expect(result.target.reassigned).toBe(4);
    expect(result.target.reassignedByTable).toEqual({ "carto.access_point": 4 });
    expect(result.target.removed).toBe(2);
    expect(result.warnings).toContain("4 direcciones de padrones subdivididos pasaron a la parte más cercana.");
    const request = vi.mocked(writeRevertBackup).mock.calls.at(-1)?.[1];
    expect(request?.expected).toMatchObject({ reassigned: 4, masterDeleted: 2, removed: 2 });
  });

  it("should ROLLBACK, never COMMIT, and throw when the rows moved differ from the rows the classification counted", async () => {
    const planId = await planIdWithMaster();
    const { session, log } = sessionWithReassign({ reassignMoved: { moved: 3 } });

    const failure = await failureOf(runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session)));

    expect(failure.message).toMatch(/Las direcciones reasignadas \(3\) no coinciden con las del análisis \(4\) en carto\.padron/);
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
    expect(log).not.toContain(buildPadronDeleteSql(LAYOUTS_WITH_MASTER, scan().tables));
  });

  it("should neither store inserted ids nor run the reassign statement when no subdivided padron is to be reassigned", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW, { removed: 2 });

    const result = await runActualizarPadron(PARAMS_OF({ planId }), depsOf(session));

    expect(log).not.toContain(buildCreateInsertedIdsTableSql());
    expect(log.some((sql) => sql.includes("padron_inserted_ids"))).toBe(false);
    expect(log.some((sql) => sql.includes("reassign_receivers"))).toBe(false);
    expect(result.target.reassigned).toBe(0);
  });

  it("should plan the reassigned rows in an analysis without creating a temp table or running the reassign statement", async () => {
    const { session, log } = sessionWithReassign();

    const result = await runActualizarPadron(MASTER_PARAMS({ dryRun: true, confirm: false }), depsOf(session));

    expect(result.target.reassigned).toBe(4);
    expect(result.target.reassignedByTable).toEqual({ "carto.access_point": 4 });
    expect(log).not.toContain(reassignSql());
    expect(log).not.toContain(buildCreateReassignIdsTableSql());
    expect(log).not.toContain(buildCreateInsertedIdsTableSql());
    expect(result.warnings).toContain("4 direcciones de padrones subdivididos pasarán a la parte más cercana.");
  });

  it("should list the reassign step in a real run's planned steps only", async () => {
    const planId = await planIdWithMaster();
    const { session } = sessionWithReassign();

    const result = await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session));
    const analysis = await runActualizarPadron(MASTER_PARAMS({ dryRun: true, confirm: false }), depsOf(sessionWithReassign().session));

    expect(JSON.stringify(result)).toContain("Reasignar direcciones de padrones subdivididos");
    expect(JSON.stringify(analysis)).not.toContain("Reasignar direcciones de padrones subdivididos");
  });
});

describe("runActualizarPadron reassignment of changed padrones (AP-121 to AP-124)", () => {
  const REASSIGNABLE_ROWS: ReferenceScanRow[] = [
    { schema: "carto", table: "access_point", readable: true, updatable: true, primaryKeyColumns: 1, primaryKeyColumn: "gid", geometryColumns: 1, geometryColumn: "geom", geometryType: "geometry" },
  ];
  const MASTER_OPTIONS: ActualizarPadronOptions = { ...OPTIONS, linkAddressMaster: true };
  const MASTER_PARAMS = (overrides: Partial<ActualizarPadronParams> = {}): ActualizarPadronParams =>
    PARAMS_OF({ addressMasterTable: "addresses_master", options: MASTER_OPTIONS, ...overrides });
  const CHANGED = { reassigned_changed: 3, reassigned_changed_ambiguous: 1, reassigned_changed_by_table: { "carto.access_point": 3 } };
  const sessionWithChanged = (overrides: SessionOptions = {}) =>
    sessionOf(CLASSIFIED_NEW, {
      layouts: LAYOUTS_WITH_MASTER,
      options: MASTER_OPTIONS,
      scanRows: REASSIGNABLE_ROWS,
      classification: CHANGED,
      changedMoved: { moved: 3, ambiguous: 1, byTable: { "carto.access_point": 3 } },
      ...overrides,
    });
  const scan = () => scanOf(REASSIGNABLE_ROWS, LAYOUTS_WITH_MASTER);
  const changedSql = (): string => buildPadronReassignChangedSql(LAYOUTS_WITH_MASTER, scan().tables);
  const planIdWithMaster = async (): Promise<string> => {
    const { session } = sessionWithChanged();
    const result = await runActualizarPadron(MASTER_PARAMS({ dryRun: true, confirm: false }), depsOf(session));
    return result.planId as string;
  };

  it("should run the changed-padron statement after the subdivided reassignment and before the delete", async () => {
    const planId = await planIdWithMaster();
    const { session, log } = sessionWithChanged();

    await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session));

    const order = [
      log.indexOf(buildPadronApplySql(LAYOUTS_WITH_MASTER, MASTER_OPTIONS, { captureRevert: true, storeInsertedIds: false })),
      log.indexOf(changedSql()),
      log.indexOf(buildPadronDeleteSql(LAYOUTS_WITH_MASTER, scan().tables)),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(log).toContain(COMMIT_SQL);
  });

  it("should run the changed-padron statement right after the subdivided reassign statement when both run", async () => {
    const planId = await planIdWithMaster();
    const { session, log } = sessionWithChanged({
      classification: { ...CHANGED, subdivided_deleted: 1, reassigned: 4, reassigned_by_table: { "carto.access_point": 4 } },
      removed: 2,
      reassignMoved: { moved: 4, byTable: { "carto.access_point": 4 } },
    });

    await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session));

    const reassign = log.indexOf(buildPadronReassignSql(LAYOUTS_WITH_MASTER, scan().tables));
    expect(reassign).toBeGreaterThan(-1);
    expect(log.indexOf(changedSql())).toBeGreaterThan(reassign);
    expect(log.indexOf(buildPadronDeleteSql(LAYOUTS_WITH_MASTER, scan().tables))).toBeGreaterThan(log.indexOf(changedSql()));
  });

  it("should report the rows the statement reassigned, with the ambiguous ones and per table, and a warning in the past", async () => {
    const planId = await planIdWithMaster();
    const { session } = sessionWithChanged();

    const result = await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session));

    expect(result.target.reassignedChanged).toBe(3);
    expect(result.target.reassignedChangedAmbiguous).toBe(1);
    expect(result.target.reassignedChangedByTable).toEqual({ "carto.access_point": 3 });
    expect(result.warnings).toContain("3 direcciones cambiaron de padrón (id_padron) porque su padrón cambió de forma.");
  });

  it("should add the changed-padron rows to the subdivided ones in the expected reassigned count of the revert backup", async () => {
    const planId = await planIdWithMaster();
    const { session } = sessionWithChanged({
      classification: { ...CHANGED, subdivided_deleted: 1, reassigned: 4, reassigned_by_table: { "carto.access_point": 4 } },
      removed: 2,
      reassignMoved: { moved: 4, byTable: { "carto.access_point": 4 } },
    });

    await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session));

    const request = vi.mocked(writeRevertBackup).mock.calls.at(-1)?.[1];
    expect(request?.expected.reassigned).toBe(7);
  });

  it("should ROLLBACK, never COMMIT, and not delete when the rows updated differ from the rows selected", async () => {
    const planId = await planIdWithMaster();
    const { session, log } = sessionWithChanged({ changedMoved: { moved: 2, selected: 3 } });

    const failure = await failureOf(runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(session)));

    expect(failure.message).toMatch(/Las direcciones reasignadas por cambio de forma de su padrón \(2\) no coinciden con las seleccionadas \(3\) en carto\.padron/);
    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
    expect(log).not.toContain(buildPadronDeleteSql(LAYOUTS_WITH_MASTER, scan().tables));
  });

  it("should not run the statement when no referencing table can be reassigned", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW);

    const result = await runActualizarPadron(PARAMS_OF({ planId }), depsOf(session));

    expect(log.some((sql) => sql.includes("reassign_changed"))).toBe(false);
    expect(result.target.reassignedChanged).toBe(0);
  });

  it("should plan the changed-padron rows in an analysis without running the statement", async () => {
    const { session, log } = sessionWithChanged();

    const result = await runActualizarPadron(MASTER_PARAMS({ dryRun: true, confirm: false }), depsOf(session));

    expect(result.target.reassignedChanged).toBe(3);
    expect(result.target.reassignedChangedAmbiguous).toBe(1);
    expect(log).not.toContain(changedSql());
    expect(result.warnings).toContain("3 direcciones cambiarán de padrón (id_padron) porque su padrón cambió de forma.");
  });

  it("should list the changed-padron step in a real run only", async () => {
    const planId = await planIdWithMaster();
    const result = await runActualizarPadron(MASTER_PARAMS({ planId }), depsOf(sessionWithChanged().session));
    const analysis = await runActualizarPadron(MASTER_PARAMS({ dryRun: true, confirm: false }), depsOf(sessionWithChanged().session));

    expect(JSON.stringify(result)).toContain("Reasignar direcciones de padrones modificados");
    expect(JSON.stringify(analysis)).not.toContain("Reasignar direcciones de padrones modificados");
  });
});

describe("runActualizarPadron sequence repair option (SQ-2, SQ-3)", () => {
  const withRepair = (repairSequences: boolean): ActualizarPadronParams => PARAMS_OF({ options: { ...OPTIONS, repairSequences } });

  it("should issue the target setval before the apply when SQ-2 repairSequences is on", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW);

    await runActualizarPadron({ ...withRepair(true), planId }, depsOf(session));

    const repairAt = log.indexOf(buildSequenceRepairSql(TARGET));
    expect(repairAt).toBeGreaterThan(-1);
    expect(repairAt).toBeLessThan(log.indexOf(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true })));
    expect(log).toContain(COMMIT_SQL);
  });

  it("should issue no setval and still COMMIT when SQ-3 repairSequences is off", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW);

    const result = await runActualizarPadron({ ...withRepair(false), planId }, depsOf(session));

    expect(log.some((sql) => sql.includes("setval"))).toBe(false);
    expect(log).toContain(buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true }));
    expect(log).toContain(COMMIT_SQL);
    expect(result.targetModified).toBe(true);
  });
});

describe("runActualizarPadron padron sequence state check (SQ-5, SQ-7)", () => {
  const off = (overrides: Partial<ActualizarPadronParams> = {}): ActualizarPadronParams =>
    PARAMS_OF({ options: { ...OPTIONS, repairSequences: false }, ...overrides });
  const BEHIND: FakeSequenceState = { table: "padron", sequence: "carto.padron_id_seq", lastValue: 5, maxId: 10 };
  const isStateSql = (sql: string): boolean => !sql.includes("setval") && (sql.includes("pg_sequence_last_value") || sql.startsWith("SELECT max("));
  const APPLY_SQL = buildPadronApplySql(LAYOUTS, OPTIONS, { captureRevert: true });

  it("should complete the analysis with the warning, READ ONLY and ROLLBACK, when SQ-5 the sequence is behind and the run inserts", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW, { sequenceStates: [BEHIND] });

    const result = await runActualizarPadron(off({ dryRun: true, confirm: false }), depsOf(session));

    expect(result.warnings.some((warning) => warning.includes("carto.padron_id_seq está en 6"))).toBe(true);
    expect(result.planId).toMatch(PLAN_ID_PATTERN);
    expect(log).not.toContain(APPLY_SQL);
    expect(log.at(-1)).toBe(ROLLBACK_SQL);
  });

  it("should throw at persist time before the repair and the apply, ROLLBACK and never COMMIT, when SQ-5 the sequence is behind", async () => {
    const planId = await analysisPlanIdOf({ sequenceStates: [BEHIND] });
    const { session, log } = sessionOf(CLASSIFIED_NEW, { sequenceStates: [BEHIND] });

    const failure = await failureOf(runActualizarPadron(off({ planId }), depsOf(session)));

    expect(failure.message).toContain("carto.padron_id_seq está en 6");
    expect(failure.message).toContain("carto.padron");
    expect(failure.message).toContain("Ajustar secuencias de destino");
    expect(log).not.toContain(APPLY_SQL);
    expect(log.some((sql) => sql.includes("setval"))).toBe(false);
    expect(log).not.toContain(COMMIT_SQL);
    expect(log.at(-1)).toBe(ROLLBACK_SQL);
  });

  it("should check at persist time, after the plan validation, so a stale plan is refused without reading the sequence", async () => {
    const planId = await analysisPlanIdOf();
    const { session, log } = sessionOf(CLASSIFIED_NEW, { sequenceStates: [BEHIND], classification: { new: CLASSIFIED_NEW + 1 } });

    const failure = await failureOf(runActualizarPadron(off({ planId }), depsOf(session)));

    expect(failure.message).not.toContain("está en 6");
    expect(log.some(isStateSql)).toBe(false);
  });

  it("should never fail nor read the sequence when SQ-7 nothing is inserted even though the sequence is behind", async () => {
    const zeroNew = { classification: { new: 0 }, sequenceStates: [BEHIND] };
    const planId = await analysisPlanIdOf(zeroNew, 0);
    const { session, log } = sessionOf(0, zeroNew);

    const result = await runActualizarPadron(off({ planId }), depsOf(session));

    expect(log.some(isStateSql)).toBe(false);
    expect(log).toContain(COMMIT_SQL);
    expect(result.warnings.some((warning) => warning.includes("está en"))).toBe(false);
  });

  it("should not read the sequence state when the repair is on", async () => {
    const { session, log } = sessionOf(CLASSIFIED_NEW, { sequenceStates: [BEHIND] });

    await runActualizarPadron(PARAMS_OF({ dryRun: true, confirm: false }), depsOf(session));

    expect(log.some(isStateSql)).toBe(false);
  });

  it.each([true, false])("should not read the sequence state in the preflight, before BEGIN, dryRun=%s", async (dryRun) => {
    const planId = dryRun ? undefined : await analysisPlanIdOf({ sequenceStates: [BEHIND] });
    const { session, log } = sessionOf(CLASSIFIED_NEW, { sequenceStates: [BEHIND] });
    const params = dryRun ? off({ dryRun: true, confirm: false }) : off({ planId });

    await runActualizarPadron(params, depsOf(session)).catch(() => undefined);

    const beginAt = log.findIndex((sql) => sql.startsWith("BEGIN"));
    expect(beginAt).toBeGreaterThan(-1);
    expect(log.findIndex(isStateSql)).toBeGreaterThan(beginAt);
  });
});
