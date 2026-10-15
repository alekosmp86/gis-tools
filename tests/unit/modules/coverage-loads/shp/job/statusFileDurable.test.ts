import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STATUS_DURABLE_BACKOFF_CAP_MS,
  STATUS_DURABLE_BACKOFF_START_MS,
  STATUS_DURABLE_BUDGET_MS,
  STATUS_READ_BACKOFF_MS,
  STATUS_READ_RETRIES,
  STATUS_RENAME_RETRIES,
} from "@/modules/coverage-loads/shp/job/constants.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { createInitialStatus } from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import type { JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";

interface Control {
  files: Map<string, string>;
  /** One entry per call: an errno code to throw, or null to let the call through. An empty queue lets everything through. */
  writeFailures: Array<string | null>;
  renameFailures: Array<string | null>;
  readFailures: Array<string | null>;
  /** When set, every call of that kind fails with this code. */
  alwaysRename: string | null;
  writeCalls: number;
  renameCalls: number;
  readCalls: number;
  renameAt: number[];
  readAt: number[];
  gate: Promise<void> | null;
}

const control = vi.hoisted(
  (): Control => ({
    files: new Map(),
    writeFailures: [],
    renameFailures: [],
    readFailures: [],
    alwaysRename: null,
    writeCalls: 0,
    renameCalls: 0,
    readCalls: 0,
    renameAt: [],
    readAt: [],
    gate: null,
  })
);

function fail(code: string): never {
  throw Object.assign(new Error(`injected ${code}`), { code });
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (file: string, data: string) => {
      control.writeCalls += 1;
      const code = control.writeFailures.shift();
      if (code) fail(code);
      control.files.set(file, String(data));
    },
    rename: async (from: string, to: string) => {
      control.renameCalls += 1;
      control.renameAt.push(Date.now());
      if (control.gate) await control.gate;
      const code = control.alwaysRename ?? control.renameFailures.shift();
      if (code) fail(code);
      const text = control.files.get(from);
      if (text === undefined) fail("ENOENT");
      control.files.set(to, text);
      control.files.delete(from);
    },
    readFile: async (file: string) => {
      control.readCalls += 1;
      control.readAt.push(Date.now());
      const code = control.readFailures.shift();
      if (code) fail(code);
      const text = control.files.get(file);
      if (text === undefined) fail("ENOENT");
      return text;
    },
  };
});

const { createStatusWriter, readStatus, writeStatusAtomic } = await import("@/modules/coverage-loads/shp/job/statusFile.ts");

const ROOT = "virtual-root";
const RETRYABLE = ["EPERM", "EBUSY", "EACCES"] as const;

function makeStatus(rows = 0): { jobId: string; status: JobStatus } {
  const jobId = randomUUID();
  const status = createInitialStatus({
    jobId,
    mode: "LOAD",
    table: "lte",
    prefix: "LTEUruguay",
    fechaact: "2026-01-31",
    fileName: "LTEUruguay_20260131.shp",
    sizeBytes: 1,
    receivedBytes: 1,
    now: Date.parse("2026-01-31T00:00:00.000Z"),
    state: "READY",
  });
  status.progress.rowsCopied = rows;
  return { jobId, status };
}

const rowsOf = (text: string | undefined): number => (JSON.parse(text ?? "{}") as JobStatus).progress.rowsCopied;

type Outcome = { ok: true } | { ok: false; error: NodeJS.ErrnoException };

/** Advances the fake clock in small steps until the promise settles; never waits on the real clock. */
async function drive(promise: Promise<unknown>): Promise<Outcome> {
  let outcome: Outcome | null = null;
  void promise.then(
    () => (outcome = { ok: true }),
    (error: NodeJS.ErrnoException) => (outcome = { ok: false, error })
  );
  for (let step = 0; step < 600 && outcome === null; step += 1) await vi.advanceTimersByTimeAsync(50);
  if (outcome === null) throw new Error("promise never settled");
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(Date.parse("2026-02-01T00:00:00.000Z"));
  control.files.clear();
  control.writeFailures = [];
  control.renameFailures = [];
  control.readFailures = [];
  control.alwaysRename = null;
  control.writeCalls = control.renameCalls = control.readCalls = 0;
  control.renameAt = [];
  control.readAt = [];
  control.gate = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("writeStatusAtomic durable", () => {
  it.each(RETRYABLE)("should retry the whole write past 3 attempts on %s at rename and then succeed", async (code) => {
    const { jobId, status } = makeStatus(7);
    control.renameFailures = Array(6).fill(code);

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));

    expect(outcome.ok).toBe(true);
    expect(control.renameCalls).toBe(7);
    expect(control.writeCalls).toBe(7);
    expect(rowsOf(control.files.get(jobPaths(ROOT, jobId).status))).toBe(7);
  });

  it.each(RETRYABLE)("should retry %s raised by the tmp write itself and then succeed", async (code) => {
    const { jobId, status } = makeStatus(3);
    control.writeFailures = Array(5).fill(code);

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));

    expect(outcome.ok).toBe(true);
    expect(control.writeCalls).toBe(6);
    expect(rowsOf(control.files.get(jobPaths(ROOT, jobId).status))).toBe(3);
  });

  it("should retry ENOENT at rename (vanished tmp) by rewriting the tmp file", async () => {
    const { jobId, status } = makeStatus(5);
    control.renameFailures = Array(5).fill("ENOENT");

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));

    expect(outcome.ok).toBe(true);
    expect(control.renameCalls).toBe(6);
    expect(control.writeCalls).toBe(6);
    expect(rowsOf(control.files.get(jobPaths(ROOT, jobId).status))).toBe(5);
  });

  it("should write once without sleeping when nothing fails", async () => {
    const { jobId, status } = makeStatus(1);

    await writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true });

    expect(control.writeCalls).toBe(1);
    expect(control.renameCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(RETRYABLE)("should throw the last %s once the budget is exhausted, without waiting 10 real seconds", async (code) => {
    const { jobId, status } = makeStatus();
    control.alwaysRename = code;
    const startedAt = Date.now();

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.code).toBe(code);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(STATUS_DURABLE_BUDGET_MS);
    expect(Date.now() - startedAt).toBeLessThan(STATUS_DURABLE_BUDGET_MS + 2 * STATUS_DURABLE_BACKOFF_CAP_MS);
    expect(control.renameCalls).toBeGreaterThan(STATUS_RENAME_RETRIES + 1);
    expect(control.files.has(jobPaths(ROOT, jobId).status)).toBe(false);
  });

  it("should back off with a growing delay that never exceeds the cap", async () => {
    const { jobId, status } = makeStatus();
    vi.spyOn(Math, "random").mockReturnValue(1);
    control.alwaysRename = "EBUSY";

    await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));

    const gaps = control.renameAt.slice(1).map((at, i) => at - control.renameAt[i]);
    expect(gaps[0]).toBeLessThanOrEqual(STATUS_DURABLE_BACKOFF_START_MS);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(STATUS_DURABLE_BACKOFF_CAP_MS);
    expect(Math.max(...gaps)).toBeGreaterThan(STATUS_DURABLE_BACKOFF_START_MS * 4);
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
  });

  it("should apply jitter: a low random draw waits less than a high one", async () => {
    const { jobId, status } = makeStatus();
    const firstGap = async (random: number): Promise<number> => {
      control.renameAt = [];
      control.renameFailures = ["EBUSY", "EBUSY"];
      vi.spyOn(Math, "random").mockReturnValue(random);
      await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));
      vi.restoreAllMocks();
      return control.renameAt[1] - control.renameAt[0];
    };

    const low = await firstGap(0);
    const high = await firstGap(1);

    expect(low).toBeLessThan(high);
  });

  it.each(["ENOSPC", "EIO", "EEXIST"])("should not retry %s raised at rename", async (code) => {
    const { jobId, status } = makeStatus();
    control.renameFailures = [code];

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));

    expect(outcome.ok === false && outcome.error.code).toBe(code);
    expect(control.renameCalls).toBe(1);
    expect(control.writeCalls).toBe(1);
  });

  it("should not retry ENOSPC raised by the tmp write", async () => {
    const { jobId, status } = makeStatus();
    control.writeFailures = ["ENOSPC"];

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: true }));

    expect(outcome.ok === false && outcome.error.code).toBe("ENOSPC");
    expect(control.writeCalls).toBe(1);
    expect(control.renameCalls).toBe(0);
  });
});

describe("writeStatusAtomic short path", () => {
  it.each(RETRYABLE)("should retry %s at rename 3 times (4th attempt succeeds) rewriting nothing", async (code) => {
    const { jobId, status } = makeStatus(2);
    control.renameFailures = [code, code, code];

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status)));

    expect(outcome.ok).toBe(true);
    expect(control.renameCalls).toBe(STATUS_RENAME_RETRIES + 1);
    expect(control.writeCalls).toBe(1);
  });

  it("should give up after the short retries instead of using the durable budget", async () => {
    const { jobId, status } = makeStatus();
    control.alwaysRename = "EBUSY";

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status), { durable: false }));

    expect(outcome.ok === false && outcome.error.code).toBe("EBUSY");
    expect(control.renameCalls).toBe(STATUS_RENAME_RETRIES + 1);
  });

  it("should not retry ENOENT at rename (only the durable path does)", async () => {
    const { jobId, status } = makeStatus();
    control.renameFailures = ["ENOENT"];

    const outcome = await drive(writeStatusAtomic(ROOT, jobId, JSON.stringify(status)));

    expect(outcome.ok === false && outcome.error.code).toBe("ENOENT");
    expect(control.renameCalls).toBe(1);
  });
});

describe("createStatusWriter durable upgrade", () => {
  function openGate(): () => void {
    let open!: () => void;
    control.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return open;
  }

  /** In flight: one short write blocked on rename. Pending: whatever the test queues behind it. */
  async function startInFlight(writer: ReturnType<typeof createStatusWriter>, status: JobStatus): Promise<{ first: Promise<void>; release: () => void }> {
    const release = openGate();
    status.progress.rowsCopied = 1;
    const first = writer.write(status);
    await vi.advanceTimersByTimeAsync(0);
    expect(control.renameCalls).toBe(1);
    return { first, release };
  }

  it("should upgrade a pending short write to durable when a durable write coalesces into it", async () => {
    const { jobId, status } = makeStatus();
    const writer = createStatusWriter(ROOT, jobId);
    const { first, release } = await startInFlight(writer, status);
    control.renameFailures = [null, ...Array(6).fill("EBUSY")];

    status.progress.rowsCopied = 2;
    const shortWrite = writer.write(status);
    status.progress.rowsCopied = 3;
    const durableWrite = writer.write(status, { durable: true });
    release();
    const outcome = await drive(Promise.all([first, shortWrite, durableWrite]));

    expect(outcome.ok).toBe(true);
    expect(control.renameCalls).toBe(1 + 7);
    expect(rowsOf(control.files.get(jobPaths(ROOT, jobId).status))).toBe(3);
  });

  it("should keep a pending durable write durable when a short write coalesces into it afterwards", async () => {
    const { jobId, status } = makeStatus();
    const writer = createStatusWriter(ROOT, jobId);
    const { first, release } = await startInFlight(writer, status);
    control.renameFailures = [null, ...Array(6).fill("EPERM")];

    status.progress.rowsCopied = 2;
    const durableWrite = writer.write(status, { durable: true });
    status.progress.rowsCopied = 3;
    const shortWrite = writer.write(status);
    release();
    const outcome = await drive(Promise.all([first, durableWrite, shortWrite]));

    expect(outcome.ok).toBe(true);
    expect(rowsOf(control.files.get(jobPaths(ROOT, jobId).status))).toBe(3);
  });

  it("should leave a pending write short when only short writes coalesce into it", async () => {
    const { jobId, status } = makeStatus();
    const writer = createStatusWriter(ROOT, jobId);
    const { first, release } = await startInFlight(writer, status);
    control.renameFailures = [null, ...Array(6).fill("EBUSY")];

    status.progress.rowsCopied = 2;
    const pendingA = writer.write(status);
    status.progress.rowsCopied = 3;
    const pendingB = writer.write(status);
    release();
    const outcome = await drive(Promise.all([first, pendingA, pendingB]));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.code).toBe("EBUSY");
    expect(control.renameCalls).toBe(1 + STATUS_RENAME_RETRIES + 1);
  });

  it("should resolve every caller after a write at least as new as theirs, with the latest text winning", async () => {
    const { jobId, status } = makeStatus();
    const writer = createStatusWriter(ROOT, jobId);
    const { first, release } = await startInFlight(writer, status);
    const seen: Record<number, number> = {};

    const issue = (rows: number, durable: boolean): Promise<void> => {
      status.progress.rowsCopied = rows;
      return writer.write(status, { durable }).then(() => {
        seen[rows] = rowsOf(control.files.get(jobPaths(ROOT, jobId).status));
      });
    };
    const rest = [issue(2, false), issue(3, true), issue(4, false)];
    release();
    await drive(Promise.all([first, ...rest]));

    for (const rows of [2, 3, 4]) expect(seen[rows]).toBeGreaterThanOrEqual(rows);
    expect(rowsOf(control.files.get(jobPaths(ROOT, jobId).status))).toBe(4);
  });

  it("should reject the durable caller when the budget is exhausted and still serve a later write", async () => {
    const { jobId, status } = makeStatus();
    const writer = createStatusWriter(ROOT, jobId);
    control.alwaysRename = "EBUSY";

    status.progress.rowsCopied = 1;
    const failed = await drive(writer.write(status, { durable: true }));
    control.alwaysRename = null;
    status.progress.rowsCopied = 2;
    const later = await drive(writer.write(status, { durable: true }));

    expect(failed.ok === false && failed.error.code).toBe("EBUSY");
    expect(later.ok).toBe(true);
    expect(rowsOf(control.files.get(jobPaths(ROOT, jobId).status))).toBe(2);
  });
});

describe("readStatus transient retry", () => {
  function seed(rows = 4): string {
    const { jobId, status } = makeStatus(rows);
    control.files.set(jobPaths(ROOT, jobId).status, JSON.stringify(status));
    return jobId;
  }

  it.each(RETRYABLE)("should retry %s up to the limit and then return the status", async (code) => {
    const jobId = seed(4);
    control.readFailures = Array(STATUS_READ_RETRIES).fill(code);

    let result: JobStatus | null = null;
    const outcome = await drive(readStatus(ROOT, jobId).then((value) => (result = value)));

    expect(outcome.ok).toBe(true);
    expect(result).not.toBeNull();
    expect((result as JobStatus | null)?.progress.rowsCopied).toBe(4);
    expect(control.readCalls).toBe(STATUS_READ_RETRIES + 1);
  });

  it.each(RETRYABLE)("should return null once %s outlasts the retries", async (code) => {
    const jobId = seed();
    control.readFailures = Array(STATUS_READ_RETRIES + 1).fill(code);

    let result: JobStatus | null | undefined;
    await drive(readStatus(ROOT, jobId).then((value) => (result = value)));

    expect(result).toBeNull();
    expect(control.readCalls).toBe(STATUS_READ_RETRIES + 1);
  });

  it("should wait the read backoff between attempts", async () => {
    const jobId = seed();
    control.readFailures = ["EBUSY", "EBUSY", "EBUSY"];

    await drive(readStatus(ROOT, jobId));

    const gaps = control.readAt.slice(1).map((at, i) => at - control.readAt[i]);
    expect(gaps).toHaveLength(STATUS_READ_RETRIES);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(STATUS_READ_BACKOFF_MS);
  });

  it("should return null immediately after a single attempt on ENOENT", async () => {
    const jobId = makeStatus().jobId;

    const result = await readStatus(ROOT, jobId);

    expect(result).toBeNull();
    expect(control.readCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should not retry an unrelated error such as EIO", async () => {
    const jobId = seed();
    control.readFailures = ["EIO"];

    expect(await readStatus(ROOT, jobId)).toBeNull();
    expect(control.readCalls).toBe(1);
  });

  it.each([
    ["malformed JSON", "{ not json"],
    ["a foreign shape", JSON.stringify({ hello: "world" })],
    ["an empty file", ""],
  ])("should return null for %s without retrying", async (_label, text) => {
    const jobId = makeStatus().jobId;
    control.files.set(jobPaths(ROOT, jobId).status, text);

    expect(await readStatus(ROOT, jobId)).toBeNull();
    expect(control.readCalls).toBe(1);
  });
});
