import { describe, it, expect, vi } from "vitest";
import {
  runCargarPadrones,
  type CargarPadronesParams,
  type RunDeps,
  type RunSession,
} from "@/modules/routine-jobs/jobs/cargar-padrones/services/runCargarPadrones";
import {
  buildAmbiguousLocalityCodesSql,
  buildClearSql,
  buildConflictSamplesSql,
  buildCountSql,
  buildGeometryReportSql,
  buildLoadSql,
  type LoadOptions,
  type SourceLayout,
  type TargetLayout,
} from "@/modules/routine-jobs/jobs/cargar-padrones/domain/loadSql";
import {
  RURAL_REQUIRED_COLUMNS,
  TARGET_REQUIRED_COLUMNS,
  URBANO_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/cargar-padrones/constants";
import {
  buildAnalyzeStatement,
  buildRepairSequenceStatement,
  buildResetSequenceStatement,
} from "@/core/services/sqlStatements";
import { AnalyzeStatus } from "@/core/types/replace";
import type { DbConfig } from "@/core/types/db";

/*
 * Fake session contract assumed by these tests (the tests are the spec of the runner's SQL I/O):
 *  - column queries (any query whose values contain a table name): rows { column_name, data_type, column_default } for that table; [] if unknown.
 *    A geometry column has data_type "geometry(<Type>,<srid>)" (format_type); SRID and polygon-ness are parsed from it.
 *  - buildCountSql -> [{ count }]; buildGeometryReportSql -> [{ rowsRead, repaired, insertedInvalid, repairedInUnion, noGeometry,
 *    nullKeyRows, groups, attributeConflicts }]; buildConflictSamplesSql / buildAmbiguousLocalityCodesSql -> list rows passed through;
 *    buildLoadSql -> { rows: [], rowCount: n } like real pg (inserted count is rowCount); buildClearSql -> [];
 *    setval statements -> [{ setval: 1 }].
 *  - rowsMerged = rowsRead - nullKeyRows - noGeometry - groups (only rows that entered grouping); totals sums rural + urbano.
 *  - has_table_privilege query -> [{ has_privilege: boolean }] (first value read).
 *  - foreign-key query (mentions pg_constraint / confrelid / referential_constraints) -> one row per referencing table.
 *  - every other statement (BEGIN, COMMIT, ROLLBACK, SET, ANALYZE, setval) -> [].
 */
const PASSWORD = "S3cr3t!pw";
const SCHEMA = "cat";
const RURAL = "paisrural";
const URBANO = "paisurbano";
const TARGET = "catastro_paispadron";
const SRID = 32721;
const GEOM_OK = `geometry(MultiPolygon,${SRID})`;
const SEQUENCE_DEFAULT = `nextval('cat.padron_id_seq'::regclass)`;

type Names = Record<string, string>;

interface ColumnRow {
  column_name: string;
  data_type: string;
  column_default: string | null;
}

interface Report {
  rowsRead: number;
  repaired: number;
  insertedInvalid: number;
  repairedInUnion: number;
  noGeometry: number;
  nullKeyRows: number;
  groups: number;
  attributeConflicts: number;
}

interface Scenario {
  names?: { rural?: Names; urbano?: Names; target?: Names };
  omit?: { rural?: string[]; urbano?: string[]; target?: string[] };
  extraColumns?: { rural?: ColumnRow[]; urbano?: ColumnRow[]; target?: ColumnRow[] };
  geomType?: { rural?: string; urbano?: string; target?: string };
  counts?: { rural?: number; urbano?: number };
  reports?: { rural?: Partial<Report>; urbano?: Partial<Report> };
  inserted?: { rural?: number; urbano?: number };
  samples?: { rural?: unknown[]; urbano?: unknown[] };
  ambiguousCodes?: unknown[];
  privilege?: boolean;
  referencingTables?: string[];
  failOn?: (sql: string) => Error | undefined;
  allColumns?: boolean;
}

const defaultReport = (overrides: Partial<Report> = {}): Report => ({
  rowsRead: 10,
  repaired: 0,
  insertedInvalid: 0,
  repairedInUnion: 0,
  noGeometry: 0,
  nullKeyRows: 0,
  groups: 8,
  attributeConflicts: 0,
  ...overrides,
});

const defaultOptions = (overrides: Partial<LoadOptions> = {}): LoadOptions => ({
  repair: true,
  clearMode: "delete",
  resetSequences: true,
  ...overrides,
});

const defaultConfig = (): DbConfig => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: PASSWORD,
  schema_name: "",
  table_name: "",
});

const defaultParams = (overrides: Partial<CargarPadronesParams> = {}): CargarPadronesParams => ({
  config: defaultConfig(),
  schema: SCHEMA,
  ruralTable: RURAL,
  urbanoTable: URBANO,
  targetTable: TARGET,
  options: defaultOptions(),
  dryRun: false,
  confirm: true,
  ...overrides,
});

const sridOf = (dataType: string): number => {
  const match = /,\s*(\d+)\s*\)/.exec(dataType);
  return match ? Number(match[1]) : 0;
};

function columnRows(
  required: readonly string[],
  names: Names | undefined,
  omit: string[] | undefined,
  geomType: string,
  extra: ColumnRow[] | undefined
): ColumnRow[] {
  const rows = required
    .filter((logical) => !omit?.includes(logical))
    .map((logical) => ({
      column_name: names?.[logical] ?? logical,
      data_type: logical === "geom" ? geomType : "text",
      column_default: null,
    }));
  return [...rows, ...(extra ?? [])];
}

function layoutColumns(required: readonly string[], names: Names | undefined): Names {
  return Object.fromEntries(required.map((logical) => [logical, names?.[logical] ?? logical]));
}

function createHarness(scenario: Scenario = {}, params: CargarPadronesParams = defaultParams()) {
  const geomType = {
    rural: scenario.geomType?.rural ?? GEOM_OK,
    urbano: scenario.geomType?.urbano ?? GEOM_OK,
    target: scenario.geomType?.target ?? GEOM_OK,
  };
  const ruralSource: SourceLayout = {
    schema: SCHEMA,
    table: RURAL,
    columns: layoutColumns(RURAL_REQUIRED_COLUMNS, scenario.names?.rural),
  };
  const urbanoSource: SourceLayout = {
    schema: SCHEMA,
    table: URBANO,
    columns: layoutColumns(URBANO_REQUIRED_COLUMNS, scenario.names?.urbano),
  };
  const targetLayout: TargetLayout = {
    schema: SCHEMA,
    table: TARGET,
    columns: layoutColumns(TARGET_REQUIRED_COLUMNS, scenario.names?.target),
    srid: sridOf(geomType.target),
  };
  const idColumn: ColumnRow = { column_name: "id", data_type: "integer", column_default: SEQUENCE_DEFAULT };
  const union = Array.from(new Set([...RURAL_REQUIRED_COLUMNS, ...URBANO_REQUIRED_COLUMNS, ...TARGET_REQUIRED_COLUMNS]));
  const allRows = columnRows(union, undefined, undefined, GEOM_OK, undefined);
  const tables: Record<string, ColumnRow[]> = scenario.allColumns
    ? { [RURAL]: allRows, [URBANO]: allRows, [TARGET]: [...allRows, idColumn] }
    : {
    [RURAL]: columnRows(RURAL_REQUIRED_COLUMNS, scenario.names?.rural, scenario.omit?.rural, geomType.rural, scenario.extraColumns?.rural),
    [URBANO]: columnRows(URBANO_REQUIRED_COLUMNS, scenario.names?.urbano, scenario.omit?.urbano, geomType.urbano, scenario.extraColumns?.urbano),
    [TARGET]: [
      ...columnRows(TARGET_REQUIRED_COLUMNS, scenario.names?.target, scenario.omit?.target, geomType.target, scenario.extraColumns?.target),
      idColumn,
    ],
  };
  const { options } = params;
  const inserted = { rural: scenario.inserted?.rural ?? 8, urbano: scenario.inserted?.urbano ?? 5 };
  const answers = new Map<string, { rows: unknown[]; rowCount?: number }>([
    [buildCountSql(ruralSource), { rows: [{ count: scenario.counts?.rural ?? 10 }] }],
    [buildCountSql(urbanoSource), { rows: [{ count: scenario.counts?.urbano ?? 6 }] }],
    [buildGeometryReportSql("RURAL", ruralSource, options), { rows: [defaultReport(scenario.reports?.rural)] }],
    [buildGeometryReportSql("URBANO", urbanoSource, options), { rows: [defaultReport({ rowsRead: 6, groups: 5, ...scenario.reports?.urbano })] }],
    [buildConflictSamplesSql("RURAL", ruralSource), { rows: scenario.samples?.rural ?? [] }],
    [buildConflictSamplesSql("URBANO", urbanoSource), { rows: scenario.samples?.urbano ?? [] }],
    [buildAmbiguousLocalityCodesSql(urbanoSource), { rows: scenario.ambiguousCodes ?? [] }],
    [buildClearSql(targetLayout, options.clearMode), { rows: [] }],
    [buildLoadSql("RURAL", ruralSource, targetLayout, options), { rows: [], rowCount: inserted.rural }],
    [buildLoadSql("URBANO", urbanoSource, targetLayout, options), { rows: [], rowCount: inserted.urbano }],
  ]);

  const log: string[] = [];
  const state = { closed: 0, inFlight: 0, maxBeforeBegin: 0, maxAfterBegin: 0, begun: false };
  const answer = async (sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> => {
    const failure = scenario.failOn?.(sql);
    if (failure) throw failure;
    const known = answers.get(sql);
    if (known) return known as { rows: Record<string, unknown>[]; rowCount?: number };
    if (/setval\(/i.test(sql)) return { rows: [{ setval: 1 }] };
    if (scenario.allColumns && /^\s*SELECT\s+count\(\*\)/i.test(sql)) return { rows: [{ count: 5 }] };
    if (/has_table_privilege/i.test(sql)) return { rows: [{ has_privilege: scenario.privilege ?? true }] };
    if (/pg_constraint|confrelid|referential_constraints/i.test(sql)) {
      return { rows: (scenario.referencingTables ?? []).map((name) => ({ referencing_table: name })) };
    }
    const table = values?.find((value) => typeof value === "string" && value in tables);
    if (typeof table === "string") return { rows: tables[table] as unknown as Record<string, unknown>[] };
    return { rows: [] };
  };
  const session: RunSession & { close(): Promise<void> } = {
    async query(sql, values) {
      log.push(sql);
      if (/^\s*BEGIN/i.test(sql)) state.begun = true;
      state.inFlight += 1;
      if (state.begun) state.maxAfterBegin = Math.max(state.maxAfterBegin, state.inFlight);
      else state.maxBeforeBegin = Math.max(state.maxBeforeBegin, state.inFlight);
      try {
        await Promise.resolve();
        return await answer(sql, values);
      } finally {
        state.inFlight -= 1;
      }
    },
    async close() {
      state.closed += 1;
    },
  };
  let clock = 0;
  const openSession = vi.fn(async () => session);
  const deps: RunDeps = {
    openSession,
    now: () => {
      clock += 5;
      return clock;
    },
  };
  return {
    deps,
    log,
    state,
    openSession,
    ruralSource,
    urbanoSource,
    targetLayout,
    sql: {
      clear: buildClearSql(targetLayout, options.clearMode),
      loadRural: buildLoadSql("RURAL", ruralSource, targetLayout, options),
      loadUrbano: buildLoadSql("URBANO", urbanoSource, targetLayout, options),
      analyze: buildAnalyzeStatement(SCHEMA, TARGET),
      resetSequence: buildResetSequenceStatement("cat", "padron_id_seq"),
      repairSequence: buildRepairSequenceStatement("cat", "padron_id_seq", SCHEMA, TARGET, ["id"]),
      reportRural: buildGeometryReportSql("RURAL", ruralSource, options),
    },
  };
}

const indexOfMatch = (log: string[], pattern: RegExp): number => log.findIndex((sql) => pattern.test(sql));
const isWrite = (sql: string): boolean => /^\s*(INSERT|DELETE|TRUNCATE|UPDATE)\b/i.test(sql);

describe("runCargarPadrones", () => {
  describe("full run", () => {
    it("AC-5/AC-7/AC-17/AC-20: should run BEGIN, clear, sequence reset, rural insert, urban insert, sequence repair, COMMIT and then ANALYZE in order", async () => {
      const harness = createHarness();

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      const { log, sql } = harness;
      const positions = [
        indexOfMatch(log, /^\s*BEGIN/i),
        log.indexOf(sql.clear),
        log.indexOf(sql.resetSequence),
        log.indexOf(sql.loadRural),
        log.indexOf(sql.loadUrbano),
        log.indexOf(sql.repairSequence),
        indexOfMatch(log, /^\s*COMMIT/i),
        log.indexOf(sql.analyze),
      ];
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      expect(result.targetModified).toBe(true);
      expect(result.analyze.status).toBe(AnalyzeStatus.OK);
      expect(result.outcomeUnknown).toBeFalsy();
    });

    it("AC-13: should report rows read, groups, rowsMerged, repaired and inserted for the rural type", async () => {
      const harness = createHarness({ reports: { rural: { rowsRead: 10, groups: 7, repaired: 2 } }, inserted: { rural: 7 } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.report.rural).toMatchObject({
        rowsRead: 10,
        groups: 7,
        rowsMerged: 3,
        repaired: 2,
        inserted: 7,
        noGeometry: 0,
        nullKeyRows: 0,
        attributeConflicts: 0,
      });
    });

    it("AC-13: should report rowsMerged 0 when every group has a single row", async () => {
      const harness = createHarness({ reports: { urbano: { rowsRead: 5, groups: 5 } }, inserted: { urbano: 5 } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.report.urbano).toMatchObject({ rowsRead: 5, groups: 5, rowsMerged: 0, inserted: 5 });
    });

    it("AC-13: should report insertedInvalid and repairedInUnion per type when repair is off", async () => {
      const options = defaultOptions({ repair: false });
      const harness = createHarness(
        { reports: { rural: { insertedInvalid: 1, repairedInUnion: 2 }, urbano: { insertedInvalid: 3, repairedInUnion: 4 } } },
        defaultParams({ options })
      );

      const result = await runCargarPadrones(defaultParams({ options }), harness.deps);

      expect(result.report.rural).toMatchObject({ insertedInvalid: 1, repairedInUnion: 2 });
      expect(result.report.urbano).toMatchObject({ insertedInvalid: 3, repairedInUnion: 4 });
    });

    it("AC-13: should report the elapsed ms of every step", async () => {
      const harness = createHarness();

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.stepTimings.length).toBeGreaterThan(0);
      for (const timing of result.stepTimings) {
        expect(timing.label).toBeTypeOf("string");
        expect(timing.label.length).toBeGreaterThan(0);
        expect(timing.ms).toBeGreaterThanOrEqual(0);
      }
    });

    it("AC-7: should use the real (resolved) column names of sources and target in the load statements", async () => {
      const names = { rural: { nomdepto: "NOMDEPTO", padron: "Padron" }, urbano: { nomloccat: "NomLocCat" }, target: { geom: "the_geom" } };
      const harness = createHarness({ names });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.log).toContain(harness.sql.loadRural);
      expect(harness.log).toContain(harness.sql.loadUrbano);
      expect(result.targetModified).toBe(true);
    });

    it("AC-8: should reproject to srid 0 (no transform) when the target geometry column has no SRID", async () => {
      const harness = createHarness({ geomType: { target: "geometry(MultiPolygon,0)" } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.targetLayout.srid).toBe(0);
      expect(harness.log).toContain(harness.sql.loadRural);
      expect(result.targetModified).toBe(true);
    });

    it("AC-5: should accept Polygon source geometry columns as well as MultiPolygon", async () => {
      const harness = createHarness({ geomType: { rural: `geometry(Polygon,${SRID})` } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.targetModified).toBe(true);
    });
  });

  describe("source validation (AC-5)", () => {
    it("AC-5: should refuse a rural source with zero rows before any write, naming the table", async () => {
      const harness = createHarness({ counts: { rural: 0 } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(new RegExp(RURAL));

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.log).not.toContain(harness.sql.clear);
    });

    it("AC-5: should refuse an urban source with zero rows before any write, naming the table", async () => {
      const harness = createHarness({ counts: { urbano: 0 } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(new RegExp(URBANO));

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.log).not.toContain(harness.sql.clear);
    });

    it.each([
      ["Point", "rural", RURAL],
      ["LineString", "urbano", URBANO],
    ] as const)("AC-5: should refuse a %s geometry column in the %s source before any write", async (type, side, table) => {
      const harness = createHarness({ geomType: { [side]: `geometry(${type},${SRID})` } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(new RegExp(table));

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.log).not.toContain(harness.sql.clear);
    });
  });

  describe("required columns", () => {
    it("AC-2: should refuse before any write when a required rural column is missing, naming table and column", async () => {
      const harness = createHarness({ omit: { rural: ["valreal"] } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(
        new RegExp(`(?=[\\s\\S]*${RURAL})(?=[\\s\\S]*valreal)`)
      );

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.log).not.toContain(harness.sql.clear);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
    });

    it("AC-2: should refuse before any write when a required urban column is missing, naming table and column", async () => {
      const harness = createHarness({ omit: { urbano: ["nomloccat"] } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(
        new RegExp(`(?=[\\s\\S]*${URBANO})(?=[\\s\\S]*nomloccat)`)
      );

      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("AC-2: should refuse before any write when a required target column is missing, naming table and column", async () => {
      const harness = createHarness({ omit: { target: ["archivo"] } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(
        new RegExp(`(?=[\\s\\S]*${TARGET})(?=[\\s\\S]*archivo)`)
      );

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
    });

    it("AC-2: should refuse before any write when a required column is ambiguous in a source, naming table and column", async () => {
      const extra: ColumnRow[] = [
        { column_name: "Sec_Cat", data_type: "text", column_default: null },
        { column_name: "SEC-CAT", data_type: "text", column_default: null },
      ];
      const harness = createHarness({ omit: { rural: ["seccat"] }, extraColumns: { rural: extra } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(
        new RegExp(`(?=[\\s\\S]*${RURAL})(?=[\\s\\S]*seccat)`)
      );

      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("AC-2: should refuse a table that does not exist because every required column is missing", async () => {
      const harness = createHarness();
      const params = defaultParams({ ruralTable: "no_existe" });

      await expect(runCargarPadrones(params, harness.deps)).rejects.toThrow(/no_existe/);

      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("AC-2: should resolve columns whose real names differ in case or separators", async () => {
      const harness = createHarness({ names: { rural: { areaha: "AREA_HA", nomofidel: "Nom_Ofidel" } } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.targetModified).toBe(true);
      expect(harness.log).toContain(harness.sql.loadRural);
    });
  });

  describe("confirmation and dry run", () => {
    it("AC-19: should refuse a real run without confirm and write nothing", async () => {
      const harness = createHarness();

      await expect(runCargarPadrones(defaultParams({ confirm: false }), harness.deps)).rejects.toThrow();

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
    });

    it("AC-18: should accept a dry run without confirm", async () => {
      const harness = createHarness();

      const result = await runCargarPadrones(defaultParams({ dryRun: true, confirm: false }), harness.deps);

      expect(result.targetModified).toBe(false);
    });

    it("AC-18: should clear, insert and count, then ROLLBACK without COMMIT or ANALYZE on a dry run", async () => {
      const harness = createHarness();

      const result = await runCargarPadrones(defaultParams({ dryRun: true }), harness.deps);

      const { log, sql } = harness;
      const begin = indexOfMatch(log, /^\s*BEGIN/i);
      const rollback = indexOfMatch(log, /^\s*ROLLBACK/i);
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(log.indexOf(sql.clear)).toBeGreaterThan(begin);
      expect(log.indexOf(sql.loadRural)).toBeGreaterThan(log.indexOf(sql.clear));
      expect(log.indexOf(sql.loadUrbano)).toBeGreaterThan(log.indexOf(sql.loadRural));
      expect(rollback).toBeGreaterThan(log.indexOf(sql.loadUrbano));
      expect(indexOfMatch(log, /^\s*COMMIT/i)).toBe(-1);
      expect(indexOfMatch(log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(result.targetModified).toBe(false);
      expect(result.analyze.status).toBe(AnalyzeStatus.SKIPPED);
      expect(result.report.rural.inserted).toBe(8);
      expect(result.report.urbano.inserted).toBe(5);
    });
  });

  describe("failure handling", () => {
    it("AC-21: should ROLLBACK, skip COMMIT and ANALYZE and propagate the error when the urban insert fails", async () => {
      const harness = createHarness();
      const failing = createHarness({ failOn: (sql) => (sql === harness.sql.loadUrbano ? new Error("disk full") : undefined) });

      await expect(runCargarPadrones(defaultParams(), failing.deps)).rejects.toThrow(/disk full/);

      expect(indexOfMatch(failing.log, /^\s*ROLLBACK/i)).toBeGreaterThan(failing.log.indexOf(harness.sql.loadUrbano));
      expect(indexOfMatch(failing.log, /^\s*COMMIT/i)).toBe(-1);
      expect(indexOfMatch(failing.log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(failing.state.closed).toBe(1);
    });

    it("AC-21: should ROLLBACK and propagate the error when the clear statement fails", async () => {
      const probe = createHarness();
      const failing = createHarness({ failOn: (sql) => (sql === probe.sql.clear ? new Error("lock timeout") : undefined) });

      await expect(runCargarPadrones(defaultParams(), failing.deps)).rejects.toThrow(/lock timeout/);

      expect(indexOfMatch(failing.log, /^\s*ROLLBACK/i)).toBeGreaterThan(-1);
      expect(indexOfMatch(failing.log, /^\s*COMMIT/i)).toBe(-1);
      expect(failing.log).not.toContain(probe.sql.loadRural);
    });

    it("AC-21: should ROLLBACK when the sequence reset fails before COMMIT", async () => {
      const probe = createHarness();
      const failing = createHarness({ failOn: (sql) => (sql === probe.sql.resetSequence ? new Error("no permission") : undefined) });

      await expect(runCargarPadrones(defaultParams(), failing.deps)).rejects.toThrow(/no permission/);

      expect(indexOfMatch(failing.log, /^\s*ROLLBACK/i)).toBeGreaterThan(-1);
      expect(indexOfMatch(failing.log, /^\s*COMMIT/i)).toBe(-1);
    });

    it("AC-21: should report outcomeUnknown when COMMIT throws and never run ANALYZE", async () => {
      const harness = createHarness({ failOn: (sql) => (/^\s*COMMIT/i.test(sql) ? new Error("connection lost") : undefined) });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.outcomeUnknown).toBe(true);
      expect(result.analyze.status).toBe(AnalyzeStatus.SKIPPED);
      expect(indexOfMatch(harness.log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-20: should report an ANALYZE failure in the result without throwing and keep the commit", async () => {
      const probe = createHarness();
      const harness = createHarness({ failOn: (sql) => (sql === probe.sql.analyze ? new Error("analyze denied") : undefined) });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.targetModified).toBe(true);
      expect(result.analyze.status).toBe(AnalyzeStatus.FAILED);
      expect(result.analyze.message).toContain("analyze denied");
      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBe(-1);
      expect(result.outcomeUnknown).toBeFalsy();
    });

    it("AC-21: should close the session after a successful run", async () => {
      const harness = createHarness();

      await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.state.closed).toBe(1);
    });

    it("AC-21: should close the session when the run is refused before any write", async () => {
      const harness = createHarness({ counts: { rural: 0 } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow();

      expect(harness.state.closed).toBe(1);
    });

    it("AC-19: should close the session when confirm is missing", async () => {
      const harness = createHarness();

      await expect(runCargarPadrones(defaultParams({ confirm: false }), harness.deps)).rejects.toThrow();

      expect(harness.state.closed).toBeLessThanOrEqual(1);
      expect(harness.state.closed).toBe(harness.openSession.mock.calls.length);
    });

    it("should never put the password in a thrown message when the session fails to open", async () => {
      const deps: RunDeps = {
        openSession: vi.fn(async () => {
          throw new Error(`password authentication failed: ${PASSWORD}`);
        }),
        now: () => 0,
      };

      const failure = await runCargarPadrones(defaultParams(), deps).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(PASSWORD);
    });

    it("should never put the password in a thrown message when a statement fails", async () => {
      const probe = createHarness();
      const failing = createHarness({
        failOn: (sql) => (sql === probe.sql.loadRural ? new Error(`server said password=${PASSWORD}`) : undefined),
      });

      const failure = await runCargarPadrones(defaultParams(), failing.deps).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(PASSWORD);
    });

    it("should never put the password in the result or its warnings", async () => {
      const harness = createHarness({ reports: { rural: { nullKeyRows: 2, noGeometry: 1 } } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    });
  });

  describe("clearing the target", () => {
    it("AC-15: should issue the DELETE clear statement inside the transaction by default and not check TRUNCATE privilege", async () => {
      const harness = createHarness();

      await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.sql.clear).toMatch(/^\s*DELETE FROM/i);
      expect(harness.log).toContain(harness.sql.clear);
      expect(indexOfMatch(harness.log, /has_table_privilege/i)).toBe(-1);
    });

    it("AC-15: should issue a TRUNCATE without CASCADE inside the transaction in truncate mode", async () => {
      const options = defaultOptions({ clearMode: "truncate" });
      const harness = createHarness({}, defaultParams({ options }));

      await runCargarPadrones(defaultParams({ options }), harness.deps);

      expect(harness.sql.clear).toMatch(/^\s*TRUNCATE/i);
      expect(harness.log).toContain(harness.sql.clear);
      expect(indexOfMatch(harness.log, /CASCADE/i)).toBe(-1);
      expect(harness.log.indexOf(harness.sql.clear)).toBeGreaterThan(indexOfMatch(harness.log, /^\s*BEGIN/i));
    });

    it("AC-16: should check has_table_privilege before BEGIN in truncate mode", async () => {
      const options = defaultOptions({ clearMode: "truncate" });
      const harness = createHarness({}, defaultParams({ options }));

      await runCargarPadrones(defaultParams({ options }), harness.deps);

      const privilege = indexOfMatch(harness.log, /has_table_privilege/i);
      expect(privilege).toBeGreaterThanOrEqual(0);
      expect(privilege).toBeLessThan(indexOfMatch(harness.log, /^\s*BEGIN/i));
    });

    it("AC-16: should refuse TRUNCATE without privilege with a Spanish message naming the table and write nothing", async () => {
      const options = defaultOptions({ clearMode: "truncate" });
      const harness = createHarness({ privilege: false }, defaultParams({ options }));

      await expect(runCargarPadrones(defaultParams({ options }), harness.deps)).rejects.toThrow(
        new RegExp(`(?=[\\s\\S]*${TARGET})(?=[\\s\\S]*(privilegio|permiso))`, "i")
      );

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.log).not.toContain(harness.sql.clear);
    });

    it("AC-16: should refuse TRUNCATE when another table has a foreign key to the target and write nothing", async () => {
      const options = defaultOptions({ clearMode: "truncate" });
      const harness = createHarness({ referencingTables: ["hija_padron"] }, defaultParams({ options }));

      await expect(runCargarPadrones(defaultParams({ options }), harness.deps)).rejects.toThrow();

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(harness.log).not.toContain(harness.sql.clear);
    });

    it("AC-16: should still allow DELETE mode when another table has a foreign key to the target", async () => {
      const harness = createHarness({ referencingTables: ["hija_padron"] });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.targetModified).toBe(true);
    });
  });

  describe("sequences", () => {
    it.each(["delete", "truncate"] as const)(
      "AC-17: should reset the unmapped sequences right after the clear and before the rural insert in %s mode",
      async (clearMode) => {
        const options = defaultOptions({ clearMode });
        const harness = createHarness({}, defaultParams({ options }));

        await runCargarPadrones(defaultParams({ options }), harness.deps);

        const reset = harness.log.indexOf(harness.sql.resetSequence);
        expect(reset).toBeGreaterThan(harness.log.indexOf(harness.sql.clear));
        expect(reset).toBeLessThan(harness.log.indexOf(harness.sql.loadRural));
      }
    );

    it.each(["delete", "truncate"] as const)(
      "AC-17: should repair every unmapped sequence after the urban insert and before COMMIT in %s mode",
      async (clearMode) => {
        const options = defaultOptions({ clearMode });
        const harness = createHarness({}, defaultParams({ options }));

        await runCargarPadrones(defaultParams({ options }), harness.deps);

        const repair = harness.log.indexOf(harness.sql.repairSequence);
        expect(repair).toBeGreaterThan(harness.log.indexOf(harness.sql.loadUrbano));
        expect(repair).toBeLessThan(indexOfMatch(harness.log, /^\s*COMMIT/i));
      }
    );

    it("AC-17: should neither reset nor repair any sequence when resetSequences is off", async () => {
      const options = defaultOptions({ resetSequences: false });
      const harness = createHarness({}, defaultParams({ options }));

      await runCargarPadrones(defaultParams({ options }), harness.deps);

      expect(indexOfMatch(harness.log, /setval\(/i)).toBe(-1);
      expect(harness.log).not.toContain(harness.sql.resetSequence);
      expect(harness.log).not.toContain(harness.sql.repairSequence);
    });

    it.each(["delete", "truncate"] as const)(
      "AC-18: should run no setval statement at all on a dry run with resetSequences on in %s mode",
      async (clearMode) => {
        const options = defaultOptions({ clearMode, resetSequences: true });
        const harness = createHarness({}, defaultParams({ options, dryRun: true }));

        const result = await runCargarPadrones(defaultParams({ options, dryRun: true }), harness.deps);

        expect(indexOfMatch(harness.log, /setval\(/i)).toBe(-1);
        expect(harness.log).not.toContain(harness.sql.resetSequence);
        expect(harness.log).not.toContain(harness.sql.repairSequence);
        expect(result.targetModified).toBe(false);
      }
    );
  });

  describe("failure after the sequence reset (AC-17)", () => {
    const failingAt = (pick: (sql: Harness["sql"]) => string, message = "disk full", extra?: Partial<Scenario>) => {
      const probe = createHarness();
      return createHarness({
        failOn: (sql) => (sql === pick(probe.sql) ? new Error(message) : undefined),
        ...extra,
      });
    };
    type Harness = ReturnType<typeof createHarness>;

    const expectRepairedAfterRollback = (harness: Harness, failing: string): void => {
      const { log, sql } = harness;
      const rollback = indexOfMatch(log, /^\s*ROLLBACK/i);
      expect(log.indexOf(sql.resetSequence)).toBeGreaterThan(-1);
      expect(log.indexOf(failing)).toBeGreaterThan(log.indexOf(sql.resetSequence));
      expect(rollback).toBeGreaterThan(log.indexOf(failing));
      expect(log.filter((entry) => entry === sql.repairSequence)).toHaveLength(1);
      expect(log.indexOf(sql.repairSequence)).toBeGreaterThan(rollback);
      expect(indexOfMatch(log, /^\s*BEGIN/i)).toBeLessThan(rollback);
      expect(log.slice(rollback).some((entry) => /^\s*BEGIN/i.test(entry))).toBe(false);
      expect(indexOfMatch(log, /^\s*COMMIT/i)).toBe(-1);
      expect(indexOfMatch(log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(harness.state.closed).toBe(1);
    };

    it("AC-17: should ROLLBACK and then repair the sequences when the rural insert fails", async () => {
      const harness = failingAt((sql) => sql.loadRural);

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(/disk full/);

      expectRepairedAfterRollback(harness, harness.sql.loadRural);
    });

    it("AC-17: should ROLLBACK and then repair the sequences when the urban insert fails", async () => {
      const harness = failingAt((sql) => sql.loadUrbano);

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(/disk full/);

      expectRepairedAfterRollback(harness, harness.sql.loadUrbano);
    });

    it("AC-17: should ROLLBACK and then repair the sequences when a report query fails", async () => {
      const harness = failingAt((sql) => sql.reportRural);

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(/disk full/);

      expectRepairedAfterRollback(harness, harness.sql.reportRural);
    });

    it("AC-17: should ROLLBACK and then repair the sequences when inserted rows differ from groups", async () => {
      const harness = createHarness({ inserted: { urbano: 4 } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow();

      expectRepairedAfterRollback(harness, harness.sql.loadUrbano);
    });

    it("AC-17: should still throw the original scrubbed error when the repair statement itself fails", async () => {
      const probe = createHarness();
      const harness = createHarness({
        failOn: (sql) => {
          if (sql === probe.sql.loadUrbano) return new Error(`disk full password=${PASSWORD}`);
          if (sql === probe.sql.repairSequence) return new Error("repair denied");
          return undefined;
        },
      });

      const failure = await runCargarPadrones(defaultParams(), harness.deps).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("disk full");
      expect((failure as Error).message).not.toContain("repair denied");
      expect((failure as Error).message).not.toContain(PASSWORD);
      expect(harness.log).toContain(harness.sql.repairSequence);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-17: should ROLLBACK and then repair the sequences when the reset itself fails, rethrowing the original error", async () => {
      const harness = failingAt((sql) => sql.resetSequence, `no permission password=${PASSWORD}`);

      const failure = await runCargarPadrones(defaultParams(), harness.deps).catch((error: unknown) => error);

      const { log, sql } = harness;
      const rollback = indexOfMatch(log, /^\s*ROLLBACK/i);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("no permission");
      expect((failure as Error).message).not.toContain(PASSWORD);
      expect(rollback).toBeGreaterThan(log.indexOf(sql.resetSequence));
      expect(log.filter((entry) => entry === sql.repairSequence)).toHaveLength(1);
      expect(log.indexOf(sql.repairSequence)).toBeGreaterThan(rollback);
      expect(indexOfMatch(log, /^\s*COMMIT/i)).toBe(-1);
      expect(indexOfMatch(log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(log).not.toContain(sql.loadRural);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-17: should ROLLBACK quietly and repair the sequences again when COMMIT throws after the reset, keeping outcomeUnknown", async () => {
      const harness = createHarness({
        failOn: (sql) => (/^\s*COMMIT/i.test(sql) ? new Error(`connection lost password=${PASSWORD}`) : undefined),
      });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      const { log, sql } = harness;
      const commit = indexOfMatch(log, /^\s*COMMIT/i);
      const repairs = log.flatMap((entry, position) => (entry === sql.repairSequence ? [position] : []));
      const rollback = indexOfMatch(log, /^\s*ROLLBACK/i);
      expect(log.indexOf(sql.resetSequence)).toBeLessThan(log.indexOf(sql.loadRural));
      expect(log.indexOf(sql.loadRural)).toBeLessThan(log.indexOf(sql.loadUrbano));
      expect(repairs).toHaveLength(2);
      expect(repairs[0]).toBeLessThan(commit);
      expect(commit).toBeLessThan(rollback);
      expect(rollback).toBeLessThan(repairs[1]);
      expect(log.slice(commit + 1).filter((entry) => /setval\(/i.test(entry))).toEqual([sql.repairSequence]);
      expect(indexOfMatch(log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(result.outcomeUnknown).toBe(true);
      expect(result.targetModified).toBe(false);
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-17: should not touch any sequence when COMMIT throws and resetSequences is off", async () => {
      const options = defaultOptions({ resetSequences: false });
      const params = defaultParams({ options });
      const harness = createHarness(
        { failOn: (sql) => (/^\s*COMMIT/i.test(sql) ? new Error("connection lost") : undefined) },
        params
      );

      const result = await runCargarPadrones(params, harness.deps);

      expect(result.outcomeUnknown).toBe(true);
      expect(indexOfMatch(harness.log, /setval\(/i)).toBe(-1);
      expect(indexOfMatch(harness.log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-17: should still return outcomeUnknown without throwing when the repair after a failed COMMIT also fails", async () => {
      const probe = createHarness();
      let committed = false;
      const harness = createHarness({
        failOn: (sql) => {
          if (/^\s*COMMIT/i.test(sql)) {
            committed = true;
            return new Error("connection lost");
          }
          if (committed && sql === probe.sql.repairSequence) return new Error("repair denied");
          return undefined;
        },
      });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.outcomeUnknown).toBe(true);
      expect(result.targetModified).toBe(false);
      expect(harness.log.filter((entry) => entry === harness.sql.repairSequence)).toHaveLength(2);
      expect(indexOfMatch(harness.log, /^\s*ANALYZE\b/i)).toBe(-1);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-17: should not repair any sequence when the clear fails before the reset", async () => {
      const harness = failingAt((sql) => sql.clear, "lock timeout");

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(/lock timeout/);

      expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThan(-1);
      expect(harness.log).not.toContain(harness.sql.resetSequence);
      expect(harness.log).not.toContain(harness.sql.repairSequence);
      expect(indexOfMatch(harness.log, /setval\(/i)).toBe(-1);
    });

    it("AC-17: should not repair any sequence when resetSequences is off and an insert fails", async () => {
      const options = defaultOptions({ resetSequences: false });
      const params = defaultParams({ options });
      const probe = createHarness({}, params);
      const harness = createHarness(
        { failOn: (sql) => (sql === probe.sql.loadUrbano ? new Error("disk full") : undefined) },
        params
      );

      await expect(runCargarPadrones(params, harness.deps)).rejects.toThrow(/disk full/);

      expect(indexOfMatch(harness.log, /setval\(/i)).toBe(-1);
    });

    it("AC-17: should not repair any sequence when a dry run fails", async () => {
      const params = defaultParams({ dryRun: true });
      const probe = createHarness({}, params);
      const harness = createHarness(
        { failOn: (sql) => (sql === probe.sql.loadUrbano ? new Error("disk full") : undefined) },
        params
      );

      await expect(runCargarPadrones(params, harness.deps)).rejects.toThrow(/disk full/);

      expect(indexOfMatch(harness.log, /setval\(/i)).toBe(-1);
    });
  });

  describe("one query at a time per session", () => {
    it("AC-13: should never issue a query while another is pending during layout and catalog resolution", async () => {
      const harness = createHarness();

      await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.state.maxBeforeBegin).toBe(1);
    });

    it("AC-13: should never issue a query while another is pending inside the transaction (reports included)", async () => {
      const harness = createHarness();

      await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.state.maxAfterBegin).toBe(1);
    });

    it("AC-13: should keep queries sequential in truncate mode (privilege check, FK check, transaction)", async () => {
      const options = defaultOptions({ clearMode: "truncate" });
      const harness = createHarness({}, defaultParams({ options }));

      await runCargarPadrones(defaultParams({ options }), harness.deps);

      expect(indexOfMatch(harness.log, /has_table_privilege/i)).toBeGreaterThan(-1);
      expect(harness.state.maxBeforeBegin).toBe(1);
      expect(harness.state.maxAfterBegin).toBe(1);
    });

    it("AC-13: should keep queries sequential on a dry run as well", async () => {
      const harness = createHarness();

      await runCargarPadrones(defaultParams({ dryRun: true }), harness.deps);

      expect(Math.max(harness.state.maxBeforeBegin, harness.state.maxAfterBegin)).toBe(1);
    });
  });

  describe("insert consistency and distinct tables (AC-14b)", () => {
    it.each([
      ["rural", { rural: 7 }],
      ["urbano", { urbano: 4 }],
    ] as const)(
      "AC-14b: should roll back with a Spanish error when the %s inserted rows differ from its groups",
      async (_side, inserted) => {
        const harness = createHarness({ inserted: { ...inserted } });

        const failure = await runCargarPadrones(defaultParams(), harness.deps).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toMatch(/inserta|filas|grupos/i);
        expect(indexOfMatch(harness.log, /^\s*ROLLBACK/i)).toBeGreaterThan(-1);
        expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
        expect(indexOfMatch(harness.log, /^\s*ANALYZE\b/i)).toBe(-1);
        expect(harness.state.closed).toBe(1);
      }
    );

    it("AC-14b: should also fail a dry run when the inserted rows differ from the groups", async () => {
      const harness = createHarness({ inserted: { urbano: 4 } });

      await expect(runCargarPadrones(defaultParams({ dryRun: true }), harness.deps)).rejects.toThrow();

      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBe(-1);
    });

    it("AC-14b: should accept the run when inserted rows equal the groups of both types", async () => {
      const harness = createHarness({ inserted: { rural: 8, urbano: 5 } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.targetModified).toBe(true);
    });

    it.each([
      ["rural and urban", { ruralTable: URBANO }],
      ["rural and target", { ruralTable: TARGET }],
      ["urban and target", { urbanoTable: TARGET }],
    ] as const)(
      "AC-14b: should refuse before any write when the %s tables are the same table",
      async (_label, overrides) => {
        const params = defaultParams({ ...overrides });
        const harness = createHarness({ allColumns: true }, params);

        const failure = await runCargarPadrones(params, harness.deps).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toMatch(/distint|diferent/i);
        expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
        expect(harness.log.filter(isWrite)).toEqual([]);
      }
    );
  });

  describe("warnings and diagnostics", () => {
    it("AC-10: should warn in Spanish about null-key rows with the affected count", async () => {
      const harness = createHarness({ reports: { rural: { nullKeyRows: 3 } } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.report.rural.nullKeyRows).toBe(3);
      expect(result.warnings.some((warning) => /3/.test(warning) && /clave|nul/i.test(warning))).toBe(true);
    });

    it("AC-6: should warn in Spanish about rows without usable geometry with the affected count", async () => {
      const harness = createHarness({ reports: { urbano: { noGeometry: 4 } } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.report.urbano.noGeometry).toBe(4);
      expect(result.warnings.some((warning) => /4/.test(warning) && /geometr/i.test(warning))).toBe(true);
    });

    it("AC-11: should report attribute conflicts with their samples and warn", async () => {
      const samples = [{ key: "MONTEVIDEO|123", column: "seccat", values: ["1", "2"] }];
      const harness = createHarness({ reports: { rural: { attributeConflicts: 1 } }, samples: { rural: samples } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.report.rural.attributeConflicts).toBe(1);
      expect(result.report.rural.attributeConflictSamples).toEqual(samples);
      expect(result.warnings.some((warning) => /conflicto/i.test(warning))).toBe(true);
      expect(result.targetModified).toBe(true);
    });

    it("AC-6: should warn that the target holds invalid geometries when repair is off and insertedInvalid is positive", async () => {
      const options = defaultOptions({ repair: false });
      const harness = createHarness({ reports: { rural: { insertedInvalid: 2 } } }, defaultParams({ options }));

      const result = await runCargarPadrones(defaultParams({ options }), harness.deps);

      expect(result.warnings.some((warning) => /2/.test(warning) && /inv[aá]lid/i.test(warning))).toBe(true);
      expect(result.targetModified).toBe(true);
    });

    it("AC-6: should warn about geometries repaired inside the union when repairedInUnion is positive", async () => {
      const options = defaultOptions({ repair: false });
      const harness = createHarness({ reports: { urbano: { repairedInUnion: 5 } } }, defaultParams({ options }));

      const result = await runCargarPadrones(defaultParams({ options }), harness.deps);

      expect(result.warnings.some((warning) => /5/.test(warning) && /uni[oó]n/i.test(warning))).toBe(true);
    });

    it("AC-12: should list ambiguous locality codes and warn without blocking the load", async () => {
      const codes = [{ coddepto: 10, codloccat: 77, nomloccat: ["A", "B"] }];
      const harness = createHarness({ ambiguousCodes: codes });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.ambiguousLocalityCodes).toEqual(codes);
      expect(result.warnings.some((warning) => /localidad/i.test(warning))).toBe(true);
      expect(result.targetModified).toBe(true);
    });

    it("AC-12: should return an empty ambiguous list and no warnings when everything is clean", async () => {
      const harness = createHarness();

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.ambiguousLocalityCodes).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe("geometry column typing", () => {
    it("AC-8: should not refuse a target geometry column typed plain geometry and should skip the transform (srid 0)", async () => {
      const harness = createHarness({ geomType: { target: "geometry" } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.targetLayout.srid).toBe(0);
      expect(harness.log).toContain(harness.sql.loadRural);
      expect(harness.log).toContain(harness.sql.loadUrbano);
      expect(harness.sql.loadRural).not.toMatch(/ST_Transform/i);
      expect(result.targetModified).toBe(true);
    });

    it.each(["rural", "urbano"] as const)("AC-5: should not refuse a %s source geometry column typed plain geometry", async (side) => {
      const harness = createHarness({ geomType: { [side]: "geometry" } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(harness.log).toContain(harness.sql.loadRural);
      expect(harness.log).toContain(harness.sql.loadUrbano);
      expect(result.targetModified).toBe(true);
    });

    it("AC-5: should still refuse a Point typmod source even when the other source is plain geometry", async () => {
      const harness = createHarness({ geomType: { rural: "geometry", urbano: `geometry(Point,${SRID})` } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(new RegExp(URBANO));

      expect(harness.log.filter(isWrite)).toEqual([]);
    });

    it("AC-8: should refuse a Polygon target before BEGIN or any write with a Spanish message naming the table and MultiPolygon", async () => {
      const harness = createHarness({ geomType: { target: `geometry(Polygon,${SRID})` } });

      await expect(runCargarPadrones(defaultParams(), harness.deps)).rejects.toThrow(
        new RegExp(`(?=[\\s\\S]*${TARGET})(?=[\\s\\S]*MultiPol)`, "i")
      );

      expect(harness.log.filter(isWrite)).toEqual([]);
      expect(indexOfMatch(harness.log, /^\s*BEGIN/i)).toBe(-1);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-8: should accept a MultiPolygon target", async () => {
      const harness = createHarness({ geomType: { target: `geometry(MultiPolygon,${SRID})` } });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.targetModified).toBe(true);
    });
  });

  describe("totals and rowsMerged", () => {
    it("AC-13: should sum rural and urbano rowsRead, groups, rowsMerged and inserted into totals", async () => {
      const harness = createHarness({
        reports: { rural: { rowsRead: 10, groups: 7 }, urbano: { rowsRead: 6, groups: 4 } },
        inserted: { rural: 7, urbano: 4 },
      });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.totals).toEqual({ rowsRead: 16, groups: 11, rowsMerged: 5, inserted: 11 });
    });

    it("AC-13: should compute totals when one side reports zero rows", async () => {
      const harness = createHarness({
        reports: { rural: { rowsRead: 0, groups: 0 }, urbano: { rowsRead: 6, groups: 5 } },
        inserted: { rural: 0, urbano: 5 },
      });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.totals).toEqual({ rowsRead: 6, groups: 5, rowsMerged: 1, inserted: 5 });
    });

    it("AC-13: should not count rows excluded for null key or missing geometry in rowsMerged", async () => {
      const harness = createHarness({
        reports: { rural: { rowsRead: 10, nullKeyRows: 1, noGeometry: 1, groups: 6 } },
        inserted: { rural: 6 },
      });

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.report.rural.rowsMerged).toBe(2);
    });
  });

  /*
   * Assumption (derived from the runner's STEP constants): the reported steps are exactly the ones the runner times, in order:
   * validate, count, [privileges when truncate], clear, [sequence reset when resetSequences and not dry run], rural, urban, report,
   * [sequence repair when resetSequences and not dry run], [COMMIT, ANALYZE when not dry run]. `total` is the planned count of that list.
   */
  describe("progress reporting (AC-27)", () => {
    type Progress = { label: string; current: number; total: number };
    const collector = () => {
      const calls: Progress[] = [];
      return { calls, onProgress: (progress: Progress) => void calls.push({ ...progress }) };
    };
    const expectSequence = (calls: Progress[], labels: string[]): void => {
      expect(calls).toEqual(labels.map((label, index) => ({ label, current: index + 1, total: labels.length })));
    };

    const VALIDATE = "Validación de tablas";
    const COUNT = "Conteo de filas";
    const PRIVILEGES = "Privilegios de vaciado";
    const CLEAR = "Vaciado de la tabla destino";
    const RESET = "Reinicio de secuencias";
    const LOAD_RURAL = "Carga rural";
    const LOAD_URBANO = "Carga urbana";
    const REPORT = "Reportes y muestras";
    const REPAIR = "Ajuste de secuencias";

    it("AC-27: should report every step of a real run once, in order, with a 1-based current and the real total", async () => {
      const harness = createHarness();
      const { calls, onProgress } = collector();

      await runCargarPadrones(defaultParams(), harness.deps, onProgress);

      expectSequence(calls, [VALIDATE, COUNT, CLEAR, RESET, LOAD_RURAL, LOAD_URBANO, REPORT, REPAIR, "COMMIT", "ANALYZE"]);
    });

    it("AC-27: should report the same labels, in the same order, as the step timings of the result", async () => {
      const harness = createHarness();
      const { calls, onProgress } = collector();

      const result = await runCargarPadrones(defaultParams(), harness.deps, onProgress);

      expect(calls.map((call) => call.label)).toEqual(result.stepTimings.map((timing) => timing.label));
      expect(calls.every((call) => call.total === result.stepTimings.length)).toBe(true);
    });

    it("AC-27: should report only the steps a dry run executes (no sequences, COMMIT or ANALYZE)", async () => {
      const harness = createHarness();
      const { calls, onProgress } = collector();

      await runCargarPadrones(defaultParams({ dryRun: true }), harness.deps, onProgress);

      expectSequence(calls, [VALIDATE, COUNT, CLEAR, LOAD_RURAL, LOAD_URBANO, REPORT]);
    });

    it("AC-27: should add the privilege step to the total in truncate mode", async () => {
      const options = defaultOptions({ clearMode: "truncate" });
      const harness = createHarness({}, defaultParams({ options }));
      const { calls, onProgress } = collector();

      await runCargarPadrones(defaultParams({ options }), harness.deps, onProgress);

      expectSequence(calls, [VALIDATE, COUNT, PRIVILEGES, CLEAR, RESET, LOAD_RURAL, LOAD_URBANO, REPORT, REPAIR, "COMMIT", "ANALYZE"]);
    });

    it("AC-27: should report a dry run in truncate mode with the privilege step and no write-only steps", async () => {
      const options = defaultOptions({ clearMode: "truncate" });
      const params = defaultParams({ options, dryRun: true });
      const harness = createHarness({}, params);
      const { calls, onProgress } = collector();

      await runCargarPadrones(params, harness.deps, onProgress);

      expectSequence(calls, [VALIDATE, COUNT, PRIVILEGES, CLEAR, LOAD_RURAL, LOAD_URBANO, REPORT]);
    });

    it("AC-27: should leave out the sequence steps when resetSequences is off", async () => {
      const options = defaultOptions({ resetSequences: false });
      const harness = createHarness({}, defaultParams({ options }));
      const { calls, onProgress } = collector();

      await runCargarPadrones(defaultParams({ options }), harness.deps, onProgress);

      expectSequence(calls, [VALIDATE, COUNT, CLEAR, LOAD_RURAL, LOAD_URBANO, REPORT, "COMMIT", "ANALYZE"]);
    });

    it("AC-27: should call onProgress as each step starts, before the step's statements run", async () => {
      const harness = createHarness();
      const logLengthAt: Record<string, number> = {};
      const onProgress = (progress: Progress): void => {
        logLengthAt[progress.label] = harness.log.length;
      };

      await runCargarPadrones(defaultParams(), harness.deps, onProgress);

      const { log, sql } = harness;
      expect(log.indexOf(sql.loadRural)).toBeGreaterThanOrEqual(logLengthAt[LOAD_RURAL]);
      expect(log.indexOf(sql.loadRural)).toBeLessThan(logLengthAt[LOAD_URBANO]);
      expect(log.indexOf(sql.loadUrbano)).toBeGreaterThanOrEqual(logLengthAt[LOAD_URBANO]);
      expect(log.indexOf(sql.clear)).toBeGreaterThanOrEqual(logLengthAt[CLEAR]);
      expect(log.indexOf(sql.analyze)).toBeGreaterThanOrEqual(logLengthAt.ANALYZE);
      expect(indexOfMatch(log, /^\s*COMMIT/i)).toBeGreaterThanOrEqual(logLengthAt.COMMIT);
    });

    it("AC-27: should report the steps reached and none after the failing one when the run fails", async () => {
      const probe = createHarness();
      const failing = createHarness({ failOn: (sql) => (sql === probe.sql.loadUrbano ? new Error("disk full") : undefined) });
      const { calls, onProgress } = collector();

      await expect(runCargarPadrones(defaultParams(), failing.deps, onProgress)).rejects.toThrow(/disk full/);

      expect(calls.map((call) => call.label)).toEqual([VALIDATE, COUNT, CLEAR, RESET, LOAD_RURAL, LOAD_URBANO]);
      expect(calls.every((call) => call.total === 10)).toBe(true);
      expect(calls.map((call) => call.current)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("AC-27: should report only the validation and count steps when a source is empty", async () => {
      const harness = createHarness({ counts: { rural: 0 } });
      const { calls, onProgress } = collector();

      await expect(runCargarPadrones(defaultParams(), harness.deps, onProgress)).rejects.toThrow();

      expect(calls.map((call) => call.label)).toEqual([VALIDATE, COUNT]);
    });

    it("AC-27: should not report any step when the run is refused before opening the session", async () => {
      const harness = createHarness();
      const { calls, onProgress } = collector();

      await expect(runCargarPadrones(defaultParams({ confirm: false }), harness.deps, onProgress)).rejects.toThrow();

      expect(calls).toEqual([]);
    });

    it("AC-27: should never fail the run when onProgress throws", async () => {
      const harness = createHarness();
      const onProgress = vi.fn(() => {
        throw new Error("progress sink exploded");
      });

      const result = await runCargarPadrones(defaultParams(), harness.deps, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(10);
      expect(result.targetModified).toBe(true);
      expect(result.analyze.status).toBe(AnalyzeStatus.OK);
      expect(indexOfMatch(harness.log, /^\s*COMMIT/i)).toBeGreaterThan(-1);
      expect(harness.state.closed).toBe(1);
    });

    it("AC-27: should never fail a dry run when onProgress throws", async () => {
      const harness = createHarness();
      const onProgress = vi.fn(() => {
        throw new Error("progress sink exploded");
      });

      const result = await runCargarPadrones(defaultParams({ dryRun: true }), harness.deps, onProgress);

      expect(result.targetModified).toBe(false);
      expect(onProgress).toHaveBeenCalledTimes(6);
    });

    it("AC-27: should not mask the run's own error when onProgress throws and the run fails", async () => {
      const probe = createHarness();
      const failing = createHarness({ failOn: (sql) => (sql === probe.sql.loadRural ? new Error("disk full") : undefined) });
      const onProgress = vi.fn(() => {
        throw new Error("progress sink exploded");
      });

      const failure = await runCargarPadrones(defaultParams(), failing.deps, onProgress).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("disk full");
      expect((failure as Error).message).not.toContain("progress sink exploded");
    });

    it("AC-27: should report COMMIT as step 9 of 10, never ANALYZE, and never reach total when COMMIT throws", async () => {
      const harness = createHarness({ failOn: (sql) => (/^\s*COMMIT/i.test(sql) ? new Error("connection lost") : undefined) });
      const { calls, onProgress } = collector();

      const result = await runCargarPadrones(defaultParams(), harness.deps, onProgress);

      expect(result.outcomeUnknown).toBe(true);
      expect(calls).toHaveLength(9);
      expect(calls[8]).toEqual({ label: "COMMIT", current: 9, total: 10 });
      expect(calls.map((call) => call.label)).not.toContain("ANALYZE");
      expect(calls.every((call) => call.total === 10)).toBe(true);
      expect(Math.max(...calls.map((call) => call.current))).toBeLessThan(10);
    });

    it("AC-27: should run normally when no onProgress is given", async () => {
      const harness = createHarness();

      const result = await runCargarPadrones(defaultParams(), harness.deps);

      expect(result.targetModified).toBe(true);
    });

    it("AC-27: should keep the result identical whether or not onProgress is given", async () => {
      const withCallback = createHarness();
      const without = createHarness();

      const reported = await runCargarPadrones(defaultParams(), withCallback.deps, () => undefined);
      const plain = await runCargarPadrones(defaultParams(), without.deps);

      expect(reported).toEqual(plain);
    });
  });
});
