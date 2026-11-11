import { describe, expect, it, vi } from "vitest";
import { createCentrosAnepHandlers } from "@/modules/routine-jobs/api/centrosAnepHandlers";
import { createJobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";
import { plannedCentrosStepLabels } from "@/modules/routine-jobs/jobs/centros-anep/domain/plannedSteps";
import { CENTROS_CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/centros-anep/constants";
import type { CentrosResult } from "@/modules/routine-jobs/jobs/centros-anep/types";
import { centrosTablesBody } from "../centros-anep/centrosFixtures";

const BASE_URL = "http://localhost/api/modules/routine-jobs";
const NOW = 1_700_000_000_000;
const PASSWORD = "Centros-http-pw!4";
const CONFLICT = "Ya hay una carga de centros ANEP en curso para esta tabla.";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const bodyOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: centrosTablesBody(),
  dryRun: true,
  confirm: false,
  ...overrides,
});

const post = (body: unknown): Request =>
  new Request(`${BASE_URL}/centros-anep/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const get = (jobId: string): Request => new Request(`${BASE_URL}/centros-anep/status?jobId=${jobId}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(response: Response): Promise<any> {
  return response.json();
}

const finished = (overrides: Partial<CentrosResult> = {}): CentrosResult =>
  ({ outcomeUnknown: false, dryRun: true, warnings: [], ...overrides }) as unknown as CentrosResult;

function harnessOf(run: () => Promise<CentrosResult>) {
  const store = createJobStore<CentrosResult>(() => NOW);
  const tracked: Promise<void>[] = [];
  const runSpy = vi.fn<(params: unknown) => Promise<CentrosResult>>(() => run());
  const handlers = createCentrosAnepHandlers({ store, run: runSpy, track: (task) => void tracked.push(task) });
  return {
    runSpy,
    handlers,
    start: (body: unknown) => handlers.startCentrosAnep(post(body)),
    status: (jobId: string) => handlers.readCentrosAnepStatus(get(jobId)),
    settle: async () => {
      await Promise.all(tracked);
    },
  };
}

describe("centros-anep handlers (CA-2)", () => {
  it("should answer 200 with a jobId and hand the parsed params to run", async () => {
    const harness = harnessOf(async () => finished());

    const response = await harness.start(bodyOf());
    await harness.settle();

    expect(response.status).toBe(200);
    expect((await jsonOf(response)).jobId).toEqual(expect.any(String));
    expect(harness.runSpy.mock.calls[0][0]).toMatchObject({ dryRun: true, tables: centrosTablesBody() });
  });

  it("should expose the planned dry run steps in the status and later the finished result", async () => {
    const gate = deferred<CentrosResult>();
    const harness = harnessOf(() => gate.promise);
    const started = await jsonOf(await harness.start(bodyOf()));

    const running = (await jsonOf(await harness.status(started.jobId))).job;
    gate.resolve(finished({ dryRun: true }));
    await harness.settle();
    const done = (await jsonOf(await harness.status(started.jobId))).job;

    expect(running.state).toBe("RUNNING");
    expect(running.steps).toEqual(plannedCentrosStepLabels({ dryRun: true }));
    expect(done.state).toBe("DONE");
    expect(done.result).toMatchObject({ dryRun: true });
  });

  it("should plan the full replace steps for a real run", async () => {
    const gate = deferred<CentrosResult>();
    const harness = harnessOf(() => gate.promise);
    const started = await jsonOf(await harness.start(bodyOf({ dryRun: false, confirm: true })));

    const view = (await jsonOf(await harness.status(started.jobId))).job;

    expect(view.steps).toEqual(plannedCentrosStepLabels({ dryRun: false }));
    expect(view.steps).toHaveLength(10);
    gate.resolve(finished({ dryRun: false }));
    await harness.settle();
  });

  it("should answer 409 with the Spanish message while the same final table is running", async () => {
    const gate = deferred<CentrosResult>();
    const harness = harnessOf(() => gate.promise);
    await harness.start(bodyOf());

    const second = await harness.start(bodyOf());

    expect(second.status).toBe(409);
    expect((await jsonOf(second)).error).toBe(CONFLICT);
    gate.resolve(finished());
    await harness.settle();
  });

  it("should answer 200 for another final table while the first is running", async () => {
    const gate = deferred<CentrosResult>();
    const harness = harnessOf(() => gate.promise);
    await harness.start(bodyOf());
    const tables = centrosTablesBody();
    tables["centros-anep-final"] = { schema: "carto", table: "otra_tabla" };

    const other = await harness.start(bodyOf({ tables }));

    expect(other.status).toBe(200);
    gate.resolve(finished());
    await harness.settle();
  });

  it("should answer 400 with the confirmation message for a real run without confirm and never run", async () => {
    const harness = harnessOf(async () => finished());

    const response = await harness.start(bodyOf({ dryRun: false, confirm: false }));

    expect(response.status).toBe(400);
    expect((await jsonOf(response)).error).toBe(CENTROS_CONFIRM_REQUIRED_MESSAGE);
    expect(harness.runSpy).not.toHaveBeenCalled();
  });

  it("should answer 400 for a body that is not valid JSON", async () => {
    const harness = harnessOf(async () => finished());

    const response = await harness.handlers.startCentrosAnep(
      new Request(`${BASE_URL}/centros-anep/start`, { method: "POST", body: "{no-json" })
    );

    expect(response.status).toBe(400);
    expect(harness.runSpy).not.toHaveBeenCalled();
  });

  it("should answer 400 for the same staging and final table", async () => {
    const harness = harnessOf(async () => finished());
    const tables = centrosTablesBody();
    tables["centros-anep-final"] = { ...tables["centros-anep-staging"] };

    const response = await harness.start(bodyOf({ tables }));

    expect(response.status).toBe(400);
    expect(harness.runSpy).not.toHaveBeenCalled();
  });

  it("should store the failure of the run as FAILED without the password", async () => {
    const harness = harnessOf(async () => {
      throw new Error(`falló la conexión con ${PASSWORD}`);
    });
    const started = await jsonOf(await harness.start(bodyOf()));
    await harness.settle();

    const view = (await jsonOf(await harness.status(started.jobId))).job;

    expect(view.state).toBe("FAILED");
    expect(JSON.stringify(view)).not.toContain(PASSWORD);
  });

  it("should answer 400 or 404 for a status request of an unknown job and never leak the password", async () => {
    const harness = harnessOf(async () => finished());

    const response = await harness.status("no-existe");

    expect([400, 404]).toContain(response.status);
    expect(JSON.stringify(await jsonOf(response))).not.toContain(PASSWORD);
  });
});
