import { describe, expect, it } from "vitest";
import { WRITTEN_ALIAS } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadWriteSql";
import {
  ANALYSIS_CHANGED_MESSAGE,
  assertWritten,
  runInOrder,
  writtenBy,
} from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";

type Row = Record<string, unknown>;

/** A session that answers every statement with `rows` and records the statements in order. */
function sessionAnswering(rows: Row[] = []): { session: RunSession; statements: string[] } {
  const statements: string[] = [];
  const session: RunSession = {
    async query(sql: string) {
      statements.push(sql);
      return { rows };
    },
    async close() {},
  };
  return { session, statements };
}

describe("assertWritten (EJL-2, F7)", () => {
  it("should pass silently when the written rows equal the expected count", () => {
    expect(() => assertWritten("los tramos quitados", 3, 3)).not.toThrow();
  });

  it("should pass silently when nothing was expected and nothing was written", () => {
    expect(() => assertWritten("las vías de circulación", 0, 0)).not.toThrow();
  });

  it("should name the table, the written count and the expected count when fewer rows were written", () => {
    expect(() => assertWritten("los tramos quitados", 2, 3)).toThrow(
      "Las filas escritas en los tramos quitados (2) no coinciden con las esperadas (3)."
    );
  });

  it("should throw when rows were expected but none was written", () => {
    expect(() => assertWritten("las direcciones maestras quitadas", 0, 4)).toThrow(
      /Las filas escritas en las direcciones maestras quitadas \(0\) no coinciden con las esperadas \(4\)\./
    );
  });

  it("should throw when more rows were written than expected", () => {
    expect(() => assertWritten("los puntos de acceso movidos", 5, 4)).toThrow(/\(5\) no coinciden con las esperadas \(4\)/);
  });
});

describe("writtenBy", () => {
  it("should read the count of the written alias from the first row of the statement", async () => {
    const { session, statements } = sessionAnswering([{ [WRITTEN_ALIAS]: "4" }]);

    expect(await writtenBy(session, "WITH \"written\" AS (DELETE ...) SELECT count(*) AS \"written\" FROM \"written\"")).toBe(4);
    expect(statements).toHaveLength(1);
  });

  it("should count zero when the statement returns no row", async () => {
    const { session } = sessionAnswering([]);

    expect(await writtenBy(session, "SELECT 1")).toBe(0);
  });

  it("should count zero when the written column is missing from the row", async () => {
    const { session } = sessionAnswering([{ other: 7 }]);

    expect(await writtenBy(session, "SELECT 1")).toBe(0);
  });
});

describe("runInOrder (F7)", () => {
  it("should run every statement once, in the order given", async () => {
    const { session, statements } = sessionAnswering();

    await runInOrder(session, ["CREATE TEMP TABLE a ()", "INSERT INTO a VALUES (1)", "SELECT 1"]);

    expect(statements).toEqual(["CREATE TEMP TABLE a ()", "INSERT INTO a VALUES (1)", "SELECT 1"]);
  });

  it("should run nothing for an empty list", async () => {
    const { session, statements } = sessionAnswering();

    await runInOrder(session, []);

    expect(statements).toEqual([]);
  });

  it("should stop at the first failing statement and not run the ones after it", async () => {
    const statements: string[] = [];
    const session: RunSession = {
      async query(sql: string) {
        statements.push(sql);
        if (sql === "BOOM") throw new Error("fallo");
        return { rows: [] };
      },
      async close() {},
    };

    await expect(runInOrder(session, ["A", "BOOM", "C"])).rejects.toThrow("fallo");
    expect(statements).toEqual(["A", "BOOM"]);
  });
});

describe("ANALYSIS_CHANGED_MESSAGE", () => {
  it("should tell the user to analyse again", () => {
    expect(ANALYSIS_CHANGED_MESSAGE).toMatch(/vuelva a analizar/);
  });
});
