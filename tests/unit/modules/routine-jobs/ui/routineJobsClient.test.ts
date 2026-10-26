import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createRoutineJobsClient, RoutineJobsApiError, STATUS_TIMEOUT_MS } from "@/modules/routine-jobs/ui/routineJobsClient";
import type { ClientConnection, JobStatusView, StartRequest } from "@/modules/routine-jobs/ui/clientTypes";

const PASSWORD = "s3cret-pw";
const BASE = "/api/m/routine-jobs";

const connection: ClientConnection = {
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "carto",
  password: PASSWORD,
};

const startRequest: StartRequest = {
  connection,
  schema: "carto",
  ruralTable: "rural",
  urbanoTable: "urbano",
  targetTable: "destino",
  options: { repair: true, clearMode: "delete", resetSequences: true },
  dryRun: false,
  confirm: true,
};

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routineJobsClient", () => {
  describe("listTables", () => {
    it("AC-4b: should POST connection and schema as JSON to catalog/tables", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, schemaExists: true, tables: [] }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.listTables(connection, "carto");

      const call = callOf(fetchMock);
      expect(call.url).toBe(`${BASE}/catalog/tables`);
      expect(call.method).toBe("POST");
      expect(new Headers(call.init?.headers).get("content-type")).toContain("application/json");
      expect(call.body).toEqual({ connection, schema: "carto" });
    });

    it("AC-4b: should unwrap the listing without the success flag", async () => {
      const tables = [
        { name: "rural", kind: "TABLE" },
        { name: "v_urbano", kind: "VIEW" },
      ];
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: true, schemaExists: true, tables })),
      });

      const listing = await client.listTables(connection, "carto");

      expect(listing).toEqual({ schemaExists: true, tables });
    });

    it("AC-4b: should return schemaExists false as a normal answer", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: true, schemaExists: false, tables: [] })),
      });

      await expect(client.listTables(connection, "nope")).resolves.toEqual({ schemaExists: false, tables: [] });
    });

    it("AC-4b: should never put the password in the URL", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, schemaExists: true, tables: [] }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.listTables(connection, "carto");

      expect(callOf(fetchMock).url).not.toContain(PASSWORD);
    });
  });

  describe("listColumns", () => {
    it("AC-4b: should POST connection, schema, table and role and never a required field", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, columns: [] }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.listColumns(connection, "carto", "rural_2024", "rural");

      const call = callOf(fetchMock);
      expect(call.url).toBe(`${BASE}/catalog/columns`);
      expect(call.method).toBe("POST");
      expect(call.body).toEqual({ connection, schema: "carto", table: "rural_2024", role: "rural" });
      expect(call.body).not.toHaveProperty("required");
    });

    it("AC-4b: should send each role as given", async () => {
      for (const role of ["rural", "urbano", "target"] as const) {
        const fetchMock = makeFetch(jsonResponse({ success: true, columns: [] }));
        const client = createRoutineJobsClient({ fetch: fetchMock });

        await client.listColumns(connection, "carto", "t", role);

        expect(callOf(fetchMock).body?.role).toBe(role);
      }
    });

    it("AC-4b: should unwrap the columns array", async () => {
      const columns = [
        { logical: "gid", status: "resolved", column: "gid", dataType: "integer" },
        { logical: "geom", status: "missing", suggestion: "the_geom" },
      ];
      const client = createRoutineJobsClient({ fetch: makeFetch(jsonResponse({ success: true, columns })) });

      await expect(client.listColumns(connection, "carto", "t", "target")).resolves.toEqual(columns);
    });

    it("AC-4b: should never put the password in the URL", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, columns: [] }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.listColumns(connection, "carto", "t", "urbano");

      expect(callOf(fetchMock).url).not.toContain(PASSWORD);
    });
  });

  describe("start", () => {
    it("AC-4b: should POST the whole request to cargar-padrones/start and return the jobId", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, jobId: "job-1" }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      const result = await client.start(startRequest);

      const call = callOf(fetchMock);
      expect(call.url).toBe(`${BASE}/cargar-padrones/start`);
      expect(call.method).toBe("POST");
      expect(call.body).toEqual(startRequest);
      expect(result).toEqual({ jobId: "job-1" });
    });

    it("AC-4b: should send a dry run request with confirm false untouched", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, jobId: "job-2" }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.start({ ...startRequest, dryRun: true, confirm: false });

      expect(callOf(fetchMock).body).toMatchObject({ dryRun: true, confirm: false });
    });

    it("AC-4b: should keep the password out of the URL", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, jobId: "job-1" }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.start(startRequest);

      expect(callOf(fetchMock).url).not.toContain(PASSWORD);
    });

    it("AC-4b: should throw RoutineJobsApiError 409 with the Spanish server message on conflict", async () => {
      const message = "Ya hay una carga en curso para esta tabla.";
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: message }, 409)),
      });

      const error = await catchError(() => client.start(startRequest));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(409);
      expect((error as RoutineJobsApiError).message).toBe(message);
    });
  });

  describe("readStatus", () => {
    const job: JobStatusView = {
      jobId: "job-1",
      state: "RUNNING",
      step: "Cargando rurales",
      current: 2,
      total: 7,
      dryRun: false,
      startedAt: 1000,
    } as JobStatusView;

    it("AC-4b: should GET cargar-padrones/status with the encoded jobId and no body", async () => {
      const fetchMock = makeFetch(jsonResponse({ success: true, job }));
      const client = createRoutineJobsClient({ fetch: fetchMock });

      await client.readStatus("a b/c&d");

      const call = callOf(fetchMock);
      expect(call.url).toBe(`${BASE}/cargar-padrones/status?jobId=${encodeURIComponent("a b/c&d")}`);
      expect(call.method).toBe("GET");
      expect(call.init?.body).toBeUndefined();
    });

    it("AC-4b: should unwrap the job from the response", async () => {
      const client = createRoutineJobsClient({ fetch: makeFetch(jsonResponse({ success: true, job })) });

      await expect(client.readStatus("job-1")).resolves.toEqual(job);
    });

    it("AC-4b: should throw RoutineJobsApiError 404 for an unknown job", async () => {
      const message = "No existe un trabajo con ese identificador.";
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: message }, 404)),
      });

      const error = await catchError(() => client.readStatus("ghost"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(404);
      expect((error as RoutineJobsApiError).message).toBe(message);
    });
  });

  describe("errors", () => {
    it("AC-4b: should throw an error that is also a plain Error", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: "Mal." }, 400)),
      });

      const error = await catchError(() => client.readStatus("job-1"));

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RoutineJobsApiError);
    });

    it("AC-4b: should throw with the server message on a 400 from the catalog", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: "El puerto debe ser un entero entre 1 y 65535." }, 400)),
      });

      const error = await catchError(() => client.listTables(connection, "carto"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(400);
      expect((error as RoutineJobsApiError).message).toBe("El puerto debe ser un entero entre 1 y 65535.");
    });

    it("AC-4b: should throw on a 500 with the generic server message", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: "Error interno al procesar la solicitud." }, 500)),
      });

      const error = await catchError(() => client.listColumns(connection, "carto", "t", "rural"));

      expect((error as RoutineJobsApiError).status).toBe(500);
      expect((error as RoutineJobsApiError).message).toBe("Error interno al procesar la solicitud.");
    });

    it("AC-4b: should throw when a 200 answer carries success false", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse({ success: false, error: "No se pudo listar." }, 200)),
      });

      const error = await catchError(() => client.listTables(connection, "carto"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).message).toBe("No se pudo listar.");
    });

    it("AC-4b: should give a non-empty message when a failed answer has no error text", async () => {
      const client = createRoutineJobsClient({ fetch: makeFetch(jsonResponse({ success: false }, 503)) });

      const error = await catchError(() => client.readStatus("job-1"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(503);
      expect((error as RoutineJobsApiError).message.trim().length).toBeGreaterThan(0);
    });

    it("AC-4b: should turn a rejected fetch into a Spanish RoutineJobsApiError with status 0", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      });
      const client = createRoutineJobsClient({ fetch: fetchMock });

      const error = await catchError(() => client.listTables(connection, "carto"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(0);
      expect((error as RoutineJobsApiError).message).not.toContain("Failed to fetch");
      expect((error as RoutineJobsApiError).message).toMatch(/servidor|conect|conexi/i);
    });

    it("AC-4b: should turn a non-JSON 200 body into a Spanish RoutineJobsApiError with status 0", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(new Response("<html>oops</html>", { status: 200 })),
      });

      const error = await catchError(() => client.readStatus("job-1"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(0);
      expect((error as RoutineJobsApiError).message).toMatch(/respuesta|servidor/i);
    });

    it("AC-4b: should turn a non-JSON error body into a RoutineJobsApiError with a Spanish message", async () => {
      const client = createRoutineJobsClient({
        fetch: makeFetch(new Response("Bad Gateway", { status: 502 })),
      });

      const error = await catchError(() => client.start(startRequest));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).message).not.toContain("Bad Gateway");
      expect((error as RoutineJobsApiError).message.trim().length).toBeGreaterThan(0);
    });

    it("AC-4b: should turn an empty body into a RoutineJobsApiError", async () => {
      const client = createRoutineJobsClient({ fetch: makeFetch(new Response("", { status: 200 })) });

      const error = await catchError(() => client.listTables(connection, "carto"));

      expect(error).toBeInstanceOf(RoutineJobsApiError);
    });

    it("AC-4b: should never log or echo the password when a request fails", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      const fetchMock = vi.fn<typeof fetch>(async () => {
        throw new TypeError("network down");
      });
      const client = createRoutineJobsClient({ fetch: fetchMock });

      const error = await catchError(() => client.start(startRequest));

      expect((error as RoutineJobsApiError).message).not.toContain(PASSWORD);
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
      }
    });
  });

  describe("readStatus timeout", () => {
    const statusBody = { success: true, job: { jobId: "job-1", state: "RUNNING", dryRun: false, startedAt: 1 } };

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

    it("AC-29: should expose a 15 second status timeout constant", () => {
      expect(STATUS_TIMEOUT_MS).toBe(15000);
    });

    it("AC-29: should arm the timer with STATUS_TIMEOUT_MS and pass an abort signal to fetch", async () => {
      const timers = fakeTimers();
      const fetchMock = makeFetch(jsonResponse(statusBody));
      const client = createRoutineJobsClient({ fetch: fetchMock, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

      await client.readStatus("job-1");

      expect(timers.setTimer).toHaveBeenCalledTimes(1);
      expect(timers.setTimer.mock.calls[0][1]).toBe(STATUS_TIMEOUT_MS);
      expect(callOf(fetchMock).init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("AC-29: should abort a hung request when the timer fires and reject with a Spanish timeout error", async () => {
      const timers = fakeTimers();
      const fetchMock = hangingFetch();
      const client = createRoutineJobsClient({ fetch: fetchMock, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

      const pending = client.readStatus("job-1");
      const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      timers.fire();
      const error = await catchError(() => pending);

      expect(signal.aborted).toBe(true);
      expect(error).toBeInstanceOf(RoutineJobsApiError);
      expect((error as RoutineJobsApiError).status).toBe(0);
      expect((error as RoutineJobsApiError).message).toMatch(/tiempo/i);
    });

    it("AC-29: should clear the timer when the answer arrives in time", async () => {
      const timers = fakeTimers();
      const client = createRoutineJobsClient({
        fetch: makeFetch(jsonResponse(statusBody)),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });

      await client.readStatus("job-1");

      expect(timers.clearTimer).toHaveBeenCalledWith("timer-handle");
    });

    it("AC-29: should clear the timer when the request fails before the timeout", async () => {
      const timers = fakeTimers();
      const client = createRoutineJobsClient({
        fetch: vi.fn<typeof fetch>(async () => {
          throw new TypeError("network down");
        }),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });

      await catchError(() => client.readStatus("job-1"));

      expect(timers.clearTimer).toHaveBeenCalledWith("timer-handle");
    });

    it("AC-29: should not give start, listTables or listColumns the short timeout", async () => {
      const timers = fakeTimers();
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/start")) return jsonResponse({ success: true, jobId: "job-9" });
        if (url.endsWith("/tables")) return jsonResponse({ success: true, schemaExists: true, tables: [] });
        return jsonResponse({ success: true, columns: [] });
      });
      const client = createRoutineJobsClient({ fetch: fetchMock, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

      await client.start(startRequest);
      await client.listTables(connection, "carto");
      await client.listColumns(connection, "carto", "t", "rural");

      expect(timers.setTimer).not.toHaveBeenCalled();
    });
  });
});
