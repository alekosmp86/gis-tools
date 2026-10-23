import { openShapefileZip, type OpenShapefile } from "@/core/services/server/shpReplace/shpRecordSource";
import {
  GeometryOptionsInvalidError,
  parseGeometryProcessingOptions,
} from "@/core/services/geometryProcessingOptions";
import type { GeometryProcessingOptions } from "@/core/types/geometryProcessing";
import { openPgShpSession, type PgShpConfig } from "@/core/services/server/shpReplace/pgShpSession";
import { getShpJobStore, type ShpJobStore } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import {
  parseStartRequest,
  parseStatusJobId,
  ShpRequestInvalidError,
  type ShpStartRequest,
} from "@/core/services/server/shpReplace/shpReplaceRequest";
import { runShpReplace } from "@/core/services/server/shpReplace/runShpReplace";
import {
  ShpCommitUncertainError,
  ShpProcessingBlockedError,
  type RunShpReplaceParams,
  type ShpReplaceResult,
  type ShpReplaceSession,
  type ShpReplaceSessionOpener,
} from "@/core/services/server/shpReplace/shpReplaceTypes";
import {
  deleteUpload,
  readUpload,
  saveUpload,
  sweepUploads,
  UploadInvalidError,
  UploadNotFoundError,
  UploadTooLargeError,
  type SavedUpload,
} from "@/core/services/server/shpReplace/shpUploadStore";

export interface ShpUploadDeps {
  save(body: ReadableStream<Uint8Array> | null, fileName: string): Promise<SavedUpload>;
  read(uploadId: string): Promise<Uint8Array>;
  delete(uploadId: string): Promise<void>;
  sweep?(maxAgeMs: number): Promise<number>;
}

export interface ShpReplaceHandlerDeps {
  store: ShpJobStore;
  uploads: ShpUploadDeps;
  openShapefile(zip: Uint8Array): Promise<OpenShapefile>;
  openSession(config: PgShpConfig): Promise<ShpReplaceSession>;
  runReplace(open: ShpReplaceSessionOpener, params: RunShpReplaceParams): Promise<ShpReplaceResult>;
}

const FILE_NAME_HEADER = "x-file-name";
const HOUR_MS = 60 * 60 * 1000;
const UPLOAD_MAX_AGE_MS = 2 * HOUR_MS;
const JOB_MAX_AGE_MS = HOUR_MS;
const REDACTION = "***";
const INTERNAL_ERROR_MESSAGE = "Error interno al procesar la solicitud.";
const CONFLICT_MESSAGE = "Ya hay un reemplazo en curso para esta tabla.";
const JOB_NOT_FOUND_MESSAGE = "No existe un trabajo con ese identificador.";
const UNKNOWN_ERROR_MESSAGE = "Error desconocido.";

function defaultShpReplaceDeps(): ShpReplaceHandlerDeps {
  return {
    store: getShpJobStore(),
    uploads: {
      save: (body, fileName) => saveUpload(body, fileName),
      read: (uploadId) => readUpload(uploadId),
      delete: (uploadId) => deleteUpload(uploadId),
      sweep: (maxAgeMs) => sweepUploads(maxAgeMs),
    },
    openShapefile: (zip) => openShapefileZip(zip),
    openSession: (config) => openPgShpSession(config),
    runReplace: runShpReplace,
  };
}

const jsonResponse = (status: number, body: object): Response => Response.json(body, { status });

const errorResponse = (status: number, message: string): Response =>
  jsonResponse(status, { success: false, error: message });

const errorTextOf = (error: unknown): string => (error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE);

const scrubSecret = (text: string, secret: string): string => text.split(secret).join(REDACTION);

function statusOf(error: unknown): number {
  if (error instanceof UploadTooLargeError) return 413;
  if (error instanceof UploadNotFoundError) return 404;
  if (error instanceof UploadInvalidError || error instanceof ShpRequestInvalidError) return 400;
  if (error instanceof GeometryOptionsInvalidError) return 400;
  return 500;
}

function failureResponse(error: unknown): Response {
  const status = statusOf(error);
  return errorResponse(status, status === 500 ? INTERNAL_ERROR_MESSAGE : errorTextOf(error));
}

async function sweepUploadsStale(uploads: ShpUploadDeps): Promise<void> {
  await uploads.sweep?.(UPLOAD_MAX_AGE_MS).catch(() => 0);
}

function sweepJobsStale(store: ShpJobStore): void {
  store.sweep(JOB_MAX_AGE_MS);
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ShpRequestInvalidError("El cuerpo de la petición no es JSON válido.");
  }
}

const tableKeyOf = (start: ShpStartRequest): string =>
  `${start.connection.host}:${start.connection.port}|${start.connection.db_name}|${start.target.schema_name}|${start.target.table_name}`;

async function readZipOrFail(deps: ShpReplaceHandlerDeps, jobId: string, uploadId: string): Promise<Uint8Array> {
  try {
    return await deps.uploads.read(uploadId);
  } catch (error) {
    deps.store.fail(jobId, errorTextOf(error));
    throw error;
  }
}

function buildRunParams(
  start: ShpStartRequest,
  shapefile: OpenShapefile,
  processing: GeometryProcessingOptions,
  store: ShpJobStore,
  jobId: string
): RunShpReplaceParams {
  return {
    target: { ...start.target },
    shapefile,
    mapping: start.mapping,
    sourceSrid: start.sourceSrid,
    resetSequences: start.resetSequences,
    processing,
    dryRun: start.dryRun,
    onProgress: (progress) => store.progress(jobId, progress),
  };
}

async function runReplaceJob(
  deps: ShpReplaceHandlerDeps,
  start: ShpStartRequest,
  jobId: string,
  params: RunShpReplaceParams
): Promise<void> {
  const result = await deps.runReplace(() => deps.openSession(start.connection), params);
  deps.store.finish(jobId, result);
  if (!start.dryRun) {
    await deps.uploads.delete(start.uploadId).catch(() => undefined);
  }
}

function failJob(store: ShpJobStore, jobId: string, start: ShpStartRequest, error: unknown): void {
  const message = scrubSecret(errorTextOf(error), start.connection.password);
  if (error instanceof ShpProcessingBlockedError) {
    store.fail(jobId, message, false, error.report);
    return;
  }
  store.fail(jobId, message, error instanceof ShpCommitUncertainError);
}

function startInBackground(
  deps: ShpReplaceHandlerDeps,
  start: ShpStartRequest,
  jobId: string,
  params: RunShpReplaceParams
): void {
  void runReplaceJob(deps, start, jobId, params).catch((error: unknown) => failJob(deps.store, jobId, start, error));
}

async function openShapefileOrFail(
  deps: ShpReplaceHandlerDeps,
  jobId: string,
  zip: Uint8Array
): Promise<OpenShapefile | null> {
  try {
    return await deps.openShapefile(zip);
  } catch (error) {
    deps.store.fail(jobId, errorTextOf(error));
    return null;
  }
}

function parseProcessingOrFail(
  store: ShpJobStore,
  jobId: string,
  raw: unknown,
  fieldNames: string[]
): GeometryProcessingOptions {
  try {
    return parseGeometryProcessingOptions(raw, fieldNames);
  } catch (error) {
    store.fail(jobId, errorTextOf(error));
    throw error;
  }
}

function launchJob(deps: ShpReplaceHandlerDeps, start: ShpStartRequest, jobId: string, shapefile: OpenShapefile): void {
  const processing = parseProcessingOrFail(deps.store, jobId, start.geometryProcessing, shapefile.fieldNames);
  startInBackground(deps, start, jobId, buildRunParams(start, shapefile, processing, deps.store, jobId));
}

export async function handleUpload(
  request: Request,
  deps: Pick<ShpReplaceHandlerDeps, "uploads"> = defaultShpReplaceDeps()
): Promise<Response> {
  try {
    await sweepUploadsStale(deps.uploads);
    const saved = await deps.uploads.save(request.body, request.headers.get(FILE_NAME_HEADER) ?? "");
    return jsonResponse(200, { success: true, uploadId: saved.uploadId, size: saved.size });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function handleStart(
  request: Request,
  deps: ShpReplaceHandlerDeps = defaultShpReplaceDeps()
): Promise<Response> {
  try {
    const start = parseStartRequest(await readJsonBody(request));
    await sweepUploadsStale(deps.uploads);
    sweepJobsStale(deps.store);
    const job = deps.store.tryStart(tableKeyOf(start), start.dryRun);
    if (!job) return errorResponse(409, CONFLICT_MESSAGE);
    const zip = await readZipOrFail(deps, job.jobId, start.uploadId);
    const shapefile = await openShapefileOrFail(deps, job.jobId, zip);
    if (shapefile) launchJob(deps, start, job.jobId, shapefile);
    return jsonResponse(200, { success: true, jobId: job.jobId });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function handleStatus(
  request: Request,
  deps: ShpReplaceHandlerDeps = defaultShpReplaceDeps()
): Promise<Response> {
  try {
    const jobId = parseStatusJobId(new URL(request.url).searchParams);
    const job = deps.store.get(jobId);
    if (!job) return errorResponse(404, JOB_NOT_FOUND_MESSAGE);
    return jsonResponse(200, { success: true, job });
  } catch (error) {
    return failureResponse(error);
  }
}
