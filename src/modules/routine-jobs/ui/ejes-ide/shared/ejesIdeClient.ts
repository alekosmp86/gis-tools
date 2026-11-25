import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import type { EjesTableRole } from "../../../jobs/ejes-ide/constants";
import type { EjesGeometryMapResult, EjesSplitPointsPage } from "../../../jobs/ejes-ide/types";
import type { ClientConnection } from "../../shared/clientTypes";
import { RoutineJobsApiError, STATUS_TIMEOUT_MS, type StartResult } from "../../shared/routineJobsClient";
import type {
  EjesGeometryMapRequest,
  EjesJobStatusView,
  EjesSplitPointsRequest,
  EjesStartRequest,
} from "./ejesIdeClientTypes";

const BASE_ROUTE = "/api/m/routine-jobs";
const CATALOG_TABLES_ROUTE = `${BASE_ROUTE}/catalog/tables`;
const CATALOG_COLUMNS_ROUTE = `${BASE_ROUTE}/catalog/columns`;
const EJES_IDE_START_ROUTE = `${BASE_ROUTE}/ejes-ide/start`;
const EJES_IDE_STATUS_ROUTE = `${BASE_ROUTE}/ejes-ide/status`;
const EJES_IDE_GEOMETRY_MAP_ROUTE = `${BASE_ROUTE}/ejes-ide/geometry-map`;
const EJES_IDE_SPLIT_POINTS_ROUTE = `${BASE_ROUTE}/ejes-ide/split-points`;
const JSON_HEADERS = { "Content-Type": "application/json" };
const NETWORK_MESSAGE = "No se pudo conectar con el servidor.";
const INVALID_RESPONSE_MESSAGE = "El servidor devolvió una respuesta no válida.";
const FAILED_REQUEST_MESSAGE = "No se pudo completar la operación en el servidor.";
const NO_RESPONSE_STATUS = 0;
const STATUS_TIMEOUT_MESSAGE = "La consulta del estado tardó demasiado tiempo. Revise la conexión con el servidor.";

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EjesIdeClientDeps {
  fetch?: FetchLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface EjesIdeClient {
  listTables(connection: ClientConnection, schema: string): Promise<TableListing>;
  listColumns(connection: ClientConnection, schema: string, table: string, role: EjesTableRole): Promise<ResolvedColumn[]>;
  startEjes(request: EjesStartRequest): Promise<StartResult>;
  readEjesStatus(jobId: string): Promise<EjesJobStatusView>;
  fetchEjesGeometryMap(request: EjesGeometryMapRequest): Promise<EjesGeometryMapResult>;
  fetchEjesSplitPoints(request: EjesSplitPointsRequest): Promise<EjesSplitPointsPage>;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);
const defaultSetTimer = (callback: () => void, ms: number): unknown => setTimeout(callback, ms);
const defaultClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJsonRecord(text: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function failureMessageOf(payload: JsonRecord | null, status: number): string {
  const serverMessage = payload?.error;
  if (typeof serverMessage === "string" && serverMessage.trim() !== "") return serverMessage;
  return `${FAILED_REQUEST_MESSAGE} (código ${status}).`;
}

async function send(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new RoutineJobsApiError(NETWORK_MESSAGE, NO_RESPONSE_STATUS);
  }
}

async function readPayload(response: Response): Promise<JsonRecord> {
  const text = await response.text().catch(() => "");
  const payload = parseJsonRecord(text);
  if (!payload) {
    throw new RoutineJobsApiError(INVALID_RESPONSE_MESSAGE, response.ok ? NO_RESPONSE_STATUS : response.status);
  }
  if (!response.ok || payload.success !== true) {
    throw new RoutineJobsApiError(failureMessageOf(payload, response.status), response.status);
  }
  return payload;
}

async function postJson(fetchImpl: FetchLike, url: string, body: unknown): Promise<JsonRecord> {
  const response = await send(fetchImpl, url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return readPayload(response);
}

function invalidResponse(): RoutineJobsApiError {
  return new RoutineJobsApiError(INVALID_RESPONSE_MESSAGE, NO_RESPONSE_STATUS);
}

async function postStart(fetchImpl: FetchLike, route: string, request: unknown): Promise<StartResult> {
  const payload = await postJson(fetchImpl, route, request);
  if (typeof payload.jobId !== "string") throw invalidResponse();
  return { jobId: payload.jobId };
}

interface TimerDeps {
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/** Reads one job status with a short timeout; the timer aborts the request and is always cleared. */
async function readJobStatus<Job>(fetchImpl: FetchLike, timers: TimerDeps, route: string, jobId: string): Promise<Job> {
  const url = `${route}?jobId=${encodeURIComponent(jobId)}`;
  const controller = new AbortController();
  let timedOut = false;
  const handle = timers.setTimer(() => {
    timedOut = true;
    controller.abort();
  }, STATUS_TIMEOUT_MS);
  try {
    const payload = await readPayload(await send(fetchImpl, url, { signal: controller.signal }));
    if (!isRecord(payload.job)) throw invalidResponse();
    return payload.job as unknown as Job;
  } catch (error: unknown) {
    if (timedOut) throw new RoutineJobsApiError(STATUS_TIMEOUT_MESSAGE, NO_RESPONSE_STATUS);
    throw error;
  } finally {
    timers.clearTimer(handle);
  }
}

export function createEjesIdeClient(deps: EjesIdeClientDeps = {}): EjesIdeClient {
  const fetchImpl = deps.fetch ?? defaultFetch;
  const timers: TimerDeps = {
    setTimer: deps.setTimer ?? defaultSetTimer,
    clearTimer: deps.clearTimer ?? defaultClearTimer,
  };

  return {
    async listTables(connection, schema) {
      const payload = await postJson(fetchImpl, CATALOG_TABLES_ROUTE, { connection, schema });
      if (typeof payload.schemaExists !== "boolean" || !Array.isArray(payload.tables)) throw invalidResponse();
      return { schemaExists: payload.schemaExists, tables: payload.tables as TableListing["tables"] };
    },

    async listColumns(connection, schema, table, role) {
      const payload = await postJson(fetchImpl, CATALOG_COLUMNS_ROUTE, { connection, schema, table, role });
      if (!Array.isArray(payload.columns)) throw invalidResponse();
      return payload.columns as ResolvedColumn[];
    },

    startEjes: (request) => postStart(fetchImpl, EJES_IDE_START_ROUTE, request),

    readEjesStatus: (jobId) => readJobStatus<EjesJobStatusView>(fetchImpl, timers, EJES_IDE_STATUS_ROUTE, jobId),

    async fetchEjesGeometryMap(request) {
      const payload = await postJson(fetchImpl, EJES_IDE_GEOMETRY_MAP_ROUTE, request);
      if (!Array.isArray(payload.features) || !Array.isArray(payload.candidates) || !Array.isArray(payload.neighbours)) throw invalidResponse();
      return payload as unknown as EjesGeometryMapResult;
    },

    async fetchEjesSplitPoints(request) {
      const payload = await postJson(fetchImpl, EJES_IDE_SPLIT_POINTS_ROUTE, request);
      if (!Array.isArray(payload.points) || !Array.isArray(payload.pieces)) throw invalidResponse();
      return payload as unknown as EjesSplitPointsPage;
    },
  };
}
