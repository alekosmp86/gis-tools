import { describe, expect, it, vi } from "vitest";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import {
  assertConfirmedOrDryRun,
  assertSourceTablesReady,
  assertWriteTargetsReady,
  throwIfIssues,
  type SourceTablesSpec,
  type WriteTargetsSpec,
} from "@/modules/routine-jobs/jobs/shared/preflightAsserts";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

type Row = Record<string, unknown>;

interface Fixture {
  /** Qualified names ("schema.table") whose SELECT EXISTS finds no row. */
  empty?: string[];
  /** Count of geometries with SRID 0 or unknown in the source. */
  unsupported?: number;
  /** relkind by table name; a missing entry reads as no relation. */
  relkinds?: Record<string, string>;
  /** Denied privileges as "table.PRIVILEGE" (tables) or "sequence.UPDATE". */
  denied?: string[];
}

const qualifiedNameIn = (sql: string): string => {
  const match = /FROM "([^"]+)"\."([^"]+)"/.exec(sql);
  return match ? `${match[1]}.${match[2]}` : "";
};

function sessionOf(fixture: Fixture = {}) {
  const query = vi.fn(async (sql: string, values?: unknown[]): Promise<{ rows: Row[] }> => {
    if (sql.includes('AS "unsupported"')) return { rows: [{ unsupported: fixture.unsupported ?? 0 }] };
    if (sql.includes("AS present")) return { rows: [{ present: !(fixture.empty ?? []).includes(qualifiedNameIn(sql)) }] };
    if (sql.includes("relkind::text")) {
      const relkind = fixture.relkinds?.[String(values?.[1])];
      return { rows: relkind === undefined ? [] : [{ relkind }] };
    }
    if (sql.includes("pg_inherits")) return { rows: [{ has_children: false, is_child: false }] };
    if (sql.includes("pg_trigger") || sql.includes("pg_rewrite") || sql.includes("attidentity")) return { rows: [] };
    if (sql.includes("has_table_privilege")) {
      return { rows: [{ has_privilege: !(fixture.denied ?? []).includes(`${String(values?.[1])}.${String(values?.[2])}`) }] };
    }
    if (sql.includes("has_sequence_privilege")) {
      return { rows: [{ has_privilege: !(fixture.denied ?? []).includes("sequence.UPDATE") }] };
    }
    return { rows: [] };
  });
  return { session: { query } as unknown as CatalogQuerySession, query };
}

const layoutOf = (table: string): TableLayout => ({ schema: "carto", table, columns: {} });

const geometryLayoutOf = (table: string): TableLayout => ({ schema: "carto", table, columns: { geometry: "geom" } });

const writableOf = (table: string): WritableTargetLayout => ({
  schema: "carto",
  table,
  columns: { urn: "urn" },
  srid: 0,
  idColumn: "id",
  idSequence: `carto.${table}_id_seq`,
  identityColumns: [],
  catalog: [],
});

const sourceSpec = (): SourceTablesSpec => ({
  withRows: [
    { layout: layoutOf("tabla_a"), description: "direcciones" },
    { layout: layoutOf("tabla_b"), description: "localidades" },
  ],
  geometry: { layout: geometryLayoutOf("origen"), column: "geometry" },
});

const writeSpec = (targets: WritableTargetLayout[], readTables: TableLayout[]): WriteTargetsSpec => ({
  targets,
  writtenColumns: ["urn"],
  title: "de destino",
  readTables,
});

const messageOf = async (work: Promise<unknown>): Promise<string> => {
  const error = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
};

describe("throwIfIssues and assertConfirmedOrDryRun", () => {
  it("should throw nothing when there are no issues", () => {
    expect(() => throwIfIssues([])).not.toThrow();
  });

  it("should join several issues into one message in their order", () => {
    expect(() => throwIfIssues(["primera.", "segunda."])).toThrow("primera. segunda.");
  });

  it("should refuse a real run without confirm with the given message", () => {
    expect(() => assertConfirmedOrDryRun({ dryRun: false, confirm: false }, "Confirme el proceso.")).toThrow("Confirme el proceso.");
  });

  it("should allow a dry run without confirm and a confirmed real run", () => {
    expect(() => assertConfirmedOrDryRun({ dryRun: true, confirm: false }, "x")).not.toThrow();
    expect(() => assertConfirmedOrDryRun({ dryRun: false, confirm: true }, "x")).not.toThrow();
  });
});

describe("assertSourceTablesReady", () => {
  it("should resolve when every source table has rows and no geometry has an unsupported SRID", async () => {
    const { session } = sessionOf();

    await expect(assertSourceTablesReady(session, sourceSpec())).resolves.toBeUndefined();
  });

  it("should report an empty source table with its description, naming the table in the qualified form", async () => {
    const { session } = sessionOf({ empty: ["carto.tabla_a"] });

    expect(await messageOf(assertSourceTablesReady(session, sourceSpec()))).toBe(
      "La tabla carto.tabla_a no tiene filas: no hay direcciones de origen.",
    );
  });

  it("should combine two empty tables and an SRID 0 geometry into one message, in that order", async () => {
    const { session } = sessionOf({ empty: ["carto.tabla_a", "carto.tabla_b"], unsupported: 2 });

    expect(await messageOf(assertSourceTablesReady(session, sourceSpec()))).toBe(
      "La tabla carto.tabla_a no tiene filas: no hay direcciones de origen. " +
        "La tabla carto.tabla_b no tiene filas: no hay localidades de origen. " +
        "La tabla carto.origen tiene 2 geometrías con SRID 0 o desconocido: no se pueden transformar al SRID de destino.",
    );
  });

  it("should report only the SRID problem when every table has rows", async () => {
    const { session } = sessionOf({ unsupported: 3 });

    expect(await messageOf(assertSourceTablesReady(session, sourceSpec()))).toBe(
      "La tabla carto.origen tiene 3 geometrías con SRID 0 o desconocido: no se pueden transformar al SRID de destino.",
    );
  });

  it("should not report a table that has rows, even when another table is empty", async () => {
    const { session } = sessionOf({ empty: ["carto.tabla_b"] });

    const message = await messageOf(assertSourceTablesReady(session, sourceSpec()));

    expect(message).not.toContain("carto.tabla_a");
    expect(message).toContain("carto.tabla_b");
  });
});

describe("assertWriteTargetsReady issue order", () => {
  it("should resolve for a regular target the user can write and read", async () => {
    const { session } = sessionOf({ relkinds: { target_t: "r" } });

    await expect(assertWriteTargetsReady(session, writeSpec([writableOf("target_t")], [layoutOf("origen")]))).resolves.toBeUndefined();
  });

  it("should list each target's structure then privilege issues, then the read privileges, in that order", async () => {
    const { session } = sessionOf({
      relkinds: { target_a: "v", target_b: "r" },
      denied: ["target_b.UPDATE", "origen.SELECT"],
    });

    expect(
      await messageOf(assertWriteTargetsReady(session, writeSpec([writableOf("target_a"), writableOf("target_b")], [layoutOf("origen")]))),
    ).toBe(
      "La tabla de destino carto.target_a es una vista: debe ser una tabla regular o particionada. " +
        "No tiene privilegio UPDATE sobre la tabla carto.target_b. " +
        "No tiene privilegio SELECT sobre la tabla carto.origen.",
    );
  });

  it("should report a read table the user cannot select from after the target issues", async () => {
    const { session } = sessionOf({ relkinds: { target_t: "r" }, denied: ["origen.SELECT"] });

    expect(await messageOf(assertWriteTargetsReady(session, writeSpec([writableOf("target_t")], [layoutOf("origen")])))).toBe(
      "No tiene privilegio SELECT sobre la tabla carto.origen.",
    );
  });
});
