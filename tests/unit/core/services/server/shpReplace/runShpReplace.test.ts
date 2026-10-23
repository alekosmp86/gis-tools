import { describe, it, expect } from "vitest";
import {
  runShpReplace,
  ShpReplacePhase,
  type RunShpReplaceParams,
  type ShpReplaceProgress,
  type ShpReplaceSession,
} from "@/core/services/server/shpReplace/runShpReplace";
import { SHP_GEOMETRY_SOURCE, type OpenShapefile, type ShpRecordRow } from "@/core/services/server/shpReplace/shpRecordSource";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { SequenceRef } from "@/core/services/replaceSequences";
import { buildRepairSequenceStatement, buildResetSequenceStatement } from "@/core/services/sqlStatements";
import type { DbColumnMetadata } from "@/core/types/db";
import { ShpCommitUncertainError, ShpProcessingBlockedError } from "@/core/services/server/shpReplace/shpReplaceTypes";
import type { GeometryProcessingOptions, GeometryProcessingReport } from "@/core/types/geometryProcessing";
import {
  AreaMode,
  BASE_TABLE,
  UNIFIED_TABLE,
  buildBaseTableSql,
  buildConflictCountSql,
  buildConflictSamplesSql,
  buildGroupStatsSql,
  buildIncompatibleGeometryCountSql,
  buildInvalidCountSql,
  buildNullKeyCountSql,
  buildOverlapCountSql,
  buildOverlapInputSql,
  buildOverlapSamplesSql,
  buildRepairSql,
  buildUnifySql,
} from "@/core/services/server/shpReplace/geometryProcessingSql";

type StatementKind =
  | "BEGIN"
  | "CATALOG"
  | "CREATE_STAGE"
  | "COPY"
  | "STAGE_COUNT"
  | "LOCK"
  | "TARGET_COUNT"
  | "DELETE"
  | "INSERT"
  | "SEQUENCE"
  | "COMMIT"
  | "ROLLBACK"
  | "ANALYZE"
  | "PROCESSING"
  | "WORK_COUNT"
  | "UNKNOWN";

type TargetColumnFixture = DbColumnMetadata & { udt_name: string };

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

interface FakeOptions {
  columns: TargetColumnFixture[];
  geometryRows: Array<{ srid: number; type: string; coord_dimension?: number }>;
  sridRows: Array<{ srid: number; geographic?: boolean }>;
  previousRows: number;
  setvalNextValue: number;
  stageCountOverride?: number;
  insertRowCount?: number;
  copyError?: Error;
  insertError?: Error;
  commitError?: Error;
  analyzeError?: Error;
  onCopyLine?: (line: string) => void;
  canned?: CannedQuery[];
}

interface CannedQuery {
  match: (sql: string) => boolean;
  results: QueryResult[];
}

const STAGE_TABLE_NAME = "shp_replace_stage";
const SOURCE_SRID = 25830;
const POLYGON_JSON = '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}';

const TARGET = { schema_name: "public", table_name: "parcelas" };

const TARGET_COLUMNS: TargetColumnFixture[] = [
  {
    column_name: "id",
    data_type: "integer",
    udt_name: "int4",
    is_nullable: false,
    column_default: "nextval('parcelas_id_seq'::regclass)",
  },
  { column_name: "nombre", data_type: "text", udt_name: "text", is_nullable: true, column_default: null },
  { column_name: "area", data_type: "numeric", udt_name: "numeric", is_nullable: true, column_default: null },
  { column_name: "geom", data_type: "USER-DEFINED", udt_name: "geometry", is_nullable: true, column_default: null },
];

const MAPPING: ReplaceColumnMapping = {
  sourceByTarget: { id: null, nombre: "NOMBRE", area: "AREA", geom: SHP_GEOMETRY_SOURCE },
  defaults: {},
};

const NO_GEOMETRY_MAPPING: ReplaceColumnMapping = {
  sourceByTarget: { id: null, nombre: "NOMBRE", area: "AREA", geom: null },
  defaults: {},
};

const SHP_ROWS: ShpRecordRow[] = [
  { rec: 1, values: { SUID: "A1", NOMBRE: "Alpha", AREA: "12.5" }, geometryJson: POLYGON_JSON },
  { rec: 2, values: { SUID: "A2", NOMBRE: null, AREA: "0" }, geometryJson: null },
  { rec: 3, values: { SUID: "A3", NOMBRE: "Gamma", AREA: "-7.5" }, geometryJson: POLYGON_JSON },
];

const UNMAPPED_SEQUENCE: SequenceRef = {
  qualifiedLabel: "public.parcelas_id_seq",
  schema: "public",
  name: "parcelas_id_seq",
  columns: ["id"],
  mapped: false,
};

const MAPPED_SEQUENCE: SequenceRef = {
  qualifiedLabel: "public.parcelas_area_seq",
  schema: "public",
  name: "parcelas_area_seq",
  columns: ["area"],
  mapped: true,
};

const DEFAULT_OPTIONS: FakeOptions = {
  columns: TARGET_COLUMNS,
  geometryRows: [{ srid: 4326, type: "MULTIPOLYGON" }],
  sridRows: [{ srid: SOURCE_SRID }],
  previousRows: 7,
  setvalNextValue: 42,
};

const SPANISH_MARKER = /\b(el|la|los|las|de|del|no|que|con|para|se|una|un|en)\b|[áéíóúñ¿¡]/i;

function classify(sql: string): StatementKind {
  const text = sql.trim();
  if (/^BEGIN\b/i.test(text)) return "BEGIN";
  if (/^COMMIT\b/i.test(text)) return "COMMIT";
  if (/^ROLLBACK\b/i.test(text)) return "ROLLBACK";
  if (/^INSERT INTO\b/i.test(text)) return "INSERT";
  if (/^SELECT count\(\*\) AS count FROM "shp_proc_(base|unified)"$/i.test(text)) return "WORK_COUNT";
  if (/shp_proc_/.test(text)) return "PROCESSING";
  if (/^COPY\b/i.test(text)) return "COPY";
  if (/^CREATE TEMP TABLE\b/i.test(text)) return "CREATE_STAGE";
  if (/^LOCK TABLE\b/i.test(text)) return "LOCK";
  if (/^DELETE FROM\b/i.test(text)) return "DELETE";
  if (/^INSERT INTO\b/i.test(text)) return "INSERT";
  if (/^ANALYZE\b/i.test(text)) return "ANALYZE";
  if (/information_schema\.columns|geometry_columns|spatial_ref_sys/i.test(text)) return "CATALOG";
  if (/count\(\*\)/i.test(text)) return text.includes(STAGE_TABLE_NAME) ? "STAGE_COUNT" : "TARGET_COUNT";
  if (/setval/i.test(text)) return "SEQUENCE";
  return "UNKNOWN";
}

function collapseConsecutive(kinds: StatementKind[]): StatementKind[] {
  return kinds.filter((kind, index) => index === 0 || kinds[index - 1] !== kind);
}

function rowsResult(rows: object[]): QueryResult {
  return { rows: rows as Array<Record<string, unknown>>, rowCount: rows.length };
}

class FakeSession implements ShpReplaceSession {
  readonly sqlLog: string[] = [];
  readonly kinds: StatementKind[] = [];
  readonly copiedLines: string[] = [];
  closeCount = 0;
  private readonly options: FakeOptions;
  private stagedRowCount = 0;

  constructor(options: FakeOptions) {
    this.options = options;
  }

  async query(sql: string): Promise<QueryResult> {
    const kind = this.record(sql);
    const canned = this.nextCanned(sql);
    if (canned) return canned;
    if (kind === "CATALOG") return this.catalogResult(sql);
    if (kind === "STAGE_COUNT") {
      return rowsResult([{ count: this.options.stageCountOverride ?? this.stagedRowCount }]);
    }
    if (kind === "TARGET_COUNT") return rowsResult([{ count: this.options.previousRows }]);
    if (kind === "SEQUENCE") return rowsResult([{ setval: this.options.setvalNextValue }]);
    if (kind === "INSERT") {
      if (this.options.insertError) throw this.options.insertError;
      return { rows: [], rowCount: this.options.insertRowCount ?? this.stagedRowCount };
    }
    if (kind === "DELETE") return { rows: [], rowCount: this.options.previousRows };
    if (kind === "COMMIT" && this.options.commitError) throw this.options.commitError;
    if (kind === "ANALYZE" && this.options.analyzeError) throw this.options.analyzeError;
    return { rows: [], rowCount: 0 };
  }

  async copyIn(sql: string, lines: Iterable<string>): Promise<number> {
    this.record(sql);
    if (this.options.copyError) throw this.options.copyError;
    let copied = 0;
    for (const line of lines) {
      this.options.onCopyLine?.(line);
      this.copiedLines.push(line);
      copied += 1;
    }
    this.stagedRowCount = copied;
    return copied;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }

  sqlOf(kind: StatementKind): string {
    return this.sqlLog[this.kinds.indexOf(kind)];
  }

  private nextCanned(sql: string): QueryResult | undefined {
    const entry = this.options.canned?.find((candidate) => candidate.match(sql));
    if (!entry) return undefined;
    return entry.results.length > 1 ? (entry.results.shift() as QueryResult) : entry.results[0];
  }

  private record(sql: string): StatementKind {
    const kind = classify(sql);
    this.sqlLog.push(sql);
    this.kinds.push(kind);
    return kind;
  }

  private catalogResult(sql: string): QueryResult {
    if (sql.includes("information_schema.columns")) return rowsResult(this.options.columns);
    if (sql.includes("geometry_columns")) return rowsResult(this.options.geometryRows);
    if (sql.includes("spatial_ref_sys")) return rowsResult(this.options.sridRows);
    return rowsResult([]);
  }
}

function createSession(overrides: Partial<FakeOptions> = {}): FakeSession {
  return new FakeSession({ ...DEFAULT_OPTIONS, ...overrides });
}

function createShapefile(
  rows: ShpRecordRow[] = SHP_ROWS,
  overrides: Partial<Pick<OpenShapefile, "recordCount" | "shapeRecordCount">> = {}
): { shapefile: OpenShapefile; yieldedCount: () => number } {
  let yielded = 0;
  const shapefile: OpenShapefile = {
    fieldNames: ["SUID", "NOMBRE", "AREA"],
    recordCount: rows.length,
    shapeRecordCount: rows.length,
    prjText: null,
    ...overrides,
    *records() {
      for (const row of rows) {
        yielded += 1;
        yield row;
      }
    },
  };
  return { shapefile, yieldedCount: () => yielded };
}

function buildParams(overrides: Partial<RunShpReplaceParams> = {}): RunShpReplaceParams {
  return {
    target: TARGET,
    shapefile: createShapefile().shapefile,
    mapping: MAPPING,
    sourceSrid: SOURCE_SRID,
    resetSequences: false,
    sequences: [],
    ...overrides,
  };
}

const GID_COLUMN: TargetColumnFixture = {
  column_name: "gid",
  data_type: "integer",
  udt_name: "int4",
  is_nullable: false,
  column_default: "nextval('public.t_id_seq'::regclass)",
};

const SERIAL_COLUMNS: TargetColumnFixture[] = [GID_COLUMN, ...TARGET_COLUMNS.slice(1)];

const UNMAPPED_GID_MAPPING: ReplaceColumnMapping = {
  sourceByTarget: { nombre: "NOMBRE", area: "AREA", geom: SHP_GEOMETRY_SOURCE },
  defaults: {},
};

const MAPPED_GID_MAPPING: ReplaceColumnMapping = {
  sourceByTarget: { gid: "SUID", nombre: "NOMBRE", area: "AREA", geom: SHP_GEOMETRY_SOURCE },
  defaults: {},
};

function buildParamsWithoutSequences(overrides: Partial<RunShpReplaceParams> = {}): RunShpReplaceParams {
  const { target, shapefile, mapping, sourceSrid, resetSequences } = buildParams();
  return { target, shapefile, mapping, sourceSrid, resetSequences, ...overrides };
}

function run(session: FakeSession, params: RunShpReplaceParams) {
  return runShpReplace(async () => session, params);
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected the replace to reject but it resolved");
}

function expectSpanishMessage(error: Error): void {
  expect(error.message.length).toBeGreaterThan(0);
  expect(error.message).toMatch(SPANISH_MARKER);
}

describe("runShpReplace", () => {
  describe("statement order", () => {
    it("should run BEGIN, catalog reads, stage, COPY, stage count, LOCK, target count, DELETE, INSERT, COMMIT and ANALYZE in that order when the replace succeeds", async () => {
      const session = createSession();

      await run(session, buildParams());

      expect(collapseConsecutive(session.kinds)).toEqual([
        "BEGIN",
        "CATALOG",
        "CREATE_STAGE",
        "COPY",
        "STAGE_COUNT",
        "LOCK",
        "TARGET_COUNT",
        "DELETE",
        "INSERT",
        "COMMIT",
        "ANALYZE",
      ]);
    });

    it("should issue ANALYZE only after COMMIT as its own statement when the replace succeeds", async () => {
      const session = createSession();

      await run(session, buildParams());

      const afterCommit = session.kinds.slice(session.kinds.indexOf("COMMIT") + 1);
      expect(afterCommit).toEqual(["ANALYZE"]);
      expect(session.sqlOf("ANALYZE")).toContain('"public"."parcelas"');
    });

    it("should close the session exactly once when the replace succeeds", async () => {
      const session = createSession();

      await run(session, buildParams());

      expect(session.closeCount).toBe(1);
    });

    it("should lock the target table in SHARE ROW EXCLUSIVE mode before deleting its rows", async () => {
      const session = createSession();

      await run(session, buildParams());

      const lockSql = session.sqlOf("LOCK");
      expect(lockSql).toMatch(/IN SHARE ROW EXCLUSIVE MODE/);
      expect(lockSql).toContain('"parcelas"');
      expect(session.kinds.indexOf("LOCK")).toBeLessThan(session.kinds.indexOf("DELETE"));
    });
  });

  describe("stage columns and COPY lines", () => {
    it("should create the stage with rec and only the mapped DBF fields plus geom_json when the geometry is mapped", async () => {
      const session = createSession();

      await run(session, buildParams());

      expect(session.sqlOf("CREATE_STAGE")).toBe(
        'CREATE TEMP TABLE "shp_replace_stage" ("rec" integer, "c0" text, "c1" text, "geom_json" text) ON COMMIT DROP'
      );
    });

    it("should issue COPY into rec, the mapped stage columns and geom_json when the geometry is mapped", async () => {
      const session = createSession();

      await run(session, buildParams());

      expect(session.sqlOf("COPY")).toBe('COPY "shp_replace_stage" ("rec","c0","c1","geom_json") FROM STDIN');
    });

    it("should omit geom_json from the stage and the COPY when no target column maps to the shapefile geometry", async () => {
      const session = createSession();

      await run(session, buildParams({ mapping: NO_GEOMETRY_MAPPING }));

      expect(session.sqlOf("CREATE_STAGE")).toBe(
        'CREATE TEMP TABLE "shp_replace_stage" ("rec" integer, "c0" text, "c1" text) ON COMMIT DROP'
      );
      expect(session.sqlOf("COPY")).toBe('COPY "shp_replace_stage" ("rec","c0","c1") FROM STDIN');
      expect(session.sqlOf("INSERT")).not.toContain("ST_");
    });

    it("should send one COPY line per record with rec, the mapped values and the geometry JSON in order", async () => {
      const session = createSession();

      await run(session, buildParams());

      expect(session.copiedLines).toEqual([
        `1\tAlpha\t12.5\t${POLYGON_JSON}\n`,
        "2\t\\N\t0\t\\N\n",
        `3\tGamma\t-7.5\t${POLYGON_JSON}\n`,
      ]);
    });

    it("should leave unmapped DBF fields such as SUID out of the COPY lines when SUID is not mapped", async () => {
      const session = createSession();

      await run(session, buildParams());

      for (const line of session.copiedLines) {
        expect(line).not.toContain("A1");
        expect(line).not.toContain("A2");
        expect(line).not.toContain("A3");
      }
    });

    it("should consume the records generator lazily through copyIn when streaming the rows", async () => {
      const { shapefile, yieldedCount } = createShapefile();
      const observedAtPull: number[] = [];
      const session = createSession({ onCopyLine: () => observedAtPull.push(yieldedCount()) });

      await run(session, buildParams({ shapefile }));

      expect(observedAtPull).toEqual([1, 2, 3]);
    });

    it("should escape tab and backslash characters inside COPY cells when a value contains them", async () => {
      const { shapefile } = createShapefile([
        { rec: 1, values: { SUID: "A", NOMBRE: "a\tb\\c", AREA: "1" }, geometryJson: null },
      ]);
      const session = createSession();

      await run(session, buildParams({ shapefile }));

      expect(session.copiedLines).toEqual(["1\ta\\tb\\\\c\t1\t\\N\n"]);
    });
  });

  describe("catalog-driven plan", () => {
    it("should wrap ST_Multi around ST_Transform in the INSERT when the catalog SRID differs and the type is MULTIPOLYGON", async () => {
      const session = createSession({ geometryRows: [{ srid: 4326, type: "MULTIPOLYGON" }] });

      await run(session, buildParams());

      expect(session.sqlOf("INSERT")).toContain(
        'ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),25830),4326))'
      );
    });

    it("should skip ST_Transform in the INSERT when the catalog SRID equals the source SRID", async () => {
      const session = createSession({ geometryRows: [{ srid: SOURCE_SRID, type: "MULTIPOLYGON" }] });

      await run(session, buildParams());

      expect(session.sqlOf("INSERT")).not.toContain("ST_Transform");
      expect(session.sqlOf("INSERT")).toContain('ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),25830))');
    });

    it("should omit ST_Multi in the INSERT when the catalog geometry type is a single POLYGON", async () => {
      const session = createSession({ geometryRows: [{ srid: 4326, type: "POLYGON" }] });

      await run(session, buildParams());

      expect(session.sqlOf("INSERT")).not.toContain("ST_Multi");
      expect(session.sqlOf("INSERT")).toContain(
        'ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),25830),4326)'
      );
    });
  });

  describe("sequences", () => {
    it("should reset the unmapped sequence before COMMIT and repair the mapped one after the INSERT when resetSequences is true", async () => {
      const session = createSession();
      const resetSql = buildResetSequenceStatement("public", "parcelas_id_seq");
      const repairSql = buildRepairSequenceStatement("public", "parcelas_area_seq", "public", "parcelas", ["area"]);

      await run(session, buildParams({ resetSequences: true, sequences: [UNMAPPED_SEQUENCE, MAPPED_SEQUENCE] }));

      const commitIndex = session.kinds.indexOf("COMMIT");
      expect(session.sqlLog.indexOf(resetSql)).toBeGreaterThan(-1);
      expect(session.sqlLog.indexOf(resetSql)).toBeLessThan(commitIndex);
      expect(session.sqlLog.indexOf(repairSql)).toBeGreaterThan(session.kinds.indexOf("INSERT"));
      expect(session.sqlLog.indexOf(repairSql)).toBeLessThan(commitIndex);
    });

    it("should list both sequences in sequencesAdjusted with resetToStart only for the unmapped one when resetSequences is true", async () => {
      const session = createSession();

      const result = await run(
        session,
        buildParams({ resetSequences: true, sequences: [UNMAPPED_SEQUENCE, MAPPED_SEQUENCE] })
      );

      expect(result.sequencesAdjusted.map(({ qualifiedLabel, resetToStart }) => ({ qualifiedLabel, resetToStart }))).toEqual([
        { qualifiedLabel: "public.parcelas_id_seq", resetToStart: true },
        { qualifiedLabel: "public.parcelas_area_seq", resetToStart: false },
      ]);
      expect(result.sequencesAdjusted[1].nextValue).toBe(42);
    });

    it("should issue no statement for the unmapped sequence when resetSequences is false", async () => {
      const session = createSession();

      await run(session, buildParams({ resetSequences: false, sequences: [UNMAPPED_SEQUENCE, MAPPED_SEQUENCE] }));

      expect(session.sqlLog.some((sql) => sql.includes("parcelas_id_seq"))).toBe(false);
    });

    it("should list only the mapped sequence in sequencesAdjusted when resetSequences is false", async () => {
      const session = createSession();

      const result = await run(
        session,
        buildParams({ resetSequences: false, sequences: [UNMAPPED_SEQUENCE, MAPPED_SEQUENCE] })
      );

      expect(result.sequencesAdjusted.map((sequence) => sequence.qualifiedLabel)).toEqual(["public.parcelas_area_seq"]);
    });
  });

  describe("failures before any DELETE", () => {
    const PRE_DELETE_FAILURES = [
      {
        label: "the COPY throws",
        build: () => ({ params: buildParams(), session: createSession({ copyError: new Error("connection reset") }) }),
      },
      {
        label: "the staged count differs from the copied rows",
        build: () => ({ params: buildParams(), session: createSession({ stageCountOverride: 2 }) }),
      },
      {
        label: "the target table has no columns",
        build: () => ({ params: buildParams(), session: createSession({ columns: [] }) }),
      },
      {
        label: "a mapping references a target column that does not exist",
        build: () => ({
          params: buildParams({
            mapping: { sourceByTarget: { ...MAPPING.sourceByTarget, ghost: "NOMBRE" }, defaults: {} },
          }),
          session: createSession(),
        }),
      },
      {
        label: "a NOT NULL target column has no default and no source or default mapping",
        build: () => ({
          params: buildParams(),
          session: createSession({
            columns: [
              ...TARGET_COLUMNS,
              { column_name: "codigo", data_type: "text", udt_name: "text", is_nullable: false, column_default: null },
            ],
          }),
        }),
      },
      {
        label: "the source SRID is not present in spatial_ref_sys",
        build: () => ({ params: buildParams(), session: createSession({ sridRows: [] }) }),
      },
      {
        label: "the shapefile holds zero records",
        build: () => ({
          params: buildParams({ shapefile: createShapefile([]).shapefile }),
          session: createSession(),
        }),
      },
      {
        label: "the .shp and .dbf record counts differ",
        build: () => ({
          params: buildParams({ shapefile: createShapefile(SHP_ROWS, { shapeRecordCount: 2 }).shapefile }),
          session: createSession(),
        }),
      },
    ];

    it.each(PRE_DELETE_FAILURES)(
      "should roll back, never delete, close the session once and reject with a Spanish Error when $label",
      async ({ build }) => {
        const { params, session } = build();

        const error = await captureRejection(run(session, params));

        expectSpanishMessage(error);
        expect(session.kinds).not.toContain("DELETE");
        expect(session.kinds).not.toContain("INSERT");
        expect(session.kinds).not.toContain("COMMIT");
        expect(session.kinds).not.toContain("ANALYZE");
        expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
        expect(session.closeCount).toBe(1);
      }
    );

    it("should reject with a message naming both the .shp and the .dbf record counts when they differ", async () => {
      const session = createSession();
      const params = buildParams({ shapefile: createShapefile(SHP_ROWS, { shapeRecordCount: 2 }).shapefile });

      const error = await captureRejection(run(session, params));

      expect(error.message).toContain("3");
      expect(error.message).toContain("2");
      expect(session.kinds).not.toContain("DELETE");
    });
  });

  describe("failures after DELETE", () => {
    const POST_DELETE_FAILURES = [
      {
        label: "the INSERT throws a bad cast",
        build: () => ({
          params: buildParams(),
          session: createSession({ insertError: new Error('invalid input syntax for type integer: "x"') }),
        }),
      },
      {
        label: "the inserted rows differ from the staged rows",
        build: () => ({ params: buildParams(), session: createSession({ insertRowCount: 2 }) }),
      },
    ];

    it.each(POST_DELETE_FAILURES)(
      "should roll back, never commit or analyze, close the session once and reject with a Spanish Error when $label",
      async ({ build }) => {
        const { params, session } = build();

        const error = await captureRejection(run(session, params));

        expectSpanishMessage(error);
        expect(session.kinds).toContain("DELETE");
        expect(session.kinds).not.toContain("COMMIT");
        expect(session.kinds).not.toContain("ANALYZE");
        expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
        expect(session.closeCount).toBe(1);
      }
    );
  });

  describe("result accounting", () => {
    it("should report sourceRows from the shapefile count, stagedRows from COPY, previousRows from the target and insertedRows from INSERT", async () => {
      const session = createSession({ previousRows: 7 });

      const result = await run(session, buildParams());

      expect(result.sourceRows).toBe(3);
      expect(result.stagedRows).toBe(3);
      expect(result.previousRows).toBe(7);
      expect(result.insertedRows).toBe(3);
    });

    it("should report targetModified true when the replace commits", async () => {
      const session = createSession();

      const result = await run(session, buildParams());

      expect(result.targetModified).toBe(true);
    });
  });

  describe("ANALYZE outcome", () => {
    it("should resolve with analyze status failed and the error message when ANALYZE throws after COMMIT", async () => {
      const session = createSession({ analyzeError: new Error("permiso denegado para ANALYZE") });

      const result = await run(session, buildParams());

      expect(result.analyze).toEqual({ status: "failed", message: "permiso denegado para ANALYZE" });
      expect(session.kinds).toContain("COMMIT");
      expect(session.kinds).not.toContain("ROLLBACK");
      expect(session.closeCount).toBe(1);
    });

    it("should resolve with analyze status ok when ANALYZE succeeds", async () => {
      const session = createSession();

      const result = await run(session, buildParams());

      expect(result.analyze).toEqual({ status: "ok" });
    });
  });

  describe("progress", () => {
    it("should report STAGING progress rising to the record total, then SWAPPING and FINALIZING", async () => {
      const session = createSession();
      const events: ShpReplaceProgress[] = [];

      await run(session, buildParams({ onProgress: (progress) => events.push(progress) }));

      const staging = events.filter((event) => event.phase === ShpReplacePhase.STAGING);
      const currents = staging.map((event) => event.current);
      expect(staging.length).toBeGreaterThan(0);
      expect(staging.every((event) => event.total === 3)).toBe(true);
      expect(currents.every((current, index) => index === 0 || current >= currents[index - 1])).toBe(true);
      expect(new Set(currents).size).toBeGreaterThan(1);
      expect(currents[currents.length - 1]).toBe(3);

      const orderedPhases = events
        .map((event) => event.phase)
        .filter((phase, index, phases) => phase !== phases[index - 1])
        .filter((phase) =>
          ([ShpReplacePhase.STAGING, ShpReplacePhase.SWAPPING, ShpReplacePhase.FINALIZING] as string[]).includes(phase)
        );
      expect(orderedPhases).toEqual([
        ShpReplacePhase.STAGING,
        ShpReplacePhase.SWAPPING,
        ShpReplacePhase.FINALIZING,
      ]);
    });
  });

  describe("sequences derived from the catalog when sequences are omitted", () => {
    const DERIVED_RESET_SQL = buildResetSequenceStatement("public", "t_id_seq");
    const DERIVED_REPAIR_SQL = buildRepairSequenceStatement("public", "t_id_seq", "public", "parcelas", ["gid"]);

    it("should reset the derived unmapped sequence before COMMIT and repair it after INSERT when sequences are omitted and resetSequences is true", async () => {
      const session = createSession({ columns: SERIAL_COLUMNS });

      await run(session, buildParamsWithoutSequences({ mapping: UNMAPPED_GID_MAPPING, resetSequences: true }));

      const commitIndex = session.kinds.indexOf("COMMIT");
      expect(session.sqlLog.indexOf(DERIVED_RESET_SQL)).toBeGreaterThan(-1);
      expect(session.sqlLog.indexOf(DERIVED_RESET_SQL)).toBeLessThan(commitIndex);
      expect(session.sqlLog.indexOf(DERIVED_REPAIR_SQL)).toBeGreaterThan(session.kinds.indexOf("INSERT"));
      expect(session.sqlLog.indexOf(DERIVED_REPAIR_SQL)).toBeLessThan(commitIndex);
    });

    it("should issue no statement for the derived unmapped sequence when sequences are omitted and resetSequences is false", async () => {
      const session = createSession({ columns: SERIAL_COLUMNS });

      await run(session, buildParamsWithoutSequences({ mapping: UNMAPPED_GID_MAPPING, resetSequences: false }));

      expect(session.sqlLog.some((sql) => sql.includes("t_id_seq"))).toBe(false);
    });

    it("should repair only the derived mapped sequence without reset when sequences are omitted and resetSequences is true", async () => {
      const session = createSession({ columns: SERIAL_COLUMNS });

      const result = await run(session, buildParamsWithoutSequences({ mapping: MAPPED_GID_MAPPING, resetSequences: true }));

      expect(session.sqlLog.includes(DERIVED_RESET_SQL)).toBe(false);
      expect(session.sqlLog.includes(DERIVED_REPAIR_SQL)).toBe(true);
      expect(result.sequencesAdjusted).toEqual([
        { qualifiedLabel: "public.t_id_seq", nextValue: 42, resetToStart: false },
      ]);
    });

    it("should repair only the derived mapped sequence when sequences are omitted and resetSequences is false", async () => {
      const session = createSession({ columns: SERIAL_COLUMNS });

      const result = await run(session, buildParamsWithoutSequences({ mapping: MAPPED_GID_MAPPING, resetSequences: false }));

      expect(session.sqlLog.includes(DERIVED_REPAIR_SQL)).toBe(true);
      expect(session.sqlLog.includes(DERIVED_RESET_SQL)).toBe(false);
      expect(result.sequencesAdjusted).toEqual([
        { qualifiedLabel: "public.t_id_seq", nextValue: 42, resetToStart: false },
      ]);
    });

    it("should use the explicit sequences array and ignore the catalog-derived ones when sequences are provided", async () => {
      const session = createSession({ columns: SERIAL_COLUMNS });

      const result = await run(
        session,
        buildParamsWithoutSequences({
          mapping: UNMAPPED_GID_MAPPING,
          resetSequences: true,
          sequences: [UNMAPPED_SEQUENCE],
        })
      );

      expect(session.sqlLog.some((sql) => sql.includes('"t_id_seq"'))).toBe(false);
      expect(session.sqlLog).toContain(buildResetSequenceStatement("public", "parcelas_id_seq"));
      expect(result.sequencesAdjusted.map((sequence) => sequence.qualifiedLabel)).toEqual(["public.parcelas_id_seq"]);
    });
  });

  describe("geometry target guards", () => {
    const GEOM2_COLUMN: TargetColumnFixture = {
      column_name: "geom2",
      data_type: "USER-DEFINED",
      udt_name: "geometry",
      is_nullable: true,
      column_default: null,
    };

    const TWO_GEOMETRY_MAPPING: ReplaceColumnMapping = {
      sourceByTarget: { nombre: "NOMBRE", geom: SHP_GEOMETRY_SOURCE, geom2: SHP_GEOMETRY_SOURCE },
      defaults: {},
    };

    it("should reject with a Spanish error naming the geometry problem before any DELETE when two target columns map to the shapefile geometry", async () => {
      const session = createSession({ columns: [...TARGET_COLUMNS, GEOM2_COLUMN] });

      const error = await captureRejection(run(session, buildParams({ mapping: TWO_GEOMETRY_MAPPING })));

      expectSpanishMessage(error);
      expect(error.message).toMatch(/geom/i);
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
      expect(session.closeCount).toBe(1);
    });

    it.each([3, 4])(
      "should reject with a Spanish error mentioning Z or 3D before any DELETE when the geometry has coord_dimension %s",
      async (coordDimension) => {
        const session = createSession({
          geometryRows: [{ srid: 4326, type: "MULTIPOLYGON", coord_dimension: coordDimension }],
        });

        const error = await captureRejection(run(session, buildParams()));

        expectSpanishMessage(error);
        expect(error.message).toMatch(/3D|\bZ/);
        expect(session.kinds).not.toContain("DELETE");
        expect(session.kinds).not.toContain("INSERT");
        expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
        expect(session.closeCount).toBe(1);
      }
    );

    it("should replace rows normally when the geometry has coord_dimension 2", async () => {
      const session = createSession({
        geometryRows: [{ srid: 4326, type: "MULTIPOLYGON", coord_dimension: 2 }],
      });

      await run(session, buildParams());

      expect(session.kinds).toContain("DELETE");
      expect(session.kinds[session.kinds.length - 1]).toBe("ANALYZE");
    });
  });

  describe("commit outcome", () => {
    it("should reject with a ShpCommitUncertainError whose message says the commit could not be confirmed when COMMIT throws", async () => {
      const session = createSession({ commitError: new Error("conexión perdida durante COMMIT") });

      const error = await captureRejection(run(session, buildParams()));

      expect(error).toBeInstanceOf(ShpCommitUncertainError);
      expect(error.message).toContain("No se pudo confirmar");
      expect(error.message).not.toContain("no fue modificada");
    });

    it("should not issue ANALYZE and should close the session once when COMMIT throws", async () => {
      const session = createSession({ commitError: new Error("conexión perdida durante COMMIT") });

      await captureRejection(run(session, buildParams()));

      expect(session.kinds).toContain("COMMIT");
      expect(session.kinds).not.toContain("ANALYZE");
      expect(session.closeCount).toBe(1);
    });

    it("should keep the message saying the target was not modified when the INSERT throws before COMMIT", async () => {
      const session = createSession({ insertError: new Error('invalid input syntax for type integer: "x"') });

      const error = await captureRejection(run(session, buildParams()));

      expect(error.message).toContain("La tabla destino no fue modificada");
    });

    it("should not be a ShpCommitUncertainError when the INSERT throws before COMMIT", async () => {
      const session = createSession({ insertError: new Error('invalid input syntax for type integer: "x"') });

      const error = await captureRejection(run(session, buildParams()));

      expect(error).not.toBeInstanceOf(ShpCommitUncertainError);
    });

    it("should keep the message saying the target was not modified when a pre-DELETE check fails", async () => {
      const session = createSession({ copyError: new Error("connection reset") });

      const error = await captureRejection(run(session, buildParams()));

      expect(error.message).toContain("La tabla destino no fue modificada");
    });

    it("should not be a ShpCommitUncertainError when a pre-DELETE check fails", async () => {
      const session = createSession({ copyError: new Error("connection reset") });

      const error = await captureRejection(run(session, buildParams()));

      expect(error).not.toBeInstanceOf(ShpCommitUncertainError);
    });
  });
});

const FULL_PROCESSING: GeometryProcessingOptions = {
  repair: { enabled: true },
  unify: { enabled: true, keyFields: ["NOMBRE"] },
  overlaps: { enabled: true, policy: "report", minAreaM2: 1 },
};

const FULL_BLOCKING_PROCESSING: GeometryProcessingOptions = {
  ...FULL_PROCESSING,
  overlaps: { enabled: true, policy: "block", minAreaM2: 1 },
};

const DISABLED_PROCESSING: GeometryProcessingOptions = {
  repair: { enabled: false },
  unify: { enabled: false, keyFields: [] },
  overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
};

const PROCESSING_LAYOUT = { stageFields: ["c0", "c1"], keyFields: ["c0"], sourceSrid: SOURCE_SRID };
const COMPARED_FIELDS = ["c1"];
const SAMPLE_LIMIT = 20;

interface ProcessingFixture {
  unify: boolean;
  repair: boolean;
  overlapCount: number;
  geographic: boolean;
  invalidBefore: number;
  invalidFinal: number;
  nullKeyRows: number;
  incompatible: number;
}

const DEFAULT_FIXTURE: ProcessingFixture = {
  unify: true,
  repair: true,
  overlapCount: 3,
  geographic: false,
  invalidBefore: 2,
  invalidFinal: 0,
  nullKeyRows: 0,
  incompatible: 0,
};

const exactSql = (sql: string) => (candidate: string): boolean => candidate === sql;
const isLargestGroupsSql = (sql: string): boolean => /ORDER BY\s+"?size"?\s+DESC/i.test(sql);
const isOverlapCountSql = (sql: string): boolean => /AS\s+"?overlaps"?\b/i.test(sql);
const isOverlapSamplesSql = (sql: string): boolean =>
  sql.includes('FROM "shp_proc_overlap" a') && /ORDER BY\s+"?area"?\s+DESC/i.test(sql);
const isIncompatibleCountSql = (sql: string): boolean => /AS\s+"?incompatible"?\b/i.test(sql);
const isWorkTableCountSql = (table: string) => (sql: string): boolean =>
  sql.includes(`"${table}"`) && /count\(\*\)/i.test(sql);
const countResult = (count: number): QueryResult => rowsResult([{ count, n: count, invalid: count, overlaps: count }]);

const BASE_REPAIR_UPDATED = 3;
const UNIFIED_REPAIR_UPDATED = 2;
const BASE_REPAIR_EMPTIED = 1;
const UNIFIED_REPAIR_EMPTIED = 1;

function processingCanned(fixture: ProcessingFixture): CannedQuery[] {
  const work = fixture.unify ? UNIFIED_TABLE : BASE_TABLE;
  const [baseRepairUpdate, baseRepairEmptied] = buildRepairSql(BASE_TABLE);
  const [unifiedRepairUpdate, unifiedRepairEmptied] = buildRepairSql(UNIFIED_TABLE);
  const baseInvalidResults =
    fixture.unify || !fixture.repair
      ? [countResult(fixture.invalidBefore)]
      : [countResult(fixture.invalidBefore), countResult(fixture.invalidFinal)];
  return [
    { match: exactSql(buildInvalidCountSql(BASE_TABLE)), results: baseInvalidResults },
    { match: exactSql(buildInvalidCountSql(UNIFIED_TABLE)), results: [countResult(fixture.invalidFinal)] },
    { match: exactSql(buildGroupStatsSql(PROCESSING_LAYOUT)), results: [rowsResult([{ groups: 2, rows_merged: 1 }])] },
    {
      match: (sql) => sql.includes("null_key_rows"),
      results: [rowsResult([{ null_key_rows: String(fixture.nullKeyRows) }])],
    },
    { match: isLargestGroupsSql, results: [rowsResult([{ c0: "Alpha", size: 2 }])] },
    {
      match: exactSql(buildConflictCountSql(PROCESSING_LAYOUT, COMPARED_FIELDS)),
      results: [countResult(1)],
    },
    {
      match: exactSql(buildConflictSamplesSql(PROCESSING_LAYOUT, COMPARED_FIELDS, SAMPLE_LIMIT)),
      results: [rowsResult([{ c0: "Alpha", c1: "12.5 | 13" }])],
    },
    { match: exactSql(baseRepairUpdate), results: [{ rows: [], rowCount: BASE_REPAIR_UPDATED }] },
    { match: exactSql(baseRepairEmptied), results: [{ rows: [], rowCount: BASE_REPAIR_EMPTIED }] },
    { match: exactSql(unifiedRepairUpdate), results: [{ rows: [], rowCount: UNIFIED_REPAIR_UPDATED }] },
    { match: exactSql(unifiedRepairEmptied), results: [{ rows: [], rowCount: UNIFIED_REPAIR_EMPTIED }] },
    { match: isOverlapCountSql, results: [countResult(fixture.overlapCount)] },
    {
      match: isOverlapSamplesSql,
      results: [
        rowsResult([
          { rec_a: 1, rec_b: 2, area: 2.5, c0: "Alpha" },
          { rec_a: 1, rec_b: 3, area: 1.5, c0: "Alpha" },
        ]),
      ],
    },
    {
      match: isIncompatibleCountSql,
      results: [rowsResult([{ incompatible: fixture.incompatible }])],
    },
    { match: isWorkTableCountSql(work), results: [countResult(fixture.unify ? 2 : 3)] },
    { match: (sql) => sql.includes("shp_proc_") && /count\(\*\)/i.test(sql), results: [countResult(0)] },
  ];
}

function processingSession(fixture: Partial<ProcessingFixture> = {}, overrides: Partial<FakeOptions> = {}): FakeSession {
  const resolved = { ...DEFAULT_FIXTURE, ...fixture };
  return createSession({
    sridRows: [{ srid: SOURCE_SRID, geographic: resolved.geographic }],
    canned: processingCanned(resolved),
    insertRowCount: resolved.unify ? 2 : 3,
    ...overrides,
  });
}

const withProcessing = (
  processing: GeometryProcessingOptions,
  overrides: Partial<RunShpReplaceParams> = {}
): RunShpReplaceParams => buildParams({ processing, ...overrides });

const processingStatements = (session: FakeSession): string[] =>
  session.sqlLog.filter((sql, index) => session.kinds[index] === "PROCESSING" && !isLargestGroupsSql(sql));

const lastIndexOfKind = (session: FakeSession, kind: StatementKind): number => session.kinds.lastIndexOf(kind);

const insertTargetColumns = (session: FakeSession): string => {
  const match = /INSERT INTO [^(]*\(([^)]*)\)/.exec(session.sqlOf("INSERT"));
  return match?.[1] ?? "";
};

describe("runShpReplace geometry processing", () => {
  describe("disabled processing", () => {
    it("should issue exactly the statements of the plain replace when every process is disabled", async () => {
      const plain = createSession();
      const disabled = createSession();

      await run(plain, buildParams());
      await run(disabled, buildParams({ processing: DISABLED_PROCESSING }));

      expect(disabled.sqlLog).toEqual(plain.sqlLog);
    });

    it("should report no geometry and no PROCESSING phase when every process is disabled", async () => {
      const session = createSession();
      const events: ShpReplaceProgress[] = [];

      const result = await run(session, buildParams({ processing: DISABLED_PROCESSING, onProgress: (p) => events.push(p) }));

      expect(result.geometry).toBeUndefined();
      expect(events.some((event) => event.phase === ShpReplacePhase.PROCESSING)).toBe(false);
    });
  });

  describe("statement plan", () => {
    it("should run every processing statement after the stage count and before the LOCK when processing is active", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING));

      const stageCount = session.kinds.indexOf("STAGE_COUNT");
      const lock = session.kinds.indexOf("LOCK");
      const processingIndexes = session.kinds
        .map((kind, index) => (kind === "PROCESSING" ? index : -1))
        .filter((index) => index >= 0);
      expect(processingIndexes.length).toBeGreaterThan(0);
      expect(processingIndexes.every((index) => index > stageCount && index < lock)).toBe(true);
    });

    it("should issue base, invalid count on base, base repair, unify, group stats, conflict statements, null key count, unified repair, final invalid count and overlap statements in that order when every process is enabled", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING));

      expect(processingStatements(session)).toEqual([
        buildBaseTableSql(PROCESSING_LAYOUT),
        buildInvalidCountSql(BASE_TABLE),
        ...buildRepairSql(BASE_TABLE),
        buildUnifySql(PROCESSING_LAYOUT),
        buildGroupStatsSql(PROCESSING_LAYOUT),
        buildConflictCountSql(PROCESSING_LAYOUT, COMPARED_FIELDS),
        buildConflictSamplesSql(PROCESSING_LAYOUT, COMPARED_FIELDS, SAMPLE_LIMIT),
        buildNullKeyCountSql(PROCESSING_LAYOUT),
        ...buildRepairSql(UNIFIED_TABLE),
        buildInvalidCountSql(UNIFIED_TABLE),
        ...buildOverlapInputSql(UNIFIED_TABLE),
        buildOverlapCountSql(1, AreaMode.PLANAR),
        buildOverlapSamplesSql(PROCESSING_LAYOUT, UNIFIED_TABLE, 1, AreaMode.PLANAR, SAMPLE_LIMIT),
      ]);
    });

    it("should run repair and the final invalid count on the base table when unify is disabled", async () => {
      const session = processingSession({ unify: false });

      await run(session, withProcessing({ ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } }));

      expect(session.sqlLog).toContain(buildRepairSql(BASE_TABLE)[0]);
      expect(session.sqlLog).toContain(buildRepairSql(BASE_TABLE)[1]);
      expect(session.sqlLog.some((sql) => sql.includes('"shp_proc_unified"'))).toBe(false);
    });

    it("should issue no UPDATE and no ST_MakeValid anywhere when repair is disabled", async () => {
      const session = processingSession({ repair: false, invalidFinal: 1 });

      await run(session, withProcessing({ ...FULL_PROCESSING, repair: { enabled: false } }));

      expect(session.sqlLog.some((sql) => sql.trimStart().startsWith("UPDATE"))).toBe(false);
      expect(session.sqlLog.some((sql) => sql.includes("ST_MakeValid"))).toBe(false);
    });

    it("should stage the unmapped key field and keep it out of the INSERT columns when the key is not mapped", async () => {
      const baseline = createSession();
      await run(baseline, buildParams());
      const session = processingSession();

      await run(session, withProcessing({ ...FULL_PROCESSING, unify: { enabled: true, keyFields: ["SUID"] } }));

      expect(session.sqlOf("CREATE_STAGE").match(/"c\d+"/g)).toHaveLength(3);
      expect(session.copiedLines.some((line) => line.includes("A1"))).toBe(true);
      expect(insertTargetColumns(session)).toBe(insertTargetColumns(baseline));
    });

    it("should not add a second stage column when the key field is already a mapped source", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING));

      expect(session.sqlOf("CREATE_STAGE").match(/"c\d+"/g)).toHaveLength(2);
    });
  });

  describe("repair passes", () => {
    const repairUpdates = (session: FakeSession): string[] =>
      session.sqlLog.filter((sql) => sql.trimStart().startsWith("UPDATE"));

    it("should run the base repair pass after the base invalid count and before unify, and the unified repair pass after the null key count and before the final invalid count, when repair and unify are both enabled", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING));

      const baseCount = session.sqlLog.indexOf(buildInvalidCountSql(BASE_TABLE));
      const basePass = session.sqlLog.indexOf(buildRepairSql(BASE_TABLE)[0]);
      const unify = session.sqlLog.indexOf(buildUnifySql(PROCESSING_LAYOUT));
      const nullKey = session.sqlLog.indexOf(buildNullKeyCountSql(PROCESSING_LAYOUT));
      const unifiedPass = session.sqlLog.indexOf(buildRepairSql(UNIFIED_TABLE)[0]);
      const finalCount = session.sqlLog.indexOf(buildInvalidCountSql(UNIFIED_TABLE));
      expect(baseCount).toBeGreaterThanOrEqual(0);
      expect(basePass).toBeGreaterThan(baseCount);
      expect(unify).toBeGreaterThan(basePass);
      expect(nullKey).toBeGreaterThan(unify);
      expect(unifiedPass).toBeGreaterThan(nullKey);
      expect(finalCount).toBeGreaterThan(unifiedPass);
    });

    it("should issue exactly two repair passes, the first on the base table and the second on the unified table, when repair and unify are both enabled", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING));

      expect(repairUpdates(session)).toEqual([...buildRepairSql(BASE_TABLE), ...buildRepairSql(UNIFIED_TABLE)]);
    });

    it("should issue exactly one repair pass on the base table and no unified repair when unify is disabled", async () => {
      const session = processingSession({ unify: false });

      await run(session, withProcessing({ ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } }));

      expect(repairUpdates(session)).toEqual(buildRepairSql(BASE_TABLE));
    });

    it("should issue no repair statement on either work table when repair is disabled even though unify is enabled", async () => {
      const session = processingSession({ repair: false });

      await run(session, withProcessing({ ...FULL_PROCESSING, repair: { enabled: false } }));

      expect(repairUpdates(session)).toEqual([]);
      expect(session.sqlLog).not.toContain(buildRepairSql(BASE_TABLE)[0]);
      expect(session.sqlLog).not.toContain(buildRepairSql(UNIFIED_TABLE)[0]);
      expect(session.sqlLog).toContain(buildUnifySql(PROCESSING_LAYOUT));
    });

    it("should report repaired as the base pass updates plus the unified pass updates and emptyAfterRepair as the sum of both null passes when repair and unify are enabled", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result.geometry).toMatchObject({ repaired: 5, emptyAfterRepair: 2 });
    });

    it("should report repaired and emptyAfterRepair from the base pass only when unify is disabled", async () => {
      const session = processingSession({ unify: false });

      const result = await run(session, withProcessing({ ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } }));

      expect(result.geometry).toMatchObject({ repaired: BASE_REPAIR_UPDATED, emptyAfterRepair: BASE_REPAIR_EMPTIED });
    });
  });

  describe("null key rows", () => {
    it("should run the null key count after the unify statements and before the unified repair pass when unify is enabled", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING));

      const nullKeyIndex = session.sqlLog.indexOf(buildNullKeyCountSql(PROCESSING_LAYOUT));
      expect(nullKeyIndex).toBeGreaterThan(session.sqlLog.indexOf(buildConflictSamplesSql(PROCESSING_LAYOUT, COMPARED_FIELDS, SAMPLE_LIMIT)));
      expect(nullKeyIndex).toBeLessThan(session.sqlLog.indexOf(buildRepairSql(UNIFIED_TABLE)[0]));
    });

    it("should report the null key row count as a number from the count returned by the database", async () => {
      const session = processingSession({ nullKeyRows: 3 });

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result.geometry?.nullKeyRows).toBe(3);
    });

    it("should report zero nullKeyRows when the null key count is zero", async () => {
      const session = processingSession({ nullKeyRows: 0 });

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result.geometry?.nullKeyRows).toBe(0);
    });

    it("should never run the null key count and report zero nullKeyRows when unify is disabled", async () => {
      const session = processingSession({ unify: false, nullKeyRows: 4 });

      const result = await run(
        session,
        withProcessing({ ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } })
      );

      expect(session.sqlLog.some((sql) => sql.includes("null_key_rows"))).toBe(false);
      expect(result.geometry?.nullKeyRows).toBe(0);
    });
  });

  describe("geometry requirement", () => {
    it("should reject with a Spanish error, roll back and never DELETE when processing is active and no column maps to the shapefile geometry", async () => {
      const session = processingSession();

      const error = await captureRejection(
        run(session, withProcessing(FULL_PROCESSING, { mapping: NO_GEOMETRY_MAPPING }))
      );

      expectSpanishMessage(error);
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
      expect(session.closeCount).toBe(1);
    });

    it("should reject with a Spanish error naming MultiPolígono before any processing statement when unify is enabled and the target geometry is a single POLYGON", async () => {
      const session = processingSession({}, { geometryRows: [{ srid: 4326, type: "POLYGON" }] });

      const error = await captureRejection(run(session, withProcessing(FULL_PROCESSING)));

      expectSpanishMessage(error);
      expect(error.message).toMatch(/MultiPol[ií]gono|Multi/);
      expect(session.kinds).not.toContain("PROCESSING");
      expect(session.sqlLog.some((sql) => sql.includes('"shp_proc_base"'))).toBe(false);
      expect(session.kinds).not.toContain("LOCK");
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
      expect(session.closeCount).toBe(1);
    });

    it("should reject with a Spanish error naming MultiPolígono before any processing statement when unify is enabled and the target geometry is a single POINT", async () => {
      const session = processingSession({}, { geometryRows: [{ srid: 4326, type: "POINT" }] });

      const error = await captureRejection(run(session, withProcessing(FULL_PROCESSING)));

      expectSpanishMessage(error);
      expect(error.message).toMatch(/MultiPol[ií]gono/);
      expect(session.kinds).not.toContain("PROCESSING");
      expect(session.kinds).not.toContain("LOCK");
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
    });

    it("should reject with a Spanish error naming MultiPolígono before any processing statement when unify is enabled and the target geometry is a single LINESTRING", async () => {
      const session = processingSession({}, { geometryRows: [{ srid: 4326, type: "LINESTRING" }] });

      const error = await captureRejection(run(session, withProcessing(FULL_PROCESSING)));

      expectSpanishMessage(error);
      expect(error.message).toMatch(/MultiPol[ií]gono/);
      expect(session.kinds).not.toContain("PROCESSING");
      expect(session.kinds).not.toContain("LOCK");
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
    });

    it("should run unify without rejection when the target geometry type is MULTIPOLYGON", async () => {
      const session = processingSession({}, { geometryRows: [{ srid: 4326, type: "MULTIPOLYGON" }] });

      await expect(run(session, withProcessing(FULL_PROCESSING))).resolves.toBeDefined();

      expect(session.kinds).toContain("PROCESSING");
      expect(session.kinds).toContain("INSERT");
      expect(session.kinds).toContain("COMMIT");
    });

    it("should run unify without rejection when the target geometry type is the unconstrained GEOMETRY", async () => {
      const session = processingSession({}, { geometryRows: [{ srid: 4326, type: "GEOMETRY" }] });

      await expect(run(session, withProcessing(FULL_PROCESSING))).resolves.toBeDefined();

      expect(session.kinds).toContain("PROCESSING");
      expect(session.kinds).toContain("INSERT");
      expect(session.kinds).toContain("COMMIT");
    });

    it("should run unify without rejection when the target geometry type is lowercase geometry", async () => {
      const session = processingSession({}, { geometryRows: [{ srid: 4326, type: "geometry" }] });

      await expect(run(session, withProcessing(FULL_PROCESSING))).resolves.toBeDefined();

      expect(session.kinds).toContain("PROCESSING");
      expect(session.kinds).toContain("INSERT");
      expect(session.kinds).toContain("COMMIT");
    });

    it("should issue exactly the statements of the plain replace without ST_Multi when the target geometry type is GEOMETRY and every process is disabled", async () => {
      const plain = createSession({ geometryRows: [{ srid: 4326, type: "GEOMETRY" }] });
      const disabled = createSession({ geometryRows: [{ srid: 4326, type: "GEOMETRY" }] });

      await run(plain, buildParams());
      await run(disabled, buildParams({ processing: DISABLED_PROCESSING }));

      expect(disabled.sqlLog).toEqual(plain.sqlLog);
      expect(disabled.sqlOf("INSERT")).not.toContain("ST_Multi");
    });

    it("should run repair without rejection when the target geometry type is GEOMETRY and unify is disabled", async () => {
      const session = processingSession({ unify: false }, { geometryRows: [{ srid: 4326, type: "GEOMETRY" }] });

      await expect(
        run(session, withProcessing({ ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } }))
      ).resolves.toBeDefined();

      expect(session.sqlLog).toContain(buildRepairSql(BASE_TABLE)[0]);
      expect(session.kinds).toContain("COMMIT");
    });
  });

  describe("overlap policy", () => {
    it("should reject with ShpProcessingBlockedError, roll back and never lock or delete when the block policy finds overlaps", async () => {
      const session = processingSession({ overlapCount: 3 });

      const error = await captureRejection(run(session, withProcessing(FULL_BLOCKING_PROCESSING)));

      expect(error).toBeInstanceOf(ShpProcessingBlockedError);
      const blocked = error as ShpProcessingBlockedError;
      expect(blocked.report.overlapCount).toBe(3);
      expect(blocked.report.wouldBlock).toBe(true);
      expect(blocked.message).toContain("3");
      expectSpanishMessage(blocked);
      expect(session.kinds).not.toContain("LOCK");
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
      expect(session.closeCount).toBe(1);
    });

    it("should replace rows and report wouldBlock false when the report policy finds overlaps", async () => {
      const session = processingSession({ overlapCount: 3 });

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(session.kinds).toContain("DELETE");
      expect(session.kinds).toContain("COMMIT");
      expect(result.geometry).toMatchObject({ overlapCount: 3, wouldBlock: false });
    });

    it("should replace rows when the block policy finds no overlap", async () => {
      const session = processingSession({ overlapCount: 0 });

      const result = await run(session, withProcessing(FULL_BLOCKING_PROCESSING));

      expect(session.kinds).toContain("COMMIT");
      expect(result.geometry).toMatchObject({ overlapCount: 0, wouldBlock: false });
    });

    it("should skip every overlap statement and report no overlaps when overlaps are disabled", async () => {
      const session = processingSession();

      const result = await run(
        session,
        withProcessing({ ...FULL_PROCESSING, overlaps: { enabled: false, policy: "block", minAreaM2: 1 } })
      );

      expect(session.sqlLog.some((sql) => sql.includes("shp_proc_overlap"))).toBe(false);
      expect(result.geometry).toMatchObject({ overlapCount: 0, overlapSamples: [], wouldBlock: false });
    });

    it("should measure the intersection area as geography when the catalog SRID is geographic", async () => {
      const session = processingSession({ geographic: true });

      await run(session, withProcessing(FULL_PROCESSING));

      expect(session.sqlLog).toContain(buildOverlapCountSql(1, AreaMode.GEOGRAPHY));
      expect(session.sqlLog).not.toContain(buildOverlapCountSql(1, AreaMode.PLANAR));
    });

    it("should measure the intersection area as planar when the catalog SRID is not geographic", async () => {
      const session = processingSession({ geographic: false });

      await run(session, withProcessing(FULL_PROCESSING));

      expect(session.sqlLog).toContain(buildOverlapCountSql(1, AreaMode.PLANAR));
      expect(session.sqlLog).not.toContain(buildOverlapCountSql(1, AreaMode.GEOGRAPHY));
    });

    it("should pass the configured minimum area to the overlap count statement", async () => {
      const session = processingSession();

      await run(
        session,
        withProcessing({ ...FULL_PROCESSING, overlaps: { enabled: true, policy: "report", minAreaM2: 0.5 } })
      );

      expect(session.sqlLog).toContain(buildOverlapCountSql(0.5, AreaMode.PLANAR));
    });
  });

  describe("dry run", () => {
    it("should resolve without throwing and report wouldBlock true when dryRun is true and the block policy finds overlaps", async () => {
      const session = processingSession({ overlapCount: 3 });

      const result = await run(session, withProcessing(FULL_BLOCKING_PROCESSING, { dryRun: true }));

      expect(result).toMatchObject({
        dryRun: true,
        targetModified: false,
        insertedRows: 0,
        stagedRows: 2,
        previousRows: 7,
      });
      expect(result.geometry?.wouldBlock).toBe(true);
      expect(session.closeCount).toBe(1);
    });

    it("should never lock, delete, insert, commit, analyze or touch sequences when dryRun is true", async () => {
      const session = processingSession({ overlapCount: 3 });

      await run(session, withProcessing(FULL_PROCESSING, { dryRun: true }));

      expect(session.kinds).not.toContain("LOCK");
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("INSERT");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.kinds).not.toContain("ANALYZE");
      expect(session.kinds).not.toContain("SEQUENCE");
      expect(session.kinds).toContain("TARGET_COUNT");
    });

    it("should roll back after the last processing statement when dryRun is true", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING, { dryRun: true }));

      expect(session.kinds).toContain("ROLLBACK");
      expect(session.kinds.indexOf("ROLLBACK")).toBeGreaterThan(lastIndexOfKind(session, "PROCESSING"));
    });

    it("should roll back, report no geometry and keep the target untouched when dryRun is true and processing is disabled", async () => {
      const session = createSession();

      const result = await run(session, buildParams({ dryRun: true }));

      expect(result).toMatchObject({ dryRun: true, targetModified: false, insertedRows: 0 });
      expect(result.geometry).toBeUndefined();
      expect(session.kinds).toContain("ROLLBACK");
      expect(session.kinds).not.toContain("DELETE");
      expect(session.kinds).not.toContain("COMMIT");
    });

    it("should return the same geometry report as a real run when dryRun is true", async () => {
      const dry = processingSession();
      const real = processingSession();

      const dryResult = await run(dry, withProcessing(FULL_PROCESSING, { dryRun: true, now: steppingClock() }));
      const realResult = await run(real, withProcessing(FULL_PROCESSING, { now: steppingClock() }));

      expect(dryResult.geometry).toEqual(realResult.geometry);
    });

    it("should report dryRun false and targetModified true for a real run with processing", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result).toMatchObject({ dryRun: false, targetModified: true });
    });
  });

  describe("final INSERT", () => {
    it("should read the unified work table with native geometry instead of the stage GeoJSON when unify is enabled", async () => {
      const session = processingSession();

      await run(session, withProcessing(FULL_PROCESSING));

      const insert = session.sqlOf("INSERT");
      expect(insert).toContain('FROM "shp_proc_unified"');
      expect(insert).not.toContain("ST_GeomFromGeoJSON");
      expect(insert).not.toContain("shp_replace_stage");
      expect(insert).toMatch(/ST_Transform\(\s*"geom"\s*,\s*4326\s*\)/);
    });

    it("should read the base work table with native geometry when unify is disabled", async () => {
      const session = processingSession({ unify: false });

      await run(session, withProcessing({ ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } }));

      expect(session.sqlOf("INSERT")).toContain('FROM "shp_proc_base"');
      expect(session.sqlOf("INSERT")).not.toContain("ST_GeomFromGeoJSON");
    });

    it("should roll back without COMMIT when the INSERT rowCount differs from the processed row count", async () => {
      const session = processingSession({}, { insertRowCount: 3 });

      const error = await captureRejection(run(session, withProcessing(FULL_PROCESSING)));

      expectSpanishMessage(error);
      expect(session.kinds).toContain("DELETE");
      expect(session.kinds).not.toContain("COMMIT");
      expect(session.kinds[session.kinds.length - 1]).toBe("ROLLBACK");
      expect(session.closeCount).toBe(1);
    });

    it("should report stagedRows as the processed row count and sourceRows as the file count when unify merges rows", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result).toMatchObject({ sourceRows: 3, stagedRows: 2, insertedRows: 2 });
    });
  });

  describe("geometry report", () => {
    it("should report invalidBefore from the base count and repaired and emptyAfterRepair summed over both repair passes when repair and unify are enabled", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result.geometry).toMatchObject({ invalidBefore: 2, repaired: 5, emptyAfterRepair: 2 });
    });

    it("should report groups, rowsMerged, the largest groups and the attribute conflicts when unify is enabled", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result.geometry).toMatchObject({ groups: 2, rowsMerged: 1, attributeConflicts: 1 });
      expect(result.geometry?.largestGroups).toHaveLength(1);
      expect(result.geometry?.attributeConflictSamples).toHaveLength(1);
    });

    it("should report the overlap count, the sample pairs and no skipped invalid geometries when the overlap check runs on valid geometries", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(result.geometry).toMatchObject({
        overlapCount: 3,
        overlapSkippedInvalid: 0,
        insertedInvalid: 0,
        wouldBlock: false,
      });
      expect(result.geometry?.overlapSamples).toHaveLength(2);
    });

    it("should report zero repaired, the remaining invalid count as insertedInvalid and as overlapSkippedInvalid when repair is disabled", async () => {
      const session = processingSession({ repair: false, invalidFinal: 1 });

      const result = await run(session, withProcessing({ ...FULL_PROCESSING, repair: { enabled: false } }));

      expect(result.geometry).toMatchObject({
        invalidBefore: 2,
        repaired: 0,
        emptyAfterRepair: 0,
        insertedInvalid: 1,
        overlapSkippedInvalid: 1,
      });
    });

    it("should report zero and empty lists for every unify field when unify is disabled", async () => {
      const session = processingSession({ unify: false });

      const result = await run(
        session,
        withProcessing({ ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } })
      );

      expect(result.geometry).toMatchObject({
        groups: 0,
        rowsMerged: 0,
        largestGroups: [],
        attributeConflicts: 0,
        attributeConflictSamples: [],
      });
    });
  });

  describe("incompatible multi-part geometries", () => {
    const POLYGON_GEOMETRY = [{ srid: 4326, type: "POLYGON" }];
    const MULTIPOLYGON_GEOMETRY = [{ srid: 4326, type: "MULTIPOLYGON" }];
    const UNCONSTRAINED_GEOMETRY = [{ srid: 4326, type: "GEOMETRY" }];
    const NO_UNIFY_PROCESSING: GeometryProcessingOptions = { ...FULL_PROCESSING, unify: { enabled: false, keyFields: [] } };

    it("should issue the incompatible count on the base table when a POLYGON target has processing active without unify", async () => {
      const session = processingSession({ unify: false, incompatible: 2 }, { geometryRows: POLYGON_GEOMETRY });

      await run(session, { ...withProcessing(NO_UNIFY_PROCESSING), dryRun: true });

      expect(session.sqlLog).toContain(buildIncompatibleGeometryCountSql(BASE_TABLE));
    });

    it("should report the incompatible row count returned by the count query when the target is POLYGON", async () => {
      const session = processingSession({ unify: false, incompatible: 2 }, { geometryRows: POLYGON_GEOMETRY });

      const result = await run(session, { ...withProcessing(NO_UNIFY_PROCESSING), dryRun: true });

      expect(result.geometry?.incompatibleGeometryRows).toBe(2);
    });

    it("should report zero incompatible rows when the POLYGON target receives only single-part geometries", async () => {
      const session = processingSession({ unify: false, incompatible: 0 }, { geometryRows: POLYGON_GEOMETRY });

      const result = await run(session, withProcessing(NO_UNIFY_PROCESSING));

      expect(session.sqlLog).toContain(buildIncompatibleGeometryCountSql(BASE_TABLE));
      expect(result.geometry?.incompatibleGeometryRows).toBe(0);
      expect(result.geometry?.incompatibleTargetType).toBeNull();
    });

    it("should run the incompatible count after the repair statements and before the final invalid count", async () => {
      const session = processingSession({ unify: false, incompatible: 1 }, { geometryRows: POLYGON_GEOMETRY });

      await run(session, { ...withProcessing(NO_UNIFY_PROCESSING), dryRun: true });

      const incompatibleAt = session.sqlLog.indexOf(buildIncompatibleGeometryCountSql(BASE_TABLE));
      const lastRepairAt = session.sqlLog.indexOf(buildRepairSql(BASE_TABLE)[1]);
      const finalInvalidAt = session.sqlLog.lastIndexOf(buildInvalidCountSql(BASE_TABLE));
      expect(lastRepairAt).toBeGreaterThanOrEqual(0);
      expect(incompatibleAt).toBeGreaterThan(lastRepairAt);
      expect(incompatibleAt).toBeLessThan(finalInvalidAt);
    });

    it("should refuse a real run before the lock when incompatible multi-part geometries exist", async () => {
      const session = processingSession({ unify: false, incompatible: 3 }, { geometryRows: POLYGON_GEOMETRY });

      const error = await captureRejection(run(session, withProcessing(NO_UNIFY_PROCESSING)));

      expectSpanishMessage(error);
      expect(error.message).toContain("3 geometrías de varias partes no caben en la columna destino de tipo Polígono");
      expect(session.sqlLog.some((sql) => sql.startsWith("LOCK TABLE"))).toBe(false);
      expect(session.sqlLog.some((sql) => sql.startsWith("DELETE FROM"))).toBe(false);
      expect(session.sqlLog[session.sqlLog.length - 1]).toBe("ROLLBACK");
    });

    it("should report the Polígono label on the dry-run geometry report when a POLYGON target rejects multi-part geometries", async () => {
      const session = processingSession({ unify: false, incompatible: 2 }, { geometryRows: POLYGON_GEOMETRY });

      const result = await run(session, { ...withProcessing(NO_UNIFY_PROCESSING), dryRun: true });

      expect(result.geometry?.incompatibleGeometryRows).toBe(2);
      expect(result.geometry?.incompatibleTargetType).toBe("Polígono");
    });

    it.each([
      ["a POINT", "POINT", "Punto"],
      ["a LINESTRING", "LINESTRING", "Línea"],
      ["an unknown CURVEPOLYGON fallback", "CURVEPOLYGON", "Curvepolygon"],
      ["a lower-cased point", "point", "Punto"],
    ])("should report the expected target label for %s on the dry-run geometry report when the target rejects multi-part geometries", async (_label, catalogType, expectedLabel) => {
      const session = processingSession({ unify: false, incompatible: 2 }, { geometryRows: [{ srid: 4326, type: catalogType }] });

      const result = await run(session, { ...withProcessing(NO_UNIFY_PROCESSING), dryRun: true });

      expect(result.geometry?.incompatibleGeometryRows).toBe(2);
      expect(result.geometry?.incompatibleTargetType).toBe(expectedLabel);
    });

    it("should refuse a real run naming the Punto label when a POINT target rejects multi-part geometries", async () => {
      const session = processingSession({ unify: false, incompatible: 2 }, { geometryRows: [{ srid: 4326, type: "POINT" }] });

      const error = await captureRejection(run(session, withProcessing(NO_UNIFY_PROCESSING)));

      expectSpanishMessage(error);
      expect(error.message).toContain("2 geometrías de varias partes no caben en la columna destino de tipo Punto");
      expect(session.sqlLog.some((sql) => sql.startsWith("LOCK TABLE"))).toBe(false);
      expect(session.sqlLog.some((sql) => sql.startsWith("DELETE FROM"))).toBe(false);
    });

    it("should refuse a real run with the singular Línea wording when one LINESTRING geometry is multi-part", async () => {
      const session = processingSession({ unify: false, incompatible: 1 }, { geometryRows: [{ srid: 4326, type: "LINESTRING" }] });

      const error = await captureRejection(run(session, withProcessing(NO_UNIFY_PROCESSING)));

      expect(error.message).toContain("1 geometría de varias partes no cabe en la columna destino de tipo Línea");
    });

    it("should report a null label on the geometry report when a MULTIPOLYGON target accepts multi-part geometries", async () => {
      const session = processingSession({ unify: false, incompatible: 4 }, { geometryRows: MULTIPOLYGON_GEOMETRY });

      const result = await run(session, withProcessing(NO_UNIFY_PROCESSING));

      expect(result.geometry?.incompatibleTargetType).toBeNull();
    });

    it("should never reach the incompatible count when a POLYGON target is combined with unify", async () => {
      const session = processingSession({ unify: true, incompatible: 5 }, { geometryRows: POLYGON_GEOMETRY });

      const error = await captureRejection(run(session, withProcessing(FULL_PROCESSING)));

      expectSpanishMessage(error);
      expect(session.sqlLog.some((sql) => sql.includes("GeometryType"))).toBe(false);
    });

    it.each([
      ["MULTIPOLYGON", MULTIPOLYGON_GEOMETRY],
      ["unconstrained GEOMETRY", UNCONSTRAINED_GEOMETRY],
    ])("should not issue the incompatible count when the target geometry accepts multi-part geometries (%s)", async (_label, geometryRows) => {
      const session = processingSession({ incompatible: 4 }, { geometryRows });

      const result = await run(session, withProcessing(FULL_PROCESSING));

      expect(session.sqlLog.some((sql) => sql.includes("GeometryType"))).toBe(false);
      expect(result.geometry?.incompatibleGeometryRows).toBe(0);
    });

    it("should not issue the incompatible count when the target is POLYGON but processing is disabled", async () => {
      const session = createSession({ geometryRows: POLYGON_GEOMETRY });

      const result = await run(session, buildParams({ processing: DISABLED_PROCESSING }));

      expect(session.sqlLog.some((sql) => sql.includes("GeometryType"))).toBe(false);
      expect(result.geometry).toBeUndefined();
    });
  });

  describe("progress", () => {
    it("should emit the PROCESSING phase between STAGING and SWAPPING when processing is active", async () => {
      const session = processingSession();
      const events: ShpReplaceProgress[] = [];

      await run(session, withProcessing(FULL_PROCESSING, { onProgress: (progress) => events.push(progress) }));

      const orderedPhases = events
        .map((event) => event.phase)
        .filter((phase, index, phases) => phase !== phases[index - 1])
        .filter((phase) =>
          [
            ShpReplacePhase.STAGING,
            ShpReplacePhase.PROCESSING,
            ShpReplacePhase.SWAPPING,
            ShpReplacePhase.FINALIZING,
          ].includes(phase)
        );
      expect(orderedPhases).toEqual([
        ShpReplacePhase.STAGING,
        ShpReplacePhase.PROCESSING,
        ShpReplacePhase.SWAPPING,
        ShpReplacePhase.FINALIZING,
      ]);
    });

    it("should never emit the PROCESSING phase when processing is disabled", async () => {
      const session = createSession();
      const events: ShpReplaceProgress[] = [];

      await run(session, buildParams({ processing: DISABLED_PROCESSING, onProgress: (progress) => events.push(progress) }));

      expect(events.some((event) => event.phase === ShpReplacePhase.PROCESSING)).toBe(false);
    });
  });
});

interface TimedProgress extends ShpReplaceProgress {
  at: number;
}

function timedRecorder(session: FakeSession): { events: TimedProgress[]; onProgress: (progress: ShpReplaceProgress) => void } {
  const events: TimedProgress[] = [];
  return {
    events,
    onProgress: (progress) => {
      events.push({ ...progress, at: session.sqlLog.length });
    },
  };
}

function eventFor(events: TimedProgress[], detail: string): TimedProgress {
  const found = events.find((event) => event.detail === detail);
  if (!found) throw new Error(`expected a progress event with detail "${detail}"`);
  return found;
}

const stepsOf = (events: TimedProgress[], phase: ShpReplacePhase) =>
  events.filter((event) => event.phase === phase).map(({ current, total, detail }) => ({ current, total, detail }));

const expectedSteps = (labels: readonly string[]) =>
  labels.map((detail, index) => ({ current: index + 1, total: labels.length, detail }));

const CONVERT_STEP = "Convirtiendo geometrías";
const REPAIR_STEP = "Reparando geometrías";
const UNIFY_STEP = "Unificando por clave";
const REPAIR_UNIFIED_STEP = "Reparando geometrías unificadas";
const VALIDITY_STEP = "Revisando validez de geometrías";
const OVERLAPS_STEP = "Buscando solapes";
const LOCK_STEP = "Bloqueando la tabla destino";
const DELETE_STEP = "Eliminando registros actuales";
const INSERT_STEP = "Insertando registros nuevos";
const ADJUST_SEQUENCES_STEP = "Ajustando secuencias";
const COMMIT_STEP = "Confirmando la transacción";
const ANALYZE_STEP = "Actualizando estadísticas";

const ALL_PROCESSING_STEPS = [CONVERT_STEP, REPAIR_STEP, UNIFY_STEP, REPAIR_UNIFIED_STEP, VALIDITY_STEP, OVERLAPS_STEP];

const ONLY_REPAIR: GeometryProcessingOptions = {
  repair: { enabled: true },
  unify: { enabled: false, keyFields: [] },
  overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
};

const ONLY_UNIFY: GeometryProcessingOptions = {
  repair: { enabled: false },
  unify: { enabled: true, keyFields: ["NOMBRE"] },
  overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
};

const REPAIR_AND_UNIFY: GeometryProcessingOptions = {
  ...FULL_PROCESSING,
  overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
};

const ONLY_OVERLAPS: GeometryProcessingOptions = {
  repair: { enabled: false },
  unify: { enabled: false, keyFields: [] },
  overlaps: { enabled: true, policy: "report", minAreaM2: 1 },
};

describe("runShpReplace progress steps", () => {
  describe("PROCESSING steps", () => {
    it("should emit the six active processing steps with current 1 to 6 and total 6 when repair, unify and overlaps are all on", async () => {
      const session = processingSession();
      const recorder = timedRecorder(session);

      await run(session, withProcessing(FULL_PROCESSING, { onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.PROCESSING)).toEqual(expectedSteps(ALL_PROCESSING_STEPS));
    });

    it("should emit convert, repair and validity steps with total 3 when only repair is on", async () => {
      const session = processingSession({ unify: false });
      const recorder = timedRecorder(session);

      await run(session, withProcessing(ONLY_REPAIR, { onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.PROCESSING)).toEqual(
        expectedSteps([CONVERT_STEP, REPAIR_STEP, VALIDITY_STEP])
      );
    });

    it("should emit convert, unify and validity steps with total 3 when only unify is on", async () => {
      const session = processingSession({ repair: false });
      const recorder = timedRecorder(session);

      await run(session, withProcessing(ONLY_UNIFY, { onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.PROCESSING)).toEqual(
        expectedSteps([CONVERT_STEP, UNIFY_STEP, VALIDITY_STEP])
      );
    });

    it("should emit the unified repair step only when repair and unify are both on", async () => {
      const session = processingSession();
      const recorder = timedRecorder(session);

      await run(session, withProcessing(REPAIR_AND_UNIFY, { onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.PROCESSING)).toEqual(
        expectedSteps([CONVERT_STEP, REPAIR_STEP, UNIFY_STEP, REPAIR_UNIFIED_STEP, VALIDITY_STEP])
      );
    });

    it("should emit convert, validity and overlap steps with total 3 when only overlaps are on", async () => {
      const session = processingSession({ unify: false, repair: false });
      const recorder = timedRecorder(session);

      await run(session, withProcessing(ONLY_OVERLAPS, { onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.PROCESSING)).toEqual(
        expectedSteps([CONVERT_STEP, VALIDITY_STEP, OVERLAPS_STEP])
      );
    });
  });

  describe("PROCESSING step order against statements", () => {
    it("should emit each processing step before the first statement of that step when every process is enabled", async () => {
      const session = processingSession();
      const recorder = timedRecorder(session);

      await run(session, withProcessing(FULL_PROCESSING, { onProgress: recorder.onProgress }));

      expect(eventFor(recorder.events, CONVERT_STEP).at).toBeLessThanOrEqual(
        session.sqlLog.indexOf(buildBaseTableSql(PROCESSING_LAYOUT))
      );
      expect(eventFor(recorder.events, REPAIR_STEP).at).toBeLessThanOrEqual(
        session.sqlLog.indexOf(buildRepairSql(BASE_TABLE)[0])
      );
      expect(eventFor(recorder.events, UNIFY_STEP).at).toBeLessThanOrEqual(
        session.sqlLog.indexOf(buildUnifySql(PROCESSING_LAYOUT))
      );
      expect(eventFor(recorder.events, REPAIR_UNIFIED_STEP).at).toBeLessThanOrEqual(
        session.sqlLog.indexOf(buildRepairSql(UNIFIED_TABLE)[0])
      );
      expect(eventFor(recorder.events, VALIDITY_STEP).at).toBeLessThanOrEqual(
        session.sqlLog.indexOf(buildInvalidCountSql(UNIFIED_TABLE))
      );
      expect(eventFor(recorder.events, OVERLAPS_STEP).at).toBeLessThanOrEqual(
        session.sqlLog.indexOf(buildOverlapInputSql(UNIFIED_TABLE)[0])
      );
    });

    it("should emit each processing step only after the last statement of the step before it when every process is enabled", async () => {
      const session = processingSession();
      const recorder = timedRecorder(session);

      await run(session, withProcessing(FULL_PROCESSING, { onProgress: recorder.onProgress }));

      const baseTableIndex = session.sqlLog.indexOf(buildBaseTableSql(PROCESSING_LAYOUT));
      const baseRepairEmptiedIndex = session.sqlLog.indexOf(buildRepairSql(BASE_TABLE)[1]);
      const unifyIndex = session.sqlLog.indexOf(buildUnifySql(PROCESSING_LAYOUT));
      const unifiedRepairEmptiedIndex = session.sqlLog.indexOf(buildRepairSql(UNIFIED_TABLE)[1]);
      const validityIndex = session.sqlLog.indexOf(buildInvalidCountSql(UNIFIED_TABLE));

      expect(eventFor(recorder.events, REPAIR_STEP).at).toBeGreaterThan(baseTableIndex);
      expect(eventFor(recorder.events, UNIFY_STEP).at).toBeGreaterThan(baseRepairEmptiedIndex);
      expect(eventFor(recorder.events, REPAIR_UNIFIED_STEP).at).toBeGreaterThan(unifyIndex);
      expect(eventFor(recorder.events, VALIDITY_STEP).at).toBeGreaterThan(unifiedRepairEmptiedIndex);
      expect(eventFor(recorder.events, OVERLAPS_STEP).at).toBeGreaterThan(validityIndex);
    });
  });

  describe("dry run steps", () => {
    it("should emit only the processing steps and no swapping or finalizing events when dryRun is true", async () => {
      const session = processingSession();
      const recorder = timedRecorder(session);

      await run(session, withProcessing(FULL_PROCESSING, { dryRun: true, onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.PROCESSING)).toEqual(expectedSteps(ALL_PROCESSING_STEPS));
      expect(
        recorder.events.some(
          (event) => event.phase === ShpReplacePhase.SWAPPING || event.phase === ShpReplacePhase.FINALIZING
        )
      ).toBe(false);
    });
  });

  describe("SWAPPING steps", () => {
    it("should emit the lock, delete and insert steps with current 1 to 3 and total 3 when the real run swaps rows", async () => {
      const session = createSession();
      const recorder = timedRecorder(session);

      await run(session, buildParams({ onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.SWAPPING)).toEqual(
        expectedSteps([LOCK_STEP, DELETE_STEP, INSERT_STEP])
      );
    });

    it("should emit each swapping step between the statement before it and the statement it precedes", async () => {
      const session = createSession();
      const recorder = timedRecorder(session);

      await run(session, buildParams({ onProgress: recorder.onProgress }));

      const lockIndex = session.kinds.indexOf("LOCK");
      const deleteIndex = session.kinds.indexOf("DELETE");
      const insertIndex = session.kinds.indexOf("INSERT");
      expect(eventFor(recorder.events, LOCK_STEP).at).toBeLessThanOrEqual(lockIndex);
      expect(eventFor(recorder.events, DELETE_STEP).at).toBeGreaterThan(lockIndex);
      expect(eventFor(recorder.events, DELETE_STEP).at).toBeLessThanOrEqual(deleteIndex);
      expect(eventFor(recorder.events, INSERT_STEP).at).toBeGreaterThan(deleteIndex);
      expect(eventFor(recorder.events, INSERT_STEP).at).toBeLessThanOrEqual(insertIndex);
    });
  });

  describe("FINALIZING steps", () => {
    it("should emit the sequence, commit and statistics steps with current 1 to 3 and total 3 when the real run finalizes", async () => {
      const session = createSession();
      const recorder = timedRecorder(session);

      await run(session, buildParams({ onProgress: recorder.onProgress }));

      expect(stepsOf(recorder.events, ShpReplacePhase.FINALIZING)).toEqual(
        expectedSteps([ADJUST_SEQUENCES_STEP, COMMIT_STEP, ANALYZE_STEP])
      );
    });

    it("should emit the statistics step after COMMIT and before ANALYZE when the real run finalizes", async () => {
      const session = createSession();
      const recorder = timedRecorder(session);

      await run(session, buildParams({ onProgress: recorder.onProgress }));

      const commitIndex = session.kinds.indexOf("COMMIT");
      const analyzeIndex = session.kinds.indexOf("ANALYZE");
      expect(eventFor(recorder.events, COMMIT_STEP).at).toBeLessThanOrEqual(commitIndex);
      expect(eventFor(recorder.events, ANALYZE_STEP).at).toBeGreaterThan(commitIndex);
      expect(eventFor(recorder.events, ANALYZE_STEP).at).toBeLessThanOrEqual(analyzeIndex);
    });

    it("should emit the sequence step before the first sequence statement and the commit step after the last one when sequences are adjusted", async () => {
      const session = createSession();
      const recorder = timedRecorder(session);

      await run(session, buildParams({ sequences: [MAPPED_SEQUENCE], onProgress: recorder.onProgress }));

      const firstSequenceIndex = session.kinds.indexOf("SEQUENCE");
      const lastSequenceIndex = session.kinds.lastIndexOf("SEQUENCE");
      expect(firstSequenceIndex).toBeGreaterThan(-1);
      expect(eventFor(recorder.events, ADJUST_SEQUENCES_STEP).at).toBeLessThanOrEqual(firstSequenceIndex);
      expect(eventFor(recorder.events, COMMIT_STEP).at).toBeGreaterThan(lastSequenceIndex);
    });
  });

  describe("STAGING steps", () => {
    it("should leave the step detail undefined on every staging progress event", async () => {
      const session = createSession();
      const recorder = timedRecorder(session);

      await run(session, buildParams({ onProgress: recorder.onProgress }));

      const staging = recorder.events.filter((event) => event.phase === ShpReplacePhase.STAGING);
      expect(staging.length).toBeGreaterThan(0);
      expect(staging.every((event) => event.detail === undefined)).toBe(true);
    });
  });
});

const TICK_MS = 7;

function steppingClock(tick = TICK_MS): () => number {
  let current = 0;
  return () => {
    current += tick;
    return current;
  };
}

const stepLabelsOf = (report: GeometryProcessingReport | undefined): string[] =>
  (report?.stepTimings ?? []).map((timing) => timing.label);

describe("runShpReplace step timings", () => {
  describe("timings per processing step", () => {
    it("should record one timing per processing step in plan order when repair, unify and overlaps are all on", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING, { now: steppingClock() }));

      expect(stepLabelsOf(result.geometry)).toEqual(ALL_PROCESSING_STEPS);
    });

    it("should record convert, repair and validity timings in plan order when only repair is on", async () => {
      const session = processingSession({ unify: false });

      const result = await run(session, withProcessing(ONLY_REPAIR, { now: steppingClock() }));

      expect(stepLabelsOf(result.geometry)).toEqual([CONVERT_STEP, REPAIR_STEP, VALIDITY_STEP]);
    });

    it("should record every step timing as a non-negative integer ms when processing runs", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING, { now: steppingClock() }));

      const timings = result.geometry?.stepTimings ?? [];
      expect(timings.length).toBeGreaterThan(0);
      for (const timing of timings) {
        expect(Number.isInteger(timing.ms)).toBe(true);
        expect(timing.ms).toBeGreaterThanOrEqual(0);
      }
    });

    it("should give each step the ticks elapsed until the next step starts when the clock advances by a fixed amount per call", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING, { now: steppingClock() }));

      expect(result.geometry?.stepTimings.map((timing) => timing.ms)).toEqual(
        ALL_PROCESSING_STEPS.map(() => TICK_MS)
      );
    });

    it("should set processingMs to the sum of the step timings when processing runs", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING, { now: steppingClock() }));

      const summed = (result.geometry?.stepTimings ?? []).reduce((total, timing) => total + timing.ms, 0);
      expect(result.geometry?.processingMs).toBe(summed);
      expect(result.geometry?.processingMs).toBe(ALL_PROCESSING_STEPS.length * TICK_MS);
    });
  });

  describe("no processing", () => {
    it("should expose no geometry report and so no step timings when every process is disabled", async () => {
      const session = createSession();

      const result = await run(session, buildParams({ processing: DISABLED_PROCESSING, now: steppingClock() }));

      expect(result.geometry).toBeUndefined();
    });
  });

  describe("dry run and real run", () => {
    it("should include the step timings and processingMs in the geometry report of a dry run", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING, { dryRun: true, now: steppingClock() }));

      expect(stepLabelsOf(result.geometry)).toEqual(ALL_PROCESSING_STEPS);
      expect(result.geometry?.processingMs).toBe(ALL_PROCESSING_STEPS.length * TICK_MS);
    });

    it("should include the step timings and processingMs in the geometry report of a real run", async () => {
      const session = processingSession();

      const result = await run(session, withProcessing(FULL_PROCESSING, { now: steppingClock() }));

      expect(stepLabelsOf(result.geometry)).toEqual(ALL_PROCESSING_STEPS);
      expect(result.geometry?.processingMs).toBe(ALL_PROCESSING_STEPS.length * TICK_MS);
    });
  });

  describe("blocked by overlaps", () => {
    it("should carry the step timings and processingMs in the ShpProcessingBlockedError report when the block policy finds overlaps", async () => {
      const session = processingSession({ overlapCount: 3 });

      const error = await captureRejection(
        run(session, withProcessing(FULL_BLOCKING_PROCESSING, { now: steppingClock() }))
      );

      expect(error).toBeInstanceOf(ShpProcessingBlockedError);
      const blocked = error as ShpProcessingBlockedError;
      expect(stepLabelsOf(blocked.report)).toEqual(ALL_PROCESSING_STEPS);
      expect(blocked.report.processingMs).toBe(ALL_PROCESSING_STEPS.length * TICK_MS);
    });
  });
});
