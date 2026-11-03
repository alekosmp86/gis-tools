import { describe, expect, it, vi } from "vitest";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { assertTargetReady } from "@/modules/routine-jobs/jobs/actualizar-padron/services/preflight";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

/* Mirrors tests/unit/modules/routine-jobs/shared/preflightAsserts.test.ts's sessionOf dispatch style, extended with
   the key-format (AP-50) and locality-reference (AP-63) checks that assertTargetReady also runs, so this covers
   AP-5's new DELETE-privilege composition (tablePrivilegeIssues + DESTINATION_DELETE_PRIVILEGE) as its own focused,
   fast unit test, independent of the full mock-dispatch job runner files. */

type Row = Record<string, unknown>;

interface Fixture {
  /** Denied privileges as "table.PRIVILEGE" (tables) or "sequence.UPDATE". */
  denied?: string[];
}

function sessionOf(fixture: Fixture = {}) {
  const query = vi.fn(async (sql: string, values?: unknown[]): Promise<{ rows: Row[] }> => {
    if (sql.includes("relkind::text")) return { rows: [{ relkind: "r" }] };
    if (sql.includes("pg_inherits")) return { rows: [{ has_children: false, is_child: false }] };
    if (sql.includes("pg_trigger") || sql.includes("pg_rewrite") || sql.includes("attidentity")) return { rows: [] };
    if (sql.includes("has_table_privilege")) {
      return { rows: [{ has_privilege: !(fixture.denied ?? []).includes(`${String(values?.[1])}.${String(values?.[2])}`) }] };
    }
    if (sql.includes("has_sequence_privilege")) {
      return { rows: [{ has_privilege: !(fixture.denied ?? []).includes("sequence.UPDATE") }] };
    }
    if (sql.includes('AS "bad"')) return { rows: [{ bad: 0, example: null }] };
    if (sql.includes('AS "unresolved"')) return { rows: [{ total: 0, unresolved: 0 }] };
    return { rows: [] };
  });
  return { session: { query } as unknown as CatalogQuerySession, query };
}

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identityOf(columns),
});

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const LAYOUTS: PadronLayouts = {
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "loc", Object.values(LOCALITY_COLUMN)),
};

const messageOf = async (work: Promise<unknown>): Promise<string> => {
  const error = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
};

describe("assertTargetReady DELETE privilege check (AP-5, AP-106)", () => {
  it("should resolve when the connecting role has DELETE on the destination, along with every other preflight check", async () => {
    const { session } = sessionOf();

    await expect(assertTargetReady(session, LAYOUTS)).resolves.toEqual([]);
  });

  it("should check DELETE the same way as INSERT, UPDATE and SELECT: one has_table_privilege call bound to the destination and the privilege name", async () => {
    const { session, query } = sessionOf();

    await assertTargetReady(session, LAYOUTS);

    const deleteCalls = query.mock.calls.filter(
      ([sql, values]) => sql.includes("has_table_privilege") && values?.[2] === "DELETE"
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][1]).toEqual(["carto", "padron", "DELETE"]);
  });

  it("should refuse in Spanish, naming DELETE and the destination table, when the privilege is missing", async () => {
    const { session } = sessionOf({ denied: ["padron.DELETE"] });

    expect(await messageOf(assertTargetReady(session, LAYOUTS))).toContain(
      "No tiene privilegio DELETE sobre la tabla carto.padron."
    );
  });

  it("should check DELETE only after assertWriteTargetsReady's own INSERT/UPDATE/SELECT checks pass, so an earlier missing privilege is reported alone", async () => {
    const { session, query } = sessionOf({ denied: ["padron.DELETE", "padron.INSERT"] });

    const message = await messageOf(assertTargetReady(session, LAYOUTS));

    expect(message).toBe("No tiene privilegio INSERT sobre la tabla carto.padron.");
    const deleteCalls = query.mock.calls.filter(([sql, values]) => sql.includes("has_table_privilege") && values?.[2] === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });

  it("should never ask for TRUNCATE on the destination: AP-5 says TRUNCATE is never used", async () => {
    const { session, query } = sessionOf();

    await assertTargetReady(session, LAYOUTS);

    const truncateCalls = query.mock.calls.filter(([sql, values]) => sql.includes("has_table_privilege") && values?.[2] === "TRUNCATE");
    expect(truncateCalls).toHaveLength(0);
  });
});
