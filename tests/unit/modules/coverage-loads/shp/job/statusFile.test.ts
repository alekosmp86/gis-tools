import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { createStatusWriter, readStatus, writeStatusAtomic } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import { CANARY_PASSWORD, createTmpRoots, makeJob } from "../helpers/jobTestEnv.ts";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

describe("writeStatusAtomic / readStatus", () => {
  it("should round trip a status and leave no tmp file behind", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);

    expect(await readStatus(root, jobId)).toEqual(status);
    expect(await readdir(jobPaths(root, jobId).dir)).not.toContain("status.json.tmp");
  });

  it("should return null when the status file is missing", async () => {
    const root = await roots.create();
    expect(await readStatus(root, randomUUID())).toBeNull();
  });

  it.each([
    ["partial JSON", '{"schemaVersion": 1, "jobId": "x'],
    ["empty file", ""],
    ["array", "[]"],
    ["null", "null"],
    ["wrong schema version", '{"schemaVersion":2,"jobId":"a","state":"READY"}'],
    ["missing state", '{"schemaVersion":1,"jobId":"a"}'],
    ["non-string jobId", '{"schemaVersion":1,"jobId":5,"state":"READY"}'],
  ])("should return null when the file is %s", async (_name, content) => {
    const root = await roots.create();
    const jobId = randomUUID();
    const paths = jobPaths(root, jobId);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.status, content);

    expect(await readStatus(root, jobId)).toBeNull();
  });

  it("should return null for an invalid job id instead of throwing", async () => {
    const root = await roots.create();
    expect(await readStatus(root, "../evil")).toBeNull();
  });

  it("should reject writing for an invalid job id", async () => {
    const root = await roots.create();
    await expect(writeStatusAtomic(root, "../evil", "{}")).rejects.toThrow();
  });

  it("should reject when the job folder does not exist", async () => {
    const root = await roots.create();
    await expect(writeStatusAtomic(root, randomUUID(), "{}")).rejects.toThrow();
  });
});

describe("createStatusWriter", () => {
  it("should end with the last write when many writes are issued concurrently", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);

    const writes: Promise<void>[] = [];
    for (let i = 0; i < 40; i += 1) {
      status.progress.rowsCopied = i;
      writes.push(writer.write(status));
    }
    await Promise.all(writes);

    const final = await readStatus(root, jobId);
    expect(final?.progress.rowsCopied).toBe(39);
    expect(JSON.parse(await readFile(jobPaths(root, jobId).status, "utf8")).progress.rowsCopied).toBe(39);
    expect(await readdir(jobPaths(root, jobId).dir)).not.toContain("status.json.tmp");
  });

  it("should serialise the status at call time, not at flush time", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);

    status.progress.rowsCopied = 1;
    const first = writer.write(status);
    status.progress.rowsCopied = 2;
    await first;

    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(1);
  });

  it("should keep writing after a failed write", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const writer = createStatusWriter(root, jobId);
    const failing = createStatusWriter(root, randomUUID());

    await expect(failing.write(status)).rejects.toThrow();
    await expect(writer.write(status)).resolves.toBeUndefined();
  });

  it("should never persist connection secrets because the status type has no place for them", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    await createStatusWriter(root, jobId).write(status);

    expect(await readFile(jobPaths(root, jobId).status, "utf8")).not.toContain(CANARY_PASSWORD);
  });
});
