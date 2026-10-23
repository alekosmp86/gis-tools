import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  openPgShpSession,
  type PgClientLike,
  type PgShpConfig,
} from "@/core/services/server/shpReplace/pgShpSession";
import type { ShpReplaceSession } from "@/core/services/server/shpReplace/shpReplaceTypes";

const PASSWORD = "s3cret-pass";
const CONFIG: PgShpConfig = { host: "db.local", port: 5432, db_name: "gis", user: "app", password: PASSWORD };
const SET_STATEMENTS = [
  "SET statement_timeout = '4h'",
  "SET lock_timeout = '30s'",
  "SET client_encoding = 'UTF8'",
  "SET work_mem = '128MB'",
  "SET maintenance_work_mem = '256MB'",
];
const SPANISH_MARKER = /\b(el|la|los|las|de|del|no|que|con|para|se|una|un|en)\b|[áéíóúñ¿¡]/i;
const COPY_SQL = 'COPY "shp_replace_stage" ("rec","c0") FROM STDIN';

interface RecordedQuery {
  arg: unknown;
  values?: unknown[];
}

type Listener = (...args: unknown[]) => void;
type WriteCallback = (error?: Error | null) => void;

class FakePgClient implements PgClientLike {
  readonly queries: RecordedQuery[] = [];
  readonly listeners = new Map<string, Listener[]>();
  connectError: Error | undefined;
  endError: Error | undefined;
  queryError: Error | undefined;
  rowsResult: { rows: Array<Record<string, unknown>>; rowCount: number | null } = { rows: [], rowCount: 0 };
  connectCount = 0;
  endCount = 0;

  async connect(): Promise<void> {
    this.connectCount += 1;
    if (this.connectError) throw this.connectError;
  }

  query(arg: unknown, values?: unknown[]): unknown {
    this.queries.push({ arg, values });
    if (typeof arg !== "string") return arg;
    if (this.queryError) return Promise.reject(this.queryError);
    return Promise.resolve(this.rowsResult);
  }

  async end(): Promise<void> {
    this.endCount += 1;
    if (this.endError) throw this.endError;
  }

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  statements(): unknown[] {
    return this.queries.map((entry) => entry.arg);
  }
}

class FakeCopyStream extends Writable {
  rowCount: number | undefined;
  readonly received: string[] = [];
  readonly held: WriteCallback[] = [];
  holdWrites: boolean;
  failOnFinal: Error | undefined;

  constructor(highWaterMark: number, holdWrites: boolean, failOnFinal: Error | undefined) {
    super({ highWaterMark, decodeStrings: false });
    this.holdWrites = holdWrites;
    this.failOnFinal = failOnFinal;
  }

  _write(chunk: unknown, _encoding: BufferEncoding, callback: WriteCallback): void {
    this.received.push(String(chunk));
    if (this.holdWrites) {
      this.held.push(callback);
      return;
    }
    callback();
  }

  _final(callback: WriteCallback): void {
    if (this.failOnFinal) {
      callback(this.failOnFinal);
      return;
    }
    this.rowCount = this.received.length;
    callback();
  }
}

interface HarnessOptions {
  highWaterMark?: number;
  holdWrites?: boolean;
  failOnFinal?: Error;
}

interface Harness {
  client: FakePgClient;
  copySqls: string[];
  streams: FakeCopyStream[];
  clientConfigs: PgShpConfig[];
  open(config?: PgShpConfig): Promise<ShpReplaceSession>;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const client = new FakePgClient();
  const copySqls: string[] = [];
  const streams: FakeCopyStream[] = [];
  const clientConfigs: PgShpConfig[] = [];
  return {
    client,
    copySqls,
    streams,
    clientConfigs,
    open: (config: PgShpConfig = CONFIG) =>
      openPgShpSession(config, {
        createClient: (received) => {
          clientConfigs.push(received);
          return client;
        },
        createCopyStream: (sql: string) => {
          copySqls.push(sql);
          const stream = new FakeCopyStream(options.highWaterMark ?? 16 * 1024, options.holdWrites ?? false, options.failOnFinal);
          streams.push(stream);
          return stream;
        },
      }),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function* countedLines(lines: string[], pulls: { count: number }): Generator<string, void, undefined> {
  for (const line of lines) {
    pulls.count += 1;
    yield line;
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (reason) {
    return reason as Error;
  }
  throw new Error("expected the promise to reject but it resolved");
}

describe("openPgShpSession", () => {
  describe("connection setup", () => {
    it("should create the client from the given config and connect it before resolving the session", async () => {
      const harness = createHarness();

      await harness.open();

      expect(harness.clientConfigs).toEqual([CONFIG]);
      expect(harness.client.connectCount).toBe(1);
    });

    it("should run only the statement_timeout, lock_timeout, client_encoding, work_mem and maintenance_work_mem SET statements in order after connecting", async () => {
      const harness = createHarness();

      await harness.open();

      expect(harness.client.statements()).toEqual(SET_STATEMENTS);
    });

    it("should register an error listener on the client when the session opens", async () => {
      const harness = createHarness();

      await harness.open();

      expect(harness.client.listeners.get("error")?.length).toBeGreaterThan(0);
    });

    it("should not throw when the client emits an error after the session opened", async () => {
      const harness = createHarness();
      await harness.open();

      for (const listener of harness.client.listeners.get("error") ?? []) {
        expect(() => listener(new Error("socket cerrado por el servidor"))).not.toThrow();
      }
    });

    it("should reject with a Spanish message that omits the password when connect fails", async () => {
      const harness = createHarness();
      harness.client.connectError = new Error("connect ECONNREFUSED 127.0.0.1:5432");

      const error = await rejectionOf(harness.open());

      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).toMatch(SPANISH_MARKER);
      expect(error.message).not.toContain(PASSWORD);
    });

    it("should reject without the password even when the driver error message contains it", async () => {
      const harness = createHarness();
      harness.client.connectError = new Error(`password authentication failed: clave ${PASSWORD} rechazada`);

      const error = await rejectionOf(harness.open());

      expect(error.message).toMatch(SPANISH_MARKER);
      expect(error.message).not.toContain(PASSWORD);
    });
  });

  describe("query", () => {
    it("should resolve with the rows and rowCount reported by the driver", async () => {
      const harness = createHarness();
      const session = await harness.open();
      harness.client.rowsResult = { rows: [{ n: 1 }, { n: 2 }], rowCount: 2 };

      await expect(session.query("SELECT n FROM t")).resolves.toEqual({ rows: [{ n: 1 }, { n: 2 }], rowCount: 2 });
    });

    it("should pass the SQL text and the values to the driver when values are given", async () => {
      const harness = createHarness();
      const session = await harness.open();

      await session.query("SELECT $1::int", [7]);

      expect(harness.client.queries[harness.client.queries.length - 1]).toEqual({
        arg: "SELECT $1::int",
        values: [7],
      });
    });

    it("should resolve with rowCount zero when the driver reports a null rowCount", async () => {
      const harness = createHarness();
      const session = await harness.open();
      harness.client.rowsResult = { rows: [], rowCount: null };

      await expect(session.query("DELETE FROM t")).resolves.toEqual({ rows: [], rowCount: 0 });
    });

    it("should reject with the driver error when the query fails", async () => {
      const harness = createHarness();
      const session = await harness.open();
      harness.client.queryError = new Error("relación no existe");

      await expect(session.query("SELECT * FROM missing")).rejects.toThrow("relación no existe");
    });
  });

  describe("copyIn", () => {
    it("should send the COPY SQL to createCopyStream and write every line in order", async () => {
      const harness = createHarness();
      const session = await harness.open();

      await session.copyIn(COPY_SQL, ["1\ta\n", "2\tb\n", "3\tc\n"]);

      expect(harness.copySqls).toEqual([COPY_SQL]);
      expect(harness.streams[0].received).toEqual(["1\ta\n", "2\tb\n", "3\tc\n"]);
    });

    it("should resolve with the row count the COPY stream reports after finishing", async () => {
      const harness = createHarness();
      const session = await harness.open();

      await expect(session.copyIn(COPY_SQL, ["1\ta\n", "2\tb\n", "3\tc\n"])).resolves.toBe(3);
    });

    it("should end the stream and resolve zero when no lines are provided", async () => {
      const harness = createHarness();
      const session = await harness.open();

      await expect(session.copyIn(COPY_SQL, [])).resolves.toBe(0);
      expect(harness.streams[0].received).toEqual([]);
    });

    it("should not pull a second line until drain when write returns false", async () => {
      const harness = createHarness({ highWaterMark: 1, holdWrites: true });
      const session = await harness.open();
      const lines = ["1\ta\n", "2\tb\n", "3\tc\n"];
      const pulls = { count: 0 };
      const copy = session.copyIn(COPY_SQL, countedLines(lines, pulls));
      await flush();
      const stream = harness.streams[0];

      expect(pulls.count).toBe(1);
      expect(stream.received).toEqual([lines[0]]);

      for (let attempt = 0; attempt < 20; attempt++) {
        await flush();
        stream.held.shift()?.();
      }

      await expect(copy).resolves.toBe(3);
      expect(stream.received).toEqual(lines);
    });

    it("should reject with the stream error and pull no more lines when the stream errors while waiting for drain", async () => {
      const harness = createHarness({ highWaterMark: 1, holdWrites: true });
      const session = await harness.open();
      const pulls = { count: 0 };
      const copy = session.copyIn(COPY_SQL, countedLines(["1\ta\n", "2\tb\n", "3\tc\n"], pulls));
      await flush();

      harness.streams[0].held.shift()?.(new Error("copia rechazada por el servidor"));

      await expect(copy).rejects.toThrow("copia rechazada por el servidor");
      expect(pulls.count).toBe(1);
    });

    it("should reject when the COPY stream errors while finishing", async () => {
      const harness = createHarness({ failOnFinal: new Error("fallo al cerrar la copia") });
      const session = await harness.open();

      await expect(session.copyIn(COPY_SQL, ["1\ta\n"])).rejects.toThrow("fallo al cerrar la copia");
    });
  });

  describe("close", () => {
    it("should call client.end exactly once when close is called twice", async () => {
      const harness = createHarness();
      const session = await harness.open();

      await session.close();
      await session.close();

      expect(harness.client.endCount).toBe(1);
    });

    it("should resolve without throwing when client.end rejects", async () => {
      const harness = createHarness();
      const session = await harness.open();
      harness.client.endError = new Error("conexión ya cerrada");

      await expect(session.close()).resolves.toBeUndefined();
    });
  });
});
