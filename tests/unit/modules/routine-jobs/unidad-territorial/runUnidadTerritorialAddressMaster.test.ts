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
import { sequenceStateRows, type FakeSequenceState } from "../shared/sequenceStateFake";
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
const OPTIONS: UnitOptions = { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: false, repairSequences: true, linkAddressMaster: true };

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
function harnessOf(
  addressApplied: Row = ADDRESS_APPLIED_ROW,
  sequenceStates: readonly FakeSequenceState[] = [],
  addressClassify: Row = ADDRESS_CLASSIFY_ROW
): { deps: RunDeps; log: string[] } {
  const log: string[] = [];
  const answers = new Map<string, Row[]>([
    [buildUnitSourceReportSql({ locality: LAYOUTS.locality }), [SOURCE_ROW]],
    [buildUnitClassifySql(LAYOUTS, OPTIONS), [CLASSIFY_ROW]],
    [buildUnitApplySql(LAYOUTS, OPTIONS), [APPLY_ROW]],
    [buildAddressMasterClassifySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC), [addressClassify]],
    [buildAddressMasterApplySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC), [addressApplied]],
    [buildAddressMasterRemainingSql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC), [ADDRESS_REMAINING_ROW]],
  ]);
  const session: RunSession = {
    async query(sql: string, params?: unknown[]) {
      log.push(sql);
      await Promise.resolve();
      return { rows: answers.get(sql) ?? sequenceStateRows(sql, params, sequenceStates) ?? [] };
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

describe("runUnidadTerritorial address master sequence repair option (SQ-2, SQ-3)", () => {
  const withRepair = (repairSequences: boolean): UnitParams => PARAMS_OF({ options: { ...OPTIONS, repairSequences } });

  it("should issue the target and the address master setval when SQ-2 repairSequences is on", async () => {
    const { deps, log } = harnessOf();

    await runUnidadTerritorial(withRepair(true), deps);

    expect(log).toContain(buildSequenceRepairSql(LAYOUTS.target));
    expect(log).toContain(buildSequenceRepairSql(ADDRESS_MASTER));
  });

  it("should issue no setval but still link the address master and COMMIT when SQ-3 repairSequences is off", async () => {
    const { deps, log } = harnessOf();

    await runUnidadTerritorial(withRepair(false), deps);

    expect(log.some((sql) => sql.includes("setval"))).toBe(false);
    expect(log).toContain(buildAddressMasterApplySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC));
    expect(log.at(-1)).toBe(COMMIT_SQL);
  });
});

describe("runUnidadTerritorial address master sequence state check in the link pass (SQ-5, SQ-7)", () => {
  const off = (): UnitParams => PARAMS_OF({ options: { ...OPTIONS, repairSequences: false } });
  const MASTER_BEHIND: FakeSequenceState = { table: ADDRESS_MASTER_TABLE, sequence: ADDRESS_MASTER.idSequence as string, lastValue: 5, maxId: 10 };
  const UNIT_BEHIND: FakeSequenceState = { table: UNIT_TABLE, sequence: TARGET.idSequence as string, lastValue: 5, maxId: 10 };
  const isMasterStateSql = (sql: string): boolean => sql.startsWith("SELECT max(") && sql.includes(`"${ADDRESS_MASTER_TABLE}"`);
  const NO_CREATE: Row = { ...ADDRESS_CLASSIFY_ROW, to_create: 0 };
  const NO_CREATE_APPLIED: Row = { created: 0, linked: 2, linked_list: [] };

  it("should throw after the classification and before the link apply, ROLLBACK, when SQ-5 the master sequence is behind and the link creates records", async () => {
    const { deps, log } = harnessOf(ADDRESS_APPLIED_ROW, [MASTER_BEHIND]);

    const failure = await failureOf(runUnidadTerritorial(off(), deps));

    expect(failure.message).toContain(`${ADDRESS_MASTER.idSequence} está en 6`);
    expect(failure.message).toContain(ADDRESS_MASTER_TABLE);
    expect(failure.message).toContain("Ajustar secuencias de destino");
    expect(log).toContain(buildAddressMasterClassifySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC));
    expect(log).not.toContain(buildAddressMasterApplySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC));
    expect(log).not.toContain(COMMIT_SQL);
    expect(log.at(-1)).toBe(ROLLBACK_SQL);
  });

  it("should complete the analysis with the master warning when SQ-5 the master sequence is behind", async () => {
    const { deps, log } = harnessOf(ADDRESS_APPLIED_ROW, [MASTER_BEHIND]);

    const result = await runUnidadTerritorial(PARAMS_OF({ dryRun: true, confirm: false, options: { ...OPTIONS, repairSequences: false } }), deps);

    expect(result.warnings.some((warning) => warning.includes(`${ADDRESS_MASTER.idSequence} está en 6`))).toBe(true);
    expect(log.at(-1)).toBe(ROLLBACK_SQL);
  });

  it("should never read the master sequence when SQ-7 the link creates no records, even if the sequence is behind", async () => {
    const { deps, log } = harnessOf(NO_CREATE_APPLIED, [MASTER_BEHIND], NO_CREATE);

    await runUnidadTerritorial(off(), deps);

    expect(log.some(isMasterStateSql)).toBe(false);
    expect(log.at(-1)).toBe(COMMIT_SQL);
  });

  it("should fail on the unit table first and never reach the address master classification when the unit sequence is behind", async () => {
    const { deps, log } = harnessOf(ADDRESS_APPLIED_ROW, [UNIT_BEHIND]);

    const failure = await failureOf(runUnidadTerritorial(off(), deps));

    expect(failure.message).toContain(`${TARGET.idSequence} está en 6`);
    expect(log).not.toContain(buildAddressMasterClassifySql(ADDRESS_LAYOUTS, UNIT_SUBJECT_SPEC));
  });

  it("should not read any sequence state when the repair is on", async () => {
    const { deps, log } = harnessOf(ADDRESS_APPLIED_ROW, [MASTER_BEHIND, UNIT_BEHIND]);

    await runUnidadTerritorial(PARAMS_OF(), deps);

    expect(log.some((sql) => !sql.includes("setval") && (sql.includes("pg_sequence_last_value") || sql.startsWith("SELECT max(")))).toBe(false);
  });
});
