import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { getRevertBackup } from "../jobs/actualizar-padron/services/revertBackupStore";
import { failure, HTTP_STATUS } from "./jobHttp";

const MISSING_TOKEN_MESSAGE = "Falta el identificador del respaldo.";
const BACKUP_NOT_FOUND_MESSAGE = "No existe un respaldo con ese identificador.";
const GZIP_CONTENT_TYPE = "application/gzip";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Serves a revert backup by its token only: the client never supplies a path. */
export async function downloadActualizarPadronBackup(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (token === "") return failure(HTTP_STATUS.BAD_REQUEST, MISSING_TOKEN_MESSAGE);
  const entry = getRevertBackup(token);
  if (entry === undefined || !(await fileExists(entry.filePath))) {
    return failure(HTTP_STATUS.NOT_FOUND, BACKUP_NOT_FOUND_MESSAGE);
  }
  const body = Readable.toWeb(createReadStream(entry.filePath)) as NodeWebReadableStream;
  return new Response(body as unknown as ReadableStream, {
    headers: {
      "Content-Type": GZIP_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${entry.fileName}"`,
      "Content-Length": String(entry.bytes),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
