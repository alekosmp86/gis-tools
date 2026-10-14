import type { JobMode, JobStatus } from "../job/types.ts";
import type { ConnectionPayload } from "../../types";
import { JOB_ID_FIELD, TAIL_FIELD } from "../constants";
import type { JobSummary, ShpPlan } from "../types";
import { getResponse, postJson } from "./shpHttp";

export { ShpRequestError } from "./shpHttp";

const PLAN_FAILURE = "No se pudo preparar el plan de carga";
const START_FAILURE = "No se pudo iniciar la carga";
const STATUS_FAILURE = "No se pudo leer el estado de la carga";
const JOBS_FAILURE = "No se pudo listar las cargas";
const LOG_FAILURE = "No se pudo leer el registro de la carga";
const CANCEL_FAILURE = "No se pudo cancelar la carga";
const DISCARD_FAILURE = "No se pudo descartar la carga";

const LOG_TAIL_LINES = 40;
const FULL_LOG_LINES = 5000;

export interface StatusResult {
  readonly status: JobStatus;
  readonly stale: boolean;
}

export function logDownloadUrl(jobId: string): string {
  return `/api/m/coverage-loads/shp/log?${JOB_ID_FIELD}=${encodeURIComponent(jobId)}&${TAIL_FIELD}=${FULL_LOG_LINES}`;
}

export async function requestPlan(connection: ConnectionPayload, jobId: string): Promise<ShpPlan> {
  const payload = await postJson<{ plan: ShpPlan }>("plan", { connection, jobId }, PLAN_FAILURE);
  return payload.plan;
}

export async function requestStart(connection: ConnectionPayload, jobId: string, mode: JobMode): Promise<void> {
  await postJson("start", { connection, jobId, mode, confirm: true }, START_FAILURE);
}

export async function requestStatus(jobId: string): Promise<StatusResult> {
  const response = await getResponse(`status?${JOB_ID_FIELD}=${encodeURIComponent(jobId)}`, STATUS_FAILURE);
  const payload = (await response.json()) as { status: JobStatus; stale: boolean };
  return { status: payload.status, stale: payload.stale };
}

export async function requestJobs(): Promise<JobSummary[]> {
  const response = await getResponse("jobs", JOBS_FAILURE);
  return ((await response.json()) as { jobs: JobSummary[] }).jobs;
}

export async function requestLogTail(jobId: string): Promise<string> {
  const query = `${JOB_ID_FIELD}=${encodeURIComponent(jobId)}&${TAIL_FIELD}=${LOG_TAIL_LINES}`;
  return (await getResponse(`log?${query}`, LOG_FAILURE)).text();
}

export async function requestCancel(jobId: string): Promise<void> {
  await postJson("cancel", { jobId }, CANCEL_FAILURE);
}

export async function requestDiscard(jobId: string): Promise<void> {
  await postJson("discard", { jobId }, DISCARD_FAILURE);
}
