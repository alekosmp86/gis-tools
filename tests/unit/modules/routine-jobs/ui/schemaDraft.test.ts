import { describe, expect, it, vi } from "vitest";
import { catalogKey, commitSchema, createInFlightMemo, schemaCommitPlan } from "@/modules/routine-jobs/ui/schemaDraft";
import type { ClientConnection } from "@/modules/routine-jobs/ui/clientTypes";

const connection = (overrides: Partial<ClientConnection> = {}): ClientConnection => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "carto",
  password: "pw-1",
  ...overrides,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("schemaDraft", () => {
  describe("commitSchema", () => {
    it("AC-30: should return the trimmed schema when it has text", () => {
      expect(commitSchema("  catastro \n")).toBe("catastro");
    });

    it("AC-30: should return the schema unchanged when there is nothing to trim", () => {
      expect(commitSchema("carto")).toBe("carto");
    });

    it.each(["", " ", "   ", "\t\n"])("AC-30: should return null (no commit) for the blank draft %j", (draft) => {
      expect(commitSchema(draft)).toBeNull();
    });
  });

  describe("schemaCommitPlan", () => {
    it.each(["", " ", "   ", "\t\n"])("AC-32: should not commit a blank draft %j", (draft) => {
      expect(schemaCommitPlan(draft, "carto").commit).toBe(false);
    });

    it("AC-32: should not commit a blank draft when nothing is committed yet", () => {
      expect(schemaCommitPlan("  ", "").commit).toBe(false);
    });

    it("AC-32: should not commit when the draft equals the committed schema", () => {
      expect(schemaCommitPlan("carto", "carto").commit).toBe(false);
    });

    it("AC-32: should not commit when the draft equals the committed schema after trimming the draft", () => {
      expect(schemaCommitPlan("  carto ", "carto").commit).toBe(false);
    });

    it("AC-32: should not commit when the draft equals the committed schema after trimming the committed value", () => {
      expect(schemaCommitPlan("carto", " carto ").commit).toBe(false);
    });

    it("AC-32: should commit the trimmed draft when it is a new value", () => {
      expect(schemaCommitPlan("  nuevo \n", "carto")).toEqual({ commit: true, schema: "nuevo" });
    });

    it.each(["", "   "])("AC-32: should commit the draft when the committed schema is %j", (committed) => {
      expect(schemaCommitPlan("carto", committed)).toEqual({ commit: true, schema: "carto" });
    });

    it("AC-32: should commit when the draft differs only by letter case", () => {
      expect(schemaCommitPlan("Carto", "carto")).toEqual({ commit: true, schema: "Carto" });
    });
  });

  describe("catalogKey", () => {
    it("AC-30: should be the same for the same server, database, user and schema", () => {
      expect(catalogKey(connection(), "carto")).toBe(catalogKey(connection(), "carto"));
    });

    it("AC-30: should ignore the password", () => {
      expect(catalogKey(connection({ password: "otra" }), "carto")).toBe(
        catalogKey(connection({ password: "" }), "carto"),
      );
    });

    it("AC-30: should never contain the password", () => {
      expect(catalogKey(connection({ password: "s3cret-unique" }), "carto")).not.toContain("s3cret-unique");
    });

    it.each([
      ["host", { host: "otro" }],
      ["port", { port: "5433" }],
      ["db_name", { db_name: "otra" }],
      ["user", { user: "otro" }],
    ] as const)("AC-30: should change when %s changes", (_field, patch) => {
      expect(catalogKey(connection(patch), "carto")).not.toBe(catalogKey(connection(), "carto"));
    });

    it("AC-30: should change when the schema changes", () => {
      expect(catalogKey(connection(), "otro")).not.toBe(catalogKey(connection(), "carto"));
    });

    it("AC-30: should not confuse values that only differ in where the fields split", () => {
      expect(catalogKey(connection({ host: "ab", port: "c" }), "s")).not.toBe(
        catalogKey(connection({ host: "a", port: "bc" }), "s"),
      );
    });
  });

  describe("createInFlightMemo", () => {
    it("AC-30: should run one load for three callers with the same key while pending", async () => {
      const memo = createInFlightMemo<string, number>();
      const gate = deferred<number>();
      const load = vi.fn(() => gate.promise);

      const calls = [memo("k", load), memo("k", load), memo("k", load)];
      gate.resolve(7);

      expect(load).toHaveBeenCalledTimes(1);
      await expect(Promise.all(calls)).resolves.toEqual([7, 7, 7]);
    });

    it("AC-30: should return the very same promise for the same pending key", () => {
      const memo = createInFlightMemo<string, number>();
      const gate = deferred<number>();

      const first = memo("k", () => gate.promise);
      const second = memo("k", () => Promise.resolve(99));

      expect(second).toBe(first);
    });

    it("AC-30: should keep distinct keys independent", async () => {
      const memo = createInFlightMemo<string, string>();
      const a = deferred<string>();
      const b = deferred<string>();
      const loadA = vi.fn(() => a.promise);
      const loadB = vi.fn(() => b.promise);

      const first = memo("a", loadA);
      const second = memo("b", loadB);
      a.resolve("A");
      b.resolve("B");

      expect(loadA).toHaveBeenCalledTimes(1);
      expect(loadB).toHaveBeenCalledTimes(1);
      await expect(first).resolves.toBe("A");
      await expect(second).resolves.toBe("B");
    });

    it("AC-30: should start a fresh load once the previous one resolved", async () => {
      const memo = createInFlightMemo<string, number>();
      const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      const first = await memo("k", load);
      const second = await memo("k", load);

      expect(first).toBe(1);
      expect(second).toBe(2);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("AC-30: should start a fresh load after the previous one rejected", async () => {
      const memo = createInFlightMemo<string, number>();
      const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(5);

      await expect(memo("k", load)).rejects.toThrow("boom");
      const retried = await memo("k", load);

      expect(retried).toBe(5);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("AC-30: should propagate a rejection to every waiter", async () => {
      const memo = createInFlightMemo<string, number>();
      const gate = deferred<number>();
      const failure = new Error("sin conexión");

      const waiters = [memo("k", () => gate.promise), memo("k", () => gate.promise)];
      gate.reject(failure);

      for (const waiter of waiters) await expect(waiter).rejects.toBe(failure);
    });
  });
});
