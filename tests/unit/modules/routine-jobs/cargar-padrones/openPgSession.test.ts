import { describe, it, expect, vi } from "vitest";
import type { PgClientLike } from "@/core/services/server/shpReplace/pgShpSession";
import { openPgRunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/services/openPgSession";

const PASSWORD = "S3cr3t!pw";

const SETUP_STATEMENTS = [
  "SET statement_timeout = '4h'",
  "SET lock_timeout = '30s'",
  "SET client_encoding = 'UTF8'",
  "SET work_mem = '128MB'",
  "SET maintenance_work_mem = '256MB'",
];

const connection = (overrides: Record<string, unknown> = {}) => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: PASSWORD,
  ...overrides,
});

function createFakeClient(options: { connect?: () => Promise<void>; end?: () => Promise<void>; query?: (...args: unknown[]) => unknown } = {}) {
  const calls: string[] = [];
  const client = {
    connect: vi.fn(async () => {
      calls.push("connect");
      await options.connect?.();
    }),
    query: vi.fn(async (...args: unknown[]) => {
      calls.push(String(args[0]));
      if (options.query) return options.query(...args);
      return { rows: [], rowCount: 0 };
    }),
    end: vi.fn(async () => {
      calls.push("end");
      await options.end?.();
    }),
    on: vi.fn(function (this: unknown) {
      return this;
    }),
  };
  return { client, calls };
}

async function openWith(fake: ReturnType<typeof createFakeClient>, overrides: Record<string, unknown> = {}) {
  const createClient = vi.fn(() => fake.client as unknown as PgClientLike);
  const session = await openPgRunSession(connection(overrides), { createClient });
  return { session, createClient };
}

describe("openPgRunSession", () => {
  describe("opening", () => {
    it("AC-28: should create the client from the connection and connect it", async () => {
      const fake = createFakeClient();

      const { createClient } = await openWith(fake);

      expect(createClient).toHaveBeenCalledTimes(1);
      expect(createClient.mock.calls[0]).toBeDefined();
      const config = (createClient.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(config).toMatchObject({ host: "db.local", db_name: "gis", user: "gis_user", password: PASSWORD });
      expect(Number(config.port)).toBe(5432);
      expect(fake.client.connect).toHaveBeenCalledTimes(1);
    });

    it("AC-28: should accept the port as a number", async () => {
      const fake = createFakeClient();

      const { createClient } = await openWith(fake, { port: 5433 });

      const config = (createClient.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(Number(config.port)).toBe(5433);
    });

    it("AC-28: should apply the session setup statements in order after connecting and before returning", async () => {
      const fake = createFakeClient();

      await openWith(fake);

      expect(fake.calls).toEqual(["connect", ...SETUP_STATEMENTS]);
    });

    it("AC-28: should expose a session with query and close", async () => {
      const fake = createFakeClient();

      const { session } = await openWith(fake);

      expect(session.query).toBeTypeOf("function");
      expect(session.close).toBeTypeOf("function");
    });
  });

  describe("connect failures", () => {
    it("AC-28: should reject with a message that does not contain the password", async () => {
      const fake = createFakeClient({
        connect: async () => {
          throw new Error(`password authentication failed for user "gis_user" (password: ${PASSWORD})`);
        },
      });

      const failure = await openWith(fake).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message.length).toBeGreaterThan(0);
      expect((failure as Error).message).not.toContain(PASSWORD);
    });

    it("AC-28: should reject when the connect error is not an Error instance, without leaking the password", async () => {
      const fake = createFakeClient({
        connect: async () => {
          throw `refused ${PASSWORD}`;
        },
      });

      const failure = await openWith(fake).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(PASSWORD);
    });

    it("AC-28: should not run any setup statement when connect fails", async () => {
      const fake = createFakeClient({
        connect: async () => {
          throw new Error("ECONNREFUSED");
        },
      });

      await openWith(fake).catch(() => undefined);

      expect(fake.client.query).not.toHaveBeenCalled();
    });
  });

  describe("failed opening releases the client (AC-28)", () => {
    it("AC-28: should end the client and throw the scrubbed error when connect fails", async () => {
      const fake = createFakeClient({
        connect: async () => {
          throw new Error(`password authentication failed (${PASSWORD})`);
        },
      });

      const failure = await openWith(fake).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(PASSWORD);
      expect(fake.client.end).toHaveBeenCalledTimes(1);
    });

    it("AC-28: should end the client and throw the scrubbed error when a setup statement fails", async () => {
      const fake = createFakeClient({
        query: async (sql: unknown) => {
          if (String(sql).includes("work_mem")) throw new Error(`permission denied ${PASSWORD}`);
          return { rows: [], rowCount: 0 };
        },
      });

      const failure = await openWith(fake).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message.length).toBeGreaterThan(0);
      expect((failure as Error).message).not.toContain(PASSWORD);
      expect(fake.client.end).toHaveBeenCalledTimes(1);
    });

    it("AC-28: should still throw the original scrubbed error when ending the client also fails", async () => {
      const fake = createFakeClient({
        connect: async () => {
          throw new Error(`refused ${PASSWORD}`);
        },
        end: async () => {
          throw new Error("end failed");
        },
      });

      const failure = await openWith(fake).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain("end failed");
      expect((failure as Error).message).not.toContain(PASSWORD);
    });
  });

  describe("query", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
    ])("AC-28: should report rowCount 0 when the driver returns %s", async (_name, driverRowCount) => {
      const fake = createFakeClient();
      const { session } = await openWith(fake);
      fake.client.query.mockResolvedValueOnce({ rows: [], rowCount: driverRowCount });

      const result = await session.query("SELECT 1");

      expect(result.rowCount).toBe(0);
    });

    it("AC-28: should forward sql and values to the client and return rows and rowCount", async () => {
      const rows = [{ count: 3 }];
      const fake = createFakeClient();
      const { session } = await openWith(fake);
      fake.client.query.mockClear();
      fake.client.query.mockResolvedValueOnce({ rows, rowCount: 1 });

      const result = await session.query("SELECT count(*) FROM t WHERE a = $1", ["x"]);

      expect(fake.client.query).toHaveBeenCalledTimes(1);
      const [sql, values] = fake.client.query.mock.calls[0] as unknown[];
      expect(sql).toBe("SELECT count(*) FROM t WHERE a = $1");
      expect(values).toEqual(["x"]);
      expect(result.rows).toEqual(rows);
      expect(result.rowCount).toBe(1);
    });

    it("AC-28: should forward a statement without values", async () => {
      const fake = createFakeClient();
      const { session } = await openWith(fake);
      fake.client.query.mockClear();

      const result = await session.query("BEGIN");

      expect((fake.client.query.mock.calls[0] as unknown[])[0]).toBe("BEGIN");
      expect(result.rows).toEqual([]);
    });

    it("AC-28: should return the affected row count of a write statement", async () => {
      const fake = createFakeClient();
      const { session } = await openWith(fake);
      fake.client.query.mockResolvedValueOnce({ rows: [], rowCount: 42 });

      const result = await session.query("INSERT INTO t SELECT 1");

      expect(result.rowCount).toBe(42);
    });

    it("AC-28: should reject with the client's error when a statement fails", async () => {
      const fake = createFakeClient();
      const { session } = await openWith(fake);
      fake.client.query.mockRejectedValueOnce(new Error("relation does not exist"));

      await expect(session.query("SELECT * FROM missing")).rejects.toThrow("relation does not exist");
    });
  });

  describe("close", () => {
    it("AC-28: should end the client", async () => {
      const fake = createFakeClient();
      const { session } = await openWith(fake);

      await session.close();

      expect(fake.client.end).toHaveBeenCalledTimes(1);
    });

    it("AC-28: should be idempotent and end the client only once", async () => {
      const fake = createFakeClient();
      const { session } = await openWith(fake);

      await session.close();
      await session.close();

      expect(fake.client.end).toHaveBeenCalledTimes(1);
    });

    it("AC-28: should end the client only once when close is called concurrently", async () => {
      const fake = createFakeClient();
      const { session } = await openWith(fake);

      await Promise.all([session.close(), session.close()]);

      expect(fake.client.end).toHaveBeenCalledTimes(1);
    });

    it("AC-28: should never throw when ending the client rejects", async () => {
      const fake = createFakeClient({
        end: async () => {
          throw new Error(`socket hang up ${PASSWORD}`);
        },
      });
      const { session } = await openWith(fake);

      await expect(session.close()).resolves.toBeUndefined();
      await expect(session.close()).resolves.toBeUndefined();
    });
  });
});
