import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createRoutineJobsClient,
  RoutineJobsApiError,
  STATUS_TIMEOUT_MS,
} from "@/modules/routine-jobs/ui/routineJobsClient";
import type { ActualizarJobStatusView, ClientConnection } from "@/modules/routine-jobs/ui/clientTypes";
import type { ActualizarTableRole } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { actualizarRequestOf, ACTUALIZAR_SECRET } from "../wizard/actualizarFixtures";

const BASE = "/api/m/routine-jobs";
const START_URL = `${BASE}/actualizar-padron/start`;
const STATUS_URL = `${BASE}/actualizar-padron/status`;
const CATALOG_COLUMNS_URL = `${BASE}/catalog/columns`;

const connection: ClientConnection = {
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "carto",
  password: ACTUALIZAR_SECRET,
};

const ACTUALIZAR_ROLES: readonly ActualizarTableRole[] = [
  "actualizar-staging",
  "actualizar-temp",
  "actualizar-padron",
  "actualizar-provincia",
  "actualizar-localidad",
];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type FetchMock = Mock<typeof fetch>;

const makeFetch = (response: Response | (() => Promise<Response>)): FetchMock =>
  vi.fn<typeof fetch>(async () => (typeof response === "function" ? response() : response));

const callOf = (fetchMock: FetchMock, index = 0) => {
  const [input, init] = fetchMock.mock.calls[index];
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
  return { url: String(input), init, body, method: init?.method ?? "GET" };
};

const catchError = async (work: () => Promise<unknown>): Promise<unknown> => {
  try {
    await work();
  } catch (error) {
    return error;
  }
  return undefined;
};

const jobBody: ActualizarJobStatusView = {
  jobId: "job-1",
  state: "RUNNING",
  step: null,
  dryRun: false,
  startedAt: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routineJobsClient (actualizar-padron)", () => {
  describe("listColumns with the actualizar roles", () => {
    it.each(ACTUALIZAR_ROLES)("AP-1: should POST the %s role as given to catalog/columns", async (role) => {
      const fetchMock = makeFetch(jsonResponse({ success: true, columns: [] }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.listColumns(connection, "carto", "padron_trabajo", role);

      const call = callOf(fetchMock);
      expect(call.url).toBe(CATALOG_COLUMNS_URL);
      expect(call.body).toEqual({ connection, schema: "carto", table: "padron_trabajo", role });
    });

    it("AP-1: should never put the password in the URL of a role check", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, columns: [] }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.listColumns(connection, "carto", "padron_trabajo", "actualizar-temp");

      expect(callOf(fetchMock).url).not.toContain(ACTUALIZAR_SECRET);
    });
  });

  describe("startActualizar", () => {
    it("AP-20: should POST the whole request to actualizar-padron/start and return the jobId", async () => {
      const request = actualizarRequestOf();
      const fetchMock = makeFetch(jsonResponse({ success: true, jobId: "job-9" }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      const result = await client.startActualizar(request);

      const call = callOf(fetchMock);
      expect(result).toEqual({ jobId: "job-9" });
      expect(call.url).toBe(START_URL);
      expect(call.method).toBe("POST");
      expect(new Headers(call.init?.headers).get("content-type")).toContain("application/json");
      expect(call.body).toEqual(structuredClone(request));
    });

    it("AP-20: should send a dry run with confirm false untouched", async () => {
      const request = actualizarRequestOf({ dryRun: true, confirm: false });
      const fetchMock = makeFetch(jsonResponse({ success: true, jobId: "job-9" }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.startActualizar(request);

      expect(callOf(fetchMock).body).toMatchObject({ dryRun: true, confirm: false });
    });

    it("AP-24: should keep the password out of the URL", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, jobId: "job-9" }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.startActualizar(actualizarRequestOf());

      expect(callOf(fetchMock).url).not.toContain(ACTUALIZAR_SECRET);
    });

    it("AP-18: should throw RoutineJobsApiError 409 with the Spanish server message on conflict", async () => {
      const fetchMock = makeFetch(
        jsonResponse({ success: false, error: "Ya hay una actualización en curso para esta tabla." }, 409),
      );
      const client = createRoutineJobsClient({ fetch: fetchMock });

      const error = await catchError(() => client.startActualizar(actualizarRequestOf()));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(409);
      expect((error as RoutineJobsApiError).message).toBe("Ya hay una actualización en curso para esta tabla.");
    });

    it("AP-20: should throw a RoutineJobsApiError when a 200 answer carries no jobId", async () => {
      const client = createRoutineJobsClient({ fetch: makeFetch(jsonResponse({ success: true })) });

      const error = await catchError(() => client.startActualizar(actualizarRequestOf()));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).message.trim().length).toBeGreaterThan(0);
    });

    it("AP-24: should never echo the password when the start request fails", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: "Error de conexión con la base." }, 500)),
      });

      const error = await catchError(() => client.startActualizar(actualizarRequestOf()));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect(String((error as Error).message)).not.toContain(ACTUALIZAR_SECRET);
    });
  });

  describe("readActualizarStatus", () => {
    it("AP-21: should GET actualizar-padron/status with the encoded jobId and no body", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, job: jobBody }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.readActualizarStatus("job 1/a");

      const call = callOf(fetchMock);
      expect(call.url).toBe(`${STATUS_URL}?jobId=job%201%2Fa`);
      expect(call.method).toBe("GET");
      expect(call.body).toBeUndefined();
    });

    it("AP-21: should unwrap the job from the response", async () => {
      const client = createRoutineJobsClient({ fetch: makeFetch(jsonResponse({ success: true, job: jobBody })) });

      await expect(client.readActualizarStatus("job-1")).resolves.toEqual(jobBody);
    });

    it("AP-21: should keep the server planned steps and the report of a DONE job", async () => {
      const done = { ...jobBody, state: "DONE", steps: ["Validar tablas y columnas"], result: { dryRun: true } };
      const client = createRoutineJobsClient({ fetch: makeFetch(jsonResponse({ success: true, job: done })) });

      const job = await client.readActualizarStatus("job-1");

      expect(job.steps).toEqual(["Validar tablas y columnas"]);
      expect(job.result).toEqual({ dryRun: true });
    });

    it("AP-21: should throw RoutineJobsApiError 404 for an unknown job", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: "Trabajo no encontrado." }, 404)),
      });

      const error = await catchError(() => client.readActualizarStatus("nope"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(404);
    });

    it("AP-21: should throw a RoutineJobsApiError when the answer carries no job object", async () => {
      const client = createRoutineJobsClient({ fetch: makeFetch(jsonResponse({ success: true })) });

      const error = await catchError(() => client.readActualizarStatus("job-1"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
    });
  });

  describe("readActualizarStatus timeout", () => {
    interface FakeTimers {
      setTimer: Mock<(callback: () => void, ms: number) => unknown>;
      clearTimer: Mock<(handle: unknown) => void>;
      fire: () => void;
    }

    function fakeTimers(): FakeTimers {
      let pending: (() => void) | null = null;
      return {
        setTimer: vi.fn((callback: () => void) => {
          pending = callback;
          return "timer-handle";
        }),
        clearTimer: vi.fn(),
        fire: () => pending?.(),
      };
    }

    const hangingFetch = (): Mock<typeof fetch> =>
      vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );

    it("AP-33: should arm the timer with STATUS_TIMEOUT_MS and pass an abort signal to fetch", async () => {
      const timers = fakeTimers();
      const fetchMock = makeFetch(jsonResponse({ success: true, job: jobBody }));
      const client = createRoutineJobsClient({ fetch: fetchMock, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

      await client.readActualizarStatus("job-1");

      expect(STATUS_TIMEOUT_MS).toBe(15000);
      expect(timers.setTimer.mock.calls[0][1]).toBe(STATUS_TIMEOUT_MS);
      expect(callOf(fetchMock).init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("AP-33: should abort a hung request when the timer fires and reject with a Spanish timeout error", async () => {
      const timers = fakeTimers();
      const client = createRoutineJobsClient({ fetch: hangingFetch(), setTimer: timers.setTimer, clearTimer: timers.clearTimer });

      const pendingRead = catchError(() => client.readActualizarStatus("job-1"));
      timers.fire();
      const error = await pendingRead;

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(0);
      expect((error as RoutineJobsApiError).message).toMatch(/tardó/);
    });

    it("AP-33: should clear the timer when the answer arrives in time", async () => {
      const timers = fakeTimers();
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: true, job: jobBody })),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });

      await client.readActualizarStatus("job-1");

      expect(timers.clearTimer).toHaveBeenCalledWith("timer-handle");
    });

    it("AP-33: should not give startActualizar the short status timeout", async () => {
      const timers = fakeTimers();
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: true, jobId: "job-1" })),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });

      await client.startActualizar(actualizarRequestOf());

      expect(timers.setTimer).not.toHaveBeenCalled();
    });
  });
});
