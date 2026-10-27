import { describe, it, expect, vi } from "vitest";
import { runActualizarPadron } from "@/modules/routine-jobs/jobs/actualizar-padron/services/runActualizarPadron";
import {
  buildClearStatement,
  buildPopulateSql,
  buildReportSql,
  buildStagingCountSql,
  buildStagingSridProbeSql,
  type PopulateLayouts,
  type TableLayout,
  type WorkLayout,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/populateSql";
import { plannedStepLabels, STEP } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";
import {
  LOCALITY_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  SKIP_REASON,
  STAGING_REQUIRED_COLUMNS,
  WORK_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronParams, RunDeps } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import { AnalyzeStatus } from "@/core/types/replace";
import type { DbColumnMetadata } from "@/core/types/db";

/*
 * Fake session contract (the tests are the spec of the runner's SQL I/O; PGlite has no PostGIS, so SQL is text):
 *  - catalog queries: bound values [schema, table]; answered with the columns of that table (is_nullable, column_default
 *    as the core column query returns them). Geometry columns carry "geometry(MultiPolygon,32721)"; the staging padron
 *    column is numeric unless the scenario says otherwise.
 *  - relation kind (SQL mentions relkind and not attname): [{ relkind }]; "r" unless the scenario names the work kind.
 *  - identity columns (SQL mentions attidentity): [{ column_name }] for the scenario's identity columns.
 *  - padron id sequence (SQL mentions pg_get_serial_sequence): [{ sequence_name }], "cat.padron_id_seq" by default.
 *  - exact builder text answers: staging count [{ count }], SRID probe [{ unsupported }], populate { rows: [], rowCount },
 *    and the single report statement, answered with one row: { rowsRead, repaired, skipped, collidingKeys (bigint, as text
 *    or number), byReason [{ reason, count }], byDepartment and byLocality [{ name, count }], samples [{ department,
 *    locality, padron, reason }], collidingKeyList [{ typePadron, idProvince, idCadastralLocality, number, rows }] }.
 *    The list columns are json: the driver hands them over already parsed, as JS arrays (null when the query gives null).
 *  - trigger and rewrite-rule facts (SQL mentions pg_trigger or pg_rewrite): [{ kind: "trigger" | "rule", name }] for the
 *    scenario's workTriggers and workRules; none by default.
 *  - has_table_privilege: one answer per privilege literal in the SQL text (INSERT, DELETE, TRUNCATE).
 *  - foreign-key lookups (pg_constraint / confrelid): one row per referencing table.
 *  - BEGIN, ROLLBACK, COMMIT, DELETE, TRUNCATE, ANALYZE and the populate: answered by the statement itself.
 * Every statement is logged in order; the state records the transaction boundary and the peak of pending queries.
 */
const PASSWORD = "S3cr3t!pw";
const SCHEMA = "cat";
const STAGING = "stg_padron";
const WORK = "padron_trabajo";
const PADRON = "padron";
const PROVINCE = "province";
const LOCALITY = "cadastral_locality";
const SRID = 32721;
const GEOMETRY_TYPE = `geometry(MultiPolygon,${SRID})`;
const PADRON_ID_DEFAULT = `nextval('${SCHEMA}.padron_id_seq'::regclass)`;
const PRIVILEGE_NAMES = ["INSERT", "DELETE", "TRUNCATE"] as const;

type Row = Record<string, unknown>;

type Totals = {
  rowsRead: number | string;
  repaired: number | string;
  skipped: number | string;
  collidingKeys: number | string;
};

/* Json list columns of the report row: null stands for a query that gave null (no rows aggregated). */
type ListColumn = Row[] | null;

interface Scenario {
  stagingRows?: number | string;
  unsupportedSrid?: number | string;
  stagingPadronType?: string;
  accepted?: number | string;
  written?: number;
  totals?: Partial<Totals>;
  byReason?: ListColumn;
  byDepartment?: ListColumn;
  byLocality?: ListColumn;
  samples?: ListColumn;
  collidingKeys?: ListColumn;
  deniedPrivileges?: string[];
  referencingTables?: string[];
  workIdDefault?: string;
  workTriggers?: string[];
  workRules?: string[];
  workExtraColumns?: DbColumnMetadata[];
  workRelkind?: string;
  workIdentityColumns?: string[];
  padronIdSequence?: string | null;
  padronGeometryType?: string;
  omitStagingColumn?: string;
  failOn?: (sql: string) => Error | undefined;
  commitFails?: boolean;
  openFailure?: string;
  closeFails?: boolean;
}

const DEFAULT_TOTALS: Totals = { rowsRead: 10, repaired: 0, skipped: 0, collidingKeys: 0 };
const DEFAULT_ACCEPTED = 10;
const DEFAULT_PADRON_SEQUENCE = `${SCHEMA}.padron_id_seq`;
const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";

const identity = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const stagingLayout: TableLayout = { schema: SCHEMA, table: STAGING, columns: identity(STAGING_REQUIRED_COLUMNS) };
const workLayout: WorkLayout = { schema: SCHEMA, table: WORK, columns: identity(WORK_REQUIRED_COLUMNS), srid: SRID };
const provinceLayout: TableLayout = { schema: SCHEMA, table: PROVINCE, columns: identity(PROVINCE_REQUIRED_COLUMNS) };
const localityLayout: TableLayout = { schema: SCHEMA, table: LOCALITY, columns: identity(LOCALITY_REQUIRED_COLUMNS) };
const populateLayouts: PopulateLayouts = {
  staging: stagingLayout,
  work: workLayout,
  province: provinceLayout,
  locality: localityLayout,
};

const defaultConfig = () => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: PASSWORD,
  schema_name: "",
  table_name: "",
});

const defaultParams = (overrides: Partial<ActualizarPadronParams> = {}): ActualizarPadronParams => ({
  config: defaultConfig(),
  stagingSchema: SCHEMA,
  stagingTable: STAGING,
  workSchema: SCHEMA,
  workTable: WORK,
  padronTable: PADRON,
  provinceTable: PROVINCE,
  localityTable: LOCALITY,
  options: { clearMode: "delete" },
  dryRun: false,
  confirm: true,
  ...overrides,
});

const columnOf = (name: string, dataType: string, overrides: Partial<DbColumnMetadata> = {}): DbColumnMetadata => ({
  column_name: name,
  data_type: dataType,
  is_nullable: true,
  column_default: null,
  ...overrides,
});

const typeOf = (name: string): string => {
  if (name === "geom" || name === "geometry") return GEOMETRY_TYPE;
  return name === "padron" ? "numeric" : "text";
};

const catalogOf = (names: readonly string[]): DbColumnMetadata[] => names.map((name) => columnOf(name, typeOf(name)));

function buildCatalogs(scenario: Scenario): Record<string, DbColumnMetadata[]> {
  const stagingNames = STAGING_REQUIRED_COLUMNS.filter((name) => name !== scenario.omitStagingColumn);
  const stagingCatalog = catalogOf(stagingNames).map((entry) =>
    entry.column_name === "padron" && scenario.stagingPadronType ? { ...entry, data_type: scenario.stagingPadronType } : entry
  );
  const workCatalog = [
    ...catalogOf(WORK_REQUIRED_COLUMNS),
    ...(scenario.workIdDefault ? [columnOf("id", "integer", { column_default: scenario.workIdDefault })] : []),
    ...(scenario.workExtraColumns ?? []),
  ];
  return {
    [STAGING]: stagingCatalog,
    [WORK]: workCatalog,
    [PADRON]: [
      columnOf("id", "integer", { column_default: PADRON_ID_DEFAULT, is_nullable: false }),
      columnOf("geometry", scenario.padronGeometryType ?? GEOMETRY_TYPE),
    ],
    [PROVINCE]: catalogOf(PROVINCE_REQUIRED_COLUMNS),
    [LOCALITY]: catalogOf(LOCALITY_REQUIRED_COLUMNS),
  };
}

const privilegeOf = (sql: string, values: unknown[] | undefined): string | undefined =>
  PRIVILEGE_NAMES.find((name) => sql.includes(`'${name}'`) || values?.includes(name));

const catalogRowsOf = (catalogs: Record<string, DbColumnMetadata[]>, values: unknown[] | undefined) => {
  const table = values?.find((value) => typeof value === "string" && value in catalogs);
  return typeof table === "string" ? { rows: catalogs[table] as unknown as Row[] } : undefined;
};

const listOf = (value: ListColumn | undefined): Row[] | null => (value === undefined ? [] : value);

/* accepted and skipped are two views of one count: the report's skipped is rowsRead minus the accepted rows. */
function reportRowOf(scenario: Scenario): Row {
  const rowsRead = scenario.totals?.rowsRead ?? DEFAULT_TOTALS.rowsRead;
  const accepted = scenario.accepted ?? DEFAULT_ACCEPTED;
  const totals: Totals = {
    ...DEFAULT_TOTALS,
    skipped: Number(rowsRead) - Number(accepted),
    ...scenario.totals,
  };
  return {
    rowsRead: totals.rowsRead,
    repaired: totals.repaired,
    skipped: totals.skipped,
    collidingKeys: totals.collidingKeys,
    byReason: listOf(scenario.byReason),
    byDepartment: listOf(scenario.byDepartment),
    byLocality: listOf(scenario.byLocality),
    samples: listOf(scenario.samples),
    collidingKeyList: listOf(scenario.collidingKeys),
  };
}

function createHarness(scenario: Scenario = {}) {
  const catalogs = buildCatalogs(scenario);
  const written = scenario.written ?? Number(scenario.accepted ?? DEFAULT_ACCEPTED);
  const exact = new Map<string, { rows: Row[]; rowCount?: number }>([
    [buildStagingCountSql(stagingLayout), { rows: [{ count: scenario.stagingRows ?? 25 }] }],
    [buildStagingSridProbeSql(stagingLayout, SRID), { rows: [{ unsupported: scenario.unsupportedSrid ?? 0 }] }],
    [buildClearStatement(workLayout, "delete"), { rows: [] }],
    [buildClearStatement(workLayout, "truncate"), { rows: [] }],
    [buildPopulateSql(populateLayouts), { rows: [], rowCount: written }],
    [buildAnalyzeStatement(SCHEMA, WORK), { rows: [] }],
  ]);

  const log: string[] = [];
  const state = { closed: 0, inFlight: 0, maxInFlight: 0, begun: false };

  const answer = async (sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number }> => {
    const failure = scenario.failOn?.(sql);
    if (failure) throw failure;
    const known = exact.get(sql);
    if (known) return known;
    if (/pg_trigger|pg_rewrite/i.test(sql)) {
      return {
        rows: [
          ...(scenario.workTriggers ?? []).map((name) => ({ kind: "trigger", name })),
          ...(scenario.workRules ?? []).map((name) => ({ kind: "rule", name })),
        ],
      };
    }
    if (/^\s*COMMIT/i.test(sql) && scenario.commitFails) throw new Error("commit rechazado por el servidor");
    if (/has_table_privilege/i.test(sql)) {
      const privilege = privilegeOf(sql, values);
      return { rows: [{ has_privilege: !(scenario.deniedPrivileges ?? []).includes(privilege ?? "") }] };
    }
    if (/pg_constraint|confrelid|referential_constraints/i.test(sql)) {
      return { rows: (scenario.referencingTables ?? []).map((name) => ({ referencing_table: name })) };
    }
    if (/AS "collidingKeyList"/.test(sql)) {
      return { rows: [reportRowOf(scenario)] };
    }
    if (/relkind/i.test(sql) && !/attname/i.test(sql)) {
      return { rows: [{ relkind: values?.[1] === WORK ? (scenario.workRelkind ?? "r") : "r" }] };
    }
    if (/attidentity/i.test(sql)) {
      return { rows: (scenario.workIdentityColumns ?? []).map((column_name) => ({ column_name })) };
    }
    if (/pg_get_serial_sequence/i.test(sql)) {
      const sequence = scenario.padronIdSequence === undefined ? DEFAULT_PADRON_SEQUENCE : scenario.padronIdSequence;
      return { rows: [{ sequence_name: sequence }] };
    }
    return catalogRowsOf(catalogs, values) ?? { rows: [] };
  };

  const session = {
    async query(sql: string, values?: unknown[]) {
      log.push(sql);
      if (/^\s*BEGIN/i.test(sql)) state.begun = true;
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        await Promise.resolve();
        return await answer(sql, values);
      } finally {
        state.inFlight -= 1;
      }
    },
    async close() {
      state.closed += 1;
      if (scenario.closeFails) throw new Error("cierre fallido");
    },
  };

  let clock = 0;
  const openSession = vi.fn(async () => {
    if (scenario.openFailure) throw new Error(scenario.openFailure);
    return session;
  });
  const deps: RunDeps = {
    openSession,
    now: () => {
      clock += 5;
      return clock;
    },
  };
  return { deps, log, state, openSession };
}

const indexOfMatch = (log: string[], pattern: RegExp): number => log.findIndex((sql) => pattern.test(sql));
const isWrite = (sql: string): boolean => /^\s*(INSERT|DELETE|TRUNCATE|UPDATE)\b/i.test(sql);

type Progress = { label: string; current: number; total: number };
const collector = () => {
  const calls: Progress[] = [];
  return { calls, onProgress: (progress: Progress) => void calls.push({ ...progress }) };
};

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

const populateSql = buildPopulateSql(populateLayouts);
const reportSql = (): string => buildReportSql(populateLayouts);
const analyzeSql = buildAnalyzeStatement(SCHEMA, WORK);
const clearSql = (mode: "delete" | "truncate") => buildClearStatement(workLayout, mode);

describe("runActualizarPadron", () => {
  describe("full run (AP-8, AP-14, AP-15, AP-17)", () => {
    it("should run BEGIN, clear, populate, ANALYZE, the report and COMMIT in that order", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(), harness.deps);

      const { log } = harness;
      const positions = [
        indexOfMatch(log, /^\s*BEGIN/i),
        log.indexOf(clearSql("delete")),
        log.indexOf(populateSql),
        log.indexOf(analyzeSql),
        log.indexOf(reportSql()),
        indexOfMatch(log, /^\s*COMMIT/i),
      ];
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    });

    it("should run ANALYZE and every report query inside the transaction, before COMMIT", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(), harness.deps);

      const begin = indexOfMatch(harness.log, /^\s*BEGIN/i);
      const commit = indexOfMatch(harness.log, /^\s*COMMIT/i);
      for (const sql of [analyzeSql, reportSql()]) {
        const at = harness.log.indexOf(sql);
        expect(at).toBeGreaterThan(begin);
        expect(at).toBeLessThan(commit);
      }
    });

    it("should report tempModified true, padronModified false, no unknown outcome and ANALYZE ok after a successful commit", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.dryRun).toBe(false);
      expect(result.tempModified).toBe(true);
      expect(result.padronModified).toBe(false);
      expect(result.outcomeUnknown).toBe(false);
      expect(result.analyze.status).toBe(AnalyzeStatus.OK);
    });

    it("should count the written rows from the populate rowCount and report them equal to the accepted rows", async () => {
      const harness = createHarness({ accepted: 7, written: 7 });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.totals.accepted).toBe(7);
      expect(result.totals.written).toBe(7);
    });

    it("should map rowsRead, repaired and skipped from the totals query into the result totals", async () => {
      const harness = createHarness({
        accepted: 7,
        totals: { rowsRead: 10, repaired: 2, skipped: 3, collidingKeys: 0 },
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.totals).toEqual({ rowsRead: 10, accepted: 7, written: 7, repaired: 2, skipped: 3 });
    });

    it("should read counts that the driver returns as text (bigint) as numbers", async () => {
      const harness = createHarness({
        accepted: "7",
        totals: { rowsRead: "10", repaired: "2", skipped: "3", collidingKeys: "1" },
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.totals).toEqual({ rowsRead: 10, accepted: 7, written: 7, repaired: 2, skipped: 3 });
      expect(result.skipped.collidingKeyCount).toBe(1);
    });

    it("should fill byReason with every skip reason, zero for the reasons without rows", async () => {
      const harness = createHarness({
        byReason: [{ reason: SKIP_REASON.PROVINCIA_NO_ENCONTRADA, count: 2 }, { reason: SKIP_REASON.CLAVE_NULA, count: "1" }],
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.skipped.byReason).toEqual({
        PROVINCIA_NO_ENCONTRADA: 2,
        PROVINCIA_AMBIGUA: 0,
        LOCALIDAD_NO_ENCONTRADA: 0,
        LOCALIDAD_AMBIGUA: 0,
        CLAVE_NULA: 1,
        SIN_GEOMETRIA: 0,
        CLAVE_DUPLICADA: 0,
      });
    });

    it("should keep the department and locality tops in the order the query returned them", async () => {
      const harness = createHarness({
        byDepartment: [
          { name: "MONTEVIDEO", count: 5 },
          { name: "CANELONES", count: 2 },
        ],
        byLocality: [{ name: "PANDO", count: 4 }],
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.skipped.byDepartment).toEqual([
        { name: "MONTEVIDEO", count: 5 },
        { name: "CANELONES", count: 2 },
      ]);
      expect(result.skipped.byLocality).toEqual([{ name: "PANDO", count: 4 }]);
    });

    it("should map the samples, converting a numeric padron to text and keeping a NULL locality as null", async () => {
      const harness = createHarness({
        samples: [
          { department: "ROCHA", locality: null, padron: 1001, reason: SKIP_REASON.PROVINCIA_NO_ENCONTRADA },
          { department: "SALTO", locality: "SALTO", padron: "2002", reason: SKIP_REASON.LOCALIDAD_AMBIGUA },
        ],
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.skipped.samples).toEqual([
        { department: "ROCHA", locality: null, padron: "1001", reason: SKIP_REASON.PROVINCIA_NO_ENCONTRADA },
        { department: "SALTO", locality: "SALTO", padron: "2002", reason: SKIP_REASON.LOCALIDAD_AMBIGUA },
      ]);
    });

    it("should map the colliding keys with their key parts and row count, and the total colliding key count", async () => {
      const harness = createHarness({
        totals: { collidingKeys: 2 },
        collidingKeys: [
          { typePadron: "URBANO", idProvince: 3, idCadastralLocality: 14, number: "120", rows: 2 },
          { typePadron: "RURAL", idProvince: 5, idCadastralLocality: null, number: "7", rows: 3 },
        ],
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.skipped.collidingKeyCount).toBe(2);
      expect(result.skipped.collidingKeys).toEqual([
        { typePadron: "URBANO", idProvince: 3, idCadastralLocality: 14, number: "120", rows: 2 },
        { typePadron: "RURAL", idProvince: 5, idCadastralLocality: null, number: "7", rows: 3 },
      ]);
    });

    it("should cap every list of the report at 20 even when the query returns more", async () => {
      const many = (build: (index: number) => Row): Row[] => Array.from({ length: 25 }, (_entry, index) => build(index));
      const harness = createHarness({
        byDepartment: many((index) => ({ name: `DEP${index}`, count: 25 - index })),
        byLocality: many((index) => ({ name: `LOC${index}`, count: 25 - index })),
        samples: many((index) => ({ department: "D", locality: "L", padron: String(index), reason: SKIP_REASON.CLAVE_NULA })),
        collidingKeys: many((index) => ({ typePadron: "URBANO", idProvince: 1, idCadastralLocality: 1, number: String(index), rows: 2 })),
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.skipped.byDepartment).toHaveLength(20);
      expect(result.skipped.byLocality).toHaveLength(20);
      expect(result.skipped.samples).toHaveLength(20);
      expect(result.skipped.collidingKeys).toHaveLength(20);
    });

    it("should warn in Spanish about the skipped rows, the repaired geometries and the colliding keys", async () => {
      const harness = createHarness({
        accepted: 7,
        totals: { rowsRead: 10, repaired: 2, skipped: 3, collidingKeys: 1 },
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.warnings.length).toBeGreaterThanOrEqual(3);
      const text = result.warnings.join(" ");
      expect(text).toMatch(/\b3\b/);
      expect(text).toMatch(/\b2\b/);
      expect(text).toMatch(/\b1\b/);
      for (const warning of result.warnings) {
        expect(typeof warning).toBe("string");
        expect(warning.trim().length).toBeGreaterThan(0);
      }
    });

    it("should return no warnings for a clean real run with no skipped, repaired or colliding rows", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.warnings).toEqual([]);
    });

    it("should report step timings labelled exactly as the planned steps, one per planned step", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      const planned = plannedStepLabels({ dryRun: false, clearMode: "delete" });
      expect(result.stepTimings.map((timing) => timing.label)).toEqual(planned);
      expect(result.stepTimings).toHaveLength(planned.length);
    });

    it("should plan the privileges step in truncate mode and report it among the timings", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams({ options: { clearMode: "truncate" } }), harness.deps);

      const planned = plannedStepLabels({ dryRun: false, clearMode: "truncate" });
      expect(planned).toContain(STEP.PRIVILEGES);
      expect(result.stepTimings.map((timing) => timing.label)).toEqual(planned);
    });
  });

  describe("clear mode (AP-8)", () => {
    it("should issue the DELETE clear inside the transaction by default and never check TRUNCATE privilege", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(), harness.deps);

      expect(harness.log).toContain(clearSql("delete"));
      expect(harness.log.some((sql) => /TRUNCATE/i.test(sql))).toBe(false);
      expect(harness.log.indexOf(clearSql("delete"))).toBeGreaterThan(indexOfMatch(harness.log, /^\s*BEGIN/i));
    });

    it("should issue TRUNCATE without CASCADE inside the transaction in truncate mode", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams({ options: { clearMode: "truncate" } }), harness.deps);

      const truncate = harness.log.find((sql) => /^TRUNCATE/i.test(sql));
      expect(truncate).toBe(clearSql("truncate"));
      expect(truncate).not.toMatch(/CASCADE/i);
      expect(harness.log.indexOf(truncate as string)).toBeGreaterThan(indexOfMatch(harness.log, /^\s*BEGIN/i));
    });
  });

  describe("accepted versus written rows (AP-14)", () => {
    it("should roll back with a Spanish error when the inserted rows differ from the accepted rows", async () => {
      const harness = createHarness({ accepted: 7, written: 6 });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).toMatch(/filas|registros/i);
      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThanOrEqual(0);
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
      expect(harness.log.indexOf(reportSql())).toBeGreaterThan(harness.log.indexOf(populateSql));
    });

    it("should close the session when the inserted rows differ from the accepted rows", async () => {
      const harness = createHarness({ accepted: 7, written: 6 });

      await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(harness.state.closed).toBe(1);
    });

    it("should roll back when the written rows differ from rowsRead minus the skipped count of the report, with no COMMIT", async () => {
      const harness = createHarness({ written: 7, totals: { rowsRead: 10, skipped: 2 } });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).toMatch(/filas/i);
      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThanOrEqual(0);
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
    });

    it("should commit when the written rows equal rowsRead minus the skipped count of the report", async () => {
      const harness = createHarness({ written: 8, totals: { rowsRead: 10, skipped: 2 } });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.tempModified).toBe(true);
      expect(result.totals.accepted).toBe(8);
      expect(result.totals.written).toBe(8);
    });
  });

  describe("transaction shape (AP-8, AP-15, AP-17, performance)", () => {
    it.each([
      ["real run", {}, COMMIT_SQL],
      ["dry run", { dryRun: true, confirm: false }, ROLLBACK_SQL],
    ])("should begin the %s with REPEATABLE READ isolation", async (_label, overrides, end) => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(overrides), harness.deps);

      expect(harness.log[indexOfMatch(harness.log, /^\s*BEGIN/i)]).toBe(BEGIN_SQL);
      expect(harness.log[harness.log.length - 1]).toBe(end);
    });

    it("should issue exactly BEGIN, clear, populate, ANALYZE, one report statement and COMMIT from the transaction start", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(), harness.deps);

      const begin = indexOfMatch(harness.log, /^\s*BEGIN/i);
      expect(harness.log.slice(begin)).toEqual([BEGIN_SQL, clearSql("delete"), populateSql, analyzeSql, reportSql(), COMMIT_SQL]);
    });

    it("should issue exactly BEGIN, clear, populate, ANALYZE, one report statement and ROLLBACK on a dry run", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams({ dryRun: true, confirm: false }), harness.deps);

      const begin = indexOfMatch(harness.log, /^\s*BEGIN/i);
      expect(harness.log.slice(begin)).toEqual([BEGIN_SQL, clearSql("delete"), populateSql, analyzeSql, reportSql(), ROLLBACK_SQL]);
    });

    it("should go from the clear straight to the populate, with no accepted-count query in between", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(), harness.deps);

      const clear = harness.log.indexOf(clearSql("delete"));
      expect(harness.log[clear + 1]).toBe(populateSql);
    });
  });

  describe("report read from one json row (AP-16, performance)", () => {
    it("should convert counts that arrive as text inside the json lists to numbers", async () => {
      const harness = createHarness({
        byDepartment: [{ name: "ROCHA", count: "3" }],
        collidingKeys: [{ typePadron: "URBANO", idProvince: "3", idCadastralLocality: "14", number: "120", rows: "2" }],
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.skipped.byDepartment).toEqual([{ name: "ROCHA", count: 3 }]);
      expect(result.skipped.collidingKeys).toEqual([
        { typePadron: "URBANO", idProvince: 3, idCadastralLocality: 14, number: "120", rows: 2 },
      ]);
    });

    it("should treat a null json list as empty and keep every count at zero", async () => {
      const harness = createHarness({ byReason: null, byDepartment: null, byLocality: null, samples: null, collidingKeys: null });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.skipped.byDepartment).toEqual([]);
      expect(result.skipped.byLocality).toEqual([]);
      expect(result.skipped.samples).toEqual([]);
      expect(result.skipped.collidingKeys).toEqual([]);
      expect(Object.values(result.skipped.byReason).every((count) => count === 0)).toBe(true);
    });
  });

  describe("dry run (AP-17)", () => {
    it("should run the same steps and end with ROLLBACK, never COMMIT, reporting tempModified false", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams({ dryRun: true, confirm: false }), harness.deps);

      expect(harness.log).toContain(populateSql);
      expect(harness.log).toContain(analyzeSql);
      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThan(harness.log.indexOf(populateSql));
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
      expect(result.dryRun).toBe(true);
      expect(result.tempModified).toBe(false);
      expect(result.padronModified).toBe(false);
      expect(result.outcomeUnknown).toBe(false);
    });

    it("should report ANALYZE ok on a dry run, since it runs in both modes", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams({ dryRun: true }), harness.deps);

      expect(result.analyze.status).toBe(AnalyzeStatus.OK);
    });

    it("should warn in Spanish that the work table was not modified on a dry run", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams({ dryRun: true }), harness.deps);

      expect(result.warnings.join(" ")).toMatch(/no (fue )?modificad/i);
    });

    it("should report the planned steps of a dry run, ending with the revert step", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams({ dryRun: true }), harness.deps);

      const planned = plannedStepLabels({ dryRun: true, clearMode: "delete" });
      expect(result.stepTimings.map((timing) => timing.label)).toEqual(planned);
      expect(planned[planned.length - 1]).toBe(STEP.ROLLBACK);
      expect(planned).not.toContain(STEP.COMMIT);
    });
  });

  describe("failure handling (AP-19)", () => {
    it("should ROLLBACK, skip COMMIT and rethrow when the populate statement fails", async () => {
      const harness = createHarness({
        failOn: (sql) => (sql === populateSql ? new Error("value too long for type character varying(10)") : undefined),
      });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).toMatch(/value too long/);
      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThan(harness.log.indexOf(populateSql));
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
      expect(harness.state.closed).toBe(1);
    });

    it("should ROLLBACK and rethrow when the clear statement fails before the load", async () => {
      const harness = createHarness({ failOn: (sql) => (sql === clearSql("delete") ? new Error("clear failed") : undefined) });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/clear failed/);

      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThanOrEqual(0);
      expect(harness.log.indexOf(populateSql)).toBe(-1);
    });

    it("should ROLLBACK, skip COMMIT and rethrow when ANALYZE fails, since ANALYZE failures roll back the run", async () => {
      const harness = createHarness({ failOn: (sql) => (sql === analyzeSql ? new Error("analyze failed") : undefined) });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/analyze failed/);

      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThanOrEqual(0);
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
    });

    it("should ROLLBACK, skip COMMIT and rethrow when the report statement fails", async () => {
      const harness = createHarness({
        failOn: (sql) => (sql === reportSql() ? new Error("report failed") : undefined),
      });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/report failed/);

      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThanOrEqual(0);
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
    });

    it("should report outcomeUnknown and tempModified false without throwing when COMMIT throws, warning to verify the work table", async () => {
      const harness = createHarness({ commitFails: true });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.outcomeUnknown).toBe(true);
      expect(result.tempModified).toBe(false);
      expect(result.padronModified).toBe(false);
      expect(result.warnings.join(" ")).toMatch(/verifique/i);
    });

    it("should close the session after a successful run", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(), harness.deps);

      expect(harness.state.closed).toBe(1);
    });

    it("should close the session after a failed run", async () => {
      const harness = createHarness({ failOn: (sql) => (sql === analyzeSql ? new Error("analyze failed") : undefined) });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow();

      expect(harness.state.closed).toBe(1);
    });

    it("should not fail a successful run when closing the session throws", async () => {
      const harness = createHarness({ closeFails: true });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.tempModified).toBe(true);
    });
  });

  describe("password scrubbing (AP-24)", () => {
    it("should keep the password out of a failure message when a statement fails with it", async () => {
      const harness = createHarness({
        failOn: (sql) => (sql === populateSql ? new Error(`fallo con clave ${PASSWORD}`) : undefined),
      });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).not.toContain(PASSWORD);
    });

    it("should keep the password out of a failure message when the session cannot be opened", async () => {
      const harness = createHarness({ openFailure: `password authentication failed for ${PASSWORD}` });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).not.toContain(PASSWORD);
      expect(failure.message).toMatch(/conexi/i);
    });

    it("should keep the password out of the result, its warnings and its step timings", async () => {
      const harness = createHarness({ written: 9, totals: { skipped: 1 }, byReason: [{ reason: SKIP_REASON.CLAVE_NULA, count: 1 }] });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    });
  });

  describe("refusals before any write (AP-3, AP-5..AP-8, AP-18)", () => {
    it("should refuse a real run without confirm before opening a session and write nothing", async () => {
      const harness = createHarness();

      await expect(runActualizarPadron(defaultParams({ confirm: false }), harness.deps)).rejects.toThrow();

      expect(harness.openSession).not.toHaveBeenCalled();
      expect(harness.log).toEqual([]);
    });

    it("should refuse repeated tables before opening a session, naming the repeated table", async () => {
      const harness = createHarness();

      await expect(runActualizarPadron(defaultParams({ workTable: PADRON }), harness.deps)).rejects.toThrow(
        new RegExp(`${SCHEMA}\\.${PADRON}`)
      );

      expect(harness.openSession).not.toHaveBeenCalled();
    });

    it("should refuse an empty staging table before BEGIN and close the session", async () => {
      const harness = createHarness({ stagingRows: 0 });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(new RegExp(`${SCHEMA}\\.${STAGING}`));

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.state.closed).toBe(1);
    });

    it("should refuse staging geometries with SRID 0 before BEGIN", async () => {
      const harness = createHarness({ unsupportedSrid: 2 });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/SRID/);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("should refuse a work id that defaults to the padron id sequence before BEGIN", async () => {
      const harness = createHarness({ workIdDefault: PADRON_ID_DEFAULT });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/secuencia/i);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
    });

    it("should refuse a work table with a user trigger before BEGIN, naming the table and the trigger in Spanish", async () => {
      const harness = createHarness({ workTriggers: ["trg_auditoria"] });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).toMatch(new RegExp(`${SCHEMA}\\.${WORK}`));
      expect(failure.message).toMatch(/trigger/i);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.state.closed).toBe(1);
    });

    it("should refuse a work table with a rewrite rule other than _RETURN before BEGIN, naming the table and the regla", async () => {
      const harness = createHarness({ workRules: ["regla_espejo"] });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).toMatch(new RegExp(`${SCHEMA}\\.${WORK}`));
      expect(failure.message).toMatch(/regla/i);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("should refuse a NOT NULL work column the job does not write before BEGIN, naming it", async () => {
      const harness = createHarness({
        workExtraColumns: [columnOf("fecha_carga", "date", { is_nullable: false })],
      });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/fecha_carga/);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
    });

    it("should refuse a generic padron geometry without SRID before BEGIN", async () => {
      const harness = createHarness({ padronGeometryType: "geometry" });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/padron/);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
    });

    it("should refuse a missing required staging column before BEGIN, naming the column", async () => {
      const harness = createHarness({ omitStagingColumn: "padron" });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/"padron"/);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
    });

    it("should refuse a missing INSERT privilege before BEGIN, reporting only the validation step", async () => {
      const harness = createHarness({ deniedPrivileges: ["INSERT"] });
      const { calls, onProgress } = collector();

      await expect(runActualizarPadron(defaultParams(), harness.deps, onProgress)).rejects.toThrow(/INSERT/);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(calls.map((call) => call.label)).toEqual([STEP.VALIDATE]);
    });

    it("should refuse a missing DELETE privilege before BEGIN", async () => {
      const harness = createHarness({ deniedPrivileges: ["DELETE"] });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/DELETE/);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("should refuse TRUNCATE without privilege before BEGIN and write nothing", async () => {
      const harness = createHarness({ deniedPrivileges: ["TRUNCATE"] });

      await expect(runActualizarPadron(defaultParams({ options: { clearMode: "truncate" } }), harness.deps)).rejects.toThrow(
        /TRUNCATE/
      );

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("should refuse TRUNCATE when another table references the work table, naming it and never using CASCADE", async () => {
      const harness = createHarness({ referencingTables: ["access_point"] });

      const failure = await failureOf(runActualizarPadron(defaultParams({ options: { clearMode: "truncate" } }), harness.deps));

      expect(failure.message).toMatch(/access_point/);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.join("\n")).not.toMatch(/CASCADE/i);
    });

    it("should still allow DELETE when another table references the work table", async () => {
      const harness = createHarness({ referencingTables: ["access_point"] });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.tempModified).toBe(true);
    });
  });

  describe("work relation kind, padron sequence, identity and staging padron type (AP-5, AP-6)", () => {
    it.each([
      ["view", "v", /vista/i],
      ["materialized view", "m", /vista materializada/i],
      ["foreign table", "f", /for[aá]nea/i],
    ])("should refuse a %s as the work table before BEGIN, naming it in Spanish and writing nothing", async (_label, relkind, kindText) => {
      const harness = createHarness({ workRelkind: relkind });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).toMatch(new RegExp(`${SCHEMA}\\.${WORK}`));
      expect(failure.message).toMatch(kindText);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.state.closed).toBe(1);
    });

    it("should refuse a non-id work column whose default is the padron id sequence before BEGIN, naming the column", async () => {
      const harness = createHarness({
        workExtraColumns: [columnOf("legacy_seq", "integer", { column_default: `nextval('${SCHEMA}.padron_id_seq'::regclass)` })],
      });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/legacy_seq[\s\S]*secuencia|secuencia[\s\S]*legacy_seq/i);

      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("should accept a NOT NULL identity work column without default, since identity counts as a default", async () => {
      const harness = createHarness({
        workExtraColumns: [columnOf("fila_id", "bigint", { is_nullable: false })],
        workIdentityColumns: ["fila_id"],
      });

      const result = await runActualizarPadron(defaultParams(), harness.deps);

      expect(result.tempModified).toBe(true);
    });

    it("should still refuse a NOT NULL work column without default that is not identity, naming it", async () => {
      const harness = createHarness({
        workExtraColumns: [columnOf("fecha_carga", "date", { is_nullable: false })],
        workIdentityColumns: [],
      });

      await expect(runActualizarPadron(defaultParams(), harness.deps)).rejects.toThrow(/fecha_carga/);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
    });

    it("should refuse a varchar staging padron column before BEGIN, naming it in Spanish", async () => {
      const harness = createHarness({ stagingPadronType: "character varying(10)" });

      const failure = await failureOf(runActualizarPadron(defaultParams(), harness.deps));

      expect(failure.message).toMatch(/"padron"/);
      expect(failure.message).toMatch(new RegExp(`${SCHEMA}\\.${STAGING}`));
      expect(failure.message).toMatch(/num[ée]ric/i);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log.filter(isWrite)).toEqual([]);
    });
  });

  describe("padron table is never written (AP-2, AP-17)", () => {
    it("should never reference the padron table in any statement of the run", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams(), harness.deps);

      expect(harness.log.join("\n")).not.toContain(`"${SCHEMA}"."${PADRON}"`);
    });

    it("should write only the work table, in every write statement of a truncate run", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams({ options: { clearMode: "truncate" } }), harness.deps);

      const writeTargets = harness.log
        .filter(isWrite)
        .map((sql) => /^\s*(?:INSERT INTO|DELETE FROM|TRUNCATE|UPDATE)\s+("[^"]+"\."[^"]+")/i.exec(sql)?.[1]);
      expect(writeTargets).toHaveLength(2);
      expect(new Set(writeTargets)).toEqual(new Set([`"${SCHEMA}"."${WORK}"`]));
    });

    it("should report padronModified false in both modes", async () => {
      const real = await runActualizarPadron(defaultParams(), createHarness().deps);
      const dry = await runActualizarPadron(defaultParams({ dryRun: true }), createHarness().deps);

      expect(real.padronModified).toBe(false);
      expect(dry.padronModified).toBe(false);
    });
  });

  describe("one statement at a time per session", () => {
    it("should never issue a query while another is pending, across the whole run", async () => {
      const harness = createHarness();

      await runActualizarPadron(defaultParams({ options: { clearMode: "truncate" } }), harness.deps);

      expect(harness.state.maxInFlight).toBe(1);
    });
  });

  describe("progress reporting (AP-22)", () => {
    it("should call onProgress once per planned step of a real run, in order, 1-based, with the planned total", async () => {
      const harness = createHarness();
      const { calls, onProgress } = collector();

      await runActualizarPadron(defaultParams(), harness.deps, onProgress);

      const planned = plannedStepLabels({ dryRun: false, clearMode: "delete" });
      expect(calls).toEqual(planned.map((label, index) => ({ label, current: index + 1, total: planned.length })));
    });

    it("should call onProgress for the steps of a dry run, ending with the revert step", async () => {
      const harness = createHarness();
      const { calls, onProgress } = collector();

      await runActualizarPadron(defaultParams({ dryRun: true }), harness.deps, onProgress);

      const planned = plannedStepLabels({ dryRun: true, clearMode: "delete" });
      expect(calls.map((call) => call.label)).toEqual(planned);
      expect(calls[calls.length - 1]).toEqual({ label: STEP.ROLLBACK, current: planned.length, total: planned.length });
    });

    it("should report the steps reached and none after the failing one when populate fails", async () => {
      const harness = createHarness({ failOn: (sql) => (sql === populateSql ? new Error("populate failed") : undefined) });
      const { calls, onProgress } = collector();

      await expect(runActualizarPadron(defaultParams(), harness.deps, onProgress)).rejects.toThrow(/populate failed/);

      expect(calls.map((call) => call.label)).toEqual([STEP.VALIDATE, STEP.COUNT, STEP.CLEAR, STEP.RESOLVE, STEP.LOAD]);
    });

    it("should not report any step when the run is refused before opening the session", async () => {
      const harness = createHarness();
      const { calls, onProgress } = collector();

      await expect(runActualizarPadron(defaultParams({ confirm: false }), harness.deps, onProgress)).rejects.toThrow();

      expect(calls).toEqual([]);
    });

    it("should never fail a real run when onProgress throws", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams(), harness.deps, () => {
        throw new Error("ui closed");
      });

      expect(result.tempModified).toBe(true);
    });

    it("should never fail a dry run when onProgress throws", async () => {
      const harness = createHarness();

      const result = await runActualizarPadron(defaultParams({ dryRun: true }), harness.deps, () => {
        throw new Error("ui closed");
      });

      expect(result.tempModified).toBe(false);
    });

    it("should not mask the run's own error when onProgress throws and the run fails", async () => {
      const harness = createHarness({ failOn: (sql) => (sql === populateSql ? new Error("populate failed") : undefined) });

      await expect(
        runActualizarPadron(defaultParams(), harness.deps, () => {
          throw new Error("ui closed");
        })
      ).rejects.toThrow(/populate failed/);
    });

    it("should keep the result identical whether or not onProgress is given", async () => {
      const withSink = await runActualizarPadron(defaultParams(), createHarness().deps, collector().onProgress);
      const withoutSink = await runActualizarPadron(defaultParams(), createHarness().deps);

      expect(withSink).toEqual(withoutSink);
    });
  });
});
