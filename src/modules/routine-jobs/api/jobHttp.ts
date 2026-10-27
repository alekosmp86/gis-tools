import type { DbConfig } from "@/core/types/db";
import type { JobProgress, JobResult, JobSnapshot, JobStore } from "../jobs/shared/jobStore";
import { parseStatusJobId, RequestInvalidError } from "./requestParsing";

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_ERROR: 500,
} as const;

const HOUR_MS = 60 * 60 * 1000;
export const JOB_MAX_AGE_MS = HOUR_MS;
const REDACTION = "***";
const INTERNAL_ERROR_MESSAGE = "Error interno al procesar la solicitud.";
const JOB_NOT_FOUND_MESSAGE = "No existe un trabajo con ese identificador.";

export type JobSink<Result extends JobResult> = Pick<JobStore<Result>, "progress" | "finish" | "fail">;

export const jsonResponse = (body: object, status: number = HTTP_STATUS.OK): Response =>
  Response.json(body, { status });

export const failure = (status: number, message: string): Response =>
  jsonResponse({ success: false, error: message }, status);

export function failureResponse(error: unknown): Response {
  if (error instanceof RequestInvalidError) return failure(HTTP_STATUS.BAD_REQUEST, error.message);
  return failure(HTTP_STATUS.SERVER_ERROR, INTERNAL_ERROR_MESSAGE);
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const scrubText = (text: string, secret: string): string => (secret ? text.split(secret).join(REDACTION) : text);

function scrubDeep<T>(value: T, secret: string): T {
  if (!secret) return value;
  if (typeof value === "string") return scrubText(value, secret) as T;
  if (Array.isArray(value)) return value.map((entry: unknown) => scrubDeep(entry, secret)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]: [string, unknown]) => [key, scrubDeep(entry, secret)])
    ) as T;
  }
  return value;
}

export const tableLockKey = (config: DbConfig, schema: string, table: string): string =>
  `${config.host.trim().toLowerCase()}:${config.port}|${config.db_name}|${schema}|${table}`;

function toStatusView<Result>(job: JobSnapshot<Result>) {
  return {
    jobId: job.jobId,
    state: job.state,
    step: job.step,
    current: job.current,
    total: job.total,
    dryRun: job.dryRun,
    steps: job.steps,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
    outcomeUnknown: job.outcomeUnknown,
  };
}

export function statusResponse<Result extends JobResult>(
  store: Pick<JobStore<Result>, "sweep" | "get">,
  request: Request
): Response {
  try {
    const jobId = parseStatusJobId(new URL(request.url).searchParams);
    store.sweep(JOB_MAX_AGE_MS);
    const job = store.get(jobId);
    if (!job) return failure(HTTP_STATUS.NOT_FOUND, JOB_NOT_FOUND_MESSAGE);
    return jsonResponse({ success: true, job: toStatusView(job) });
  } catch (error: unknown) {
    return failureResponse(error);
  }
}

export async function executeJob<Result extends JobResult>(
  sink: JobSink<Result>,
  jobId: string,
  secret: string,
  run: (onProgress: (progress: JobProgress) => void) => Promise<Result>
): Promise<void> {
  const onProgress = (progress: JobProgress): void => {
    try {
      sink.progress(jobId, { ...progress, label: scrubText(progress.label, secret) });
    } catch {
      // A progress write never fails the run.
    }
  };
  try {
    const result = await run(onProgress);
    sink.finish(jobId, scrubDeep(result, secret));
  } catch (error: unknown) {
    sink.fail(jobId, scrubText(messageOf(error), secret));
  }
}
