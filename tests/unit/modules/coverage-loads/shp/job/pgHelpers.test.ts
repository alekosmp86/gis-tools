import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PG_APPLICATION_NAME,
  PG_CONNECTION_TIMEOUT_MS,
  PG_KEEPALIVE_INITIAL_DELAY_MS,
} from "@/modules/coverage-loads/shp/job/constants.ts";
import { cancelBackend } from "@/modules/coverage-loads/shp/job/pg/cancelStatement.ts";
import { createJobClient, defaultClientFactory } from "@/modules/coverage-loads/shp/job/pg/createClient.ts";
import type { JobPgClient } from "@/modules/coverage-loads/shp/job/pg/createClient.ts";
import { CANARY_CONNECTION } from "../helpers/jobTestEnv.ts";

const pgMock = vi.hoisted(() => ({ lastOptions: null as Record<string, unknown> | null }));

vi.mock("pg", () => {
  class FakePgClient {
    constructor(options: Record<string, unknown>) {
      pgMock.lastOptions = options;
    }
  }
  return { default: { Client: FakePgClient } };
});

interface FakeClient extends JobPgClient {
  calls: string[];
  queries: { text: string; values?: unknown[] }[];
  errorListeners: ((error: Error) => void)[];
  ended: number;
}

function fakeClient(options: { failOn?: (text: string) => boolean; rows?: unknown[]; connectFails?: boolean; endFails?: boolean } = {}): FakeClient {
  const client: FakeClient = {
    calls: [],
    queries: [],
    errorListeners: [],
    ended: 0,
    async connect() {
      client.calls.push("connect");
      if (options.connectFails) throw new Error("connect refused");
    },
    async query(text, values) {
      client.calls.push("query");
      client.queries.push({ text, values });
      if (options.failOn?.(text)) throw new Error("permission denied");
      return { rows: options.rows ?? [] };
    },
    async end() {
      client.ended += 1;
      if (options.endFails) throw new Error("end failed");
    },
    on(_event, listener) {
      client.calls.push("on");
      client.errorListeners.push(listener);
      return client;
    },
  };
  return client;
}

beforeEach(() => {
  pgMock.lastOptions = null;
});

describe("defaultClientFactory", () => {
  it("should configure keepAlive, initial delay, application_name, timeout and the connection fields", () => {
    defaultClientFactory(CANARY_CONNECTION);

    expect(pgMock.lastOptions).toEqual({
      host: CANARY_CONNECTION.host,
      port: CANARY_CONNECTION.port,
      database: CANARY_CONNECTION.db_name,
      user: CANARY_CONNECTION.user,
      password: CANARY_CONNECTION.password,
      application_name: PG_APPLICATION_NAME,
      connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: PG_KEEPALIVE_INITIAL_DELAY_MS,
    });
  });
});

describe("createJobClient", () => {
  it("should attach the error listener before connecting, then SET statement_timeout = 0 and the keepalives", async () => {
    const client = fakeClient();
    const log = vi.fn();

    const result = await createJobClient(CANARY_CONNECTION, log, () => client);

    expect(result).toBe(client);
    expect(client.calls.slice(0, 2)).toEqual(["on", "connect"]);
    expect(client.queries.map((q) => q.text)).toEqual([
      "SET statement_timeout = 0",
      "SET tcp_keepalives_idle = 30",
      "SET tcp_keepalives_interval = 10",
      "SET tcp_keepalives_count = 6",
    ]);
  });

  it("should pass the connection to the factory", async () => {
    const factory = vi.fn(() => fakeClient());

    await createJobClient(CANARY_CONNECTION, vi.fn(), factory);

    expect(factory).toHaveBeenCalledWith(CANARY_CONNECTION);
  });

  it("should tolerate rejected tcp_keepalives settings, warn, and keep going", async () => {
    const client = fakeClient({ failOn: (text) => text.startsWith("SET tcp_keepalives") });
    const log = vi.fn();

    await expect(createJobClient(CANARY_CONNECTION, log, () => client)).resolves.toBe(client);

    expect(client.queries).toHaveLength(4);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.every(([level]) => level === "WARN")).toBe(true);
  });

  it("should not leak the connection values into the warnings", async () => {
    const client = fakeClient({ failOn: (text) => text.startsWith("SET tcp_keepalives") });
    const log = vi.fn();

    await createJobClient(CANARY_CONNECTION, log, () => client);

    const text = JSON.stringify(log.mock.calls);
    expect(text).not.toContain(CANARY_CONNECTION.password);
    expect(text).not.toContain(CANARY_CONNECTION.host);
  });

  it("should reject when statement_timeout cannot be disabled", async () => {
    const client = fakeClient({ failOn: (text) => text === "SET statement_timeout = 0" });

    await expect(createJobClient(CANARY_CONNECTION, vi.fn(), () => client)).rejects.toThrow("permission denied");
  });

  it("should reject when connect fails", async () => {
    const client = fakeClient({ connectFails: true });

    await expect(createJobClient(CANARY_CONNECTION, vi.fn(), () => client)).rejects.toThrow("connect refused");
    expect(client.queries).toEqual([]);
  });

  it("should turn a later client error event into a warning rather than throwing", async () => {
    const client = fakeClient();
    const log = vi.fn();
    await createJobClient(CANARY_CONNECTION, log, () => client);
    log.mockClear();

    expect(() => client.errorListeners[0](new Error(`socket reset for ${CANARY_CONNECTION.password}`))).not.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe("WARN");
    expect(String(log.mock.calls[0][1])).not.toContain(CANARY_CONNECTION.password);
  });
});

describe("cancelBackend", () => {
  it("should run pg_cancel_backend with the pid as the only parameter and end the connection", async () => {
    const client = fakeClient({ rows: [{ cancelled: true }] });

    const result = await cancelBackend(CANARY_CONNECTION, 4321, () => client);

    expect(result).toBe(true);
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0].text).toMatch(/^SELECT pg_cancel_backend\(\$1\)/);
    expect(client.queries[0].values).toEqual([4321]);
    expect(client.ended).toBe(1);
  });

  it("should return false when the server reports the cancel did not happen", async () => {
    expect(await cancelBackend(CANARY_CONNECTION, 1, () => fakeClient({ rows: [{ cancelled: false }] }))).toBe(false);
  });

  it("should return false when no row comes back", async () => {
    expect(await cancelBackend(CANARY_CONNECTION, 1, () => fakeClient({ rows: [] }))).toBe(false);
  });

  it("should attach an error listener and still end the connection when connect fails", async () => {
    const client = fakeClient({ connectFails: true });

    await expect(cancelBackend(CANARY_CONNECTION, 1, () => client)).rejects.toThrow("connect refused");

    expect(client.errorListeners).toHaveLength(1);
    expect(client.ended).toBe(1);
  });

  it("should still end the connection when the query fails", async () => {
    const client = fakeClient({ failOn: () => true });

    await expect(cancelBackend(CANARY_CONNECTION, 1, () => client)).rejects.toThrow("permission denied");

    expect(client.ended).toBe(1);
  });

  it("should swallow a failure while ending the connection", async () => {
    const client = fakeClient({ rows: [{ cancelled: true }], endFails: true });

    await expect(cancelBackend(CANARY_CONNECTION, 1, () => client)).resolves.toBe(true);
  });

  it("should use its own client per call (a short second connection)", async () => {
    const factory = vi.fn(() => fakeClient({ rows: [{ cancelled: true }] }));

    await cancelBackend(CANARY_CONNECTION, 1, factory);
    await cancelBackend(CANARY_CONNECTION, 2, factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
