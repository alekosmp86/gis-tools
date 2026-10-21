import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseJobConfig } from "@/modules/coverage-loads/shp/job/jobConfig.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { CHILD_ENV_ALLOW_LIST, FAKE_STAGE_MS, PIPELINE_ENV_VAR } from "@/modules/coverage-loads/shp/constants";
import { createShpHandlers } from "@/modules/coverage-loads/shp/api/handlers";
import {
  CANARY_PASSWORD,
  CONNECTION_BODY,
  createFakeSpawn,
  createHarness,
  createTmpRoots,
  exists,
  FakeRepository,
  FIXED_NOW,
  jsonPost,
  makeJob,
  MISSING_JOB_ID,
  readAllText,
  readJson,
  readLockFile,
  readStatusFile,
  waitFor,
} from "../helpers/apiTestEnv";

vi.setConfig({ testTimeout: 30_000 });

const roots = createTmpRoots();
const originalPipeline = process.env[PIPELINE_ENV_VAR];

afterEach(async () => {
  if (originalPipeline === undefined) delete process.env[PIPELINE_ENV_VAR];
  else process.env[PIPELINE_ENV_VAR] = originalPipeline;
  await roots.cleanup();
});

function startBody(jobId: string, overrides: Record<string, unknown> = {}) {
  return { jobId, mode: "LOAD", confirm: true, connection: CONNECTION_BODY, ...overrides };
}

async function expectNothingStarted(harness: ReturnType<typeof createHarness>, table: "lte" = "lte") {
  expect(harness.spawn.calls).toEqual([]);
  expect(await readLockFile(harness.root, table)).toBeNull();
}

describe("POST shp/start refusals", () => {
  it.each([
    ["missing", undefined],
    ["unknown", "DELETE_EVERYTHING"],
    ["lowercase", "load"],
    ["a number", 1],
  ])("should answer 400 when the mode is %s", async (_label, mode) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId, { mode })));

    // Assert
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ success: false, error: "El modo de carga no es válido." });
    await expectNothingStarted(harness);
  });

  it.each([
    ["missing", undefined],
    ["false", false],
    ["the string true", "true"],
    ["1", 1],
  ])("should answer 400 when confirm is %s", async (_label, confirm) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId, { confirm })));

    // Assert
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe("Hay que confirmar la carga para escribir en la base de datos.");
    await expectNothingStarted(harness);
    expect(harness.repository.calls).toEqual([]);
  });

  it("should answer 400 for an invalid jobId and for a missing connection", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const badId = await harness.handlers.start(jsonPost("start", startBody("nope")));
    const noConnection = await harness.handlers.start(jsonPost("start", startBody(jobId, { connection: undefined })));

    // Assert
    expect(badId.status).toBe(400);
    expect(noConnection.status).toBe(400);
    await expectNothingStarted(harness);
  });

  it("should answer 404 when the job does not exist", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(MISSING_JOB_ID)));

    // Assert
    expect(response.status).toBe(404);
    expect((await readJson(response)).error).toBe("No existe la carga indicada.");
    await expectNothingStarted(harness);
  });

  it.each(["UPLOADING", "RUNNING", "CANCELLING", "SUCCEEDED", "FAILED", "CANCELLED"] as const)(
    "should answer 409 when the job is %s instead of READY",
    async (state) => {
      // Arrange
      const harness = createHarness(await roots.create());
      const { jobId } = await makeJob(harness.root, { state });

      // Act
      const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

      // Assert
      expect(response.status).toBe(409);
      expect((await readJson(response)).error).toContain(state);
      await expectNothingStarted(harness);
    }
  );

  it("should answer 409 with the plan when the database reports a blocker", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.repository.inspection = { ...harness.repository.inspection, postgisAvailable: false };
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toBe("La carga no puede iniciarse: revise los bloqueos y privilegios del plan.");
    expect(body.plan).toMatchObject({ canStart: false, blockers: [expect.stringContaining("PostGIS")] });
    await expectNothingStarted(harness);
    expect((await readStatusFile(harness.root, jobId)).state).toBe("READY");
  });

  it("should answer 409 with the plan when privileges are missing", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.repository.inspection = { ...harness.repository.inspection, missingTablePrivileges: ["DELETE"], schemaCreateGranted: false };
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(409);
    expect(body.plan.privilegeShortfalls).toHaveLength(2);
    await expectNothingStarted(harness);
  });

  it("should answer 409 and spawn nothing when the advisory lock is held by another session", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.repository.inspection = { ...harness.repository.inspection, advisoryLockHeld: true };
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(409);
    await expectNothingStarted(harness);
  });

  it("should answer 409 with the plan when another job already holds the table lock", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const holder = await makeJob(harness.root, { table: "lte" });
    mkdirSync(path.join(harness.root, "locks"), { recursive: true });
    writeFileSync(path.join(harness.root, "locks", "lte.json"), JSON.stringify({ table: "lte", jobId: holder.jobId, pid: process.pid, acquiredAt: "x" }));
    const { jobId } = await makeJob(harness.root, { table: "lte" });

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(409);
    expect(body.plan.blockers).toEqual(["Ya hay una carga de lte en curso."]);
    expect(harness.spawn.calls).toEqual([]);
    expect((await readLockFile(harness.root, "lte"))?.jobId).toBe(holder.jobId);
  });

  it("should answer 409 and leave the winner's lock alone when the lock is taken between the plan check and the start", async () => {
    // Arrange: the lock appears right after the plan check, just before the start tries to take it
    const root = await roots.create();
    const repository = new FakeRepository();
    const spawn = createFakeSpawn(root);
    const holder = await makeJob(root, { table: "lte" });
    let armed = false;
    repository.onInspect = () => {
      armed = true;
    };
    const handlers = createShpHandlers({
      rootDir: root,
      repository,
      spawnProcess: spawn.fn,
      pipelineMode: "real",
      freeBytes: async () => Number.MAX_SAFE_INTEGER,
      now: () => {
        if (armed) {
          armed = false;
          mkdirSync(path.join(root, "locks"), { recursive: true });
          writeFileSync(path.join(root, "locks", "lte.json"), JSON.stringify({ table: "lte", jobId: holder.jobId, pid: process.pid, acquiredAt: "x" }));
        }
        return FIXED_NOW;
      },
    });
    const { jobId } = await makeJob(root, { table: "lte" });

    // Act
    const response = await handlers.start(jsonPost("start", startBody(jobId)));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(409);
    expect(body.error).toContain("Ya hay una carga de lte en curso");
    expect(body.plan).toBeDefined();
    expect(spawn.calls).toEqual([]);
    expect((await readLockFile(root, "lte"))?.jobId).toBe(holder.jobId);
    expect((await readStatusFile(root, jobId)).state).toBe("READY");
  });
});

describe("POST shp/start success", () => {
  it("should answer {success, jobId}, take the lock and write the mode before spawning", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId, { mode: "TEST" })));

    // Assert
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ success: true, jobId });
    expect(harness.spawn.calls).toHaveLength(1);
    expect(harness.spawn.calls[0].observed).toEqual({ lockExists: true, statusMode: "TEST" });
    expect((await readStatusFile(harness.root, jobId)).mode).toBe("TEST");
  });

  it("should update the lock with the pid of the spawned child", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { spawnPid: 31337 });
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(await readLockFile(harness.root, "lte")).toMatchObject({ jobId, pid: 31337 });
  });

  it("should spawn node detached and hidden with the memory flag, the job entry and the job dir as cwd", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    const call = harness.spawn.calls[0];
    expect(call.command).toBe(process.execPath);
    expect(call.args.slice(0, 2)).toEqual(["--max-old-space-size=1536", "--disable-warning=ExperimentalWarning"]);
    expect(call.args).toHaveLength(3);
    expect(path.isAbsolute(call.args[2])).toBe(true);
    expect(call.args[2]).toBe(path.resolve(process.cwd(), "src", "modules", "coverage-loads", "shp", "job", "jobEntry.ts"));
    expect(call.options.detached).toBe(true);
    expect(call.options.windowsHide).toBe(true);
    expect(call.options.cwd).toBe(jobPaths(harness.root, jobId).dir);
    const stdio = call.options.stdio as unknown[];
    expect(stdio[0]).toBe("pipe");
    expect(typeof stdio[1]).toBe("number");
    expect(stdio[2]).toBe(stdio[1]);
  });

  it("should give the child a minimal allow-listed environment with no PG variables and no secret", async () => {
    // Arrange
    const previous = { PGPASSWORD: process.env.PGPASSWORD, PGHOST: process.env.PGHOST, NODE_OPTIONS: process.env.NODE_OPTIONS, SECRET_TOKEN: process.env.SECRET_TOKEN };
    process.env.PGPASSWORD = CANARY_PASSWORD;
    process.env.PGHOST = "leak.example";
    process.env.NODE_OPTIONS = "--inspect";
    process.env.SECRET_TOKEN = "tok";
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    try {
      // Act
      await harness.handlers.start(jsonPost("start", startBody(jobId)));
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    // Assert
    const env = harness.spawn.calls[0].options.env as Record<string, string>;
    expect(Object.keys(env).filter((key) => !(CHILD_ENV_ALLOW_LIST as readonly string[]).includes(key))).toEqual([]);
    expect(Object.keys(env).some((key) => key.toUpperCase().startsWith("PG"))).toBe(false);
    expect(JSON.stringify(env)).not.toContain(CANARY_PASSWORD);
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it("should write exactly one JSON line with the config to stdin, then end it, and unref the child", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.start(jsonPost("start", startBody(jobId, { mode: "LOAD" })));

    // Assert
    const child = harness.spawn.calls[0].child;
    expect(child.stdinWrites).toHaveLength(1);
    expect(child.stdinWrites[0].endsWith("\n")).toBe(true);
    expect(child.stdinWrites[0].trim().split("\n")).toHaveLength(1);
    expect(child.stdinEnded).toBe(1);
    expect(child.unrefCalls).toBe(1);
    const parsed = parseJobConfig(child.stdinWrites[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.config).toEqual({
      jobId,
      mode: "LOAD",
      rootDir: harness.root,
      pipeline: "real",
      connection: { host: "db.internal.example", port: 5432, db_name: "gisdb", user: "gisuser", password: CANARY_PASSWORD },
    });
  });

  it("should never put the password in argv, in env, in job.log, in status.json, in the lock or in the response", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));
    const body = JSON.stringify(await readJson(response));

    // Assert
    const call = harness.spawn.calls[0];
    expect(JSON.stringify(call.args)).not.toContain(CANARY_PASSWORD);
    expect(JSON.stringify(call.options)).not.toContain(CANARY_PASSWORD);
    expect(body).not.toContain(CANARY_PASSWORD);
    expect(await readAllText(harness.root)).not.toContain(CANARY_PASSWORD);
    expect(await exists(jobPaths(harness.root, jobId).log)).toBe(true);
  });

  it("should use the pipeline mode and fake config the handlers were created with", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { pipelineMode: "fake", fakeConfig: { stageMs: 5 } });
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    const parsed = parseJobConfig(harness.spawn.calls[0].child.stdinWrites[0]);
    expect(parsed.ok && parsed.config).toMatchObject({ pipeline: "fake", fake: { stageMs: 5 } });
  });

  it("should default to the real pipeline when nothing is injected and the env var is unset", async () => {
    // Arrange
    delete process.env[PIPELINE_ENV_VAR];
    const harness = createHarness(await roots.create(), { pipelineMode: undefined });
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    const parsed = parseJobConfig(harness.spawn.calls[0].child.stdinWrites[0]);
    expect(parsed.ok && parsed.config.pipeline).toBe("real");
    expect(parsed.ok && parsed.config.fake).toBeUndefined();
  });

  it("should read COVERAGE_LOADS_SHP_PIPELINE=fake once, when the handlers are created", async () => {
    // Arrange
    process.env[PIPELINE_ENV_VAR] = "fake";
    const harness = createHarness(await roots.create(), { pipelineMode: undefined });
    delete process.env[PIPELINE_ENV_VAR];
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    const parsed = parseJobConfig(harness.spawn.calls[0].child.stdinWrites[0]);
    expect(parsed.ok && parsed.config).toMatchObject({ pipeline: "fake", fake: { stageMs: FAKE_STAGE_MS } });
  });

  it("should ignore an env value other than fake", async () => {
    // Arrange
    process.env[PIPELINE_ENV_VAR] = "FAKE";
    const harness = createHarness(await roots.create(), { pipelineMode: undefined });
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    const parsed = parseJobConfig(harness.spawn.calls[0].child.stdinWrites[0]);
    expect(parsed.ok && parsed.config.pipeline).toBe("real");
  });

  it("should refuse a second start of the same job once the first took the lock", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Act
    const second = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(second.status).toBe(409);
    expect(harness.spawn.calls).toHaveLength(1);
  });
});

describe("POST shp/start spawn failures", () => {
  it("should release the lock, mark the job FAILED with a Spanish SPAWN_FAILED and answer 500 when spawn throws", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { spawnThrows: new Error("EAGAIN") });
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(500);
    expect((await readJson(response)).success).toBe(false);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
    const status = await readStatusFile(harness.root, jobId);
    expect(status.state).toBe("FAILED");
    expect(status.error).toEqual({ code: "SPAWN_FAILED", message: "No se pudo iniciar el proceso de carga.", stage: null });
  });

  it("should treat a child without a pid as a failed spawn, in Spanish, with the lock released", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { spawnPid: undefined });
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: "No se pudo iniciar el proceso de carga." });
    expect(await readLockFile(harness.root, "lte")).toBeNull();
    expect((await readStatusFile(harness.root, jobId)).state).toBe("FAILED");
  });

  it("should never leak the password from a spawn error", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { spawnThrows: new Error(`spawn failed with ${CANARY_PASSWORD}`) });
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(JSON.stringify(await readJson(response))).not.toContain(CANARY_PASSWORD);
    expect(await readAllText(harness.root)).not.toContain(CANARY_PASSWORD);
  });

  it("should mark the job FAILED with SPAWN_FAILED and free the lock when the child exits non-zero while still READY", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Act
    harness.spawn.calls[0].child.emit("exit", 1);
    await waitFor(async () => (await readStatusFile(harness.root, jobId)).state === "FAILED");

    // Assert
    const status = await readStatusFile(harness.root, jobId);
    expect(status.error?.code).toBe("SPAWN_FAILED");
    expect(status.error?.message).toContain("código 1");
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should mark the job FAILED when the child emits an error event while still READY", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Act
    harness.spawn.calls[0].child.emit("error", new Error("ENOENT"));
    await waitFor(async () => (await readStatusFile(harness.root, jobId)).state === "FAILED");

    // Assert
    expect((await readStatusFile(harness.root, jobId)).error?.code).toBe("SPAWN_FAILED");
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should leave the job alone when the child exits non-zero after it already left READY", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await harness.handlers.start(jsonPost("start", startBody(jobId)));
    const statusPath = jobPaths(harness.root, jobId).status;
    const running = await readStatusFile(harness.root, jobId);
    running.state = "RUNNING";
    writeFileSync(statusPath, JSON.stringify(running));

    // Act
    harness.spawn.calls[0].child.emit("exit", 1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).state).toBe("RUNNING");
    expect(await readLockFile(harness.root, "lte")).not.toBeNull();
  });

  it("should not touch the job when the child exits with code 0", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Act
    harness.spawn.calls[0].child.emit("exit", 0);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).state).toBe("READY");
  });
});
