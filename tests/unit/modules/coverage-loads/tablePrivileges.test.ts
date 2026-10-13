import { describe, expect, it } from "vitest";
import {
  describeShortfall,
  findPrivilegeShortfalls,
  TABLE_PRIVILEGE_SQL,
} from "@/modules/coverage-loads/shared/tablePrivileges";
import type { Queryable } from "@/modules/coverage-loads/shared/pgClient";

interface PrivilegeScript {
  readonly exists: boolean;
  readonly granted: ReadonlyArray<string>;
}

/** Answers has_table_privilege from a script: table -> existence and the privileges granted. */
function scriptedQueryable(scripts: Record<string, PrivilegeScript>): Queryable & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    async query(_text, values) {
      calls.push(values);
      const [table, privilege] = values as [string, string];
      const script = scripts[table];
      return { rows: [{ table_exists: script.exists, granted: script.exists && script.granted.includes(privilege) }] };
    },
  };
}

describe("findPrivilegeShortfalls (AC-14)", () => {
  it("should return nothing when every privilege of every table is granted", async () => {
    // Arrange
    const queryable = scriptedQueryable({ "s.t": { exists: true, granted: ["SELECT", "INSERT"] } });

    // Act
    const shortfalls = await findPrivilegeShortfalls(queryable, [{ table: "s.t", privileges: ["SELECT", "INSERT"] }]);

    // Assert
    expect(shortfalls).toEqual([]);
  });

  it("should list the missing privileges in the order they were required", async () => {
    // Arrange
    const queryable = scriptedQueryable({ "s.t": { exists: true, granted: ["INSERT"] } });

    // Act
    const shortfalls = await findPrivilegeShortfalls(queryable, [
      { table: "s.t", privileges: ["SELECT", "INSERT", "DELETE"] },
    ]);

    // Assert
    expect(shortfalls).toEqual([{ table: "s.t", tableExists: true, missing: ["SELECT", "DELETE"] }]);
  });

  it("should report a missing table once, with no privileges, and stop checking it", async () => {
    // Arrange
    const queryable = scriptedQueryable({ "s.gone": { exists: false, granted: [] } });

    // Act
    const shortfalls = await findPrivilegeShortfalls(queryable, [{ table: "s.gone", privileges: ["SELECT", "INSERT"] }]);

    // Assert
    expect(shortfalls).toEqual([{ table: "s.gone", tableExists: false, missing: [] }]);
    expect(queryable.calls).toHaveLength(1);
  });

  it("should report each failing table separately and skip the healthy ones", async () => {
    // Arrange
    const queryable = scriptedQueryable({
      "a.ok": { exists: true, granted: ["SELECT"] },
      "b.low": { exists: true, granted: [] },
      "c.gone": { exists: false, granted: [] },
    });

    // Act
    const shortfalls = await findPrivilegeShortfalls(queryable, [
      { table: "a.ok", privileges: ["SELECT"] },
      { table: "b.low", privileges: ["SELECT"] },
      { table: "c.gone", privileges: ["SELECT"] },
    ]);

    // Assert
    expect(shortfalls.map((item) => [item.table, item.tableExists, item.missing])).toEqual([
      ["b.low", true, ["SELECT"]],
      ["c.gone", false, []],
    ]);
  });

  it("should treat an empty answer as a missing table", async () => {
    // Arrange
    const queryable: Queryable = { query: async () => ({ rows: [] }) };

    // Act
    const shortfalls = await findPrivilegeShortfalls(queryable, [{ table: "s.t", privileges: ["SELECT"] }]);

    // Assert
    expect(shortfalls).toEqual([{ table: "s.t", tableExists: false, missing: [] }]);
  });

  it("should return nothing when no requirement is given", async () => {
    // Arrange, Act & Assert
    expect(await findPrivilegeShortfalls({ query: async () => ({ rows: [] }) }, [])).toEqual([]);
  });

  it("should ask the database with has_table_privilege and bind the table and privilege", async () => {
    // Arrange
    const queryable = scriptedQueryable({ "s.t": { exists: true, granted: ["SELECT"] } });

    // Act
    await findPrivilegeShortfalls(queryable, [{ table: "s.t", privileges: ["SELECT"] }]);

    // Assert
    expect(TABLE_PRIVILEGE_SQL).toContain("has_table_privilege");
    expect(TABLE_PRIVILEGE_SQL).toContain("to_regclass");
    expect(queryable.calls).toEqual([["s.t", "SELECT"]]);
  });
});

describe("describeShortfall", () => {
  it("should say the table does not exist when it is missing", () => {
    // Arrange, Act & Assert
    expect(describeShortfall({ table: "s.t", tableExists: false, missing: [] })).toBe(
      "La tabla s.t no existe en esta base de datos."
    );
  });

  it("should list the missing privileges when the table exists", () => {
    // Arrange, Act & Assert
    expect(describeShortfall({ table: "s.t", tableExists: true, missing: ["INSERT", "DELETE"] })).toBe(
      "Faltan privilegios sobre s.t: INSERT, DELETE."
    );
  });
});
