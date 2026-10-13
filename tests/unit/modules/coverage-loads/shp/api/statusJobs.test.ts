import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, createTmpRoots, FIXED_NOW, getRequest, makeJob, MISSING_JOB_ID, readJson } from "../helpers/apiTestEnv";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const iso = (offsetMs: number) => new Date(FIXED_NOW + offsetMs).toISOString();

describe("GET shp/status", () => {
  it("should answer 200 with the status and stale false for a READY job", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.status(getRequest("status", { jobId }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stale).toBe(false);
    expect(body.status).toMatchObject({ jobId, state: "READY", target: { table: "lte" } });
  });

  it("should flag stale when a live-state job has no live pid and an old heartbeat but was not swept yet", async () => {
    // Arrange: the once-per-process sweep is consumed first, so the job below is not closed by it
    const harness = createHarness(await roots.create());
    await harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID }));
    const { jobId } = await makeJob(harness.root, {
      state: "RUNNING",
      mutate: (status) => {
        status.pid = 5555;
        status.heartbeatAt = iso(-5 * 60_000);
      },
    });

    // Act
    const body = await readJson(await harness.handlers.status(getRequest("status", { jobId })));

    // Assert
    expect(body.status.state).toBe("RUNNING");
    expect(body.stale).toBe(true);
  });

  it("should not flag stale when the pid is alive, even with an old heartbeat", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    await harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID }));
    harness.alivePids.add(5555);
    const { jobId } = await makeJob(harness.root, {
      state: "RUNNING",
      mutate: (status) => {
        status.pid = 5555;
        status.heartbeatAt = iso(-5 * 60_000);
      },
    });

    // Act
    const body = await readJson(await harness.handlers.status(getRequest("status", { jobId })));

    // Assert
    expect(body.stale).toBe(false);
  });

  it("should not flag stale when the pid is dead but the heartbeat is recent (clock injected)", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    await harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID }));
    const { jobId } = await makeJob(harness.root, {
      state: "RUNNING",
      mutate: (status) => {
        status.pid = 5555;
        status.heartbeatAt = iso(-10_000);
      },
    });

    // Act
    const fresh = await readJson(await harness.handlers.status(getRequest("status", { jobId })));
    harness.clock.now = FIXED_NOW + 120_000;
    const later = await readJson(await harness.handlers.status(getRequest("status", { jobId })));

    // Assert
    expect(fresh.stale).toBe(false);
    expect(later.stale).toBe(true);
  });

  it("should treat a throwing liveness probe as alive instead of failing the status request", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), {
      isPidAlive: () => {
        throw new Error("process table exploded");
      },
    });
    const { jobId } = await makeJob(harness.root, {
      state: "RUNNING",
      mutate: (status) => {
        status.pid = 5555;
        status.heartbeatAt = iso(-5 * 60_000);
      },
    });

    // Act
    const response = await harness.handlers.status(getRequest("status", { jobId }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(200);
    expect(body.stale).toBe(false);
  });

  it("should flag stale when the pid answers but the heartbeat is older than the pid-reuse bound", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    await harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID }));
    harness.alivePids.add(5555);
    const { jobId } = await makeJob(harness.root, {
      state: "RUNNING",
      mutate: (status) => {
        status.pid = 5555;
        status.heartbeatAt = iso(-11 * 60_000);
      },
    });

    // Act
    const body = await readJson(await harness.handlers.status(getRequest("status", { jobId })));

    // Assert
    expect(body.stale).toBe(true);
  });

  it("should answer 404 when the job does not exist", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID }));

    // Assert
    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ success: false, error: "No existe la carga indicada." });
  });

  it.each([
    ["absent", {}],
    ["not a uuid", { jobId: "abc" }],
    ["a path traversal", { jobId: "..%2F..%2Fjobs" }],
    ["upper-case hex", { jobId: "ABCDEF01-0000-4000-8000-00000000000A" }],
  ])("should answer 400 when the jobId is %s", async (_label, query) => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.status(getRequest("status", query));

    // Assert
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ success: false, error: "Identificador de carga inválido." });
  });

  it("should treat a corrupt status.json as a missing job", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(harness.root, "jobs", jobId, "status.json"), "{ not json");

    // Act
    const response = await harness.handlers.status(getRequest("status", { jobId }));

    // Assert
    expect(response.status).toBe(404);
  });
});

describe("GET shp/jobs", () => {
  it("should answer an empty list when there are no jobs, even without a jobs folder", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ success: true, jobs: [] });
  });

  it("should list the summary fields of each job, including the error message", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, {
      state: "FAILED",
      table: "wcdma",
      mutate: (status) => {
        status.error = { code: "X", message: "Falló algo.", stage: "READING" };
        status.progress.stageFraction = 0.25;
        status.progress.overallFraction = 0.5;
        status.startedAt = iso(-1000);
      },
    });

    // Act
    const body = await readJson(await harness.handlers.jobs(getRequest("jobs")));

    // Assert
    expect(body.jobs).toEqual([
      {
        jobId,
        target: { table: "wcdma", prefix: "WCDMAUruguay", fechaact: "2026-01-31" },
        mode: "LOAD",
        state: "FAILED",
        stage: null,
        stageFraction: 0.25,
        overallFraction: 0.5,
        startedAt: iso(-1000),
        updatedAt: iso(0),
        errorMessage: "Falló algo.",
        stale: false,
      },
    ]);
  });

  it("should sort the jobs by updatedAt, newest first", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const oldest = await makeJob(harness.root, { now: FIXED_NOW - 3000 });
    const newest = await makeJob(harness.root, { now: FIXED_NOW - 1000 });
    const middle = await makeJob(harness.root, { now: FIXED_NOW - 2000 });

    // Act
    const body = await readJson(await harness.handlers.jobs(getRequest("jobs")));

    // Assert
    expect(body.jobs.map((job: { jobId: string }) => job.jobId)).toEqual([newest.jobId, middle.jobId, oldest.jobId]);
  });

  it("should skip folders that are not valid job ids or have no readable status", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await mkdir(path.join(harness.root, "jobs", "not-a-job"), { recursive: true });
    await mkdir(path.join(harness.root, "jobs", MISSING_JOB_ID), { recursive: true });

    // Act
    const body = await readJson(await harness.handlers.jobs(getRequest("jobs")));

    // Assert
    expect(body.jobs.map((job: { jobId: string }) => job.jobId)).toEqual([jobId]);
  });

  it("should mark a dead live-state job as stale in the summary", async () => {
    // Arrange: consume the once-sweep so the dead job is only listed, then list without closing it
    const harness = createHarness(await roots.create());
    await harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID }));
    const { jobId } = await makeJob(harness.root, {
      state: "RUNNING",
      mutate: (status) => {
        status.pid = 4444;
        status.heartbeatAt = iso(-10 * 60_000);
      },
    });
    harness.alivePids.add(4444);

    // Act
    const body = await readJson(await harness.handlers.jobs(getRequest("jobs")));

    // Assert
    expect(body.jobs[0]).toMatchObject({ jobId, state: "RUNNING", stale: false });
  });
});
