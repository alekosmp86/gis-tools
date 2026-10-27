import { describe, it, expect } from "vitest";
import {
  assertRunAllowed,
  assertStagingHasRows,
  assertStagingSridSupported,
  assertTruncatable,
  assertUnitTypeUnique,
  assertWorkTableSafe,
  assertWorkWritePrivileges,
} from "@/modules/routine-jobs/jobs/actualizar-padron/services/preflight";
import {
  buildStagingCountSql,
  buildStagingSridProbeSql,
  type TableLayout,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/populateSql";
import type { ResolvedActualizarLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/services/resolveLayouts";
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
 * Session fake for the preflight checks:
 *  - the staging count and SRID probe answer the exact builder text: [{ count }] and [{ unsupported }]
 *    (the probe is built with the target SRID, as the runner does);
 *  - has_table_privilege answers per privilege literal found in the SQL text (or bound values): INSERT, DELETE, TRUNCATE;
 *    the table and schema are bound values, never interpolated;
 *  - foreign-key lookups (pg_constraint / confrelid) answer one row per referencing table;
 *  - every other statement answers [].
 * Every statement is recorded so the tests can assert what ran before any write.
 */
const SCHEMA = "cat";
const WORK = "padron_trabajo";
const PADRON_SEQUENCE = "padron_id_seq";
const PADRON_ID_DEFAULT = `nextval('${SCHEMA}.${PADRON_SEQUENCE}'::regclass)`;
const SRID = 32721;
const PRIVILEGE_NAMES = ["INSERT", "DELETE", "TRUNCATE"] as const;

interface SessionScenario {
  stagingRows?: number | string;
  unsupportedSrid?: number | string;
  deniedPrivileges?: string[];
  referencingTables?: string[];
}

function sessionWith(scenario: SessionScenario = {}, staging: TableLayout = stagingLayout()) {
  const log: Array<{ sql: string; values?: unknown[] }> = [];
  const countSql = buildStagingCountSql(staging);
  const probeSql = buildStagingSridProbeSql(staging, SRID);
  const session = {
    log,
    async query(sql: string, values?: unknown[]) {
      log.push({ sql, values });
      await Promise.resolve();
      if (sql === countSql) return { rows: [{ count: scenario.stagingRows ?? 5 }] };
      if (sql === probeSql) return { rows: [{ unsupported: scenario.unsupportedSrid ?? 0 }] };
      const privilege = PRIVILEGE_NAMES.find((name) => sql.includes(`'${name}'`) || values?.includes(name));
      if (privilege) {
        return { rows: [{ has_privilege: !(scenario.deniedPrivileges ?? []).includes(privilege) }] };
      }
      if (/pg_constraint|confrelid|referential_constraints/i.test(sql)) {
        return { rows: (scenario.referencingTables ?? []).map((name) => ({ referencing_table: name })) };
      }
      return { rows: [] };
    },
    async close() {
      return undefined;
    },
  };
  return session;
}

const identity = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const stagingLayout = (): TableLayout => ({ schema: SCHEMA, table: "stg_padron", columns: identity(STAGING_REQUIRED_COLUMNS) });

/* A work-table catalog entry: the core column metadata plus the identity flag read by the module's own catalog query. */
type WorkCatalogColumn = DbColumnMetadata & { is_identity: boolean };

const column = (name: string, dataType = "integer", overrides: Partial<WorkCatalogColumn> = {}): WorkCatalogColumn => ({
  column_name: name,
  data_type: dataType,
  is_nullable: true,
  column_default: null,
  is_identity: false,
  ...overrides,
});

const defaultWorkCatalog = (): WorkCatalogColumn[] => [
  column("number", "character varying(10)"),
  column("type_padron", "character varying(30)"),
  column("id_cadastral_locality"),
  column("id_province"),
  column("geometry", `geometry(MultiPolygon,${SRID})`),
];

const defaultPadronCatalog = (): DbColumnMetadata[] => [
  column("id", "integer", { column_default: PADRON_ID_DEFAULT, is_nullable: false }),
  column("geometry", `geometry(MultiPolygon,${SRID})`),
];

/*
 * The padron id sequence is the resolved pg_get_serial_sequence text of the padron id column (serial or identity),
 * not the padron column default: the fixture carries it in padronIdSequence.
 */
interface ResolvedOverrides {
  workCatalog?: WorkCatalogColumn[];
  padronCatalog?: DbColumnMetadata[];
  padronIdSequence?: string | null;
}

const resolvedWith = (overrides: ResolvedOverrides = {}): ResolvedActualizarLayouts => ({
  staging: stagingLayout(),
  work: { schema: SCHEMA, table: WORK, columns: identity(WORK_REQUIRED_COLUMNS), srid: SRID },
  padron: { schema: SCHEMA, table: "padron", columns: identity(PADRON_REQUIRED_COLUMNS) },
  province: { schema: SCHEMA, table: "province", columns: identity(PROVINCE_REQUIRED_COLUMNS) },
  locality: { schema: SCHEMA, table: "cadastral_locality", columns: identity(LOCALITY_REQUIRED_COLUMNS) },
  workCatalog: overrides.workCatalog ?? defaultWorkCatalog(),
  padronCatalog: overrides.padronCatalog ?? defaultPadronCatalog(),
  padronIdSequence: overrides.padronIdSequence !== undefined ? overrides.padronIdSequence : `${SCHEMA}.${PADRON_SEQUENCE}`,
});

const workLayout = (): TableLayout => ({ schema: SCHEMA, table: WORK, columns: identity(WORK_REQUIRED_COLUMNS) });

const workCatalogWith = (extra: WorkCatalogColumn[], geometryType = `geometry(MultiPolygon,${SRID})`): WorkCatalogColumn[] =>
  defaultWorkCatalog()
    .map((entry) => (entry.column_name === "geometry" ? { ...entry, data_type: geometryType } : entry))
    .concat(extra);

const paramsWith = (overrides: Partial<ActualizarPadronParams> = {}): ActualizarPadronParams => ({
  config: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "x", schema_name: "", table_name: "" },
  stagingSchema: SCHEMA,
  stagingTable: "stg_padron",
  workSchema: SCHEMA,
  workTable: WORK,
  cartoSchema: SCHEMA,
  padronTable: "padron",
  provinceTable: "province",
  localityTable: "cadastral_locality",
  options: { clearMode: "delete" },
  dryRun: false,
  confirm: true,
  ...overrides,
});

const isWrite = (sql: string): boolean => /^\s*(INSERT|DELETE|TRUNCATE|UPDATE)\b/i.test(sql);

describe("actualizar-padron preflight", () => {
  describe("assertUnitTypeUnique (AP-7b)", () => {
    const TYPE_LAYOUT: TableLayout = { schema: SCHEMA, table: "territorial_unit_type", columns: { id: "id", name: "name" } };
    const LOCALITY_TYPE = "LOCALIDAD CATASTRAL";
    const unitTypeOf = (localityType = LOCALITY_TYPE) => ({ layout: TYPE_LAYOUT, localityType });
    const typeSessionWith = (matches: number) => {
      const log: Array<{ sql: string; values?: unknown[] }> = [];
      return {
        log,
        async query(sql: string, values?: unknown[]) {
          log.push({ sql, values });
          await Promise.resolve();
          return { rows: Array.from({ length: matches }, (_entry, index) => ({ id: index + 1 })) };
        },
        async close() {
          return undefined;
        },
      };
    };

    it("should run no query when no type table is selected", async () => {
      const session = typeSessionWith(1);

      await assertUnitTypeUnique(session, undefined);

      expect(session.log).toEqual([]);
    });

    it("should accept exactly one type row whose name matches the locality type", async () => {
      await expect(assertUnitTypeUnique(typeSessionWith(1), unitTypeOf())).resolves.toBeUndefined();
    });

    it("should match the type name with upper() on both sides, against the type table qualified with cartoSchema", async () => {
      const session = typeSessionWith(1);

      await assertUnitTypeUnique(session, unitTypeOf());

      expect(session.log).toHaveLength(1);
      expect(session.log[0].sql).toContain(`"${SCHEMA}"."territorial_unit_type"`);
      expect(session.log[0].sql).toMatch(/upper\(\s*"name"\s*\)\s*=\s*upper\(\s*\$1/i);
    });

    it("should bind the locality type as a parameter and never put it in the SQL text", async () => {
      const session = typeSessionWith(1);

      await assertUnitTypeUnique(session, unitTypeOf("O'Brien TIPO"));

      expect(session.log[0].values).toEqual(["O'Brien TIPO"]);
      expect(session.log[0].sql).not.toContain("O'Brien");
    });

    it("should refuse zero matching type rows, naming the locality type and the type table in Spanish", async () => {
      const failure = await assertUnitTypeUnique(typeSessionWith(0), unitTypeOf()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(LOCALITY_TYPE);
      expect((failure as Error).message).toContain(`${SCHEMA}.territorial_unit_type`);
      expect((failure as Error).message).toMatch(/\b(el|la|no|de|en)\b/i);
    });

    it("should refuse more than one matching type row, naming the count, the locality type and the type table", async () => {
      const failure = await assertUnitTypeUnique(typeSessionWith(2), unitTypeOf()).catch((error: unknown) => error);

      expect((failure as Error).message).toMatch(/\b2\b/);
      expect((failure as Error).message).toContain(LOCALITY_TYPE);
      expect((failure as Error).message).toContain(`${SCHEMA}.territorial_unit_type`);
    });

    it.each([
      ["an empty", ""],
      ["a whitespace only", "   "],
    ])("should refuse %s locality type before any query", async (_label, localityType) => {
      const session = typeSessionWith(1);

      await expect(assertUnitTypeUnique(session, unitTypeOf(localityType))).rejects.toThrow();

      expect(session.log).toEqual([]);
    });
  });

  describe("assertRunAllowed", () => {
    it("should refuse a real run without confirm", () => {
      expect(() => assertRunAllowed(paramsWith({ confirm: false }))).toThrow();
    });

    it("should allow a real run with confirm", () => {
      expect(() => assertRunAllowed(paramsWith({ confirm: true }))).not.toThrow();
    });

    it("should allow a dry run without confirm", () => {
      expect(() => assertRunAllowed(paramsWith({ dryRun: true, confirm: false }))).not.toThrow();
    });
  });

  describe("assertWorkTableSafe: the id column and the padron sequence (AP-5)", () => {
    it("should accept a work table without an id column", () => {
      expect(() => assertWorkTableSafe(resolvedWith())).not.toThrow();
    });

    it("should accept a work id column with no default", () => {
      const catalog = workCatalogWith([column("id", "integer")]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should accept a work id default that uses a different sequence", () => {
      const catalog = workCatalogWith([column("id", "integer", { column_default: `nextval('${SCHEMA}.work_id_seq'::regclass)` })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should accept a work id default that names a sequence with the same name in another schema", () => {
      const catalog = workCatalogWith([column("id", "integer", { column_default: `nextval('otro.${PADRON_SEQUENCE}'::regclass)` })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should accept a work id default when the padron id has no sequence to share", () => {
      const catalog = workCatalogWith([column("id", "integer", { column_default: PADRON_ID_DEFAULT })]);
      const padronCatalog = defaultPadronCatalog().map((entry) =>
        entry.column_name === "id" ? { ...entry, column_default: null, is_nullable: false } : entry
      );

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog, padronCatalog, padronIdSequence: null }))).not.toThrow();
    });

    it("should refuse a work id default on the padron id column default sequence even when pg_get_serial_sequence finds none (AP-5)", () => {
      const catalog = workCatalogWith([column("id", "integer", { column_default: PADRON_ID_DEFAULT })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog, padronIdSequence: null }))).toThrow(/cat\.padron_trabajo/);
      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog, padronIdSequence: null }))).toThrow(/secuencia/i);
    });

    it("should refuse a non-id work column on the padron column default sequence when pg_get_serial_sequence finds none, naming the column", () => {
      const catalog = workCatalogWith([column("legacy_seq", "integer", { column_default: PADRON_ID_DEFAULT })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog, padronIdSequence: null }))).toThrow(/legacy_seq/);
    });

    it("should keep refusing a work id default on the sequence that pg_get_serial_sequence names, even when the padron id column default is null (identity)", () => {
      const catalog = workCatalogWith([column("id", "integer", { column_default: PADRON_ID_DEFAULT })]);
      const padronCatalog = defaultPadronCatalog().map((entry) =>
        entry.column_name === "id" ? { ...entry, column_default: null, is_nullable: false } : entry
      );

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog, padronCatalog }))).toThrow(/secuencia/i);
    });

    it("should refuse a work id that defaults to the padron id sequence, naming the work table and the sequence in Spanish", () => {
      const catalog = workCatalogWith([column("id", "integer", { column_default: PADRON_ID_DEFAULT })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).toThrow(/padron_trabajo[\s\S]*secuencia|secuencia[\s\S]*padron_trabajo/i);
    });

    it("should refuse the same padron sequence when the work default writes it with quoted identifiers", () => {
      const catalog = workCatalogWith([
        column("id", "integer", { column_default: `nextval('"${SCHEMA}"."${PADRON_SEQUENCE}"'::regclass)` }),
      ]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).toThrow(/secuencia/i);
    });

    it("should refuse the same padron sequence when the work default omits the regclass cast", () => {
      const catalog = workCatalogWith([column("id", "integer", { column_default: `nextval('${SCHEMA}.${PADRON_SEQUENCE}')` })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).toThrow(/secuencia/i);
    });

    it("should refuse a work column that is not id when its default is the padron id sequence, naming the column (AP-5: every column)", () => {
      const catalog = workCatalogWith([column("legacy_seq", "integer", { column_default: PADRON_ID_DEFAULT })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).toThrow(/legacy_seq[\s\S]*secuencia|secuencia[\s\S]*legacy_seq/i);
    });

    it("should refuse a work column default that writes the padron sequence when pg_get_serial_sequence returns it quoted", () => {
      const catalog = workCatalogWith([column("legacy_seq", "integer", { column_default: PADRON_ID_DEFAULT })]);

      expect(() =>
        assertWorkTableSafe(resolvedWith({ workCatalog: catalog, padronIdSequence: `"${SCHEMA}"."${PADRON_SEQUENCE}"` }))
      ).toThrow(/secuencia/i);
    });

    it("should refuse a non-id work column on the padron sequence whether the padron id is serial or identity, since the sequence is resolved by pg_get_serial_sequence", () => {
      const catalog = workCatalogWith([column("otro_id", "integer", { column_default: `nextval('${SCHEMA}.${PADRON_SEQUENCE}'::regclass)` })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog, padronIdSequence: `${SCHEMA}.${PADRON_SEQUENCE}` }))).toThrow(/otro_id/);
    });
  });

  describe("assertWorkTableSafe: NOT NULL columns the job does not write (AP-5)", () => {
    it("should refuse a NOT NULL column without default that the job does not write, naming it", () => {
      const catalog = workCatalogWith([column("fecha_carga", "date", { is_nullable: false })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).toThrow(/fecha_carga/);
    });

    it("should accept a NOT NULL column without default that the job writes", () => {
      const catalog = defaultWorkCatalog().map((entry) =>
        entry.column_name === "number" ? { ...entry, is_nullable: false } : entry
      );

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should accept a NOT NULL column that has a default", () => {
      const catalog = workCatalogWith([column("creado", "timestamp", { is_nullable: false, column_default: "now()" })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should accept a nullable extra column", () => {
      const catalog = workCatalogWith([column("observacion", "text")]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should refuse a NOT NULL id column without default, since the job never writes id", () => {
      const catalog = workCatalogWith([column("id", "integer", { is_nullable: false })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).toThrow(/\bid\b/);
    });

    it("should accept a NOT NULL identity column without default that the job does not write (identity counts as a default)", () => {
      const catalog = workCatalogWith([column("fila_id", "bigint", { is_nullable: false, is_identity: true })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should accept a NOT NULL identity id column, since the identity generates it", () => {
      const catalog = workCatalogWith([column("id", "integer", { is_nullable: false, is_identity: true })]);

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });
  });

  describe("assertWorkTableSafe: geometry SRID (AP-5)", () => {
    it("should accept a work geometry whose SRID is the padron SRID", () => {
      expect(() => assertWorkTableSafe(resolvedWith())).not.toThrow();
    });

    it("should accept a plain work geometry (SRID 0)", () => {
      const catalog = workCatalogWith([], "geometry");

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).not.toThrow();
    });

    it("should refuse a work geometry with another SRID, naming both SRIDs", () => {
      const catalog = workCatalogWith([], "geometry(MultiPolygon,4326)");

      expect(() => assertWorkTableSafe(resolvedWith({ workCatalog: catalog }))).toThrow(/4326[\s\S]*32721|32721[\s\S]*4326/);
    });
  });

  describe("assertStagingHasRows (AP-6)", () => {
    it("should refuse an empty staging table, naming it", async () => {
      const session = sessionWith({ stagingRows: 0 });

      await expect(assertStagingHasRows(session, stagingLayout())).rejects.toThrow(/cat\.stg_padron/);
    });

    it("should accept a staging table with rows", async () => {
      const session = sessionWith({ stagingRows: 12 });

      await expect(assertStagingHasRows(session, stagingLayout())).resolves.toBeUndefined();
    });

    it("should accept a count that the driver returns as text", async () => {
      const session = sessionWith({ stagingRows: "7" });

      await expect(assertStagingHasRows(session, stagingLayout())).resolves.toBeUndefined();
    });
  });

  describe("assertStagingSridSupported (AP-6)", () => {
    it("should refuse staging geometries with SRID 0 or an unknown SRID, naming the staging table and the SRID", async () => {
      const session = sessionWith({ unsupportedSrid: 3 });

      await expect(assertStagingSridSupported(session, stagingLayout(), SRID)).rejects.toThrow(/cat\.stg_padron[\s\S]*SRID|SRID[\s\S]*cat\.stg_padron/);
    });

    it("should run the probe that checks spatial_ref_sys against the target SRID, as the builder text", async () => {
      const session = sessionWith({ unsupportedSrid: 0 });

      await assertStagingSridSupported(session, stagingLayout(), SRID);

      expect(session.log.map((entry) => entry.sql)).toEqual([buildStagingSridProbeSql(stagingLayout(), SRID)]);
      expect(session.log[0].sql).toMatch(/spatial_ref_sys/i);
    });

    it("should accept staging geometries that all carry a known SRID", async () => {
      const session = sessionWith({ unsupportedSrid: 0 });

      await expect(assertStagingSridSupported(session, stagingLayout(), SRID)).resolves.toBeUndefined();
    });
  });

  describe("assertWorkWritePrivileges (AP-5, AP-8)", () => {
    it("should accept a work table where INSERT and DELETE are granted", async () => {
      const session = sessionWith();

      await expect(assertWorkWritePrivileges(session, workLayout())).resolves.toBeUndefined();
    });

    it("should refuse a work table without INSERT, naming the table and the privilege", async () => {
      const session = sessionWith({ deniedPrivileges: ["INSERT"] });

      await expect(assertWorkWritePrivileges(session, workLayout())).rejects.toThrow(/INSERT[\s\S]*cat\.padron_trabajo|cat\.padron_trabajo[\s\S]*INSERT/);
    });

    it("should refuse a work table without DELETE, naming the table and the privilege", async () => {
      const session = sessionWith({ deniedPrivileges: ["DELETE"] });

      await expect(assertWorkWritePrivileges(session, workLayout())).rejects.toThrow(/DELETE[\s\S]*cat\.padron_trabajo|cat\.padron_trabajo[\s\S]*DELETE/);
    });

    it("should check the privileges with bound schema and table values, never interpolated into the SQL", async () => {
      const session = sessionWith();

      await assertWorkWritePrivileges(session, workLayout());

      const privilegeCalls = session.log.filter((entry) => /has_table_privilege/i.test(entry.sql));
      expect(privilegeCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of privilegeCalls) {
        expect(call.sql).not.toContain(WORK);
        expect(call.values).toEqual(expect.arrayContaining([WORK]));
      }
    });

    it("should write nothing while checking the privileges", async () => {
      const session = sessionWith();

      await assertWorkWritePrivileges(session, workLayout());

      expect(session.log.filter((entry) => isWrite(entry.sql))).toEqual([]);
    });
  });

  describe("assertTruncatable (AP-8, mirror of Cargar padrones AC-16)", () => {
    it("should accept a work table with TRUNCATE privilege and no referencing foreign keys", async () => {
      const session = sessionWith();

      await expect(assertTruncatable(session, workLayout())).resolves.toBeUndefined();
    });

    it("should refuse without TRUNCATE privilege, naming the table and the privilege in Spanish", async () => {
      const session = sessionWith({ deniedPrivileges: ["TRUNCATE"] });

      await expect(assertTruncatable(session, workLayout())).rejects.toThrow(/TRUNCATE[\s\S]*cat\.padron_trabajo|cat\.padron_trabajo[\s\S]*TRUNCATE/);
    });

    it("should refuse when another table has a foreign key to the work table, naming the referencing table", async () => {
      const session = sessionWith({ referencingTables: ["access_point"] });

      await expect(assertTruncatable(session, workLayout())).rejects.toThrow(/access_point/);
    });

    it("should check the TRUNCATE privilege before the foreign keys", async () => {
      const session = sessionWith({ deniedPrivileges: ["TRUNCATE"], referencingTables: ["access_point"] });

      await expect(assertTruncatable(session, workLayout())).rejects.toThrow(/TRUNCATE/);
      expect(session.log.some((entry) => /pg_constraint|confrelid/i.test(entry.sql))).toBe(false);
    });

    it("should never suggest or use CASCADE", async () => {
      const session = sessionWith({ referencingTables: ["access_point"] });

      const failure = await assertTruncatable(session, workLayout()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toMatch(/CASCADE/i);
      expect(session.log.map((entry) => entry.sql).join("\n")).not.toMatch(/CASCADE/i);
    });
  });
});
