import { describe, expect, it, vi } from "vitest";
import { createStageJobHandlers, type StageJobDefinition, type StageJobParams } from "@/modules/routine-jobs/api/stageJobHandlers";
import { tableLockKey } from "@/modules/routine-jobs/api/jobHttp";
import { parseConnection, readBoolean, readRequiredText, toDbConfig, type JsonRecord } from "@/modules/routine-jobs/api/requestParsing";
import { createJobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";
import type { RunDeps, RunProgress } from "@/modules/routine-jobs/jobs/cargar-padrones/types";

const BASE_URL = "http://localhost/api/modules/routine-jobs";
const NOW = 1_700_000_000_000;
const PASSWORD = "Stage-pw!5";
const CONFLICT = "Ya hay una prueba en curso para esta tabla.";
const SCHEMA = "carto";

interface FakeParams extends StageJobParams {
  table: string;
}

type FakeResult = { outcomeUnknown: boolean };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const parseFake = (body: JsonRecord): FakeParams => ({
  config: toDbConfig(parseConnection(body)),
  table: readRequiredText(body, "table"),
  dryRun: readBoolean(body, "dryRun"),
});

const definitionOf = (run: StageJobDefinition<FakeParams, FakeResult>["run"]): StageJobDefinition<FakeParams, FakeResult> => ({
  namespace: "stage-job-test",
  conflictMessage: CONFLICT,
  parse: parseFake,
  lockKeysOf: (params) => [tableLockKey(params.config, SCHEMA, params.table)],
  plannedSteps: (params) => [`Leer ${params.table}`, params.dryRun ? "Revertir" : "Confirmar"],
  run,
});

const bodyOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  table: "tabla_a",
  dryRun: false,
  ...overrides,
});

const startRequest = (body: unknown): Request =>
  new Request(`${BASE_URL}/stage/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const statusRequest = (jobId?: string): Request =>
  new Request(`${BASE_URL}/stage/status${jobId === undefined ? "" : `?jobId=${encodeURIComponent(jobId)}`}`);

async function jsonOf(response: Response): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return response.json();
}

function harnessOf(run: (params: FakeParams, deps: RunDeps, onProgress: (progress: RunProgress) => void) => Promise<FakeResult>) {
  const store = createJobStore<FakeResult>(() => NOW);
  const tracked: Promise<void>[] = [];
  const runSpy = vi.fn(run);
  const handlers = createStageJobHandlers<FakeParams, FakeResult>(definitionOf(runSpy), {
    store,
    track: (task) => void tracked.push(task),
  });
  return {
    store,
    runSpy,
    start: (body: unknown) => handlers.start(startRequest(body)),
    status: (jobId?: string) => handlers.status(statusRequest(jobId)),
    settle: async () => {
      await Promise.all(tracked);
    },
  };
}

const finishing = async (): Promise<FakeResult> => ({ outcomeUnknown: false });

describe("createStageJobHandlers start", () => {
  it("should answer 200 with a jobId and call run with the parsed params and the run dependencies", async () => {
    const harness = harnessOf(finishing);

    const response = await harness.start(bodyOf());
    await harness.settle();

    expect(response.status).toBe(200);
    expect((await jsonOf(response)).success).toBe(true);
    expect(harness.runSpy).toHaveBeenCalledTimes(1);
    const [params, deps] = harness.runSpy.mock.calls[0];
    expect(params).toMatchObject({ table: "tabla_a", dryRun: false });
    expect(deps).toMatchObject({ openSession: expect.any(Function), now: expect.any(Function) });
  });

  it("should answer 409 with the definition's conflict message while the same table is running", async () => {
    const gate = deferred<FakeResult>();
    const harness = harnessOf(() => gate.promise);
    await harness.start(bodyOf());

    const second = await harness.start(bodyOf());

    expect(second.status).toBe(409);
    expect(await jsonOf(second)).toEqual({ success: false, error: CONFLICT });
    gate.resolve({ outcomeUnknown: false });
    await harness.settle();
  });

  it("should answer 200 for a different table while another table is running", async () => {
    const gate = deferred<FakeResult>();
    const harness = harnessOf(() => gate.promise);
    await harness.start(bodyOf());

    const other = await harness.start(bodyOf({ table: "tabla_b" }));

    expect(other.status).toBe(200);
    gate.resolve({ outcomeUnknown: false });
    await harness.settle();
  });

  it("should answer 409 for a dry run of a table whose real run is running, because the lock ignores the mode", async () => {
    const gate = deferred<FakeResult>();
    const harness = harnessOf(() => gate.promise);
    await harness.start(bodyOf());

    const dry = await harness.start(bodyOf({ dryRun: true }));

    expect(dry.status).toBe(409);
    gate.resolve({ outcomeUnknown: false });
    await harness.settle();
  });

  it("should answer 400 and take no lock when the body is invalid, so a valid start still works", async () => {
    const harness = harnessOf(finishing);
    const invalid = bodyOf();
    delete invalid.table;

    const rejected = await harness.start(invalid);
    const valid = await harness.start(bodyOf());
    await harness.settle();

    expect(rejected.status).toBe(400);
    expect((await jsonOf(rejected)).error).toMatch(/table/);
    expect(valid.status).toBe(200);
  });

  it("should answer 400 for a body that is not JSON and run nothing", async () => {
    const harness = harnessOf(finishing);

    const response = await harness.start("{no json");

    expect(response.status).toBe(400);
    expect(harness.runSpy).not.toHaveBeenCalled();
  });

  it("should release the lock when the run succeeds so the same table can start again", async () => {
    const harness = harnessOf(finishing);
    await harness.start(bodyOf());
    await harness.settle();

    const again = await harness.start(bodyOf());
    await harness.settle();

    expect(again.status).toBe(200);
  });

  it("should release the lock when the run fails so the same table can start again", async () => {
    const harness = harnessOf(async () => {
      throw new Error("fallo");
    });
    await harness.start(bodyOf());
    await harness.settle();

    const again = await harness.start(bodyOf());
    await harness.settle();

    expect(again.status).toBe(200);
  });

  it("should never echo the password in the start or conflict responses", async () => {
    const gate = deferred<FakeResult>();
    const harness = harnessOf(() => gate.promise);
    const started = await harness.start(bodyOf());
    const conflict = await harness.start(bodyOf());

    expect(await started.clone().text()).not.toContain(PASSWORD);
    expect(await conflict.clone().text()).not.toContain(PASSWORD);
    gate.resolve({ outcomeUnknown: false });
    await harness.settle();
  });
});

describe("createStageJobHandlers status", () => {
  it("should expose the planned steps of the started job in order", async () => {
    const gate = deferred<FakeResult>();
    const harness = harnessOf(() => gate.promise);
    const started = await jsonOf(await harness.start(bodyOf({ dryRun: true })));

    const view = (await jsonOf(await harness.status(started.jobId))).job;

    expect(view.steps).toEqual(["Leer tabla_a", "Revertir"]);
    expect(view.dryRun).toBe(true);
    gate.resolve({ outcomeUnknown: false });
    await harness.settle();
  });

  it("should expose the DONE state and the result once the run finishes", async () => {
    const harness = harnessOf(finishing);
    const started = await jsonOf(await harness.start(bodyOf()));
    await harness.settle();

    const view = (await jsonOf(await harness.status(started.jobId))).job;

    expect(view.state).toBe("DONE");
    expect(view.result).toEqual({ outcomeUnknown: false });
  });

  it("should answer 404 for an unknown job id", async () => {
    const harness = harnessOf(finishing);

    expect((await harness.status("no-existe")).status).toBe(404);
  });

  it("should answer 400 when the jobId is missing", async () => {
    const harness = harnessOf(finishing);

    expect((await harness.status()).status).toBe(400);
  });

  it("should scrub the password from the error of a failed run", async () => {
    const harness = harnessOf(async () => {
      throw new Error(`clave ${PASSWORD} rechazada`);
    });
    const started = await jsonOf(await harness.start(bodyOf()));
    await harness.settle();

    const view = (await jsonOf(await harness.status(started.jobId))).job;

    expect(view.state).toBe("FAILED");
    expect(view.error).not.toContain(PASSWORD);
    expect(view.error).toContain("***");
  });
});
