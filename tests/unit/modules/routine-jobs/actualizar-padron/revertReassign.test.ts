import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { REVERT_KIND } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import { formatCall, INT4_MIN, pagedRows } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertPaging";
import { masterRestoreLines, reassignedRestoreLines } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertReassignLines";
import {
  assertRevertTally,
  emptyRevertCounts,
  revertScriptLines,
  type RevertCounts,
  type RevertLine,
  type RevertScriptPlan,
} from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertScript";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

type Row = Record<string, unknown>;

const identity = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({ schema, table, columns: identity(columns) });

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", [...Object.values(DESTINATION_COLUMN), "id_address_master"]),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const ADDRESS_MASTER: WritableTargetLayout = {
  ...tableOf("carto", "addresses_master", ["addresses_master_id", "urn", "latitud", "longitud"]),
  srid: 0,
  idColumn: "addresses_master_id",
  idSequence: null,
  identityColumns: [],
  catalog: [],
};

interface QueryCall {
  sql: string;
  values: unknown[] | undefined;
}

/** Answers every query with the next prepared page of its kind (empty when none is left) and records each call. */
function pagedSession(pages: Partial<Record<string, Row[][]>> = {}): { session: RunSession; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const remaining = new Map(Object.entries(pages).map(([kind, kindPages]) => [kind, [...(kindPages ?? [])]]));
  const session: RunSession = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      await Promise.resolve();
      const kind = /"kind" = '([A-Z])'/.exec(sql)?.[1] ?? "";
      return { rows: remaining.get(kind)?.shift() ?? [] };
    },
    async close() {},
  };
  return { session, calls };
}

const planOf = (withMaster: boolean, counts: RevertCounts = emptyRevertCounts()): RevertScriptPlan => ({
  target: TARGET,
  addressMaster: withMaster ? { layout: ADDRESS_MASTER, maxIdBefore: 10 } : undefined,
  counts,
  generatedAt: "2026-10-30T12:00:00.000Z",
});

async function drain(session: RunSession, plan: RevertScriptPlan): Promise<RevertLine[]> {
  const lines: RevertLine[] = [];
  for await (const line of revertScriptLines(session, plan)) lines.push(line);
  return lines;
}

const kindOfQuery = (call: QueryCall): string | undefined => /"kind" = '([A-Z])'/.exec(call.sql)?.[1];

describe("pagedRows keyset paging (AP-72)", () => {
  it("should start after the smallest int4 and continue after the last key of each page until an empty page", async () => {
    const { session, calls } = pagedSession({ R: [[{ seq: 1 }, { seq: 2 }], [{ seq: 5 }], []] });

    const pages: Row[][] = [];
    for await (const page of pagedRows(session, REVERT_KIND.REASSIGNED, '"seq"', 2, "seq")) pages.push(page);

    expect(pages).toEqual([[{ seq: 1 }, { seq: 2 }], [{ seq: 5 }]]);
    expect(calls.map((call) => call.values)).toEqual([[INT4_MIN], [2], [5]]);
  });

  it("should page by the id column by default", async () => {
    const { session, calls } = pagedSession({ U: [[{ id: 4 }], []] });

    for await (const _page of pagedRows(session, REVERT_KIND.UPDATED, '"id"', 10)) void _page;

    expect(calls[0].sql).toBe(`SELECT "id" FROM pg_temp."padron_revert" WHERE "kind" = 'U' AND "id" > $1 ORDER BY "id" LIMIT 10`);
    expect(calls[1].values).toEqual([4]);
  });

  it("should page by the chosen unique column with the kind filter and the limit", async () => {
    const { session, calls } = pagedSession();

    for await (const _page of pagedRows(session, REVERT_KIND.MASTER_DELETED, '"seq"', 5000, "seq")) void _page;

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe(`SELECT "seq" FROM pg_temp."padron_revert" WHERE "kind" = 'M' AND "seq" > $1 ORDER BY "seq" LIMIT 5000`);
  });

  it("should read the next page only after the consumer asks for it", async () => {
    const { session, calls } = pagedSession({ R: [[{ seq: 1 }], [{ seq: 2 }], []] });

    const iterator = pagedRows(session, REVERT_KIND.REASSIGNED, '"seq"', 1, "seq");
    await iterator.next();

    expect(calls).toHaveLength(1);
  });

  it("should read a bigint key that arrives as text", async () => {
    const { session, calls } = pagedSession({ R: [[{ seq: "9007199254740" }], []] });

    for await (const _page of pagedRows(session, REVERT_KIND.REASSIGNED, '"seq"', 1, "seq")) void _page;

    expect(calls[1].values).toEqual([9007199254740]);
  });
});

describe("formatCall", () => {
  it("should wrap the template as a quoted literal and join the arguments", () => {
    expect(formatCall("A %s B %L", ['"x"', "'y'"])).toBe(`format('A %s B %L', "x", 'y')`);
  });

  it("should double a quote inside the template", () => {
    expect(formatCall("it's %s", ["1"])).toBe(`format('it''s %s', 1)`);
  });
});

describe("reassignedRestoreLines (AP-113)", () => {
  it("should ask for the R rows ordered by seq and restore id_padron by primary key with the stored old id", async () => {
    const { session, calls } = pagedSession();

    for await (const _line of reassignedRestoreLines(session)) void _line;

    expect(kindOfQuery(calls[0])).toBe("R");
    expect(calls[0].sql).toContain('ORDER BY "seq"');
    expect(calls[0].sql).toContain("format('UPDATE %s SET %s = %L WHERE %I = %L;', \"ref_table\", '\"id_padron\"', \"id\", \"ref_key_column\", \"ref_key\")");
  });

  it("should yield one line of kind R per row read, each counted as one row", async () => {
    const { session } = pagedSession({
      R: [
        [
          { seq: 1, line: 'UPDATE "carto"."a" SET "id_padron" = 7 WHERE "gid" = 1;' },
          { seq: 2, line: 'UPDATE "carto"."a" SET "id_padron" = 7 WHERE "gid" = 2;' },
        ],
        [],
      ],
    });

    const lines: RevertLine[] = [];
    for await (const line of reassignedRestoreLines(session)) lines.push(line);

    expect(lines).toEqual([
      { kind: "R", rows: 1, text: 'UPDATE "carto"."a" SET "id_padron" = 7 WHERE "gid" = 1;' },
      { kind: "R", rows: 1, text: 'UPDATE "carto"."a" SET "id_padron" = 7 WHERE "gid" = 2;' },
    ]);
  });

  it("should yield nothing when there are no R rows", async () => {
    const { session } = pagedSession();
    const lines: RevertLine[] = [];

    for await (const line of reassignedRestoreLines(session)) lines.push(line);

    expect(lines).toEqual([]);
  });
});

describe("masterRestoreLines (AP-114)", () => {
  it("should ask for the M rows ordered by seq and rebuild the whole row from its jsonb copy into the master table", async () => {
    const { session, calls } = pagedSession();

    for await (const _line of masterRestoreLines(session, ADDRESS_MASTER)) void _line;

    expect(kindOfQuery(calls[0])).toBe("M");
    expect(calls[0].sql).toContain(
      "format('INSERT INTO %s SELECT * FROM jsonb_populate_record(NULL::%s, %L);', '\"carto\".\"addresses_master\"', '\"carto\".\"addresses_master\"', \"payload\")"
    );
  });

  it("should yield one line of kind M per row", async () => {
    const { session } = pagedSession({ M: [[{ seq: 3, line: "INSERT INTO x;" }], []] });
    const lines: RevertLine[] = [];

    for await (const line of masterRestoreLines(session, ADDRESS_MASTER)) lines.push(line);

    expect(lines).toEqual([{ kind: "M", rows: 1, text: "INSERT INTO x;" }]);
  });
});

describe("revertScriptLines order with the reassign kinds (AP-114, AP-72)", () => {
  it("should read the kinds in the order A, I, P, U, M, D, R and end with COMMIT", async () => {
    const { session, calls } = pagedSession();

    const lines = await drain(session, planOf(true));

    const kinds = calls.map(kindOfQuery).filter((kind): kind is string => kind !== undefined);
    const firstOf = (kind: string): number => kinds.indexOf(kind);
    expect(firstOf("P")).toBeLessThan(firstOf("U"));
    expect(firstOf("U")).toBeLessThan(firstOf("M"));
    expect(firstOf("M")).toBeLessThan(firstOf("D"));
    expect(firstOf("D")).toBeLessThan(firstOf("R"));
    expect(kinds[kinds.length - 1]).toBe("R");
    expect(lines[lines.length - 1].text).toBe("COMMIT;");
  });

  it("should skip the M restore when no address master is part of the plan, and still restore R last", async () => {
    const { session, calls } = pagedSession();

    await drain(session, planOf(false));

    const kinds = calls.map(kindOfQuery);
    expect(kinds).not.toContain("M");
    expect(kinds[kinds.length - 1]).toBe("R");
  });

  it("should keep the R and M lines between the U restores and COMMIT, in order M, D, R", async () => {
    const { session } = pagedSession({
      M: [[{ seq: 1, line: "-- M" }], []],
      D: [[{ id: 1, line: "-- D" }], []],
      R: [[{ seq: 1, line: "-- R" }], []],
    });

    const lines = (await drain(session, planOf(true))).map((line) => line.text);

    expect(lines.indexOf("-- M")).toBeLessThan(lines.indexOf("-- D"));
    expect(lines.indexOf("-- D")).toBeLessThan(lines.indexOf("-- R"));
    expect(lines.indexOf("-- R")).toBeLessThan(lines.indexOf("COMMIT;"));
  });

  it("should count the R and M lines in the header", async () => {
    const { session } = pagedSession();
    const counts: RevertCounts = { ...emptyRevertCounts(), R: 6, M: 2 };

    const lines = await drain(session, planOf(true, counts));

    expect(lines.map((line) => line.text).join("\n")).toContain("direcciones reasignadas 6, direcciones maestras eliminadas 2.");
  });
});

describe("assertRevertTally reassigned and master checks (AP-72)", () => {
  const countsOf = (reassigned: number, masters: number): RevertCounts => ({ ...emptyRevertCounts(), R: reassigned, M: masters });
  const baseExpected = { inserted: 0, updated: 0, paired: 0 };

  it("should pass when the R and M lines written equal the rows moved and the masters deleted", () => {
    const counts = countsOf(4, 2);

    expect(() => assertRevertTally({ ...counts }, counts, { ...baseExpected, reassigned: 4, masterDeleted: 2 })).not.toThrow();
  });

  it("should throw naming the reassigned addresses when the stored R rows differ from the moved rows", () => {
    const counts = countsOf(3, 0);

    expect(() => assertRevertTally({ ...counts }, counts, { ...baseExpected, reassigned: 4 })).toThrow(
      /Las direcciones reasignadas guardadas \(3\) no coinciden con las reasignadas \(4\)/
    );
  });

  it("should throw naming the master entries when the stored M rows differ from the deleted masters", () => {
    const counts = countsOf(0, 1);

    expect(() => assertRevertTally({ ...counts }, counts, { ...baseExpected, masterDeleted: 2 })).toThrow(
      /Las direcciones maestras guardadas \(1\) no coinciden con las eliminadas \(2\)/
    );
  });

  it("should throw when the lines written for kind R differ from the rows counted in the revert table", () => {
    const counts = countsOf(4, 0);
    const tally = countsOf(3, 0);

    expect(() => assertRevertTally(tally, counts, { ...baseExpected, reassigned: 4 })).toThrow(/direcciones reasignadas/);
  });

  it("should throw when the lines written for kind M differ from the rows counted in the revert table", () => {
    const counts = countsOf(0, 2);
    const tally = countsOf(0, 1);

    expect(() => assertRevertTally(tally, counts, { ...baseExpected, masterDeleted: 2 })).toThrow(/direcciones maestras/);
  });

  it("should treat absent expected reassigned and masterDeleted as zero", () => {
    const counts = countsOf(0, 0);

    expect(() => assertRevertTally({ ...counts }, counts, baseExpected)).not.toThrow();
  });

  it("should fail an R row captured when none was expected", () => {
    const counts = countsOf(1, 0);

    expect(() => assertRevertTally({ ...counts }, counts, baseExpected)).toThrow(/direcciones reasignadas/);
  });

  it("should start every counter, R and M included, at zero", () => {
    expect(emptyRevertCounts()).toEqual({ U: 0, P: 0, I: 0, A: 0, D: 0, R: 0, M: 0 });
  });
});
