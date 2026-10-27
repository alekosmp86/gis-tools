import { describe, it, expect, vi } from "vitest";
import {
  createActualizarPadronHandlers,
  type ActualizarPadronHandlerDeps,
} from "@/modules/routine-jobs/api/actualizarPadronHandlers";
import { createJobStore, JobState, type JobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";
import { getCargarPadronesJobStore } from "@/modules/routine-jobs/jobs/cargar-padrones/services/jobStore";
import { CLEAR_MODE } from "@/modules/routine-jobs/jobs/cargar-padrones/constants";
import { plannedStepLabels, STEP } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";
import { SKIP_REASON } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronResult, SkippedReport } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { AnalyzeStatus } from "@/core/types/replace";

const PASSWORD = "Ac7ual!zar-pw";
const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const LOCK_KEY = "db.local:5432|gis|cat|padron_trabajo";
const CONFLICT_MESSAGE = "Ya hay una actualización en curso para esta tabla.";
const BASE_URL = "http://localhost/api/modules/routine-jobs";
const START_PATH = "actualizar-padron/start";
const STATUS_PATH = "actualizar-padron/status";
const REDACTION = "***";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
type RunFn = ActualizarPadronHandlerDeps["run"];

const emptySkippedReport = (): SkippedReport => ({
  byReason: Object.fromEntries(Object.values(SKIP_REASON).map((reason) => [reason, 0])) as SkippedReport["byReason"],
  byDepartment: [],
  byLocality: [],
  samples: [],
  collidingKeys: [],
  collidingKeyCount: 0,
});

const resultFixture = (overrides: Partial<ActualizarPadronResult> = {}): ActualizarPadronResult => ({
  dryRun: false,
  tempModified: true,
  padronModified: false,
  outcomeUnknown: false,
  totals: { rowsRead: 20, accepted: 18, written: 18, repaired: 1, skipped: 2 },
  skipped: emptySkippedReport(),
  warnings: [],
  stepTimings: [],
  analyze: { status: AnalyzeStatus.OK },
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const jsonRequest = (path: string, body: unknown): Request =>
  new Request(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const statusRequest = (query: string): Request => new Request(`${BASE_URL}/${STATUS_PATH}${query}`);

const connectionBody = (): Body => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: PASSWORD,
});

const startBody = (): Body => ({
  connection: connectionBody(),
  stagingSchema: "cat",
  stagingTable: "catastro_paispadron_stg",
  workSchema: "cat",
  workTable: "padron_trabajo",
  padronTable: "catastro_paispadron",
  provinceTable: "province",
  localityTable: "cadastral_locality",
  options: { clearMode: "delete" },
  dryRun: false,
  confirm: true,
});

const mutated = (patch: (body: Body) => void): Body => {
  const body = startBody();
  patch(body);
  return body;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bodyOf(response: Response): Promise<any> {
  return response.json();
}

async function textOf(response: Response): Promise<string> {
  return response.clone().text();
}

const SPANISH_WORD = /\b(el|la|los|las|de|del|debe|no|es|un|una|con|para|en)\b/i;

async function expectSpanishError(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  const body = await bodyOf(response.clone());
  expect(body.success).toBe(false);
  expect(body.error).toBeTypeOf("string");
  expect(body.error).toMatch(SPANISH_WORD);
  expect(await textOf(response)).not.toContain(PASSWORD);
}

function gated() {
  const gate = deferred<ActualizarPadronResult>();
  const started = deferred<void>();
  const run: RunFn = async () => {
    started.resolve();
    return gate.promise;
  };
  return { gate, started, run };
}

function createWiring(options: { store?: JobStore<ActualizarPadronResult>; run?: RunFn } = {}) {
  const store = options.store ?? createJobStore<ActualizarPadronResult>(() => NOW);
  const run = vi.fn<RunFn>(options.run ?? (async () => resultFixture()));
  const tracked: Promise<void>[] = [];
  const handlers = createActualizarPadronHandlers({
    store,
    run,
    track: (task: Promise<void>) => void tracked.push(task),
  });
  const tryStart = vi.spyOn(store, "tryStart");
  return {
    store,
    run,
    handlers,
    tryStart,
    settle: async (): Promise<void> => {
      await Promise.all(tracked);
    },
    start: (body: unknown = startBody()) => handlers.startActualizarPadron(jsonRequest(START_PATH, body)),
    status: async (query: string) => handlers.readActualizarPadronStatus(statusRequest(query)),
  };
}

describe("createActualizarPadronHandlers", () => {
  describe("startActualizarPadron (AP-20)", () => {
    it("should answer 200 with success and a jobId at once, while the run is still pending", async () => {
      const { gate, started, run } = gated();
      const wiring = createWiring({ run });

      const response = await wiring.start();
      await started.promise;

      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      expect(body.success).toBe(true);
      expect(body.jobId).toBeTypeOf("string");
      expect(wiring.store.get(body.jobId)?.state).toBe(JobState.RUNNING);
      gate.resolve(resultFixture());
      await wiring.settle();
    });

    it("should call run with the parsed params including the password, and a progress callback", async () => {
      const wiring = createWiring();

      await wiring.start();
      await wiring.settle();

      expect(wiring.run).toHaveBeenCalledTimes(1);
      const [params, onProgress] = wiring.run.mock.calls[0];
      expect(params.config.password).toBe(PASSWORD);
      expect(params.config.host).toBe("db.local");
      expect(params.workTable).toBe("padron_trabajo");
      expect(params.stagingTable).toBe("catastro_paispadron_stg");
      expect(params.options).toEqual({ clearMode: CLEAR_MODE.DELETE });
      expect(params.dryRun).toBe(false);
      expect(typeof onProgress).toBe("function");
    });

    it("should hand run the truncate clear mode when the request sends it", async () => {
      const wiring = createWiring();

      await wiring.start(mutated((body) => (body.options.clearMode = CLEAR_MODE.TRUNCATE)));
      await wiring.settle();

      expect(wiring.run.mock.calls[0][0].options).toEqual({ clearMode: CLEAR_MODE.TRUNCATE });
    });

    it("should take the lock with the host:port|db|workSchema|workTable key, the dryRun flag and the planned steps", async () => {
      const wiring = createWiring();

      await wiring.start();
      await wiring.settle();

      expect(wiring.tryStart).toHaveBeenCalledWith(
        LOCK_KEY,
        false,
        plannedStepLabels({ dryRun: false, clearMode: CLEAR_MODE.DELETE })
      );
    });

    it("should include the count and privileges steps in the planned steps of a truncate run", async () => {
      const wiring = createWiring();

      await wiring.start(mutated((body) => (body.options.clearMode = CLEAR_MODE.TRUNCATE)));
      await wiring.settle();

      expect(wiring.tryStart).toHaveBeenCalledWith(
        LOCK_KEY,
        false,
        [
          STEP.VALIDATE,
          STEP.COUNT,
          STEP.PRIVILEGES,
          STEP.CLEAR,
          STEP.RESOLVE,
          STEP.LOAD,
          STEP.ANALYZE,
          STEP.REPORT,
          STEP.COMMIT,
        ]
      );
    });

    it("should take the lock with dryRun true and a rollback step on a dry run", async () => {
      const wiring = createWiring();

      const response = await wiring.start(mutated((body) => ((body.dryRun = true), (body.confirm = false))));
      await wiring.settle();

      expect(response.status).toBe(200);
      expect(wiring.tryStart).toHaveBeenCalledWith(
        LOCK_KEY,
        true,
        plannedStepLabels({ dryRun: true, clearMode: CLEAR_MODE.DELETE })
      );
      expect(wiring.tryStart.mock.calls[0][2]).toContain(STEP.ROLLBACK);
    });

    it("should normalise the host of the key by trimming and lower-casing it", async () => {
      const wiring = createWiring();

      await wiring.start(mutated((body) => (body.connection.host = "  DB.Local  ")));
      await wiring.settle();

      expect(wiring.tryStart.mock.calls[0][0]).toBe(LOCK_KEY);
    });

    it("should key the lock on the work table and not on the staging table", async () => {
      const { gate, run } = gated();
      const wiring = createWiring({ run });
      await wiring.start();

      const second = await wiring.start(mutated((body) => (body.stagingTable = "otra_staging")));
      gate.resolve(resultFixture());
      await wiring.settle();

      expect(second.status).toBe(409);
    });

    it("should grant two starts on different work tables of the same database", async () => {
      const wiring = createWiring({ run: gated().run });

      const first = await wiring.start();
      const second = await wiring.start(mutated((body) => (body.workTable = "padron_otro")));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it("should grant two starts on the same table name in different work schemas", async () => {
      const wiring = createWiring({ run: gated().run });

      const first = await wiring.start();
      const second = await wiring.start(
        mutated((body) => {
          body.workSchema = "otro_esquema";
          body.padronTable = "catastro_paispadron";
        })
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it("should answer 409 with the Spanish conflict message while a job is RUNNING for the same work table", async () => {
      const { run } = gated();
      const wiring = createWiring({ run });
      await wiring.start();

      const response = await wiring.start();

      expect(response.status).toBe(409);
      const body = await bodyOf(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe(CONFLICT_MESSAGE);
      expect(body.jobId).toBeUndefined();
      expect(wiring.run).toHaveBeenCalledTimes(1);
    });

    it("should answer 409 for a dry run while a real run of the same work table is RUNNING", async () => {
      const { run } = gated();
      const wiring = createWiring({ run });
      await wiring.start();

      const response = await wiring.start(mutated((body) => ((body.dryRun = true), (body.confirm = false))));

      expect(response.status).toBe(409);
    });

    it("should answer 409 for the same work table when the host differs only by case and spaces", async () => {
      const { run } = gated();
      const wiring = createWiring({ run });
      await wiring.start();

      const response = await wiring.start(mutated((body) => (body.connection.host = " DB.LOCAL ")));

      expect(response.status).toBe(409);
    });

    it("should release the lock when the run fails so a new start works", async () => {
      const wiring = createWiring({ run: async () => Promise.reject(new Error("fallo")) });
      const first = await wiring.start();
      await wiring.settle();

      const second = await wiring.start();
      await wiring.settle();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it("should release the lock when the run succeeds so a new start works", async () => {
      const wiring = createWiring();
      await wiring.start();
      await wiring.settle();

      const second = await wiring.start();
      await wiring.settle();

      expect(second.status).toBe(200);
    });

    it("should answer 400 with a Spanish message before taking the lock when a real run has no confirm", async () => {
      const wiring = createWiring();

      const response = await wiring.start(mutated((body) => (body.confirm = false)));
      await wiring.settle();

      await expectSpanishError(response, 400);
      expect(wiring.tryStart).not.toHaveBeenCalled();
      expect(wiring.run).not.toHaveBeenCalled();
    });

    it("should accept a dry run with confirm false", async () => {
      const wiring = createWiring();

      const response = await wiring.start(mutated((body) => ((body.dryRun = true), (body.confirm = false))));
      await wiring.settle();

      expect(response.status).toBe(200);
      expect(wiring.run.mock.calls[0][0].dryRun).toBe(true);
    });

    it("should accept an empty password string and hand it to run", async () => {
      const wiring = createWiring();

      const response = await wiring.start(mutated((body) => (body.connection.password = "")));
      await wiring.settle();

      expect(response.status).toBe(200);
      expect(wiring.run.mock.calls[0][0].config.password).toBe("");
    });

    it("should never put the password in the start response", async () => {
      const wiring = createWiring();

      const response = await wiring.start();
      await wiring.settle();

      expect(await textOf(response)).not.toContain(PASSWORD);
    });

    it("should never keep the password in the stored snapshot, even when the result echoes it", async () => {
      const wiring = createWiring({
        run: async () => resultFixture({ warnings: [`Contraseña usada: ${PASSWORD}`] }),
      });
      const response = await wiring.start();
      await wiring.settle();
      const jobId = (await bodyOf(response)).jobId;

      expect(JSON.stringify(wiring.store.get(jobId))).not.toContain(PASSWORD);
    });

    it("should sweep finished jobs older than one hour on start", async () => {
      let clock = NOW;
      const store = createJobStore<ActualizarPadronResult>(() => clock);
      const sweep = vi.spyOn(store, "sweep");
      const wiring = createWiring({ store });
      const first = await wiring.start(mutated((body) => (body.workTable = "tabla_vieja")));
      await wiring.settle();
      const oldJobId = (await bodyOf(first)).jobId;
      clock = NOW + HOUR_MS + 1;

      await wiring.start(mutated((body) => (body.workTable = "tabla_nueva")));
      await wiring.settle();

      expect(sweep).toHaveBeenCalledWith(HOUR_MS);
      expect(store.get(oldJobId)).toBeUndefined();
    });

    it("should answer 500 with a generic Spanish message and no password when the store fails to start a job", async () => {
      const store = createJobStore<ActualizarPadronResult>(() => NOW);
      vi.spyOn(store, "tryStart").mockImplementation(() => {
        throw new Error(`fallo interno con ${PASSWORD}`);
      });
      const wiring = createWiring({ store });

      const response = await wiring.start();

      expect(response.status).toBe(500);
      const text = await textOf(response);
      const body = JSON.parse(text);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(SPANISH_WORD);
      expect(text).not.toContain(PASSWORD);
      expect(wiring.run).not.toHaveBeenCalled();
    });
  });

  describe("startActualizarPadron validation (AP-3, AP-20)", () => {
    const invalidCases: Array<{ name: string; body: unknown }> = [
      { name: "the body is not valid JSON", body: "{not json" },
      { name: "the body is a JSON array", body: [] },
      { name: "the body is JSON null", body: null },
      { name: "stagingSchema is missing", body: mutated((body) => delete body.stagingSchema) },
      { name: "workTable is blank", body: mutated((body) => (body.workTable = "   ")) },
      { name: "padronTable is not a string", body: mutated((body) => (body.padronTable = 7)) },
      { name: "clearMode is unknown", body: mutated((body) => (body.options.clearMode = "drop")) },
      { name: "dryRun is missing", body: mutated((body) => delete body.dryRun) },
      { name: "confirm is missing", body: mutated((body) => delete body.confirm) },
      { name: "the work table is repeated as the province table", body: mutated((body) => (body.provinceTable = body.workTable)) },
      { name: "the staging table is repeated as the work table", body: mutated((body) => ((body.stagingSchema = "cat"), (body.stagingTable = body.workTable))) },
      { name: "the connection is missing", body: mutated((body) => delete body.connection) },
    ];

    it.each(invalidCases)("should answer 400 in Spanish, without the lock or run, when $name", async ({ body }) => {
      const wiring = createWiring();

      const response = await wiring.start(body);
      await wiring.settle();

      await expectSpanishError(response, 400);
      expect((await bodyOf(response.clone())).jobId).toBeUndefined();
      expect(wiring.tryStart).not.toHaveBeenCalled();
      expect(wiring.run).not.toHaveBeenCalled();
    });

    it("should let a valid start work after an invalid one for the same work table", async () => {
      const wiring = createWiring();
      await wiring.start(mutated((body) => (body.confirm = false)));

      const valid = await wiring.start();
      await wiring.settle();

      expect(valid.status).toBe(200);
      expect(wiring.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("progress and outcome", () => {
    it("should feed the store with every progress report of the run", async () => {
      const wiring = createWiring({
        run: async (_params, onProgress) => {
          onProgress({ label: STEP.VALIDATE, current: 1, total: 8 });
          onProgress({ label: STEP.COUNT, current: 2, total: 8 });
          return resultFixture();
        },
      });
      const progress = vi.spyOn(wiring.store, "progress");

      await wiring.start();
      await wiring.settle();

      expect(progress).toHaveBeenCalledWith(expect.any(String), { label: STEP.VALIDATE, current: 1, total: 8 });
      expect(progress).toHaveBeenCalledWith(expect.any(String), { label: STEP.COUNT, current: 2, total: 8 });
    });

    it("should mark the job DONE with the result when run resolves", async () => {
      const result = resultFixture({ warnings: ["aviso"] });
      const wiring = createWiring({ run: async () => result });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(job?.state).toBe(JobState.DONE);
      expect(job?.result).toEqual(result);
      expect(job?.finishedAt).toBe(NOW);
    });

    it("should keep a result with outcomeUnknown as DONE with that flag, not FAILED", async () => {
      const wiring = createWiring({ run: async () => resultFixture({ outcomeUnknown: true, tempModified: false }) });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(job?.state).toBe(JobState.DONE);
      expect(job?.outcomeUnknown).toBe(true);
    });

    it("should mark the job FAILED with the message when run rejects", async () => {
      const wiring = createWiring({ run: async () => Promise.reject(new Error("La tabla no existe.")) });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(job?.state).toBe(JobState.FAILED);
      expect(job?.error).toBe("La tabla no existe.");
    });

    it("should scrub the password from the error and from the progress label of a failed run", async () => {
      const wiring = createWiring({
        run: async (_params, onProgress) => {
          onProgress({ label: `Conexión con ${PASSWORD}`, current: 1, total: 8 });
          throw new Error(`Fallo con la clave ${PASSWORD}`);
        },
      });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(job?.state).toBe(JobState.FAILED);
      expect(job?.error).toBe(`Fallo con la clave ${REDACTION}`);
      expect(job?.step).toBe(`Conexión con ${REDACTION}`);
      expect(JSON.stringify(job)).not.toContain(PASSWORD);
    });

    it("should scrub the password from every field of a DONE result", async () => {
      const wiring = createWiring({
        run: async () =>
          resultFixture({
            warnings: [`Aviso ${PASSWORD}`],
            skipped: {
              ...emptySkippedReport(),
              samples: [{ department: PASSWORD, locality: null, padron: "1", reason: SKIP_REASON.CLAVE_NULA }],
            },
          }),
      });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(JSON.stringify(job?.result)).not.toContain(PASSWORD);
      expect(job?.result?.warnings).toEqual([`Aviso ${REDACTION}`]);
    });

    it("should mark the job FAILED, scrubbed, when run rejects with a non-Error value", async () => {
      const wiring = createWiring({ run: async () => Promise.reject(`fallo ${PASSWORD}`) });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(job?.state).toBe(JobState.FAILED);
      expect(job?.error).not.toContain(PASSWORD);
    });

    it("should mark the job FAILED when run throws synchronously", async () => {
      const wiring = createWiring({
        run: (() => {
          throw new Error("error síncrono");
        }) as RunFn,
      });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(job?.state).toBe(JobState.FAILED);
      expect(job?.error).toBe("error síncrono");
    });

    it("should keep the run going and end DONE when store.progress throws", async () => {
      const store = createJobStore<ActualizarPadronResult>(() => NOW);
      vi.spyOn(store, "progress").mockImplementation(() => {
        throw new Error("progreso caído");
      });
      const wiring = createWiring({
        store,
        run: async (_params, onProgress) => {
          onProgress({ label: STEP.VALIDATE, current: 1, total: 8 });
          return resultFixture();
        },
      });
      const response = await wiring.start();
      await wiring.settle();

      expect(wiring.store.get((await bodyOf(response)).jobId)?.state).toBe(JobState.DONE);
    });

    it("should end FAILED with a scrubbed message and free the lock when store.finish throws", async () => {
      const store = createJobStore<ActualizarPadronResult>(() => NOW);
      vi.spyOn(store, "finish").mockImplementation(() => {
        throw new Error(`no se pudo guardar ${PASSWORD}`);
      });
      const wiring = createWiring({ store });
      const response = await wiring.start();
      await wiring.settle();

      const job = wiring.store.get((await bodyOf(response)).jobId);

      expect(job?.state).toBe(JobState.FAILED);
      expect(job?.error).not.toContain(PASSWORD);
      expect(store.tryStart(LOCK_KEY)).not.toBeNull();
    });
  });

  describe("readActualizarPadronStatus (AP-21)", () => {
    it("should answer 200 with success and the job view including steps, dryRun and the result fields", async () => {
      const wiring = createWiring();
      const response = await wiring.start();
      await wiring.settle();
      const jobId = (await bodyOf(response)).jobId;

      const statusResponse = await wiring.status(`?jobId=${encodeURIComponent(jobId)}`);

      expect(statusResponse.status).toBe(200);
      const body = await bodyOf(statusResponse);
      expect(body.success).toBe(true);
      expect(body.job).toMatchObject({
        jobId,
        state: JobState.DONE,
        dryRun: false,
        steps: plannedStepLabels({ dryRun: false, clearMode: CLEAR_MODE.DELETE }),
      });
      expect(body.job).toHaveProperty("step");
      expect(body.job).toHaveProperty("startedAt");
      expect(body.job).toHaveProperty("finishedAt");
      expect(body.job.result.totals).toEqual({ rowsRead: 20, accepted: 18, written: 18, repaired: 1, skipped: 2 });
    });

    it("should expose the planned steps of a dry run ending with the rollback step", async () => {
      const wiring = createWiring();
      const response = await wiring.start(mutated((body) => ((body.dryRun = true), (body.confirm = false))));
      await wiring.settle();
      const jobId = (await bodyOf(response)).jobId;

      const body = await bodyOf(await wiring.status(`?jobId=${jobId}`));

      expect(body.job.dryRun).toBe(true);
      expect(body.job.steps.at(-1)).toBe(STEP.ROLLBACK);
      expect(body.job.steps).not.toContain(STEP.COMMIT);
    });

    it("should expose the Spanish step label with current and total while the run is RUNNING", async () => {
      const { gate, started } = gated();
      const wiring = createWiring({
        run: async (_params, onProgress) => {
          onProgress({ label: STEP.LOAD, current: 5, total: 8 });
          started.resolve();
          return gate.promise;
        },
      });
      const response = await wiring.start();
      await started.promise;
      const jobId = (await bodyOf(response)).jobId;

      const body = await bodyOf(await wiring.status(`?jobId=${jobId}`));

      expect(body.job).toMatchObject({ state: JobState.RUNNING, step: STEP.LOAD, current: 5, total: 8 });
      gate.resolve(resultFixture());
      await wiring.settle();
    });

    it("should expose the FAILED job with the scrubbed Spanish error", async () => {
      const wiring = createWiring({ run: async () => Promise.reject(new Error(`Fallo ${PASSWORD}`)) });
      const response = await wiring.start();
      await wiring.settle();
      const jobId = (await bodyOf(response)).jobId;

      const statusResponse = await wiring.status(`?jobId=${jobId}`);
      const text = await textOf(statusResponse);
      const body = JSON.parse(text);

      expect(body.job.state).toBe(JobState.FAILED);
      expect(body.job.error).toBe(`Fallo ${REDACTION}`);
      expect(text).not.toContain(PASSWORD);
    });

    it("should expose a DONE job with outcomeUnknown as DONE with the flag", async () => {
      const wiring = createWiring({ run: async () => resultFixture({ outcomeUnknown: true }) });
      const response = await wiring.start();
      await wiring.settle();
      const jobId = (await bodyOf(response)).jobId;

      const body = await bodyOf(await wiring.status(`?jobId=${jobId}`));

      expect(body.job.state).toBe(JobState.DONE);
      expect(body.job.outcomeUnknown).toBe(true);
    });

    it("should answer 400 in Spanish when jobId is missing", async () => {
      const wiring = createWiring();

      const response = await wiring.status("");

      await expectSpanishError(response, 400);
    });

    it("should answer 400 in Spanish when jobId is empty", async () => {
      const wiring = createWiring();

      const response = await wiring.status("?jobId=");

      await expectSpanishError(response, 400);
    });

    it("should answer 404 in Spanish for an unknown job id", async () => {
      const wiring = createWiring();

      const response = await wiring.status("?jobId=no-existe");

      await expectSpanishError(response, 404);
      expect((await bodyOf(response.clone())).error).toBe("No existe un trabajo con ese identificador.");
    });

    it("should answer 404 for a job that was swept as older than one hour", async () => {
      let clock = NOW;
      const store = createJobStore<ActualizarPadronResult>(() => clock);
      const wiring = createWiring({ store });
      const response = await wiring.start();
      await wiring.settle();
      const jobId = (await bodyOf(response)).jobId;
      clock = NOW + HOUR_MS + 1;

      const statusResponse = await wiring.status(`?jobId=${jobId}`);

      expect(statusResponse.status).toBe(404);
    });
  });

  describe("default stores", () => {
    it("should not let a RUNNING Cargar Padrones job on the same key answer 409 to an actualizar start", async () => {
      const cargarStore = getCargarPadronesJobStore();
      const cargarJob = cargarStore.tryStart(LOCK_KEY);
      const tracked: Promise<void>[] = [];
      const handlers = createActualizarPadronHandlers({
        run: async () => resultFixture(),
        track: (task: Promise<void>) => void tracked.push(task),
      });

      try {
        const response = await handlers.startActualizarPadron(jsonRequest(START_PATH, startBody()));
        await Promise.all(tracked);

        expect(cargarJob).not.toBeNull();
        expect(response.status).toBe(200);
      } finally {
        if (cargarJob) cargarStore.fail(cargarJob.jobId, "limpieza");
      }
    });
  });
});
