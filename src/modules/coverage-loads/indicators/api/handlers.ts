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
import { REPORT_CONTENT_TYPE, ReportKind } from "../constants";
import {
  buildPlan,
  listLoadBlockers,
  LoadRefusedError,
  rejectRepeatedDates,
  splitOutcomes,
} from "../domain/plan";
import { buildReportCsv, buildReportFileName } from "../domain/reportCsv";
import type { IndicatorsRepository } from "../services/IndicatorsRepository";
import { PgIndicatorsRepository } from "../services/PgIndicatorsRepository";
import type { IndicatorsPlan, ParsedCut } from "../types";
import {
  ACCEPT_SHRINK_FIELD,
  CONFIRM_FIELD,
  CONNECTION_FIELD,
  readFlag,
  checkDeclaredBodySize,
  readForm,
  readUploads,
} from "./uploadReaders";

/**
 * HTTP surface of the Indicadores LTE tool. Handlers stay thin: parse and validate, call the
 * domain and the repository, shape the response. Credentials are read from the POST body only,
 * and the password is scrubbed from any error text before it leaves.
 */

const PLAN_FAILURE_MESSAGE = "No se pudo preparar el plan de carga.";
const LOAD_FAILURE_MESSAGE = "No se pudo completar la carga.";
const REPORT_FAILURE_MESSAGE = "No se pudo generar el reporte.";
const CONFIRMATION_REQUIRED_MESSAGE = "Hay que confirmar la carga para escribir en el histórico.";
const INVALID_JSON_MESSAGE = "El cuerpo de la solicitud debe ser un JSON válido.";
const INVALID_KIND_MESSAGE = "El tipo de reporte no es válido.";

export interface IndicatorsHandlers {
  readonly plan: ModuleEndpointHandler;
  readonly load: ModuleEndpointHandler;
  readonly reports: ModuleEndpointHandler;
}

export interface IndicatorsHandlerDependencies {
  readonly repository?: IndicatorsRepository;
  /** The clock for report file names; injected so tests are not tied to today. */
  readonly now?: () => Date;
}

interface PreparedUpload {
  readonly connection: DbConnection;
  readonly form: FormData;
  readonly cuts: ParsedCut[];
  readonly plan: IndicatorsPlan;
}

type UploadResponder = (upload: PreparedUpload) => Promise<Response>;

function refusalResponse(message: string, plan: IndicatorsPlan): Response {
  return failure(message, HTTP_STATUS.CONFLICT, { plan });
}

/** Parses the multipart request and builds the plan against the database; shared by plan and load. */
async function buildUpload(
  form: FormData,
  connection: DbConnection,
  repository: IndicatorsRepository
): Promise<PreparedUpload | Response> {
  const uploads = await readUploads(form);
  if (!uploads.ok) return failure(uploads.error, HTTP_STATUS.BAD_REQUEST);

  const { cuts, fileErrors } = splitOutcomes(rejectRepeatedDates(uploads.value));
  const history = await repository.inspectHistory(
    connection,
    cuts.map((cut) => cut.fechaact)
  );
  return { connection, form, cuts, plan: buildPlan(cuts, fileErrors, history) };
}

async function handleUpload(
  request: Request,
  repository: IndicatorsRepository,
  failureMessage: string,
  respond: UploadResponder
): Promise<Response> {
  const oversize = checkDeclaredBodySize(request);
  if (oversize !== null) return failure(oversize, HTTP_STATUS.PAYLOAD_TOO_LARGE);
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

function readReportKind(body: ParsedBody): ValidationResult<ReportKind> {
  const knownKinds: ReadonlyArray<unknown> = Object.values(ReportKind);
  return knownKinds.includes(body.kind)
    ? { ok: true, value: body.kind as ReportKind }
    : { ok: false, error: INVALID_KIND_MESSAGE };
}

function toCsvResponse(kind: ReportKind, content: Uint8Array, runDay: Date): Response {
  const fileName = buildReportFileName(kind, runDay);
  return new Response(content.slice().buffer, {
    status: HTTP_STATUS.OK,
    headers: {
      "Content-Type": REPORT_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
    },
  });
}

export function createIndicatorsHandlers(dependencies: IndicatorsHandlerDependencies = {}): IndicatorsHandlers {
  const repository = dependencies.repository ?? new PgIndicatorsRepository();
  const now = dependencies.now ?? (() => new Date());

  const respondWithPlan: UploadResponder = async (upload) => jsonResponse({ success: true, plan: upload.plan });

  const respondWithLoad: UploadResponder = async (upload) => {
    if (!readFlag(upload.form, CONFIRM_FIELD)) {
      return failure(CONFIRMATION_REQUIRED_MESSAGE, HTTP_STATUS.BAD_REQUEST);
    }
    const acceptShrink = readFlag(upload.form, ACCEPT_SHRINK_FIELD);
    const blockers = listLoadBlockers(upload.plan, acceptShrink);
    if (blockers.length > 0) return refusalResponse(blockers.join(" "), upload.plan);

    const result = await repository.loadCuts(upload.connection, { cuts: upload.cuts, acceptShrink });
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
      const rows = await repository.readReport(connection.value, kind.value);
      return toCsvResponse(kind.value, buildReportCsv(kind.value, rows), now());
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
