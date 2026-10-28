import { describe, expect, it, vi } from "vitest";
import { createCompletarUnidadTerritorialHandlers } from "@/modules/routine-jobs/api/completarUnidadTerritorialHandlers";
import { createJobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";
import { plannedCompletarStepLabels } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/plannedSteps";
import type { CompletarParams, CompletarResult } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import { COMPLETAR_PASSWORD, completarResultOf } from "./completarFixtures";

const BASE_URL = "http://localhost/api/modules/routine-jobs";
const NOW = 1_700_000_000_000;
const START_PATH = `${BASE_URL}/completar-unidad-territorial/start`;
const STATUS_PATH = `${BASE_URL}/completar-unidad-territorial/status`;
const CONFLICT_MESSAGE = "Ya hay un proceso de direcciones maestras de unidades territoriales en curso para estas tablas.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

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

const jsonRequest = (body: unknown): Request =>
  new Request(START_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const connectionBody = (overrides: Body = {}): Body => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: COMPLETAR_PASSWORD,
  ...overrides,
});

const startBody = (overrides: Body = {}): Body => ({
  connection: connectionBody(),
  unitSchema: "carto",
  unitTable: "territorial_unit",
  addressMasterSchema: "carto",
  addressMasterTable: "addresses_master",
  dryRun: false,
  confirm: true,
  ...overrides,
});

const UNIT_A = { unitSchema: "carto", unitTable: "unidades_a" };
const UNIT_B = { unitSchema: "carto", unitTable: "unidades_b" };
const ADDRESS_A = { addressMasterSchema: "carto", addressMasterTable: "direcciones_a" };
const ADDRESS_B = { addressMasterSchema: "carto", addressMasterTable: "direcciones_b" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bodyOf(response: Response): Promise<any> {
  return response.json();
}

function createHarness(runImpl?: (params: CompletarParams) => Promise<CompletarResult>) {
  const store = createJobStore<CompletarResult>(() => NOW);
  const run = vi.fn<(params: CompletarParams, onProgress: unknown) => Promise<CompletarResult>>(
    runImpl ? (params) => runImpl(params) : async () => completarResultOf(),
  );
  const tracked: Promise<void>[] = [];
  const handlers = createCompletarUnidadTerritorialHandlers({
    store,
    run: (params, onProgress) => run(params, onProgress),
    track: (task) => void tracked.push(task),
  });
  const start = (body: Body) => handlers.startCompletarUnidadTerritorial(jsonRequest(body));
  const status = (jobId: string) =>
    handlers.readCompletarUnidadTerritorialStatus(new Request(`${STATUS_PATH}?jobId=${encodeURIComponent(jobId)}`));
  const settle = async (): Promise<void> => {
    await Promise.all(tracked);
  };
  return { store, run, handlers, start, status, settle };
}

function gatedRun() {
  const gate = deferred<CompletarResult>();
  const started = deferred<void>();
  const impl = async (): Promise<CompletarResult> => {
    started.resolve();
    return gate.promise;
  };
  return { gate, started, impl };
}

describe("createCompletarUnidadTerritorialHandlers two-key lock (CU-10)", () => {
  it("should answer 200 with a jobId when a real run starts on two free tables", async () => {
    const harness = createHarness(gatedRun().impl);

    const response = await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));

    expect(response.status).toBe(200);
    expect((await bodyOf(response)).success).toBe(true);
  });

  it("should answer 409 when the same unit table and the same address master table are already running", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;

    const second = await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));

    expect(second.status).toBe(409);
    expect(await bodyOf(second)).toEqual({ success: false, error: CONFLICT_MESSAGE });
    gate.resolve(completarResultOf());
    await harness.settle();
  });

  it("should answer 409 when only the unit table is busy", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;

    const second = await harness.start(startBody({ ...UNIT_A, ...ADDRESS_B }));

    expect(second.status).toBe(409);
    gate.resolve(completarResultOf());
    await harness.settle();
  });

  it("should answer 409 when only the address master table is busy", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;

    const second = await harness.start(startBody({ ...UNIT_B, ...ADDRESS_A }));

    expect(second.status).toBe(409);
    gate.resolve(completarResultOf());
    await harness.settle();
  });

  it("should answer 200 when both tables are different from the running job", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;

    const second = await harness.start(startBody({ ...UNIT_B, ...ADDRESS_B }));

    expect(second.status).toBe(200);
    gate.resolve(completarResultOf());
    await harness.settle();
  });

  it("should answer 409 for a dry run while a real run of the same tables is running", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;

    const dry = await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A, dryRun: true, confirm: false }));

    expect(dry.status).toBe(409);
    gate.resolve(completarResultOf());
    await harness.settle();
  });

  it("should answer 200 for the same tables on another host, because the lock key includes the connection", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;

    const other = await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A, connection: connectionBody({ host: "otro.local" }) }));

    expect(other.status).toBe(200);
    gate.resolve(completarResultOf());
    await harness.settle();
  });

  it("should release both tables when the run finishes so the same tables can start again", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;
    gate.resolve(completarResultOf());
    await harness.settle();

    const again = await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));

    expect(again.status).toBe(200);
    await harness.settle();
  });

  it("should release both tables when the run fails so the same tables can start again", async () => {
    const failing = deferred<CompletarResult>();
    const started = deferred<void>();
    const harness = createHarness(async () => {
      started.resolve();
      return failing.promise;
    });
    await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));
    await started.promise;
    failing.reject(new Error("fallo"));
    await harness.settle();

    const again = await harness.start(startBody({ ...UNIT_A, ...ADDRESS_A }));

    expect(again.status).toBe(200);
    await harness.settle();
  });
});

describe("createCompletarUnidadTerritorialHandlers start validation", () => {
  it("should answer 400 and take no lock when the two tables are the same", async () => {
    const harness = createHarness();

    const response = await harness.start(startBody({ unitSchema: "carto", unitTable: "x", addressMasterSchema: "carto", addressMasterTable: "x" }));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatch(/distintas/);
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("should answer 400 with the confirmation text on a real run without confirm and run nothing", async () => {
    const harness = createHarness();

    const response = await harness.start(startBody({ confirm: false }));

    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toEqual({ success: false, error: expect.stringContaining("Confirme") });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("should answer 400 for a body that is not JSON", async () => {
    const harness = createHarness();

    const response = await harness.handlers.startCompletarUnidadTerritorial(
      new Request(START_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: "{no json" }),
    );

    expect(response.status).toBe(400);
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("should let a valid start work after an invalid one for the same tables, because the lock was not taken", async () => {
    const harness = createHarness();
    await harness.start(startBody({ confirm: false }));

    const valid = await harness.start(startBody());

    expect(valid.status).toBe(200);
    await harness.settle();
  });

  it("should answer 400 with the tables named in the message when a table is missing", async () => {
    const harness = createHarness();
    const body = startBody();
    delete body.addressMasterTable;

    const response = await harness.start(body);

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatch(/addressMasterTable/);
  });
});

describe("createCompletarUnidadTerritorialHandlers status and secrets", () => {
  it("should answer 200 with the planned steps of the started job, in order", async () => {
    const { gate, started, impl } = gatedRun();
    const harness = createHarness(impl);
    const body = await bodyOf(await harness.start(startBody({ dryRun: true, confirm: false })));
    await started.promise;

    const response = await harness.status(body.jobId);
    const view = (await bodyOf(response)).job;

    expect(response.status).toBe(200);
    expect(view.steps).toEqual(plannedCompletarStepLabels({ dryRun: true }));
    expect(view.dryRun).toBe(true);
    gate.resolve(completarResultOf({ dryRun: true, targetModified: false }));
    await harness.settle();
  });

  it("should answer 404 in Spanish for an unknown job id", async () => {
    const harness = createHarness();

    const response = await harness.status("no-existe");

    expect(response.status).toBe(404);
    expect((await bodyOf(response)).error).toBeTypeOf("string");
  });

  it("should answer 400 when the status request has no jobId", async () => {
    const harness = createHarness();

    const response = await harness.handlers.readCompletarUnidadTerritorialStatus(new Request(STATUS_PATH));

    expect(response.status).toBe(400);
  });

  it("should scrub the password from the error of a failed run in the status view", async () => {
    const harness = createHarness(async () => {
      throw new Error(`clave ${COMPLETAR_PASSWORD} rechazada`);
    });
    const body = await bodyOf(await harness.start(startBody()));
    await harness.settle();

    const view = (await bodyOf(await harness.status(body.jobId))).job;

    expect(view.state).toBe("FAILED");
    expect(view.error).not.toContain(COMPLETAR_PASSWORD);
    expect(view.error).toContain("***");
  });

  it("should never put the password in the start response", async () => {
    const harness = createHarness();

    const response = await harness.start(startBody());

    expect(await response.clone().text()).not.toContain(COMPLETAR_PASSWORD);
    await harness.settle();
  });
});
