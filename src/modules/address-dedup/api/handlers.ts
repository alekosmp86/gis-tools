import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { ExportFormat } from "../constants";
import {
  buildExportFilename,
  countWithoutCoordinates,
  groupsToGeoJsonLinks,
  rowsToCsv,
  rowsToGeoJsonPoints,
} from "../domain/export";
import { groupRows } from "../domain/groups";
import { DedupOrchestrator } from "../services/DedupOrchestrator";
import { PgAddressRepository } from "../services/PgAddressRepository";
import { PgRemovalRepository } from "../services/PgRemovalRepository";
import type { DedupRequest, DedupResult } from "../types";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "./httpResponses";
import { readConnection, readDedupRequest, readJsonBody, type ParsedBody, type ValidationResult } from "./requestReaders";
import { createRemovalHandlers, type RemovalHandlers } from "./removalHandlers";

/**
 * HTTP surface of the module. Handlers stay thin: parse and validate, call the orchestrator,
 * shape the response. Credentials are read from the POST body only, never from the query string,
 * and the password is scrubbed from any error text before it leaves.
 */

const CONTENT_TYPE_BY_FORMAT: Readonly<Record<ExportFormat, string>> = {
  [ExportFormat.CSV]: "text/csv; charset=utf-8",
  [ExportFormat.GEOJSON]: "application/geo+json; charset=utf-8",
  [ExportFormat.LINKS]: "application/geo+json; charset=utf-8",
};

const ANALYSIS_FAILURE_MESSAGE = "No se pudo completar el análisis.";
const PROVINCES_FAILURE_MESSAGE = "No se pudieron cargar los departamentos.";

export interface DedupHandlers extends RemovalHandlers {
  readonly provinces: ModuleEndpointHandler;
  readonly analyze: ModuleEndpointHandler;
  readonly exportResult: ModuleEndpointHandler;
}

function readFormat(body: ParsedBody): ValidationResult<ExportFormat> {
  const knownFormats: ReadonlyArray<unknown> = Object.values(ExportFormat);
  if (!knownFormats.includes(body.format)) {
    return { ok: false, error: 'El formato debe ser "csv", "geojson" o "links".' };
  }
  return { ok: true, value: body.format as ExportFormat };
}

function badRequest(message: string): Response {
  return failure(message, HTTP_STATUS.BAD_REQUEST);
}

function invalidBodyResponse(): Response {
  return badRequest("El cuerpo de la solicitud debe ser un JSON válido.");
}

async function readDedupInput(
  request: Request
): Promise<{ body: ParsedBody; dedupRequest: DedupRequest } | Response> {
  const body = await readJsonBody(request);
  if (!body) return invalidBodyResponse();

  const dedupRequest = readDedupRequest(body);
  if (!dedupRequest.ok) return badRequest(dedupRequest.error);

  return { body, dedupRequest: dedupRequest.value };
}

function toAnalyzeResponse(result: DedupResult): Response {
  return jsonResponse({
    success: true,
    summary: result.summary,
    groups: groupRows(result.rows),
    skippedWithoutCoordinates: countWithoutCoordinates(result.rows),
  });
}

function formatExportBody(format: ExportFormat, result: DedupResult): string {
  switch (format) {
    case ExportFormat.CSV:
      return rowsToCsv(result.rows);
    case ExportFormat.GEOJSON:
      return JSON.stringify(rowsToGeoJsonPoints(result.rows).featureCollection);
    case ExportFormat.LINKS:
      return JSON.stringify(groupsToGeoJsonLinks(groupRows(result.rows)));
  }
}

function toExportResponse(format: ExportFormat, provinceId: number, result: DedupResult): Response {
  const filename = buildExportFilename(provinceId, format);

  return new Response(formatExportBody(format, result), {
    status: HTTP_STATUS.OK,
    headers: {
      "Content-Type": CONTENT_TYPE_BY_FORMAT[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Builds the module's handlers around an orchestrator.
 *
 * @param orchestrator - injected in tests; defaults to the real Postgres repositories (read-only analysis, confirmed removal).
 */
export function createDedupHandlers(
  orchestrator: DedupOrchestrator = new DedupOrchestrator(
    new PgAddressRepository(),
    new PgRemovalRepository()
  )
): DedupHandlers {
  return {
    ...createRemovalHandlers(orchestrator),

    provinces: async (request) => {
      const body = await readJsonBody(request);
      if (!body) return invalidBodyResponse();

      const connection = readConnection(body);
      if (!connection.ok) return badRequest(connection.error);

      try {
        return jsonResponse({ success: true, provinces: await orchestrator.listProvinces(connection.value) });
      } catch (error: unknown) {
        return toErrorResponse(error, connection.value.password, PROVINCES_FAILURE_MESSAGE);
      }
    },

    analyze: async (request) => {
      const input = await readDedupInput(request);
      if (input instanceof Response) return input;
      const { dedupRequest } = input;

      try {
        return toAnalyzeResponse(await orchestrator.analyze(dedupRequest));
      } catch (error: unknown) {
        return toErrorResponse(error, dedupRequest.connection.password, ANALYSIS_FAILURE_MESSAGE);
      }
    },

    exportResult: async (request) => {
      const input = await readDedupInput(request);
      if (input instanceof Response) return input;
      const { body, dedupRequest } = input;
      const format = readFormat(body);
      if (!format.ok) return badRequest(format.error);

      try {
        const result = await orchestrator.analyze(dedupRequest);
        return toExportResponse(format.value, dedupRequest.provinceId, result);
      } catch (error: unknown) {
        return toErrorResponse(error, dedupRequest.connection.password, ANALYSIS_FAILURE_MESSAGE);
      }
    },
  };
}
