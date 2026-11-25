import { openPgRunSession } from "../../jobs/cargar-padrones/services/openPgSession";
import type { RunDeps } from "../../jobs/cargar-padrones/types";
import { SPLIT_REVIEW_GONE_MESSAGE } from "../../jobs/ejes-ide/constants";
import { readEjesSplitPoints } from "../../jobs/ejes-ide/services/readEjesSplitPoints";
import { parseEjesSplitPointsRequest } from "./ejesSplitPointsRequestParsing";
import { failure, HTTP_STATUS, jsonResponse, scrubText } from "../jobHttp";
import { getEjesReviewStore } from "./ejesReviewStore";
import { readJsonRecord, RequestInvalidError } from "../requestParsing";

const TIMEOUT_MESSAGE = "La lectura de los puntos de la división tardó demasiado. Pruebe de nuevo.";
const READ_FAILED_PREFIX = "No se pudieron leer los puntos de la división";
const TIMEOUT_REASON = /statement timeout/i;

const defaultDeps: RunDeps = { openSession: openPgRunSession, now: Date.now };

function splitPointsFailure(error: unknown, secret: string): Response {
  if (error instanceof RequestInvalidError) return failure(HTTP_STATUS.BAD_REQUEST, error.message);
  const reason = error instanceof Error ? error.message : String(error);
  const text = TIMEOUT_REASON.test(reason) ? TIMEOUT_MESSAGE : `${READ_FAILED_PREFIX}: ${reason}`;
  return failure(HTTP_STATUS.SERVER_ERROR, scrubText(text, secret));
}

/**
 * Read-only: one page of the review points of one split, from the dry run `jobId` kept. A dry run that is gone answers 400 with
 * "vuelva a analizar". The password is never logged or echoed.
 */
export async function readEjesIdeSplitPoints(request: Request, deps: RunDeps = defaultDeps): Promise<Response> {
  let secret = "";
  try {
    const params = parseEjesSplitPointsRequest(await readJsonRecord(request));
    secret = params.config.password ?? "";
    const page = await readEjesSplitPoints(params, deps, getEjesReviewStore());
    if (page === null) return failure(HTTP_STATUS.BAD_REQUEST, SPLIT_REVIEW_GONE_MESSAGE);
    return jsonResponse({ success: true, ...page });
  } catch (error: unknown) {
    return splitPointsFailure(error, secret);
  }
}
