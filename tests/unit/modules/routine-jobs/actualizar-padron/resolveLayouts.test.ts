import { describe, it, expect } from "vitest";
import {
  assertDistinctTables,
  resolveActualizarLayouts,
} from "@/modules/routine-jobs/jobs/actualizar-padron/services/resolveLayouts";
import type { ActualizarPadronParams } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  LOCALITY_REQUIRED_COLUMNS,
  PADRON_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  STAGING_REQUIRED_COLUMNS,
  WORK_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { DbColumnMetadata } from "@/core/types/db";

/*
 * Catalog fake, dispatching on the SQL text (every query binds [schema, table] first):
 *  - relation-kind query: the SQL mentions relkind and NOT attname (the core column query also mentions relkind).
 *    Answers [{ relkind }] for the table in values[1]: "r" unless the scenario names another kind; [] for an unknown table.
 *  - identity query: the SQL mentions attidentity. Answers [{ column_name }] for the scenario's identity columns of the work table.
 *  - padron sequence query: the SQL mentions pg_get_serial_sequence, binds [schema, table, column] and answers
 *    [{ sequence_name }] (the scenario's padronIdSequence, default "cat.padron_id_seq"; null when the scenario says so).
 *  - trigger and rewrite-rule facts (SQL mentions pg_trigger or pg_rewrite; bound [schema, table]): one row per user
 *    trigger and per rewrite rule other than _RETURN of the WORK table, as { kind: "trigger" | "rule", name }. Other
 *    tables answer []. The scenario names them in workTriggers and workRules. Answered before any other query kind.
 *  - any other query is the core column query: it answers that table's columns as
 *    { column_name, data_type, is_nullable, column_default }; an unknown table answers [].
 * Geometry columns carry the format_type text, e.g. "geometry(MultiPolygon,32721)"; plain "geometry" means SRID 0.
 * Column reads are recorded so the tests can assert they are sequential (one pg client, no overlap).
 */
const SCHEMA = "cat";
const PASSWORD = "S3cr3t!pw";
const MULTIPOLYGON_32721 = "geometry(MultiPolygon,32721)";

type CatalogMap = Record<string, DbColumnMetadata[]>;

const column = (name: string, dataType = "text", overrides: Partial<DbColumnMetadata> = {}): DbColumnMetadata => ({
  column_name: name,
  data_type: dataType,
  is_nullable: true,
  column_default: null,
  ...overrides,
});

const stagingColumns = (): DbColumnMetadata[] => [
  column("unidadcat"),
  column("nomdepto"),
  column("nomloccat"),
  column("padron", "numeric"),
  column("geom", MULTIPOLYGON_32721),
];

const workColumns = (): DbColumnMetadata[] => [
  column("number", "character varying(10)"),
  column("type_padron", "character varying(30)"),
  column("id_cadastral_locality", "integer"),
  column("id_province", "integer"),
  column("geometry", MULTIPOLYGON_32721),
];

const padronColumns = (): DbColumnMetadata[] => [
  column("id", "integer", { column_default: "nextval('cat.padron_id_seq'::regclass)" }),
  column("geometry", MULTIPOLYGON_32721),
];

const provinceColumns = (): DbColumnMetadata[] => [column("id", "integer"), column("name")];

const localityColumns = (): DbColumnMetadata[] => [column("id", "integer"), column("name"), column("id_province", "integer")];

const defaultCatalogs = (): CatalogMap => ({
  stg_padron: stagingColumns(),
  padron_trabajo: workColumns(),
  padron: padronColumns(),
  province: provinceColumns(),
  cadastral_locality: localityColumns(),
});

const paramsWith = (overrides: Partial<ActualizarPadronParams> = {}): ActualizarPadronParams => ({
  config: {
    host: "db.local",
    port: "5432",
    db_name: "gis",
    user: "gis_user",
    password: PASSWORD,
    schema_name: "",
    table_name: "",
  },
  stagingSchema: SCHEMA,
  stagingTable: "stg_padron",
  workSchema: SCHEMA,
  workTable: "padron_trabajo",
  padronTable: "padron",
  provinceTable: "province",
  localityTable: "cadastral_locality",
  options: { clearMode: "delete" },
  dryRun: false,
  confirm: true,
  ...overrides,
});

interface CatalogScenario {
  catalogs: CatalogMap;
  relkinds?: Record<string, string>;
  identityColumns?: string[];
  padronIdSequence?: string | null;
  workTriggers?: string[];
  workRules?: string[];
}

const DEFAULT_PADRON_SEQUENCE = "cat.padron_id_seq";
const WORK_TABLE = "padron_trabajo";

const isFactsQuery = (sql: string): boolean => /pg_trigger|pg_rewrite/i.test(sql);
const isRelkindQuery = (sql: string): boolean => /relkind/i.test(sql) && !/attname/i.test(sql);
const isIdentityQuery = (sql: string): boolean => /attidentity/i.test(sql);
const isPadronSequenceQuery = (sql: string): boolean => /pg_get_serial_sequence/i.test(sql);

function catalogSession(scenario: CatalogScenario) {
  const state = {
    inFlight: 0,
    maxInFlight: 0,
    reads: [] as Array<{ schema: unknown; table: unknown }>,
    relkindCalls: [] as Array<{ sql: string; values?: unknown[] }>,
    identityCalls: [] as Array<{ sql: string; values?: unknown[] }>,
    sequenceCalls: [] as Array<{ sql: string; values?: unknown[] }>,
    factsCalls: [] as Array<{ sql: string; values?: unknown[] }>,
  };
  return {
    state,
    async query(sql: string, values?: unknown[]) {
      const schema = values?.[0];
      const table = values?.[1];
      await Promise.resolve();
      if (isFactsQuery(sql)) {
        state.factsCalls.push({ sql, values });
        if (String(table) !== WORK_TABLE) return { rows: [] };
        return {
          rows: [
            ...(scenario.workTriggers ?? []).map((name) => ({ kind: "trigger", name })),
            ...(scenario.workRules ?? []).map((name) => ({ kind: "rule", name })),
          ],
        };
      }
      if (isRelkindQuery(sql)) {
        state.relkindCalls.push({ sql, values });
        const relkind = scenario.relkinds?.[String(table)] ?? "r";
        return { rows: scenario.catalogs[String(table)] ? [{ relkind }] : [] };
      }
      if (isIdentityQuery(sql)) {
        state.identityCalls.push({ sql, values });
        return { rows: (scenario.identityColumns ?? []).map((column_name) => ({ column_name })) };
      }
      if (isPadronSequenceQuery(sql)) {
        state.sequenceCalls.push({ sql, values });
        const sequence = scenario.padronIdSequence === undefined ? DEFAULT_PADRON_SEQUENCE : scenario.padronIdSequence;
        return { rows: [{ sequence_name: sequence }] };
      }
      state.reads.push({ schema, table });
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        await Promise.resolve();
        const rows = scenario.catalogs[String(table)] ?? [];
        return {
          rows: rows.map((entry) => ({
            column_name: entry.column_name,
            data_type: entry.data_type,
            is_nullable: entry.is_nullable,
            column_default: entry.column_default,
          })),
        };
      } finally {
        state.inFlight -= 1;
      }
    },
  };
}

const withCatalogs = (overrides: CatalogMap, extras: Omit<CatalogScenario, "catalogs"> = {}) =>
  catalogSession({ catalogs: { ...defaultCatalogs(), ...overrides }, ...extras });

const replaceColumn = (columns: DbColumnMetadata[], name: string, replacement: DbColumnMetadata[]): DbColumnMetadata[] =>
  columns.flatMap((entry) => (entry.column_name === name ? replacement : [entry]));

describe("resolveActualizarLayouts", () => {
  describe("assertDistinctTables (AP-3)", () => {
    it("should accept five distinct tables", () => {
      expect(() => assertDistinctTables(paramsWith())).not.toThrow();
    });

    it("should accept the same table name in two different schemas", () => {
      const params = paramsWith({ stagingSchema: "otro", stagingTable: "padron_trabajo" });

      expect(() => assertDistinctTables(params)).not.toThrow();
    });

    it.each([
      ["staging and work", { stagingSchema: SCHEMA, stagingTable: "padron_trabajo" }, "cat.padron_trabajo"],
      ["work and padron", { workTable: "padron" }, "cat.padron"],
      ["province and locality", { localityTable: "province" }, "cat.province"],
      ["padron and locality", { localityTable: "padron" }, "cat.padron"],
      ["staging and province", { stagingTable: "province" }, "cat.province"],
    ])("should refuse when %s name the same table, naming the repeated table in Spanish", (_label, overrides, repeated) => {
      const params = paramsWith(overrides);

      expect(() => assertDistinctTables(params)).toThrow(repeated);
    });
  });

  describe("logical columns per role (AP-2)", () => {
    it("should map every logical column of the five roles to its catalog column name", async () => {
      const session = withCatalogs({});

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.staging).toEqual({
        schema: SCHEMA,
        table: "stg_padron",
        columns: Object.fromEntries(STAGING_REQUIRED_COLUMNS.map((name) => [name, name])),
      });
      expect(layouts.work.columns).toEqual(Object.fromEntries(WORK_REQUIRED_COLUMNS.map((name) => [name, name])));
      expect(layouts.padron.columns).toEqual(Object.fromEntries(PADRON_REQUIRED_COLUMNS.map((name) => [name, name])));
      expect(layouts.province.columns).toEqual(Object.fromEntries(PROVINCE_REQUIRED_COLUMNS.map((name) => [name, name])));
      expect(layouts.locality.columns).toEqual(Object.fromEntries(LOCALITY_REQUIRED_COLUMNS.map((name) => [name, name])));
    });

    it("should carry the schema and table of each role from the selection", async () => {
      const session = withCatalogs({});

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.work).toMatchObject({ schema: SCHEMA, table: "padron_trabajo" });
      expect(layouts.padron).toMatchObject({ schema: SCHEMA, table: "padron" });
      expect(layouts.province).toMatchObject({ schema: SCHEMA, table: "province" });
      expect(layouts.locality).toMatchObject({ schema: SCHEMA, table: "cadastral_locality" });
    });

    it("should resolve column names that differ in case or separators to the logical columns", async () => {
      const session = withCatalogs({
        stg_padron: [
          column("UnidadCat"),
          column("NOM_DEPTO"),
          column("Nom Loc Cat"),
          column("PADRON", "numeric"),
          column("GEOM", MULTIPOLYGON_32721),
        ],
      });

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.staging.columns).toMatchObject({
        unidadcat: "UnidadCat",
        nomdepto: "NOM_DEPTO",
        nomloccat: "Nom Loc Cat",
        padron: "PADRON",
        geom: "GEOM",
      });
    });

    it("should accept a single geometry column of another name as the staging geom (generic geometry exception)", async () => {
      const session = withCatalogs({
        stg_padron: replaceColumn(stagingColumns(), "geom", [column("forma", MULTIPOLYGON_32721)]),
      });

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.staging.columns.geom).toBe("forma");
    });

    it("should accept a single geometry column of another name as the work geometry (generic exception applies to every role)", async () => {
      const session = withCatalogs({
        padron_trabajo: replaceColumn(workColumns(), "geometry", [column("forma_w", MULTIPOLYGON_32721)]),
      });

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.work.columns.geometry).toBe("forma_w");
    });

    it("should refuse a required staging column that is missing, naming the table and the logical column", async () => {
      const session = withCatalogs({ stg_padron: stagingColumns().filter((entry) => entry.column_name !== "padron") });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/stg_padron/);
      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/"padron"/);
    });

    it.each([
      ["work", { padron_trabajo: workColumns().filter((entry) => entry.column_name !== "id_province") }, "id_province"],
      ["padron", { padron: padronColumns().filter((entry) => entry.column_name !== "id") }, "id"],
      ["province", { province: provinceColumns().filter((entry) => entry.column_name !== "name") }, "name"],
      ["locality", { cadastral_locality: localityColumns().filter((entry) => entry.column_name !== "id_province") }, "id_province"],
    ])("should refuse a missing required column of the %s role, naming it in Spanish", async (_role, overrides, missing) => {
      const session = withCatalogs(overrides);

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(`"${missing}"`);
    });

    it("should refuse an ambiguous required column, naming the table in Spanish", async () => {
      const session = withCatalogs({
        stg_padron: [
          ...stagingColumns().filter((entry) => entry.column_name !== "nomdepto"),
          column("Nom_Depto"),
          column("NOM-DEPTO"),
        ],
      });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/stg_padron[\s\S]*nomdepto|nomdepto[\s\S]*stg_padron/);
      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/ambigu/i);
    });

    it("should refuse a table that does not exist because it has no columns, naming the table", async () => {
      const session = withCatalogs({ province: [] });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/cat\.province.*no existe/);
    });

    it("should report every table with issues in one error", async () => {
      const session = withCatalogs({
        stg_padron: stagingColumns().filter((entry) => entry.column_name !== "unidadcat"),
        cadastral_locality: localityColumns().filter((entry) => entry.column_name !== "name"),
      });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/cat\.stg_padron[\s\S]*cat\.cadastral_locality/);
    });
  });

  describe("geometry typing (AP-6, AP-7)", () => {
    it.each([
      ["Polygon", "geometry(Polygon,32721)"],
      ["MultiPolygon", "geometry(MultiPolygon,32721)"],
      ["generic GEOMETRY", "geometry"],
    ])("should accept a %s staging geometry", async (_label, dataType) => {
      const session = withCatalogs({ stg_padron: replaceColumn(stagingColumns(), "geom", [column("geom", dataType)]) });

      await expect(resolveActualizarLayouts(session, paramsWith())).resolves.toBeDefined();
    });

    it("should refuse a Point staging geometry, naming the staging table and the required types", async () => {
      const session = withCatalogs({ stg_padron: replaceColumn(stagingColumns(), "geom", [column("geom", "geometry(Point,32721)")]) });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/stg_padron[\s\S]*Point|Point[\s\S]*stg_padron/);
    });

    it("should refuse a staging geom column that is not a geometry, naming the table", async () => {
      const session = withCatalogs({ stg_padron: replaceColumn(stagingColumns(), "geom", [column("geom", "text")]) });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/stg_padron/);
    });

    it("should accept a plain geometry work column, with the target SRID still taken from the padron", async () => {
      const session = withCatalogs({ padron_trabajo: replaceColumn(workColumns(), "geometry", [column("geometry", "geometry")]) });

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.work.srid).toBe(32721);
    });

    it("should refuse a Polygon work geometry, since the work table holds MultiPolygon, naming the work table", async () => {
      const session = withCatalogs({
        padron_trabajo: replaceColumn(workColumns(), "geometry", [column("geometry", "geometry(Polygon,32721)")]),
      });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/padron_trabajo/);
    });

    it("should read the target SRID from the padron geometry typmod", async () => {
      const session = withCatalogs({ padron: replaceColumn(padronColumns(), "geometry", [column("geometry", "geometry(MultiPolygon,4326)")]) });

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.work.srid).toBe(4326);
    });

    it("should refuse a generic padron geometry without SRID (typmod 0), naming the padron table", async () => {
      const session = withCatalogs({ padron: replaceColumn(padronColumns(), "geometry", [column("geometry", "geometry")]) });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/padron/);
    });

    it("should refuse a padron geometry column that is not a geometry, naming the padron table", async () => {
      const session = withCatalogs({ padron: replaceColumn(padronColumns(), "geometry", [column("geometry", "text")]) });

      await expect(resolveActualizarLayouts(session, paramsWith())).rejects.toThrow(/padron/);
    });
  });

  describe("catalog reads", () => {
    it("should read the catalog of each of the five tables once, in the selected schema", async () => {
      const session = withCatalogs({});

      await resolveActualizarLayouts(session, paramsWith());

      expect(session.state.reads.map((read) => read.table).sort()).toEqual(
        ["cadastral_locality", "padron", "padron_trabajo", "province", "stg_padron"].sort()
      );
      expect(session.state.reads.every((read) => read.schema === SCHEMA)).toBe(true);
    });

    it("should never issue two catalog queries at once on the one session", async () => {
      const session = withCatalogs({});

      await resolveActualizarLayouts(session, paramsWith());

      expect(session.state.maxInFlight).toBe(1);
    });

    it("should expose the work and padron catalogs for the preflight checks", async () => {
      const session = withCatalogs({});

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.workCatalog.map((entry) => entry.column_name)).toEqual(expect.arrayContaining(["number", "geometry"]));
      expect(layouts.padronCatalog.find((entry) => entry.column_name === "id")?.column_default).toContain("padron_id_seq");
    });
  });

  describe("work table relation kind (AP-5)", () => {
    it.each([
      ["view (v)", "v", /vista(?! materializada)/i],
      ["materialized view (m)", "m", /vista materializada/i],
      ["foreign table (f)", "f", /for[aá]nea/i],
      ["sequence (S)", "S", /tabla regular|partitionada/i],
    ])("should refuse a %s as the work table in Spanish, naming cat.padron_trabajo", async (_label, relkind, kindText) => {
      const session = withCatalogs({}, { relkinds: { padron_trabajo: relkind } });

      const failure = await resolveActualizarLayouts(session, paramsWith()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/cat\.padron_trabajo/);
      expect((failure as Error).message).toMatch(kindText);
    });

    it.each([
      ["regular table (r)", "r"],
      ["partitioned table (p)", "p"],
    ])("should accept a %s as the work table", async (_label, relkind) => {
      const session = withCatalogs({}, { relkinds: { padron_trabajo: relkind } });

      await expect(resolveActualizarLayouts(session, paramsWith())).resolves.toBeDefined();
    });

    it("should read the relation kind with the schema and table as bound values, never interpolated", async () => {
      const session = withCatalogs({});

      await resolveActualizarLayouts(session, paramsWith());

      const workRead = session.state.relkindCalls.find((call) => call.values?.includes("padron_trabajo"));
      expect(workRead).toBeDefined();
      expect(workRead?.sql).toMatch(/relkind/i);
      expect(workRead?.sql).not.toContain("padron_trabajo");
      expect(workRead?.values).toEqual([SCHEMA, "padron_trabajo"]);
    });
  });

  describe("work table triggers and rewrite rules (AP-5)", () => {
    it("should refuse a user trigger on the work table in Spanish, naming cat.padron_trabajo and the trigger", async () => {
      const session = withCatalogs({}, { workTriggers: ["trg_auditoria"] });

      const failure = await resolveActualizarLayouts(session, paramsWith()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/cat\.padron_trabajo/);
      expect((failure as Error).message).toMatch(/trigger/i);
    });

    it("should refuse a rewrite rule other than _RETURN on the work table in Spanish, naming cat.padron_trabajo and the regla", async () => {
      const session = withCatalogs({}, { workRules: ["regla_espejo"] });

      const failure = await resolveActualizarLayouts(session, paramsWith()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/cat\.padron_trabajo/);
      expect((failure as Error).message).toMatch(/regla/i);
    });

    it("should name both causes when the work table has a trigger and a rule", async () => {
      const session = withCatalogs({}, { workTriggers: ["trg_auditoria"], workRules: ["regla_espejo"] });

      const failure = await resolveActualizarLayouts(session, paramsWith()).catch((error: unknown) => error);

      expect((failure as Error).message).toMatch(/trigger/i);
      expect((failure as Error).message).toMatch(/regla/i);
    });

    it("should accept a work table with no user triggers and no rewrite rules", async () => {
      const session = withCatalogs({}, { workTriggers: [], workRules: [] });

      await expect(resolveActualizarLayouts(session, paramsWith())).resolves.toBeDefined();
    });

    it("should read the triggers and rules of the work table in one query with bound schema and table, skipping internal triggers and _RETURN", async () => {
      const session = withCatalogs({});

      await resolveActualizarLayouts(session, paramsWith());

      expect(session.state.factsCalls).toHaveLength(1);
      const [call] = session.state.factsCalls;
      expect(call.values).toEqual([SCHEMA, WORK_TABLE]);
      expect(call.sql).not.toContain(WORK_TABLE);
      expect(call.sql).toMatch(/pg_trigger/i);
      expect(call.sql).toMatch(/pg_rewrite/i);
      expect(call.sql).toMatch(/tgisinternal/i);
      expect(call.sql).toMatch(/_RETURN/);
    });
  });

  describe("padron id sequence (AP-5)", () => {
    it("should resolve the padron id sequence with pg_get_serial_sequence on the bound padron table and its id column", async () => {
      const session = withCatalogs({});

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(session.state.sequenceCalls).toHaveLength(1);
      expect(session.state.sequenceCalls[0].sql).not.toContain("padron");
      expect(session.state.sequenceCalls[0].values).toEqual([SCHEMA, "padron", "id"]);
      expect(layouts.padronIdSequence).toBe(DEFAULT_PADRON_SEQUENCE);
    });

    it("should expose a null padron id sequence when pg_get_serial_sequence finds none", async () => {
      const session = withCatalogs({}, { padronIdSequence: null });

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.padronIdSequence).toBeNull();
    });
  });

  describe("identity columns of the work table (AP-5)", () => {
    it("should flag the work columns that are identity, and only those, in the work catalog", async () => {
      const session = withCatalogs(
        { padron_trabajo: [...workColumns(), column("id", "integer")] },
        { identityColumns: ["id"] },
      );

      const layouts = await resolveActualizarLayouts(session, paramsWith());

      expect(layouts.workCatalog.find((entry) => entry.column_name === "id")?.is_identity).toBe(true);
      expect(layouts.workCatalog.find((entry) => entry.column_name === "number")?.is_identity).toBe(false);
      expect(layouts.workCatalog.filter((entry) => entry.is_identity).map((entry) => entry.column_name)).toEqual(["id"]);
    });

    it("should read the identity columns with the work schema and table as bound values", async () => {
      const session = withCatalogs({});

      await resolveActualizarLayouts(session, paramsWith());

      expect(session.state.identityCalls).toHaveLength(1);
      expect(session.state.identityCalls[0].values).toEqual([SCHEMA, "padron_trabajo"]);
    });
  });

  describe("staging padron column type (AP-6)", () => {
    it.each([
      ["character varying(10)"],
      ["text"],
    ])("should refuse a staging padron column of type %s, naming the staging table and the column in Spanish", async (dataType) => {
      const session = withCatalogs({ stg_padron: replaceColumn(stagingColumns(), "padron", [column("padron", dataType)]) });

      const failure = await resolveActualizarLayouts(session, paramsWith()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/cat\.stg_padron/);
      expect((failure as Error).message).toMatch(/"padron"/);
      expect((failure as Error).message).toMatch(/num[ée]ric/i);
    });

    it.each([
      ["numeric"],
      ["numeric(12,0)"],
      ["integer"],
      ["bigint"],
      ["double precision"],
    ])("should accept a staging padron column of type %s", async (dataType) => {
      const session = withCatalogs({ stg_padron: replaceColumn(stagingColumns(), "padron", [column("padron", dataType)]) });

      await expect(resolveActualizarLayouts(session, paramsWith())).resolves.toBeDefined();
    });
  });
});
