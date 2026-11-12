import { MapFeatureNotFoundError } from "../jobs/actualizar-padron/domain/geometryMap";
import { openPgRunSession } from "../jobs/cargar-padrones/services/openPgSession";
import type { RunDeps } from "../jobs/cargar-padrones/types";
import { readEjesGeometryMap } from "../jobs/ejes-calles/services/readEjesGeometryMap";
import { parseEjesGeometryMapRequest } from "./ejesGeometryMapRequestParsing";
import { failure, HTTP_STATUS, jsonResponse, scrubText } from "./jobHttp";
import { readJsonRecord, RequestInvalidError } from "./requestParsing";

const TIMEOUT_MESSAGE = "La lectura de las geometrías tardó demasiado. Pruebe de nuevo.";
const READ_FAILED_PREFIX = "No se pudieron leer las geometrías";
const TIMEOUT_REASON = /statement timeout/i;

const defaultDeps: RunDeps = { openSession: openPgRunSession, now: Date.now };

function geometryMapFailure(error: unknown, secret: string): Response {
  if (error instanceof RequestInvalidError) return failure(HTTP_STATUS.BAD_REQUEST, error.message);
  if (error instanceof MapFeatureNotFoundError) return failure(HTTP_STATUS.NOT_FOUND, error.message);
  const reason = error instanceof Error ? error.message : String(error);
  const text = TIMEOUT_REASON.test(reason) ? TIMEOUT_MESSAGE : `${READ_FAILED_PREFIX}: ${reason}`;
  return failure(HTTP_STATUS.SERVER_ERROR, scrubText(text, secret));
}

/** Read-only: the outlines (WGS84, simplified) of up to 30 sections, by old or new `reftramo`. The password is never logged or echoed. */
export async function readEjesCallesGeometryMap(request: Request, deps: RunDeps = defaultDeps): Promise<Response> {
  let secret = "";
  try {
    const params = parseEjesGeometryMapRequest(await readJsonRecord(request));
    secret = params.config.password ?? "";
    const features = await readEjesGeometryMap(params, deps);
    return jsonResponse({ success: true, features });
  } catch (error: unknown) {
    return geometryMapFailure(error, secret);
  }
}
