import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { readStatus } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import { CANARY_CONNECTION, CANARY_DB, CANARY_HOST, CANARY_PASSWORD, CANARY_USER, createTmpRoots, exists, makeJob, waitFor } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 30_000 });

const ENTRY = path.resolve(process.cwd(), "src/modules/coverage-loads/shp/job/jobEntry.ts");
const SPAWN_TIMEOUT_MS = 30_000;

const roots = createTmpRoots();
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await roots.cleanup();
});

interface Finished {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Running {
  child: ChildProcess;
  done: Promise<Finished>;
}

function start(args: string[], stdin: string | null): Running {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", ENTRY, ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr!.on("data", (chunk) => (stderr += String(chunk)));
  const done = new Promise<Finished>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  if (stdin !== null) child.stdin!.end(stdin);
  else child.stdin!.end();
  return { child, done };
}

function configJson(jobId: string, root: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jobId,
    mode: "LOAD",
    rootDir: root,
    pipeline: "fake",
    fake: { stageMs: 20 },
    connection: CANARY_CONNECTION,
    timing: { heartbeatMs: 20, cancelPollMs: 20, progressThrottleMs: 5, hardKillGraceMs: 5000 },
    ...extra,
  });
}

async function allText(root: string, jobId: string, finished: Finished): Promise<string> {
  const paths = jobPaths(root, jobId);
  const log = await readFile(paths.log, "utf8").catch(() => "");
  const status = await readFile(paths.status, "utf8").catch(() => "");
  return [log, status, finished.stdout, finished.stderr].join("\n");
}

function expectNoCanaries(text: string): void {
  for (const secret of [CANARY_PASSWORD, CANARY_HOST, CANARY_USER, CANARY_DB]) expect(text).not.toContain(secret);
}

describe("jobEntry spawned process", () => {
  it("should run a fake job to SUCCEEDED, exit 0, clean up, and never print or persist connection values", async () => {
    const root = await roots.create();
    const job = await makeJob(root);

    const finished = await start([], configJson(job.jobId, root)).done;

    expect(finished.code).toBe(0);
    const status = await readStatus(root, job.jobId);
    expect(status?.state).toBe("SUCCEEDED");
    expect(status?.pid).not.toBeNull();
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expect(await exists(path.join(root, "locks", "lte.json"))).toBe(false);
    expectNoCanaries(await allText(root, job.jobId, finished));
  }, SPAWN_TIMEOUT_MS);

  it("should take the root from --root when the config has no rootDir", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const json = JSON.parse(configJson(job.jobId, root));
    delete json.rootDir;

    const finished = await start(["--root", root], JSON.stringify(json)).done;

    expect(finished.code).toBe(0);
    expect((await readStatus(root, job.jobId))?.state).toBe("SUCCEEDED");
  }, SPAWN_TIMEOUT_MS);

  it("should exit 1 with FAILED when the fake pipeline fails at a stage", async () => {
    const root = await roots.create();
    const job = await makeJob(root);

    const finished = await start([], configJson(job.jobId, root, { fake: { stageMs: 20, failAtStage: "STAGING" } })).done;

    expect(finished.code).toBe(1);
    expect(await readStatus(root, job.jobId)).toMatchObject({ state: "FAILED", error: { code: "FAKE_FAILURE", stage: "STAGING" } });
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expectNoCanaries(await allText(root, job.jobId, finished));
  }, SPAWN_TIMEOUT_MS);

  it("should exit 2 with CANCELLED when cancel.request appears mid-run", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const running = start([], configJson(job.jobId, root, { fake: { stageMs: 5000 } }));
    await waitFor(async () => (await readStatus(root, job.jobId))?.stage === "READING", SPAWN_TIMEOUT_MS - 5000, 50);

    await writeFile(jobPaths(root, job.jobId).cancel, "");
    const finished = await running.done;

    expect(finished.code).toBe(2);
    expect((await readStatus(root, job.jobId))?.state).toBe("CANCELLED");
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expect(await exists(path.join(root, "locks", "lte.json"))).toBe(false);
    expectNoCanaries(await allText(root, job.jobId, finished));
  }, SPAWN_TIMEOUT_MS);

  it("should exit 3 on malformed JSON without echoing the input", async () => {
    const finished = await start([], `{"connection":{"password":"${CANARY_PASSWORD}"`).done;

    expect(finished.code).toBe(3);
    expect(finished.stderr).toContain("Configuración inválida");
    expectNoCanaries(finished.stdout + finished.stderr);
  }, SPAWN_TIMEOUT_MS);

  it("should exit 3 on an invalid config without echoing values", async () => {
    const root = await roots.create();
    const finished = await start([], configJson("not-a-uuid", root, { mode: CANARY_PASSWORD })).done;

    expect(finished.code).toBe(3);
    expectNoCanaries(finished.stdout + finished.stderr);
  }, SPAWN_TIMEOUT_MS);

  it("should exit 3 on empty stdin", async () => {
    const finished = await start([], null).done;

    expect(finished.code).toBe(3);
  }, SPAWN_TIMEOUT_MS);

  it("should exit 3 and write nothing when the job status does not exist", async () => {
    const root = await roots.create();

    const finished = await start([], configJson("123e4567-e89b-42d3-a456-426614174000", root)).done;

    expect(finished.code).toBe(3);
    expect(finished.stderr).toContain("no pudo iniciarse");
    expect(await readdir(root)).toEqual([]);
    expectNoCanaries(finished.stdout + finished.stderr);
  }, SPAWN_TIMEOUT_MS);

  it("should pass --self-test and print 'self-test ok'", async () => {
    const finished = await start(["--self-test"], null).done;

    expect(finished.code).toBe(0);
    expect(finished.stdout.trim()).toBe("self-test ok");
  }, SPAWN_TIMEOUT_MS);
});
