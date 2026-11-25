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
  deleteUpload,
  locateUpload,
  saveUpload,
  sweepUploads,
  type SavedUpload,
  type UploadProfile,
} from "@/core/services/server/shpReplace/shpUploadStore";

export interface FileUploadDeps {
  save(body: ReadableStream<Uint8Array> | null, fileName: string): Promise<SavedUpload>;
  locate(uploadId: string): Promise<string>;
  delete(uploadId: string): Promise<void>;
  sweep?(maxAgeMs: number): Promise<number>;
}

export interface FileReplaceDeps {
  store: ShpJobStore;
  uploads: FileUploadDeps;
  openSession(config: PgShpConfig): Promise<ShpReplaceSession>;
  runReplace(open: ShpReplaceSessionOpener, params: RunShpReplaceParams): Promise<ShpReplaceResult>;
}

export type FileSourceOpener = (filePath: string, start: ShpStartRequest) => ReplaceRecordSource;

export function defaultUploadDeps(profile: UploadProfile): FileUploadDeps {
  return {
    save: (body, fileName) => saveUpload(body, fileName, { profile }),
    locate: (uploadId) => locateUpload(uploadId, { profile }),
    delete: (uploadId) => deleteUpload(uploadId, { profile }),
    sweep: (maxAgeMs) => sweepUploads(maxAgeMs, { profile }),
  };
}

export function defaultFileReplaceDeps(profile: UploadProfile): FileReplaceDeps {
  return {
    store: getShpJobStore(),
    uploads: defaultUploadDeps(profile),
    openSession: (config) => openPgShpSession(config),
    runReplace: runShpReplace,
  };
}

export async function saveRequestUpload(request: Request, uploads: FileUploadDeps): Promise<SavedUpload> {
  await sweepUploadsStale(uploads);
  return uploads.save(request.body, request.headers.get(FILE_NAME_HEADER) ?? "");
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

async function runFileJob(
  deps: FileReplaceDeps,
  openSource: FileSourceOpener,
  start: ShpStartRequest,
  jobId: string,
  filePath: string
): Promise<void> {
  await yieldToEventLoop();
  const source = openSource(filePath, start);
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

async function locateOrFail(deps: FileReplaceDeps, jobId: string, uploadId: string): Promise<string> {
  try {
    return await deps.uploads.locate(uploadId);
  } catch (error) {
    deps.store.fail(jobId, errorTextOf(error));
    throw error;
  }
}

export async function handleFileStart(
  request: Request,
  deps: FileReplaceDeps,
  openSource: FileSourceOpener
): Promise<Response> {
  try {
    const start = parseStartRequest(await readJsonBody(request));
    await sweepUploadsStale(deps.uploads);
    sweepJobsStale(deps.store);
    const job = deps.store.tryStart(tableKeyOf(start), false);
    if (!job) return errorResponse(409, CONFLICT_MESSAGE);
    const filePath = await locateOrFail(deps, job.jobId, start.uploadId);
    void runFileJob(deps, openSource, start, job.jobId, filePath).catch((error: unknown) =>
      failJob(deps.store, job.jobId, start, error)
    );
    return jsonResponse(200, { success: true, jobId: job.jobId });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function handleFileUpload(request: Request, uploads: FileUploadDeps): Promise<Response> {
  try {
    const saved = await saveRequestUpload(request, uploads);
    return jsonResponse(200, { success: true, uploadId: saved.uploadId, size: saved.size });
  } catch (error) {
    return failureResponse(error);
  }
}
