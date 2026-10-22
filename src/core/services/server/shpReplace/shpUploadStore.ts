import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 1024 ** 3;

const DEFAULT_UPLOAD_DIR = path.join(os.tmpdir(), "gis-tools-shp-replace");
const UPLOAD_EXTENSION = ".zip";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZIP_NAME_PATTERN = /\.zip$/i;

export class UploadInvalidError extends Error {
  override readonly name = "UploadInvalidError";
}

export class UploadNotFoundError extends Error {
  override readonly name = "UploadNotFoundError";
}

export class UploadTooLargeError extends Error {
  override readonly name = "UploadTooLargeError";
}

export interface UploadStoreOptions {
  dir?: string;
  maxBytes?: number;
  now?: () => number;
}

export interface SavedUpload {
  uploadId: string;
  size: number;
}

const uploadPathOf = (dir: string, uploadId: string): string => path.join(dir, `${uploadId}${UPLOAD_EXTENSION}`);

const isUploadId = (uploadId: string): boolean => UUID_PATTERN.test(uploadId);

function assertZipName(fileName: string): void {
  if (!ZIP_NAME_PATTERN.test(fileName)) {
    throw new UploadInvalidError("Solo se admiten archivos .zip.");
  }
}

function byteLimit(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new UploadTooLargeError("El archivo supera el límite de 1 GiB."));
        return;
      }
      callback(null, chunk);
    },
  });
}

export async function saveUpload(
  body: ReadableStream<Uint8Array> | null,
  fileName: string,
  options: UploadStoreOptions = {}
): Promise<SavedUpload> {
  assertZipName(fileName);
  if (body === null) {
    throw new UploadInvalidError("La petición no contiene datos.");
  }
  const dir = options.dir ?? DEFAULT_UPLOAD_DIR;
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  await mkdir(dir, { recursive: true });
  const uploadId = randomUUID();
  const filePath = uploadPathOf(dir, uploadId);
  try {
    await pipeline(
      Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>),
      byteLimit(maxBytes),
      createWriteStream(filePath)
    );
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }
  const { size } = await stat(filePath);
  return { uploadId, size };
}

export async function readUpload(uploadId: string, options: UploadStoreOptions = {}): Promise<Uint8Array> {
  if (!isUploadId(uploadId)) {
    throw new UploadNotFoundError("No existe la subida solicitada.");
  }
  try {
    return await readFile(uploadPathOf(options.dir ?? DEFAULT_UPLOAD_DIR, uploadId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UploadNotFoundError("No existe la subida solicitada.");
    }
    throw error;
  }
}

export async function deleteUpload(uploadId: string, options: UploadStoreOptions = {}): Promise<void> {
  if (!isUploadId(uploadId)) {
    throw new UploadNotFoundError("No existe la subida solicitada.");
  }
  await rm(uploadPathOf(options.dir ?? DEFAULT_UPLOAD_DIR, uploadId), { force: true });
}

async function listUploadFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

const isStale = (mtimeMs: number, now: number, maxAgeMs: number): boolean => now - mtimeMs > maxAgeMs;

export async function sweepUploads(maxAgeMs: number, options: UploadStoreOptions = {}): Promise<number> {
  const dir = options.dir ?? DEFAULT_UPLOAD_DIR;
  const now = (options.now ?? Date.now)();
  let removed = 0;
  for (const fileName of await listUploadFiles(dir)) {
    const uploadId = fileName.slice(0, -UPLOAD_EXTENSION.length);
    if (!fileName.endsWith(UPLOAD_EXTENSION) || !isUploadId(uploadId)) continue;
    const filePath = path.join(/*turbopackIgnore: true*/ dir, fileName);
    const { mtimeMs } = await stat(/*turbopackIgnore: true*/ filePath);
    if (isStale(mtimeMs, now, maxAgeMs)) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }
  return removed;
}
