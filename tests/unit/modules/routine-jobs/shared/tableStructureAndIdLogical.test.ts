import { describe, expect, it, vi } from "vitest";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { tableStructureIssuesOf, targetStructureIssuesOf } from "@/modules/routine-jobs/jobs/shared/targetPreflight";
import { resolveWritableTarget, type TableSpec, type WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

type Row = Record<string, unknown>;

interface Fixture {
  relkind?: string;
  hasChildren?: boolean;
  isChild?: boolean;
  triggers?: string[];
  rules?: string[];
  columns?: Row[];
  sequenceByColumn?: Record<string, string>;
}

const TABLE: TableLayout = { schema: "carto", table: "direcciones", columns: { urn: "urn" } };
const TITLE = "de direcciones maestras";

const column = (name: string, overrides: Row = {}): Row => ({
  column_name: name,
  data_type: "integer",
  is_nullable: true,
  column_default: null,
  ...overrides,
});

function sessionOf(fixture: Fixture = {}) {
  const query = vi.fn(async (sql: string, values?: unknown[]): Promise<{ rows: Row[] }> => {
    if (sql.includes("pg_attrdef")) return { rows: fixture.columns ?? [] };
    if (sql.includes("relkind::text")) return { rows: fixture.relkind === undefined ? [] : [{ relkind: fixture.relkind }] };
    if (sql.includes("pg_inherits")) return { rows: [{ has_children: fixture.hasChildren === true, is_child: fixture.isChild === true }] };
    if (sql.includes("pg_trigger")) {
      return { rows: [...(fixture.triggers ?? []).map((name) => ({ kind: "trigger", name })), ...(fixture.rules ?? []).map((name) => ({ kind: "rule", name }))] };
    }
    if (sql.includes("attidentity")) return { rows: [] };
    if (sql.includes("pg_get_serial_sequence")) {
      const sequence = fixture.sequenceByColumn?.[String(values?.[2])];
      return { rows: [{ sequence_name: sequence ?? null }] };
    }
    if (sql.includes("to_regclass")) return { rows: [] };
    return { rows: [] };
  });
  return { session: { query } as unknown as CatalogQuerySession, query };
}

const writableTargetOf = (overrides: Partial<WritableTargetLayout> = {}): WritableTargetLayout => ({
  ...TABLE,
  srid: 0,
  idColumn: "addresses_master_id",
  idSequence: "carto.direcciones_id_seq",
  identityColumns: [],
  catalog: [],
  ...overrides,
});

describe("tableStructureIssuesOf", () => {
  it("should report no issue for a regular table", async () => {
    const { session } = sessionOf({ relkind: "r" });

    expect(await tableStructureIssuesOf(session, TABLE, TITLE)).toEqual([]);
  });

  it("should report no issue for a partitioned table", async () => {
    const { session } = sessionOf({ relkind: "p" });

    expect(await tableStructureIssuesOf(session, TABLE, TITLE)).toEqual([]);
  });

  it.each([
    ["v", /es una vista: debe ser una tabla regular o particionada/],
    ["m", /es una vista materializada/],
    ["f", /es una tabla foránea/],
    ["S", /es un objeto que no es una tabla/],
  ])("should report the relation kind %s as not writable", async (relkind, message) => {
    const { session } = sessionOf({ relkind });

    const issues = await tableStructureIssuesOf(session, TABLE, TITLE);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(message);
  });

  it("should name the title and the qualified table in the relation kind message", async () => {
    const { session } = sessionOf({ relkind: "v" });

    expect((await tableStructureIssuesOf(session, TABLE, TITLE))[0]).toBe(
      "La tabla de direcciones maestras carto.direcciones es una vista: debe ser una tabla regular o particionada.",
    );
  });

  it("should report inheritance when the table has child tables and is not partitioned", async () => {
    const { session } = sessionOf({ relkind: "r", hasChildren: true });

    expect((await tableStructureIssuesOf(session, TABLE, TITLE))[0]).toMatch(/tiene herencia/);
  });

  it("should report inheritance when the table is itself a child table", async () => {
    const { session } = sessionOf({ relkind: "r", isChild: true });

    expect((await tableStructureIssuesOf(session, TABLE, TITLE))[0]).toMatch(/tiene herencia/);
  });

  it("should accept child tables under a partitioned table", async () => {
    const { session } = sessionOf({ relkind: "p", hasChildren: true });

    expect(await tableStructureIssuesOf(session, TABLE, TITLE)).toEqual([]);
  });

  it("should report each trigger and each rule by name", async () => {
    const { session } = sessionOf({ relkind: "r", triggers: ["trg_audit"], rules: ["regla_x"] });

    const issues = await tableStructureIssuesOf(session, TABLE, TITLE);

    expect(issues).toEqual([
      expect.stringMatching(/tiene triggers \(trg_audit\)/),
      expect.stringMatching(/tiene reglas de reescritura \(regla_x\)/),
    ]);
  });

  it("should not report a missing id sequence, which belongs to the writable target check only", async () => {
    const { session } = sessionOf({ relkind: "r" });

    expect(await tableStructureIssuesOf(session, TABLE, TITLE)).toEqual([]);
  });

  it("should still report a missing id sequence in the full writable target check", async () => {
    const { session } = sessionOf({ relkind: "r" });

    const issues = await targetStructureIssuesOf(session, writableTargetOf({ idSequence: null }), ["urn"], TITLE);

    expect(issues).toEqual([expect.stringMatching(/no tiene secuencia/)]);
  });
});

describe("resolveWritableTarget with TableSpec.idLogical", () => {
  const columns = [column("addresses_master_id", { is_nullable: false, column_default: "nextval('x'::regclass)" }), column("urn", { data_type: "text" })];
  const spec = (overrides: Partial<TableSpec> = {}): TableSpec => ({
    label: "carto.direcciones",
    schema: "carto",
    table: "direcciones",
    required: ["addresses_master_id", "urn"],
    ...overrides,
  });

  it("should take the id column from the declared idLogical and read its sequence", async () => {
    const { session, query } = sessionOf({ columns, sequenceByColumn: { addresses_master_id: "carto.direcciones_addresses_master_id_seq" } });

    const { target } = await resolveWritableTarget(session, spec({ idLogical: "addresses_master_id" }));

    expect(target.idColumn).toBe("addresses_master_id");
    expect(target.idSequence).toBe("carto.direcciones_addresses_master_id_seq");
    expect(query.mock.calls.some(([sql, values]) => sql.includes("pg_get_serial_sequence") && values?.[2] === "addresses_master_id")).toBe(true);
  });

  it("should fall back to the id logical column when no idLogical is declared", async () => {
    const { session } = sessionOf({
      columns: [column("id", { is_nullable: false }), column("urn", { data_type: "text" })],
      sequenceByColumn: { id: "carto.direcciones_id_seq" },
    });

    const { target } = await resolveWritableTarget(session, spec({ required: ["id", "urn"] }));

    expect(target.idColumn).toBe("id");
    expect(target.idSequence).toBe("carto.direcciones_id_seq");
  });

  it("should leave the id column empty and read no sequence when the idLogical is not among the required columns", async () => {
    const { session, query } = sessionOf({ columns, sequenceByColumn: { addresses_master_id: "carto.x" } });

    const { target } = await resolveWritableTarget(session, spec({ required: ["urn"], idLogical: "addresses_master_id" }));

    expect(target.idColumn).toBe("");
    expect(target.idSequence).toBeNull();
    expect(query.mock.calls.some(([sql]) => sql.includes("pg_get_serial_sequence"))).toBe(false);
  });

  it("should report the missing idLogical column as a required column issue", async () => {
    const { session } = sessionOf({ columns: [column("urn", { data_type: "text" })] });

    const { target, issues } = await resolveWritableTarget(session, spec({ idLogical: "addresses_master_id" }));

    expect(target.idColumn).toBe("");
    expect(issues).toEqual([expect.stringMatching(/no tiene la columna requerida "addresses_master_id"/)]);
  });
});
