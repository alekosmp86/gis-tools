import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { revertColumnList } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
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

const identity = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identity(columns),
});

const BASE_TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const TARGET_WITH_ADDRESS_MASTER: WritableTargetLayout = {
  ...BASE_TARGET,
  columns: { ...BASE_TARGET.columns, id_address_master: "id_address_master" },
};

/** Records every SQL statement sent and answers every query with no rows, so every paged loop in
    revertScriptLines ends after its first read: enough to capture the deletedRestoreSelect's own SQL text
    (deletedRestoreSelect itself builds a format() call that only PostgreSQL can evaluate, so what is testable
    without a live database is the SQL text that would ask the database to build that line, not the rendered line). */
function recordingSession(): { session: RunSession; sql: string[] } {
  const sql: string[] = [];
  const session: RunSession = {
    async query(text: string) {
      sql.push(text);
      return { rows: [] };
    },
    async close() {},
  };
  return { session, sql };
}

const planOf = (target: WritableTargetLayout): RevertScriptPlan => ({
  target,
  counts: emptyRevertCounts(),
  generatedAt: "2026-10-30T12:00:00.000Z",
});

async function drain(session: RunSession, plan: RevertScriptPlan): Promise<RevertLine[]> {
  const lines: RevertLine[] = [];
  for await (const line of revertScriptLines(session, plan)) lines.push(line);
  return lines;
}

/** The query embedding deletedRestoreSelect's SQL is the one that filters the revert table on kind = 'D'. */
const deletedSelectQueryOf = (sqlLog: readonly string[]): string => {
  const match = sqlLog.find((text) => text.includes(`= 'D'`) && text.includes('AS "line"'));
  if (match === undefined) throw new Error("no kind = 'D' select query found in the SQL log");
  return match;
};

/** The INSERT template text is format()'s own first argument: the part PostgreSQL would fill in with %s/%L,
    distinct from the outer SELECT ... WHERE "kind" = 'D' envelope that reads the revert table's own rows. */
const insertTemplateOf = (query: string): string => {
  const match = /format\('([^']*)'/.exec(query);
  if (match === null) throw new Error("no format() template found in the query");
  return match[1];
};

describe("revertScriptLines deletedRestoreSelect (AP-106, AP-70)", () => {
  it("should build a full INSERT INTO ... VALUES (...) with no WHERE clause, since the deleted row is assumed gone", () => {
    const { session, sql } = recordingSession();

    return drain(session, planOf(BASE_TARGET)).then(() => {
      const template = insertTemplateOf(deletedSelectQueryOf(sql));

      expect(template).toMatch(/^INSERT INTO %s \(/);
      expect(template).toContain("VALUES (");
      expect(template).not.toMatch(/WHERE/);
    });
  });

  it("should restore the geometry via encode(ST_AsEWKB(...), 'hex')::geometry", () => {
    const { session, sql } = recordingSession();

    return drain(session, planOf(BASE_TARGET)).then(() => {
      const query = deletedSelectQueryOf(sql);

      expect(query).toContain(`encode(ST_AsEWKB(\"geometry\"), 'hex')`);
      expect(query).toContain("%L::geometry");
    });
  });

  it("should write the id explicitly, since ids are never reverted", () => {
    const { session, sql } = recordingSession();

    return drain(session, planOf(BASE_TARGET)).then(() => {
      const query = deletedSelectQueryOf(sql);

      expect(query).toContain('"id"');
    });
  });

  it("should not reference id_address_master when the destination has no such column resolved or catalogued", () => {
    const { session, sql } = recordingSession();

    return drain(session, planOf(BASE_TARGET)).then(() => {
      const query = deletedSelectQueryOf(sql);

      expect(query).not.toContain('"id_address_master"');
    });
  });

  it("should include id_address_master as one more column and value when optionalAddressMasterColumn resolves it", () => {
    const { session, sql } = recordingSession();

    return drain(session, planOf(TARGET_WITH_ADDRESS_MASTER)).then(() => {
      const query = deletedSelectQueryOf(sql);

      expect(query).toContain('"id_address_master"');
    });
  });
});

describe("assertRevertTally expected.removed check (AP-106, AP-72)", () => {
  const tallyAndCountsOf = (deleted: number): { tally: RevertCounts; counts: RevertCounts } => {
    const counts: RevertCounts = { ...emptyRevertCounts(), D: deleted };
    return { tally: { ...counts }, counts };
  };

  it("should pass when the deleted count equals the expected removed count", () => {
    const { tally, counts } = tallyAndCountsOf(2);

    expect(() => assertRevertTally(tally, counts, { inserted: 0, updated: 0, paired: 0, removed: 2 })).not.toThrow();
  });

  it("should throw the Spanish message naming padrones eliminados when the deleted count does not match the expected removed count", () => {
    const { tally, counts } = tallyAndCountsOf(2);

    expect(() => assertRevertTally(tally, counts, { inserted: 0, updated: 0, paired: 0, removed: 3 })).toThrow(
      /Los padrones eliminados guardados \(2\) no coinciden con los eliminados \(3\)/
    );
  });

  it("should treat an absent expected.removed as zero, for a run with no delete step", () => {
    const { tally, counts } = tallyAndCountsOf(0);

    expect(() => assertRevertTally(tally, counts, { inserted: 0, updated: 0, paired: 0 })).not.toThrow();
  });

  it("should throw when the tally captured for kind D differs from the counts read from the revert table", () => {
    const counts: RevertCounts = { ...emptyRevertCounts(), D: 2 };
    const tally: RevertCounts = { ...emptyRevertCounts(), D: 1 };

    expect(() => assertRevertTally(tally, counts, { inserted: 0, updated: 0, paired: 0, removed: 2 })).toThrow(
      /padrones eliminados/
    );
  });
});

describe("revertColumnList (shared by deletedRestoreSelect and the apply-time capture)", () => {
  it("should list the kind, id, type_padron, id_cadastral_locality, number, geometry, id_province and id_address_master columns in order", () => {
    expect(revertColumnList()).toBe(
      '"kind", "id", "type_padron", "id_cadastral_locality", "number", "geometry", "id_province", "id_address_master"'
    );
  });
});
