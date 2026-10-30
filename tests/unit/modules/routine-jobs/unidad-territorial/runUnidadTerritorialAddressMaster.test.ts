import { describe, expect, it, vi } from "vitest";
import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import {
  ADDRESS_MASTER_COLUMN,
  UNIT_SUBJECT_SPEC,
} from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
import {
  buildAddressMasterApplySql,
  buildAddressMasterClassifySql,
  buildAddressMasterRemainingSql,
} from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSql";
import { buildSequenceRepairSql } from "@/modules/routine-jobs/jobs/shared/transaction";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import {
  UNIT_SOURCE_COLUMN,
  UNIT_TARGET_COLUMN,
  UNIT_TYPE_COLUMN,
} from "@/modules/routine-jobs/jobs/unidad-territorial/constants";
import { buildUnitSourceReportSql } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/sourceSql";
import { buildUnitApplySql, buildUnitClassifySql } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/targetSql";
import { runUnidadTerritorial } from "@/modules/routine-jobs/jobs/unidad-territorial/services/runUnidadTerritorial";
import type { UnitLayouts, UnitOptions, UnitParams } from "@/modules/routine-jobs/jobs/unidad-territorial/types";

vi.mock("@/modules/routine-jobs/jobs/unidad-territorial/services/resolveLayouts", () => ({
  resolveUnitLayouts: vi.fn(async () => LAYOUTS),
}));

vi.mock("@/modules/routine-jobs/jobs/shared/preflightAsserts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/routine-jobs/jobs/shared/preflightAsserts")>()),
  assertWriteTargetsReady: vi.fn(async () => undefined),
  assertSourceTablesReady: vi.fn(async () => undefined),
}));

vi.mock("@/modules/routine-jobs/jobs/shared/addressMasterLinkPreflight", () => ({
  addressMasterIssuesOf: vi.fn(async () => []),
}));

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const PASSWORD = "Unidad-pw!7";
const UNIT_SCHEMA = "carto";
const UNIT_TABLE = "territorial_unit";
const ADDRESS_MASTER_TABLE = "addresses_master";
const OPTIONS: UnitOptions = { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: false, linkAddressMaster: true };

type Row = Record<string, unknown>;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf(UNIT_SCHEMA, UNIT_TABLE, [...Object.values(UNIT_TARGET_COLUMN), "id_address_master"]),
  srid: 32721,
  idColumn: UNIT_TARGET_COLUMN.ID,
  idSequence: `${UNIT_SCHEMA}.${UNIT_TABLE}_id_seq`,
  identityColumns: [],
  catalog: [],
};

const ADDRESS_MASTER: WritableTargetLayout = {
  ...tableOf(UNIT_SCHEMA, ADDRESS_MASTER_TABLE, Object.values(ADDRESS_MASTER_COLUMN)),
  srid: 0,
  idColumn: ADDRESS_MASTER_COLUMN.ID,
  idSequence: `${UNIT_SCHEMA}.${ADDRESS_MASTER_TABLE}_${ADDRESS_MASTER_COLUMN.ID}_seq`,
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: UnitLayouts = {
  locality: tableOf("stg", "localidades_catastrales_stg", Object.values(UNIT_SOURCE_COLUMN)),
  type: tableOf(UNIT_SCHEMA, "tipo_unidad", Object.values(UNIT_TYPE_COLUMN)),
  target: TARGET,
  unitTypeId: 42,
  addressMaster: ADDRESS_MASTER,
};

const ADDRESS_LAYOUTS = { subject: TARGET, addressMaster: ADDRESS_MASTER };

const SOURCE_ROW: Row = { rows_read: 10, candidates: 8, by_reason: {}, samples: [] };
const CLASSIFY_ROW: Row = {
  new: 2,
  unchanged: 5,
  within_tolerance: 0,
  changed: 0,
  ambiguous: 0,
  missing: 0,
  font_differs: 0,
  updates: 0,
  missing_samples: [],
  ambiguous_samples: [],
  geometry_changes: [],
};
const APPLY_ROW: Row = { inserted: 2, updated: 0, inserted_list: [] };
const ADDRESS_CLASSIFY_ROW: Row = { without_address_master: 2, to_create: 1, already_had_record: 1, ambiguous: 0, ambiguous_samples: [] };
const ADDRESS_REMAINING_ROW: Row = { remaining: 0 };
const ADDRESS_APPLIED_ROW: Row = { created: 1, linked: 2, linked_list: [] };

const PARAMS_OF = (overrides: Partial<UnitParams> = {}): UnitParams => ({
  config: {
    host: "db.local",
    port: "5432",
    db_name: "gis",
    user: "gis_user",
    password: PASSWORD,
    schema_name: "",
    table_name: "",
  },
  localitySchema: "stg",
  localityTable: "localidades_catastrales_stg",
  typeSchema: UNIT_SCHEMA,
  typeTable: "tipo_unidad",
  targetSchema: UNIT_SCHEMA,
  targetTable: UNIT_TABLE,
  addressMasterTable: { schema: UNIT_SCHEMA, table: ADDRESS_MASTER_TABLE },
  options: OPTIONS,
  dryRun: false,
  confirm: true,
  ...overrides,
});

/** The session answers the statements of the unit pass and of the address master link pass by their exact text; every other statement answers nothing. */
function harnessOf(addressApplied: Row = ADDRESS_APPLIED_ROW): { deps: RunDeps; log: string[] } {
  const log: string[] = [];
  const answers = new Map<string, Row[]>([
    [buildUnitSourceReportSql({ locality: LAYOUTS.locality }), [SOURCE_ROW]],
    [buildUnitClassifySql(LAYOUTS, OPTIONS), [CLASSIFY_ROW]],
    [buildUnitApplySql(LAYOUTS, OPTIONS), [APPLY_ROW]],
    [buildAddressMasterClassifySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC), [ADDRESS_CLASSIFY_ROW]],
    [buildAddressMasterApplySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC), [addressApplied]],
    [buildAddressMasterRemainingSql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC), [ADDRESS_REMAINING_ROW]],
  ]);
  const session: RunSession = {
    async query(sql: string) {
      log.push(sql);
      await Promise.resolve();
      return { rows: answers.get(sql) ?? [] };
    },
    async close() {},
  };
  return { deps: { openSession: vi.fn(async () => session), now: () => 0 }, log };
}

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

describe("runUnidadTerritorial address master link transaction (UT-8, UT-13, UT-14, UT-16, UT-23)", () => {
  it("should repair the address master sequence, link, then analyze both tables in the same transaction and COMMIT when the link is on", async () => {
    const { deps, log } = harnessOf();

    const result = await runUnidadTerritorial(PARAMS_OF(), deps);

    const ordered = [
      buildUnitApplySql(LAYOUTS, OPTIONS),
      buildSequenceRepairSql(ADDRESS_MASTER),
      buildAddressMasterClassifySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC),
      buildAddressMasterApplySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC),
      buildAddressMasterRemainingSql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC),
      buildAnalyzeStatement(UNIT_SCHEMA, UNIT_TABLE),
      buildAnalyzeStatement(UNIT_SCHEMA, ADDRESS_MASTER_TABLE),
    ].map((sql) => log.indexOf(sql));
    expect(ordered.every((position) => position > log.indexOf(BEGIN_SQL))).toBe(true);
    expect(ordered).toEqual([...ordered].sort((first, second) => first - second));
    expect(log.filter((sql) => sql === BEGIN_SQL)).toHaveLength(1);
    expect(log.at(-1)).toBe(COMMIT_SQL);
    expect(log).not.toContain(ROLLBACK_SQL);
    expect(result.targetModified).toBe(true);
    expect(result.addressMaster?.counts.linked).toBe(2);
  });

  it("should ROLLBACK and never COMMIT on a dry run, and on a created count that differs from the classification", async () => {
    const dry = harnessOf();
    const dryResult = await runUnidadTerritorial(PARAMS_OF({ dryRun: true, confirm: false }), dry.deps);

    const mismatch = harnessOf({ created: 0, linked: 2, linked_list: [] });
    const failure = await failureOf(runUnidadTerritorial(PARAMS_OF(), mismatch.deps));

    expect(dry.log.indexOf(buildAddressMasterApplySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC))).toBeLessThan(dry.log.lastIndexOf(ROLLBACK_SQL));
    expect(dry.log.at(-1)).toBe(ROLLBACK_SQL);
    expect(dry.log).not.toContain(COMMIT_SQL);
    expect(dryResult.targetModified).toBe(false);
    expect(failure.message).toMatch(/Los registros de dirección maestra creados \(0\) no coinciden con los esperados \(1\)/);
    expect(mismatch.log.at(-1)).toBe(ROLLBACK_SQL);
    expect(mismatch.log).not.toContain(COMMIT_SQL);
  });
});
