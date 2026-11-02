import { buildPendingGeometryCsv } from "../jobs/actualizar-padron/domain/pendingGeometryCsv";
import { isPlanId, PLAN_EXPIRED_MESSAGE, PLAN_UNKNOWN_MESSAGE } from "../jobs/actualizar-padron/domain/plan";
import { readPlanRecord } from "../jobs/actualizar-padron/services/planStore";
import { failure, HTTP_STATUS } from "./jobHttp";

const INVALID_PLAN_MESSAGE = "El identificador del plan no es válido.";
const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
const PENDING_FILE_NAME = "carto-actualizar-padron-geometrias-pendientes.csv";

/** Serves the pending geometry changes of an analysis by its plan id only: the client never supplies a path. */
export async function downloadActualizarPendingCsv(request: Request): Promise<Response> {
  const planId = new URL(request.url).searchParams.get("planId") ?? "";
  if (!isPlanId(planId)) return failure(HTTP_STATUS.BAD_REQUEST, INVALID_PLAN_MESSAGE);
  const record = await readPlanRecord(planId);
  if (record === undefined) return failure(HTTP_STATUS.NOT_FOUND, PLAN_UNKNOWN_MESSAGE);
  if (Date.parse(record.expiresAt) <= Date.now()) return failure(HTTP_STATUS.GONE, PLAN_EXPIRED_MESSAGE);
  return new Response(buildPendingGeometryCsv(record.pendingGeometryChanges), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${PENDING_FILE_NAME}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
