import type { ConnectionPayload } from "../../types";
import { downloadBlob } from "../../shared/ui/downloadBlob";
import type {
  AvanceErrorPayload,
  AvanceLoadResult,
  AvancePlan,
  LoadResponsePayload,
  PlanResponsePayload,
  ReportKind,
  ReportRequestPayload,
} from "../client";
import { parseContentDispositionFileName } from "../../shared/domain/contentDisposition";
import { RunMode } from "../domain/loadFlow";

/**
 * Browser-side access to the Avance FTTH endpoints. Credentials travel in the request body only
 * and are never logged. Each call checks `response.ok` first: an error page is HTML, and parsing
 * it as JSON hides the real failure.
 */

const API_BASE = "/api/m/coverage-loads/avance-ftth";

const CONNECTION_FIELD = "connection";
const FILES_FIELD = "files";
const CONFIRM_FIELD = "confirm";
const DRY_RUN_FIELD = "dryRun";
const TRUE_VALUE = "true";

const CONTENT_TYPE_HEADER = "Content-Type";
const CONTENT_DISPOSITION_HEADER = "Content-Disposition";
const JSON_CONTENT_TYPE = "application/json";

const NETWORK_FAILURE_PREFIX = "No se pudo contactar con el servidor";
const PLAN_FAILURE = "No se pudo preparar el plan de carga";
const LOAD_FAILURE = "No se pudo completar la carga";
const REPORT_FAILURE = "No se pudo generar el reporte";
const ZIP_FALLBACK_NAME = "AvanceFTTH_Reportes.zip";

/** A failed request. `plan` is present when the server refused a load (409) and sends the plan it computed. */
export class AvanceRequestError extends Error {
  readonly plan?: AvancePlan;

  constructor(message: string, plan?: AvancePlan) {
    super(message);
    this.name = "AvanceRequestError";
    this.plan = plan;
  }
}

export interface ReportDownload {
  readonly fileName: string;
  readonly sizeBytes: number;
}

function buildUploadForm(connection: ConnectionPayload, files: ReadonlyArray<File>, mode: RunMode | null): FormData {
  const form = new FormData();
  form.append(CONNECTION_FIELD, JSON.stringify(connection));
  for (const file of files) form.append(FILES_FIELD, file, file.name);
  if (mode === RunMode.LOAD) form.append(CONFIRM_FIELD, TRUE_VALUE);
  if (mode === RunMode.DRY_RUN) form.append(DRY_RUN_FIELD, TRUE_VALUE);
  return form;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}/${path}`, { method: "POST", ...init });
  } catch (failure: unknown) {
    const detail = failure instanceof Error ? `: ${failure.message}` : ".";
    throw new AvanceRequestError(`${NETWORK_FAILURE_PREFIX}${detail}`);
  }
}

async function readFailure(response: Response, context: string): Promise<AvanceRequestError> {
  const fallback = `${context} (HTTP ${response.status}).`;
  try {
    const payload = (await response.json()) as Partial<AvanceErrorPayload>;
    return new AvanceRequestError(payload.error ?? fallback, payload.plan);
  } catch {
    return new AvanceRequestError(fallback);
  }
}

export async function requestPlan(connection: ConnectionPayload, files: ReadonlyArray<File>): Promise<AvancePlan> {
  const response = await send("plan", { body: buildUploadForm(connection, files, null) });
  if (!response.ok) throw await readFailure(response, PLAN_FAILURE);
  return ((await response.json()) as PlanResponsePayload).plan;
}

export async function requestRun(
  connection: ConnectionPayload,
  files: ReadonlyArray<File>,
  mode: RunMode
): Promise<AvanceLoadResult> {
  const response = await send("load", { body: buildUploadForm(connection, files, mode) });
  if (!response.ok) throw await readFailure(response, LOAD_FAILURE);
  return ((await response.json()) as LoadResponsePayload).result;
}

/** One report when `kind` is given, the zip of all five otherwise. */
export async function downloadReport(connection: ConnectionPayload, kind: ReportKind | null): Promise<ReportDownload> {
  const body: ReportRequestPayload = kind === null ? { connection } : { connection, kind };
  const response = await send("reports", {
    headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readFailure(response, REPORT_FAILURE);

  const blob = await response.blob();
  const fileName =
    parseContentDispositionFileName(response.headers.get(CONTENT_DISPOSITION_HEADER)) ?? kind ?? ZIP_FALLBACK_NAME;
  downloadBlob(blob, fileName);
  return { fileName, sizeBytes: blob.size };
}
