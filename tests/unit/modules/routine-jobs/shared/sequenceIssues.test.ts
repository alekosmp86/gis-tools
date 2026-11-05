import { describe, expect, it, vi } from "vitest";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { addressMasterIssuesOf } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkPreflight";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import {
  sequenceIssuesOf,
  sequenceStateWarnings,
  writeTargetPrivilegeIssues,
  type SequenceGuardInput,
} from "@/modules/routine-jobs/jobs/shared/targetPreflight";

type Row = Record<string, unknown>;

interface Fixture {
  hasUpdate?: boolean;
  hasUsageOrUpdate?: boolean;
  readable?: boolean;
  lastValue?: number | null;
  maxId?: number | null;
  stateError?: string;
  maxError?: string;
}

const TARGET: WritableTargetLayout = {
  schema: "carto",
  table: "padron",
  columns: { urn: "urn" },
  srid: 0,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const sessionOf = (fixture: Fixture = {}) => {
  const query = vi.fn(async (sql: string): Promise<{ rows: Row[] }> => {
    if (sql.includes("pg_sequence_last_value")) {
      if (fixture.stateError !== undefined) throw new Error(fixture.stateError);
      return { rows: [{ readable: fixture.readable ?? true, last_value: fixture.lastValue === undefined ? 50 : fixture.lastValue }] };
    }
    if (sql.includes("'USAGE,UPDATE'")) return { rows: [{ has_privilege: fixture.hasUsageOrUpdate ?? true }] };
    if (sql.includes("'UPDATE'") && sql.includes("has_sequence_privilege")) return { rows: [{ has_privilege: fixture.hasUpdate ?? true }] };
    if (sql.startsWith("SELECT max(")) {
      if (fixture.maxError !== undefined) throw new Error(fixture.maxError);
      return { rows: [{ max_id: fixture.maxId === undefined ? 10 : fixture.maxId }] };
    }
    if (sql.includes("has_table_privilege")) return { rows: [{ has_privilege: true }] };
    return { rows: [] };
  });
  return { session: { query } as unknown as CatalogQuerySession, query };
};

const sqlOf = (query: ReturnType<typeof sessionOf>["query"]): string[] => query.mock.calls.map(([sql]) => String(sql));

describe("sequenceIssuesOf with repairSequences on (SQ-2, SQ-6)", () => {
  it("should return no issue when SQ-2 the role has UPDATE on the sequence", async () => {
    const { session } = sessionOf({ hasUpdate: true });

    expect(await sequenceIssuesOf(session, TARGET, true)).toEqual([]);
  });

  it("should name the sequence and the table and end with the SQ-6 hint when UPDATE is missing", async () => {
    const { session } = sessionOf({ hasUpdate: false });

    const issues = await sequenceIssuesOf(session, TARGET, true);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("No tiene privilegio UPDATE sobre la secuencia carto.padron_id_seq");
    expect(issues[0]).toContain("carto.padron");
    expect(
      issues[0].endsWith('Puede desactivar "Ajustar secuencias de destino" si la secuencia ya está por encima de los ids, o solicitar el permiso.')
    ).toBe(true);
  });

  it("should never read the sequence value nor max(id) when the repair is on", async () => {
    const { session, query } = sessionOf({ hasUpdate: true });

    await sequenceIssuesOf(session, TARGET, true);

    expect(sqlOf(query).some((sql) => sql.includes("pg_sequence_last_value") || sql.startsWith("SELECT max("))).toBe(false);
  });

  it("should return no issue and run no query when the target has no id sequence", async () => {
    const { session, query } = sessionOf();

    expect(await sequenceIssuesOf(session, { ...TARGET, idSequence: null }, true)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("sequenceIssuesOf with repairSequences off (SQ-3, SQ-5)", () => {
  it("should return no issue and not read the sequence state when SQ-5 the sequence is behind max(id)", async () => {
    const { session, query } = sessionOf({ lastValue: 5, maxId: 10 });

    expect(await sequenceIssuesOf(session, TARGET, false)).toEqual([]);
    expect(sqlOf(query).some((sql) => sql.includes("pg_sequence_last_value") || sql.startsWith("SELECT max("))).toBe(false);
  });

  it("should not require UPDATE: it asks for USAGE or UPDATE only", async () => {
    const { session, query } = sessionOf({ hasUpdate: false, hasUsageOrUpdate: true });

    expect(await sequenceIssuesOf(session, TARGET, false)).toEqual([]);
    expect(sqlOf(query).some((sql) => sql.includes("'USAGE,UPDATE'"))).toBe(true);
  });

  it("should report the missing USAGE or UPDATE privilege naming the sequence and the table and read nothing else", async () => {
    const { session, query } = sessionOf({ hasUsageOrUpdate: false });

    const issues = await sequenceIssuesOf(session, TARGET, false);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("No tiene privilegio USAGE ni UPDATE sobre la secuencia carto.padron_id_seq");
    expect(issues[0]).toContain("carto.padron");
    expect(sqlOf(query).some((sql) => sql.includes("pg_sequence_last_value"))).toBe(false);
  });

  it("should return no issue and run no query when the target has no id sequence", async () => {
    const { session, query } = sessionOf();

    expect(await sequenceIssuesOf(session, { ...TARGET, idSequence: null }, false)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("sequenceStateWarnings (SQ-5, SQ-7)", () => {
  const input = (overrides: Partial<SequenceGuardInput> = {}): SequenceGuardInput => ({
    target: TARGET,
    inserts: 3,
    repairSequences: false,
    dryRun: false,
    ...overrides,
  });

  it("should run no query and return nothing when SQ-7 there are zero inserts, even if the sequence is behind", async () => {
    const { session, query } = sessionOf({ lastValue: 5, maxId: 10 });

    expect(await sequenceStateWarnings(session, input({ inserts: 0 }))).toEqual([]);
    expect(await sequenceStateWarnings(session, input({ inserts: 0, dryRun: true }))).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("should run no query when the repair is on", async () => {
    const { session, query } = sessionOf({ lastValue: 5, maxId: 10 });

    expect(await sequenceStateWarnings(session, input({ repairSequences: true }))).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("should return nothing and run no query when the target has no id sequence", async () => {
    const { session, query } = sessionOf({ lastValue: 5, maxId: 10 });

    expect(await sequenceStateWarnings(session, input({ target: { ...TARGET, idSequence: null } }))).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("should throw in a real run naming the sequence, the table, both numbers and the option when the sequence is behind", async () => {
    const { session } = sessionOf({ lastValue: 5, maxId: 10 });

    const failure = await sequenceStateWarnings(session, input()).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("carto.padron_id_seq está en 6");
    expect(message).toContain("carto.padron");
    expect(message).toContain("ids hasta 10");
    expect(message).toContain('"Ajustar secuencias de destino"');
  });

  it("should return the warning without throwing in an analysis when the sequence is behind", async () => {
    const { session } = sessionOf({ lastValue: 5, maxId: 10 });

    const warnings = await sequenceStateWarnings(session, input({ dryRun: true }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("carto.padron_id_seq está en 6");
  });

  it("should treat a never-called sequence as next value 1 and pass when the table is empty", async () => {
    const { session } = sessionOf({ lastValue: null, maxId: null });

    expect(await sequenceStateWarnings(session, input())).toEqual([]);
  });

  it("should fail a never-called sequence when the table already has ids, naming next value 1", async () => {
    const { session } = sessionOf({ lastValue: null, maxId: 3 });

    const warnings = await sequenceStateWarnings(session, input({ dryRun: true }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("carto.padron_id_seq está en 1");
    expect(warnings[0]).toContain("ids hasta 3");
    await expect(sequenceStateWarnings(session, input())).rejects.toThrow("está en 1");
  });

  it("should fail on the boundary where the next value equals max(id)", async () => {
    const { session } = sessionOf({ lastValue: 9, maxId: 10 });

    await expect(sequenceStateWarnings(session, input())).rejects.toThrow("ids hasta 10");
  });

  it("should pass on the boundary where the next value is max(id) + 1", async () => {
    const { session } = sessionOf({ lastValue: 10, maxId: 10 });

    expect(await sequenceStateWarnings(session, input())).toEqual([]);
  });

  it("should pass when the sequence is ahead of max(id)", async () => {
    const { session } = sessionOf({ lastValue: 50, maxId: 10 });

    expect(await sequenceStateWarnings(session, input())).toEqual([]);
  });

  it("should pass when the table is empty whatever the sequence value", async () => {
    const { session } = sessionOf({ lastValue: 0, maxId: null });

    expect(await sequenceStateWarnings(session, input())).toEqual([]);
  });

  it("should report an unreadable sequence naming USAGE, SELECT, the sequence and the table, without reading max(id)", async () => {
    const { session, query } = sessionOf({ readable: false });

    const warnings = await sequenceStateWarnings(session, input({ dryRun: true }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("USAGE ni SELECT");
    expect(warnings[0]).toContain("carto.padron_id_seq");
    expect(sqlOf(query).some((sql) => sql.startsWith("SELECT max("))).toBe(false);
    await expect(sequenceStateWarnings(session, input())).rejects.toThrow("USAGE ni SELECT");
  });

  it("should turn a failing sequence read into a warning in an analysis and a throw in a real run", async () => {
    const { session } = sessionOf({ stateError: "relation does not exist" });

    const warnings = await sequenceStateWarnings(session, input({ dryRun: true }));

    expect(warnings[0]).toContain("No se pudo leer la secuencia carto.padron_id_seq");
    expect(warnings[0]).toContain("relation does not exist");
    await expect(sequenceStateWarnings(session, input())).rejects.toThrow("relation does not exist");
  });

  it("should turn a failing max(id) read into a warning in an analysis and a throw in a real run", async () => {
    const { session } = sessionOf({ maxError: "permission denied for table padron" });

    const warnings = await sequenceStateWarnings(session, input({ dryRun: true }));

    expect(warnings[0]).toContain("permission denied for table padron");
    await expect(sequenceStateWarnings(session, input())).rejects.toThrow("permission denied for table padron");
  });

  it("should guard the value read with has_sequence_privilege USAGE,SELECT", async () => {
    const { session, query } = sessionOf();

    await sequenceStateWarnings(session, input());

    const stateSql = sqlOf(query).find((sql) => sql.includes("pg_sequence_last_value"));
    expect(stateSql).toContain("has_sequence_privilege(current_user, $1::text, 'USAGE,SELECT')");
  });
});

describe("writeTargetPrivilegeIssues and addressMasterIssuesOf pass the mode (SQ-2, SQ-3)", () => {
  it("should report the UPDATE issue in mode on and none in mode off when the role only has USAGE", async () => {
    const { session } = sessionOf({ hasUpdate: false, hasUsageOrUpdate: true, lastValue: 50, maxId: 10 });

    const on = await writeTargetPrivilegeIssues(session, TARGET, true);
    const off = await writeTargetPrivilegeIssues(session, TARGET, false);

    expect(on).toHaveLength(1);
    expect(on[0]).toContain("UPDATE sobre la secuencia");
    expect(off).toEqual([]);
  });

  it("should not read the sequence state of the address master in either mode (SQ-5)", async () => {
    const { session, query } = sessionOf({ lastValue: 5, maxId: 10 });

    const on = await addressMasterIssuesOf(session, TARGET, true);
    const off = await addressMasterIssuesOf(session, TARGET, false);

    expect([...on, ...off].some((issue) => issue.includes("está en 6"))).toBe(false);
    expect(sqlOf(query).some((sql) => sql.includes("pg_sequence_last_value"))).toBe(false);
  });
});
