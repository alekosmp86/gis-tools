import type { ConnectionPayload } from "../../types";
import { downloadBlob } from "../../shared/ui/downloadBlob";
import type {
  IndicatorsErrorPayload,
  IndicatorsPlan,
  LoadResponsePayload,
  LoadResult,
  PlanResponsePayload,
  ReportKind,
  ReportRequestPayload,
} from "../client";
import { parseContentDispositionFileName } from "../../shared/domain/contentDisposition";

/**
 * Browser-side access to the Indicadores LTE endpoints. Credentials travel in the request body
 * only and are never logged. Each call checks `response.ok` first: an error page is HTML, and
 * parsing it as JSON hides the real failure.
 */

const API_BASE = "/api/m/coverage-loads/indicators";

const CONNECTION_FIELD = "connection";
const FILES_FIELD = "files";
const CONFIRM_FIELD = "confirm";
const ACCEPT_SHRINK_FIELD = "acceptShrink";
const TRUE_VALUE = "true";

const CONTENT_TYPE_HEADER = "Content-Type";
const CONTENT_DISPOSITION_HEADER = "Content-Disposition";
const JSON_CONTENT_TYPE = "application/json";

const NETWORK_FAILURE_PREFIX = "No se pudo contactar con el servidor";
const PLAN_FAILURE = "No se pudo preparar el plan de carga";
const LOAD_FAILURE = "No se pudo completar la carga";
const REPORT_FAILURE = "No se pudo generar el reporte";

/** A failed request. `plan` is present when the server refused a load (409) and sends the plan it computed. */
export class IndicatorsRequestError extends Error {
  readonly plan?: IndicatorsPlan;

  constructor(message: string, plan?: IndicatorsPlan) {
    super(message);
    this.name = "IndicatorsRequestError";
    this.plan = plan;
  }
}

export interface ReportDownload {
  readonly fileName: string;
  readonly sizeBytes: number;
}

interface UploadOptions {
  readonly confirm?: boolean;
  readonly acceptShrink?: boolean;
}

function buildUploadForm(
  connection: ConnectionPayload,
  files: ReadonlyArray<File>,
  options: UploadOptions
): FormData {
  const form = new FormData();
  form.append(CONNECTION_FIELD, JSON.stringify(connection));
  for (const file of files) form.append(FILES_FIELD, file, file.name);
  if (options.confirm) form.append(CONFIRM_FIELD, TRUE_VALUE);
  if (options.acceptShrink) form.append(ACCEPT_SHRINK_FIELD, TRUE_VALUE);
  return form;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}/${path}`, { method: "POST", ...init });
  } catch (failure: unknown) {
    const detail = failure instanceof Error ? `: ${failure.message}` : ".";
    throw new IndicatorsRequestError(`${NETWORK_FAILURE_PREFIX}${detail}`);
  }
}

async function readFailure(response: Response, context: string): Promise<IndicatorsRequestError> {
  const fallback = `${context} (HTTP ${response.status}).`;
  try {
    const payload = (await response.json()) as Partial<IndicatorsErrorPayload>;
    return new IndicatorsRequestError(payload.error ?? fallback, payload.plan);
  } catch {
    return new IndicatorsRequestError(fallback);
  }
}

export async function requestPlan(
  connection: ConnectionPayload,
  files: ReadonlyArray<File>
): Promise<IndicatorsPlan> {
  const response = await send("plan", { body: buildUploadForm(connection, files, {}) });
  if (!response.ok) throw await readFailure(response, PLAN_FAILURE);
  return ((await response.json()) as PlanResponsePayload).plan;
}

export async function requestLoad(
  connection: ConnectionPayload,
  files: ReadonlyArray<File>,
  acceptShrink: boolean
): Promise<LoadResult> {
  const form = buildUploadForm(connection, files, { confirm: true, acceptShrink });
  const response = await send("load", { body: form });
  if (!response.ok) throw await readFailure(response, LOAD_FAILURE);
  return ((await response.json()) as LoadResponsePayload).result;
}

export async function downloadReport(connection: ConnectionPayload, kind: ReportKind): Promise<ReportDownload> {
  const body: ReportRequestPayload = { connection, kind };
  const response = await send("reports", {
    headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readFailure(response, REPORT_FAILURE);

  const blob = await response.blob();
  const fileName =
    parseContentDispositionFileName(response.headers.get(CONTENT_DISPOSITION_HEADER)) ?? `reporte_${kind}.csv`;
  downloadBlob(blob, fileName);
  return { fileName, sizeBytes: blob.size };
}
