import { mkdir, rename } from "node:fs/promises";
import { HTTP_STATUS } from "../../shared/httpResponses";
import { BYTES_PER_MIB, DISK_HEADROOM_FACTOR, DISK_SAFETY_MARGIN_BYTES } from "../constants";
import { jobPaths, jobsDir, newJobId } from "../job/layout.ts";
import { createStatusWriter, readStatus } from "../job/statusFile.ts";
import { createInitialStatus } from "../job/statusTransitions.ts";
import { JOB_MODE, JOB_STATE } from "../job/types.ts";
import type { JobTarget } from "../job/types.ts";
import { listJobIds, removeJobDir } from "./jobStore";
import type { ShpContext } from "./shpContext";
import { viewTableLock } from "./tableLock";
import { streamBodyToFile, UploadSizeMismatchError } from "./uploadStream";

const TABLE_BUSY_MESSAGE = (table: string) => `Ya hay una carga de ${table} en curso. Espere a que termine antes de subir otro archivo.`;
const NO_SPACE_MESSAGE = (needed: number) =>
  `No hay espacio suficiente en disco para recibir el archivo (se necesitan unos ${Math.ceil(needed / BYTES_PER_MIB)} MiB libres).`;
const MISMATCH_MESSAGE = "El archivo recibido no tiene el tamaño declarado; la subida fue descartada.";
const ABORTED_MESSAGE = "La subida fue interrumpida; se descartó el archivo parcial.";
const FAILED_MESSAGE = "No se pudo recibir el archivo.";

export interface UploadRequest {
  readonly body: ReadableStream<Uint8Array>;
  readonly signal: AbortSignal;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly target: JobTarget;
}

export type UploadOutcome =
  | { readonly ok: true; readonly jobId: string; readonly target: JobTarget; readonly sizeBytes: number }
  | { readonly ok: false; readonly status: number; readonly message: string };

function refuse(status: number, message: string): UploadOutcome {
  return { ok: false, status, message };
}

/** Bytes other uploads still have to write: free space does not reflect them yet. */
async function pendingUploadBytes(context: ShpContext): Promise<number> {
  const statuses = await Promise.all((await listJobIds(context.rootDir)).map((id) => readStatus(context.rootDir, id)));
  return statuses.reduce(
    (total, status) =>
      status !== null && status.state === JOB_STATE.UPLOADING ? total + Math.max(0, status.source.sizeBytes - status.source.receivedBytes) : total,
    0
  );
}

async function precheck(context: ShpContext, upload: UploadRequest): Promise<UploadOutcome | null> {
  await mkdir(jobsDir(context.rootDir), { recursive: true });
  const lock = await viewTableLock(context.rootDir, upload.target.table, null, context.now());
  if (lock !== "FREE") return refuse(HTTP_STATUS.CONFLICT, TABLE_BUSY_MESSAGE(upload.target.table));
  const needed = upload.sizeBytes * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
  if ((await context.freeBytes(context.rootDir)) - (await pendingUploadBytes(context)) < needed) return refuse(HTTP_STATUS.INSUFFICIENT_STORAGE, NO_SPACE_MESSAGE(needed));
  return null;
}

function failureOutcome(error: unknown, signal: AbortSignal): UploadOutcome {
  if (error instanceof UploadSizeMismatchError) return refuse(HTTP_STATUS.BAD_REQUEST, MISMATCH_MESSAGE);
  if (signal.aborted) return refuse(HTTP_STATUS.BAD_REQUEST, ABORTED_MESSAGE);
  return refuse(HTTP_STATUS.SERVER_ERROR, FAILED_MESSAGE);
}

/**
 * Creates the job folder (UPLOADING), streams the body to `upload.part`, then renames it to
 * `source.shp` and marks the job READY. Any failure or abort removes the whole folder.
 */
export async function receiveUpload(context: ShpContext, upload: UploadRequest): Promise<UploadOutcome> {
  const refused = await precheck(context, upload);
  if (refused !== null) return refused;

  const jobId = newJobId();
  const paths = jobPaths(context.rootDir, jobId);
  const writer = createStatusWriter(context.rootDir, jobId);
  const newStatus = (state: typeof JOB_STATE.UPLOADING | typeof JOB_STATE.READY, receivedBytes: number) =>
    createInitialStatus({
      jobId,
      mode: JOB_MODE.LOAD,
      ...upload.target,
      fileName: upload.fileName,
      sizeBytes: upload.sizeBytes,
      receivedBytes,
      now: context.now(),
      state,
    });
  let pendingWrites: Promise<void> = Promise.resolve();

  try {
    await mkdir(paths.dir, { recursive: true });
    await writer.write(newStatus(JOB_STATE.UPLOADING, 0));
    await streamBodyToFile(upload.body, paths.upload, {
      declaredBytes: upload.sizeBytes,
      signal: upload.signal,
      now: context.now,
      onProgress: (received) => {
        pendingWrites = writer.write(newStatus(JOB_STATE.UPLOADING, received)).catch(() => undefined);
      },
    });
    await pendingWrites;
    await rename(paths.upload, paths.source);
    await writer.write(newStatus(JOB_STATE.READY, upload.sizeBytes));
    return { ok: true, jobId, target: upload.target, sizeBytes: upload.sizeBytes };
  } catch (error) {
    await pendingWrites.catch(() => undefined);
    await removeJobDir(context.rootDir, jobId).catch(() => undefined);
    return failureOutcome(error, upload.signal);
  }
}
