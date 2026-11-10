import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 1024 ** 3;

const UPLOAD_LIMIT_MESSAGE = "El archivo supera el límite de 1 GiB.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UploadInvalidError extends Error {
  override readonly name = "UploadInvalidError";
}

export class UploadNotFoundError extends Error {
  override readonly name = "UploadNotFoundError";
}

export class UploadTooLargeError extends Error {
  override readonly name = "UploadTooLargeError";
}

export interface UploadProfile {
  readonly dir: string;
  readonly extension: string;
  readonly namePattern: RegExp;
  readonly nameError: string;
}

const ZIP_UPLOAD_PROFILE: UploadProfile = {
  dir: path.join(os.tmpdir(), "gis-tools-shp-replace"),
  extension: ".zip",
  namePattern: /\.zip$/i,
  nameError: "Solo se admiten archivos .zip.",
};

export const CSV_UPLOAD_PROFILE: UploadProfile = {
  dir: path.join(os.tmpdir(), "gis-tools-csv-replace"),
  extension: ".csv",
  namePattern: /\.(csv|txt)$/i,
  nameError: "Solo se admiten archivos .csv o .txt.",
};

export interface UploadStoreOptions {
  profile?: UploadProfile;
  dir?: string;
  maxBytes?: number;
  now?: () => number;
}

export interface SavedUpload {
  uploadId: string;
  size: number;
}

const profileOf = (options: UploadStoreOptions): UploadProfile => options.profile ?? ZIP_UPLOAD_PROFILE;

const dirOf = (options: UploadStoreOptions): string => options.dir ?? profileOf(options).dir;

const uploadPathOf = (dir: string, uploadId: string, extension: string): string =>
  path.join(dir, `${uploadId}${extension}`);

const isUploadId = (uploadId: string): boolean => UUID_PATTERN.test(uploadId);

function assertUploadName(fileName: string, profile: UploadProfile): void {
  if (!profile.namePattern.test(fileName)) {
    throw new UploadInvalidError(profile.nameError);
  }
}

function byteLimit(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new UploadTooLargeError(UPLOAD_LIMIT_MESSAGE));
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
  const profile = profileOf(options);
  assertUploadName(fileName, profile);
  if (body === null) {
    throw new UploadInvalidError("La petición no contiene datos.");
  }
  const dir = dirOf(options);
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  await mkdir(dir, { recursive: true });
  const uploadId = randomUUID();
  const filePath = uploadPathOf(dir, uploadId, profile.extension);
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
  const { size } = await stat(/*turbopackIgnore: true*/ filePath);
  return { uploadId, size };
}

function resolveUploadPath(uploadId: string, options: UploadStoreOptions): string {
  if (!isUploadId(uploadId)) {
    throw new UploadNotFoundError("No existe la subida solicitada.");
  }
  return uploadPathOf(dirOf(options), uploadId, profileOf(options).extension);
}

export async function locateUpload(uploadId: string, options: UploadStoreOptions = {}): Promise<string> {
  const filePath = resolveUploadPath(uploadId, options);
  try {
    await stat(/*turbopackIgnore: true*/ filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UploadNotFoundError("No existe la subida solicitada.");
    }
    throw error;
  }
  return filePath;
}

export async function readUpload(uploadId: string, options: UploadStoreOptions = {}): Promise<Uint8Array> {
  const filePath = resolveUploadPath(uploadId, options);
  try {
    return await readFile(/*turbopackIgnore: true*/ filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UploadNotFoundError("No existe la subida solicitada.");
    }
    throw error;
  }
}

export async function deleteUpload(uploadId: string, options: UploadStoreOptions = {}): Promise<void> {
  await rm(resolveUploadPath(uploadId, options), { force: true });
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
  const dir = dirOf(options);
  const extension = profileOf(options).extension;
  const now = (options.now ?? Date.now)();
  let removed = 0;
  for (const fileName of await listUploadFiles(dir)) {
    const uploadId = fileName.slice(0, -extension.length);
    if (!fileName.endsWith(extension) || !isUploadId(uploadId)) continue;
    const filePath = path.join(/*turbopackIgnore: true*/ dir, fileName);
    const { mtimeMs } = await stat(/*turbopackIgnore: true*/ filePath);
    if (isStale(mtimeMs, now, maxAgeMs)) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }
  return removed;
}
