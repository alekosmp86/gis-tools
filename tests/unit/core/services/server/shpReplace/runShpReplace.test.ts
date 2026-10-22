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
import { ShpCommitUncertainError } from "@/core/services/server/shpReplace/shpReplaceTypes";

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
  | "UNKNOWN";

type TargetColumnFixture = DbColumnMetadata & { udt_name: string };

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

interface FakeOptions {
  columns: TargetColumnFixture[];
  geometryRows: Array<{ srid: number; type: string; coord_dimension?: number }>;
  sridRows: Array<{ srid: number }>;
  previousRows: number;
  setvalNextValue: number;
  stageCountOverride?: number;
  insertRowCount?: number;
  copyError?: Error;
  insertError?: Error;
  commitError?: Error;
  analyzeError?: Error;
  onCopyLine?: (line: string) => void;
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
          [ShpReplacePhase.STAGING, ShpReplacePhase.SWAPPING, ShpReplacePhase.FINALIZING].includes(phase)
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
