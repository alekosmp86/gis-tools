import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import {
  readConnection,
  readConnectionFromForm,
  readJsonBody,
  type ParsedBody,
  type ValidationResult,
} from "../../shared/requestReaders";
import type { DbConnection } from "../../types";
import {
  MAX_BODY_BYTES,
  REPORT_KIND_LABELS,
  REPORT_KINDS,
  REPORT_TEXT_CONTENT_TYPE,
  REPORT_ZIP_CONTENT_TYPE,
  ReportKind,
} from "../constants";
import { arrangeOutcomes, assertLoadable, buildPlan, LoadRefusedError } from "../domain/plan";
import { buildReportFileName, buildReportText, buildReportZip, buildReportZipName } from "../domain/reportFiles";
import type { AvanceFtthRepository } from "../services/AvanceFtthRepository";
import { PgAvanceFtthRepository } from "../services/PgAvanceFtthRepository";
import type { AvancePlan, ParsedAvanceFile, ReportData } from "../types";
import {
  CONFIRM_FIELD,
  CONNECTION_FIELD,
  DRY_RUN_FIELD,
  readUploads,
} from "./uploadReaders";
import { checkDeclaredBodySize, readFlag, readForm } from "../../shared/uploadReaders";

/**
 * HTTP surface of the Avance FTTH part. Handlers stay thin: parse and validate, call the domain
 * and the repository, shape the response. Credentials are read from the POST body only, and the
 * password is scrubbed from any error text before it leaves.
 */

const PLAN_FAILURE_MESSAGE = "No se pudo preparar el plan de carga.";
const LOAD_FAILURE_MESSAGE = "No se pudo completar la carga.";
const REPORT_FAILURE_MESSAGE = "No se pudo generar el reporte.";
const CONFIRMATION_REQUIRED_MESSAGE = "Hay que confirmar la carga para reemplazar el Avance.";
const INVALID_JSON_MESSAGE = "El cuerpo de la solicitud debe ser un JSON válido.";
const INVALID_KIND_MESSAGE = "El tipo de reporte no es válido.";

export interface AvanceFtthHandlers {
  readonly plan: ModuleEndpointHandler;
  readonly load: ModuleEndpointHandler;
  readonly reports: ModuleEndpointHandler;
}

export interface AvanceFtthHandlerDependencies {
  readonly repository?: AvanceFtthRepository;
  /** The clock for report file names; injected so tests are not tied to today. */
  readonly now?: () => Date;
}

interface PreparedUpload {
  readonly connection: DbConnection;
  readonly form: FormData;
  readonly files: ParsedAvanceFile[];
  readonly plan: AvancePlan;
}

type UploadResponder = (upload: PreparedUpload) => Promise<Response>;

function refusalResponse(message: string, plan: AvancePlan): Response {
  return failure(message, HTTP_STATUS.CONFLICT, { plan });
}

/** Parses the multipart request and builds the plan against the database; shared by plan and load. */
async function buildUpload(
  form: FormData,
  connection: DbConnection,
  repository: AvanceFtthRepository
): Promise<PreparedUpload | Response> {
  const uploads = await readUploads(form);
  if (!uploads.ok) return failure(uploads.error, HTTP_STATUS.BAD_REQUEST);

  const { files, fileErrors } = arrangeOutcomes(uploads.value);
  const state = await repository.inspect(connection);
  return { connection, form, files, plan: buildPlan(files, fileErrors, state) };
}

async function handleUpload(
  request: Request,
  repository: AvanceFtthRepository,
  failureMessage: string,
  respond: UploadResponder
): Promise<Response> {
  const refusal = checkDeclaredBodySize(request, MAX_BODY_BYTES);
  if (refusal !== null) return failure(refusal.message, refusal.status);
  const form = await readForm(request);
  if (!form.ok) return failure(form.error, HTTP_STATUS.BAD_REQUEST);
  const connection = readConnectionFromForm(form.value, CONNECTION_FIELD);
  if (!connection.ok) return failure(connection.error, HTTP_STATUS.BAD_REQUEST);

  try {
    const upload = await buildUpload(form.value, connection.value, repository);
    return upload instanceof Response ? upload : await respond(upload);
  } catch (error: unknown) {
    if (error instanceof LoadRefusedError) return refusalResponse(error.message, error.plan);
    return toErrorResponse(error, connection.value.password, failureMessage);
  }
}

function readReportKind(body: ParsedBody): ValidationResult<ReportKind | null> {
  if (body.kind === undefined || body.kind === null) return { ok: true, value: null };
  const knownKinds: ReadonlyArray<unknown> = REPORT_KINDS;
  return knownKinds.includes(body.kind)
    ? { ok: true, value: body.kind as ReportKind }
    : { ok: false, error: INVALID_KIND_MESSAGE };
}

function toDownloadResponse(content: Uint8Array, contentType: string, fileName: string): Response {
  return new Response(content.slice().buffer, {
    status: HTTP_STATUS.OK,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
    },
  });
}

/** A report the user asked for must not be served half-made: any failed report fails the request. */
function requireAllReports(reports: ReadonlyArray<ReportData>): void {
  const failed = reports.find((report) => report.error !== null);
  if (failed) throw new Error(`${REPORT_FAILURE_MESSAGE} "${REPORT_KIND_LABELS[failed.kind]}": ${failed.error}`);
}

function buildReportResponse(kind: ReportKind | null, reports: ReadonlyArray<ReportData>, runDay: Date): Response {
  if (kind === null) {
    return toDownloadResponse(buildReportZip(reports, runDay), REPORT_ZIP_CONTENT_TYPE, buildReportZipName(runDay));
  }
  const rows = reports.find((report) => report.kind === kind)?.rows ?? [];
  return toDownloadResponse(buildReportText(kind, rows), REPORT_TEXT_CONTENT_TYPE, buildReportFileName(kind, runDay));
}

export function createAvanceFtthHandlers(dependencies: AvanceFtthHandlerDependencies = {}): AvanceFtthHandlers {
  const repository = dependencies.repository ?? new PgAvanceFtthRepository();
  const now = dependencies.now ?? (() => new Date());

  const respondWithPlan: UploadResponder = async (upload) => jsonResponse({ success: true, plan: upload.plan });

  const respondWithLoad: UploadResponder = async (upload) => {
    const dryRun = readFlag(upload.form, DRY_RUN_FIELD);
    if (!dryRun && !readFlag(upload.form, CONFIRM_FIELD)) {
      return failure(CONFIRMATION_REQUIRED_MESSAGE, HTTP_STATUS.BAD_REQUEST);
    }
    assertLoadable(upload.plan);
    const result = await repository.load(upload.connection, { files: upload.files, dryRun });
    return jsonResponse({ success: true, result });
  };

  const reports: ModuleEndpointHandler = async (request) => {
    const body = await readJsonBody(request);
    if (!body) return failure(INVALID_JSON_MESSAGE, HTTP_STATUS.BAD_REQUEST);
    const connection = readConnection(body);
    if (!connection.ok) return failure(connection.error, HTTP_STATUS.BAD_REQUEST);
    const kind = readReportKind(body);
    if (!kind.ok) return failure(kind.error, HTTP_STATUS.BAD_REQUEST);

    try {
      const data = await repository.readReports(connection.value, kind.value === null ? REPORT_KINDS : [kind.value]);
      requireAllReports(data);
      return buildReportResponse(kind.value, data, now());
    } catch (error: unknown) {
      return toErrorResponse(error, connection.value.password, REPORT_FAILURE_MESSAGE);
    }
  };

  return {
    plan: (request) => handleUpload(request, repository, PLAN_FAILURE_MESSAGE, respondWithPlan),
    load: (request) => handleUpload(request, repository, LOAD_FAILURE_MESSAGE, respondWithLoad),
    reports,
  };
}
