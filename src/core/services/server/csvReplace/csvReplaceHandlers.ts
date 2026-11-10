import { openCsvFile } from "@/core/services/server/csvReplace/csvRecordSource";
import type { ReplaceRecordSource } from "@/core/services/server/shpReplace/replaceRecordSource";
import {
  CONFLICT_MESSAGE,
  errorResponse,
  errorTextOf,
  failureResponse,
  FILE_NAME_HEADER,
  jsonResponse,
  readJsonBody,
  scrubSecret,
  sweepJobsStale,
  sweepUploadsStale,
  tableKeyOf,
} from "@/core/services/server/shpReplace/replaceHttp";
import { openPgShpSession, type PgShpConfig } from "@/core/services/server/shpReplace/pgShpSession";
import { runShpReplace } from "@/core/services/server/shpReplace/runShpReplace";
import { getShpJobStore, type ShpJobStore } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import { parseStartRequest, type ShpStartRequest } from "@/core/services/server/shpReplace/shpReplaceRequest";
import {
  ShpCommitUncertainError,
  type RunShpReplaceParams,
  type ShpReplaceResult,
  type ShpReplaceSession,
  type ShpReplaceSessionOpener,
} from "@/core/services/server/shpReplace/shpReplaceTypes";
import {
  CSV_UPLOAD_PROFILE,
  deleteUpload,
  locateUpload,
  saveUpload,
  sweepUploads,
  type SavedUpload,
} from "@/core/services/server/shpReplace/shpUploadStore";

export interface CsvUploadDeps {
  save(body: ReadableStream<Uint8Array> | null, fileName: string): Promise<SavedUpload>;
  locate(uploadId: string): Promise<string>;
  delete(uploadId: string): Promise<void>;
  sweep?(maxAgeMs: number): Promise<number>;
}

export interface CsvReplaceHandlerDeps {
  store: ShpJobStore;
  uploads: CsvUploadDeps;
  openCsv(filePath: string): ReplaceRecordSource;
  openSession(config: PgShpConfig): Promise<ShpReplaceSession>;
  runReplace(open: ShpReplaceSessionOpener, params: RunShpReplaceParams): Promise<ShpReplaceResult>;
}

function defaultCsvReplaceDeps(): CsvReplaceHandlerDeps {
  const profile = { profile: CSV_UPLOAD_PROFILE };
  return {
    store: getShpJobStore(),
    uploads: {
      save: (body, fileName) => saveUpload(body, fileName, profile),
      locate: (uploadId) => locateUpload(uploadId, profile),
      delete: (uploadId) => deleteUpload(uploadId, profile),
      sweep: (maxAgeMs) => sweepUploads(maxAgeMs, profile),
    },
    openCsv: openCsvFile,
    openSession: (config) => openPgShpSession(config),
    runReplace: runShpReplace,
  };
}

const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

function buildRunParams(
  start: ShpStartRequest,
  source: ReplaceRecordSource,
  store: ShpJobStore,
  jobId: string
): RunShpReplaceParams {
  return {
    target: { ...start.target },
    shapefile: source,
    mapping: start.mapping,
    sourceSrid: start.sourceSrid,
    resetSequences: start.resetSequences,
    dryRun: false,
    onProgress: (progress) => store.progress(jobId, progress),
  };
}

async function runCsvJob(
  deps: CsvReplaceHandlerDeps,
  start: ShpStartRequest,
  jobId: string,
  filePath: string
): Promise<void> {
  await yieldToEventLoop();
  const source = deps.openCsv(filePath);
  const result = await deps.runReplace(
    () => deps.openSession(start.connection),
    buildRunParams(start, source, deps.store, jobId)
  );
  deps.store.finish(jobId, result);
  await deps.uploads.delete(start.uploadId).catch(() => undefined);
}

function failJob(store: ShpJobStore, jobId: string, start: ShpStartRequest, error: unknown): void {
  const message = scrubSecret(errorTextOf(error), start.connection.password);
  store.fail(jobId, message, error instanceof ShpCommitUncertainError);
}

async function locateOrFail(deps: CsvReplaceHandlerDeps, jobId: string, uploadId: string): Promise<string> {
  try {
    return await deps.uploads.locate(uploadId);
  } catch (error) {
    deps.store.fail(jobId, errorTextOf(error));
    throw error;
  }
}

export async function handleCsvUpload(
  request: Request,
  deps: Pick<CsvReplaceHandlerDeps, "uploads"> = defaultCsvReplaceDeps()
): Promise<Response> {
  try {
    await sweepUploadsStale(deps.uploads);
    const saved = await deps.uploads.save(request.body, request.headers.get(FILE_NAME_HEADER) ?? "");
    return jsonResponse(200, { success: true, uploadId: saved.uploadId, size: saved.size });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function handleCsvStart(
  request: Request,
  deps: CsvReplaceHandlerDeps = defaultCsvReplaceDeps()
): Promise<Response> {
  try {
    const start = parseStartRequest(await readJsonBody(request));
    await sweepUploadsStale(deps.uploads);
    sweepJobsStale(deps.store);
    const job = deps.store.tryStart(tableKeyOf(start), false);
    if (!job) return errorResponse(409, CONFLICT_MESSAGE);
    const filePath = await locateOrFail(deps, job.jobId, start.uploadId);
    void runCsvJob(deps, start, job.jobId, filePath).catch((error: unknown) =>
      failJob(deps.store, job.jobId, start, error)
    );
    return jsonResponse(200, { success: true, jobId: job.jobId });
  } catch (error) {
    return failureResponse(error);
  }
}
