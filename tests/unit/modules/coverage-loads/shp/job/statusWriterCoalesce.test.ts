import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTmpRoots, makeJob, waitFor } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 30_000 });

const control = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  failures: [] as string[],
  renameCalls: 0,
  written: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (file: unknown, data: unknown, options?: unknown) => {
      if (typeof file === "string" && file.endsWith("status.json.tmp")) control.written.push(String(data));
      return (actual.writeFile as (...args: unknown[]) => Promise<void>)(file, data, options);
    },
    rename: async (from: string, to: string) => {
      control.renameCalls += 1;
      if (control.gate) await control.gate;
      const code = control.failures.shift();
      if (code) throw Object.assign(new Error(`injected ${code}`), { code });
      return actual.rename(from, to);
    },
  };
});

const { createStatusWriter, readStatus } = await import("@/modules/coverage-loads/shp/job/statusFile.ts");

const roots = createTmpRoots();

beforeEach(() => {
  control.gate = null;
  control.failures = [];
  control.renameCalls = 0;
  control.written = [];
});
afterEach(() => roots.cleanup());

function openGate(): { open: () => void } {
  let open!: () => void;
  control.gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open };
}

const rowsOf = (text: string): number => (JSON.parse(text) as { progress: { rowsCopied: number } }).progress.rowsCopied;

describe("createStatusWriter coalescing", () => {
  it("should write only the latest text when many writes are issued before the first one gets its turn", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    control.written = [];

    const writes: Promise<void>[] = [];
    for (let i = 1; i <= 40; i += 1) {
      status.progress.rowsCopied = i;
      writes.push(writer.write(status));
    }
    await Promise.all(writes);

    expect(control.written).toHaveLength(1);
    expect(rowsOf(control.written[0])).toBe(40);
    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(40);
  });

  it("should keep at most one pending write while one is in flight and let the latest text win", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    control.written = [];
    const gate = openGate();

    status.progress.rowsCopied = 1;
    const first = writer.write(status);
    await waitFor(() => control.renameCalls === 1);
    const pending: Promise<void>[] = [];
    for (let i = 2; i <= 6; i += 1) {
      status.progress.rowsCopied = i;
      pending.push(writer.write(status));
    }
    gate.open();
    await Promise.all([first, ...pending]);

    expect(control.written.map(rowsOf)).toEqual([1, 6]);
    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(6);
  });

  it("should resolve every caller only after a write at least as new as theirs reached the file", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    const gate = openGate();
    const observed: number[] = [];

    const issue = (rows: number): Promise<void> => {
      status.progress.rowsCopied = rows;
      return writer.write(status).then(async () => {
        observed[rows] = (await readStatus(root, jobId))?.progress.rowsCopied ?? -1;
      });
    };
    const first = issue(1);
    await waitFor(() => control.renameCalls === 1);
    const rest = [issue(2), issue(3), issue(4)];
    gate.open();
    await Promise.all([first, ...rest]);

    for (const rows of [1, 2, 3, 4]) expect(observed[rows]).toBeGreaterThanOrEqual(rows);
  });

  it("should preserve write order: the values that reach the file never go backwards", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    control.written = [];

    const writes: Promise<void>[] = [];
    for (let round = 0; round < 5; round += 1) {
      for (let i = 1; i <= 8; i += 1) {
        status.progress.rowsCopied = round * 8 + i;
        writes.push(writer.write(status));
      }
      await waitFor(() => control.renameCalls >= round + 1);
    }
    await Promise.all(writes);

    const values = control.written.map(rowsOf);
    expect(values.length).toBeGreaterThan(0);
    expect(values.length).toBeLessThan(40);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
    expect(values[values.length - 1]).toBe(40);
    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(40);
  });

  it("should serialise the status when write is called, not when the write runs", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    const gate = openGate();

    status.progress.rowsCopied = 1;
    const first = writer.write(status);
    await waitFor(() => control.renameCalls === 1);
    status.progress.rowsCopied = 2;
    const second = writer.write(status);
    status.progress.rowsCopied = 99;
    gate.open();
    await Promise.all([first, second]);

    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(2);
  });

  it("should start a fresh pending write after the previous batch finished", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    control.written = [];

    status.progress.rowsCopied = 1;
    await writer.write(status);
    status.progress.rowsCopied = 2;
    await writer.write(status);

    expect(control.written.map(rowsOf)).toEqual([1, 2]);
  });
});

describe("createStatusWriter failures and retries", () => {
  it("should retry a transient EPERM on rename and still resolve every coalesced caller", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    control.failures = ["EPERM", "EPERM"];

    status.progress.rowsCopied = 1;
    const first = writer.write(status);
    status.progress.rowsCopied = 2;
    const second = writer.write(status);
    await Promise.all([first, second]);

    expect(control.renameCalls).toBe(3);
    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(2);
  });

  it("should reject the callers of a write that finally fails and still run the write queued behind it", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    const gate = openGate();
    control.failures = ["ENOSPC"];

    status.progress.rowsCopied = 1;
    const failing = writer.write(status);
    const failed = failing.then(
      () => "resolved",
      (error: NodeJS.ErrnoException) => error.code
    );
    await waitFor(() => control.renameCalls === 1);
    status.progress.rowsCopied = 2;
    const next = writer.write(status);
    gate.open();

    expect(await failed).toBe("ENOSPC");
    await expect(next).resolves.toBeUndefined();
    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(2);
  });

  it("should keep working after a failed write when nothing else was queued", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    control.renameCalls = 0;
    control.failures = ["ENOSPC"];

    status.progress.rowsCopied = 1;
    await expect(writer.write(status)).rejects.toMatchObject({ code: "ENOSPC" });
    status.progress.rowsCopied = 2;
    await expect(writer.write(status)).resolves.toBeUndefined();

    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(2);
  });
});
