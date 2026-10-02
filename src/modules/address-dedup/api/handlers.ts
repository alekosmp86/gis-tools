import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import {
  DEFAULT_DB_HOST,
  DEFAULT_DB_PORT,
  DedupScope,
  ExportFormat,
} from "../constants";
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
import type { DbConnection, DedupRequest, DedupResult } from "../types";

/**
 * HTTP surface of the module. Handlers stay thin: parse and validate, call the orchestrator,
 * shape the response. Credentials are read from the POST body only, never from the query string,
 * and the password is scrubbed from any error text before it leaves.
 */

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  SERVER_ERROR: 500,
} as const;

const CONTENT_TYPE_BY_FORMAT: Readonly<Record<ExportFormat, string>> = {
  [ExportFormat.CSV]: "text/csv; charset=utf-8",
  [ExportFormat.GEOJSON]: "application/geo+json; charset=utf-8",
  [ExportFormat.LINKS]: "application/geo+json; charset=utf-8",
};

const SCRUBBED_SECRET = "***";

export interface DedupHandlers {
  readonly analyze: ModuleEndpointHandler;
  readonly exportResult: ModuleEndpointHandler;
}

type ParsedBody = Record<string, unknown>;

type ValidationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: string };

function jsonResponse(body: unknown, status: number = HTTP_STATUS.OK): Response {
  return Response.json(body, { status });
}

function failure(message: string, status: number): Response {
  return jsonResponse({ success: false, error: message }, status);
}

function scrubSecret(message: string, secret: string): string {
  return secret.length > 0 ? message.split(secret).join(SCRUBBED_SECRET) : message;
}

function toErrorResponse(error: unknown, secret: string): Response {
  const message = error instanceof Error ? error.message : "No se pudo completar el análisis.";
  return failure(scrubSecret(message, secret), HTTP_STATUS.SERVER_ERROR);
}

async function readJsonBody(request: Request): Promise<ParsedBody | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ParsedBody)
      : null;
  } catch {
    return null;
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readConnection(body: ParsedBody): ValidationResult<DbConnection> {
  const raw = (typeof body.connection === "object" && body.connection !== null
    ? body.connection
    : {}) as ParsedBody;
  const dbName = readText(raw.db_name);
  const user = readText(raw.user);
  const password = typeof raw.password === "string" ? raw.password : "";

  if (!dbName || !user) {
    return { ok: false, error: "El nombre de la base de datos y el usuario son obligatorios." };
  }
  if (password.length === 0) {
    return { ok: false, error: "La contraseña es obligatoria." };
  }

  return {
    ok: true,
    value: {
      host: readText(raw.host) || DEFAULT_DB_HOST,
      port: Number(raw.port) || DEFAULT_DB_PORT,
      db_name: dbName,
      user,
      password,
    },
  };
}

function readProvinceId(body: ParsedBody): ValidationResult<number> {
  const provinceId = body.provinceId;
  if (typeof provinceId !== "number" || !Number.isInteger(provinceId) || provinceId <= 0) {
    return { ok: false, error: "El identificador de provincia debe ser un entero positivo." };
  }
  return { ok: true, value: provinceId };
}

function readScope(body: ParsedBody): ValidationResult<DedupScope | undefined> {
  if (body.scope === undefined) return { ok: true, value: undefined };

  const knownScopes: ReadonlyArray<unknown> = Object.values(DedupScope);
  if (!knownScopes.includes(body.scope)) {
    return { ok: false, error: "El alcance indicado no es válido." };
  }
  return { ok: true, value: body.scope as DedupScope };
}

function readToggle(body: ParsedBody): ValidationResult<boolean | undefined> {
  if (body.protectedSiblingRemovesLone === undefined) return { ok: true, value: undefined };
  if (typeof body.protectedSiblingRemovesLone !== "boolean") {
    return { ok: false, error: "La opción protectedSiblingRemovesLone debe ser verdadero o falso." };
  }
  return { ok: true, value: body.protectedSiblingRemovesLone };
}

function readFormat(body: ParsedBody): ValidationResult<ExportFormat> {
  const knownFormats: ReadonlyArray<unknown> = Object.values(ExportFormat);
  if (!knownFormats.includes(body.format)) {
    return { ok: false, error: 'El formato debe ser "csv", "geojson" o "links".' };
  }
  return { ok: true, value: body.format as ExportFormat };
}

function readDedupRequest(body: ParsedBody): ValidationResult<DedupRequest> {
  const connection = readConnection(body);
  if (!connection.ok) return connection;
  const provinceId = readProvinceId(body);
  if (!provinceId.ok) return provinceId;
  const scope = readScope(body);
  if (!scope.ok) return scope;
  const toggle = readToggle(body);
  if (!toggle.ok) return toggle;

  return {
    ok: true,
    value: {
      connection: connection.value,
      provinceId: provinceId.value,
      scope: scope.value,
      protectedSiblingRemovesLone: toggle.value,
    },
  };
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
 * @param orchestrator - injected in tests; defaults to the real read-only Postgres repository.
 */
export function createDedupHandlers(
  orchestrator: DedupOrchestrator = new DedupOrchestrator(new PgAddressRepository())
): DedupHandlers {
  return {
    analyze: async (request) => {
      const body = await readJsonBody(request);
      if (!body) return failure("El cuerpo de la solicitud debe ser un JSON válido.", HTTP_STATUS.BAD_REQUEST);

      const dedupRequest = readDedupRequest(body);
      if (!dedupRequest.ok) return failure(dedupRequest.error, HTTP_STATUS.BAD_REQUEST);

      try {
        return toAnalyzeResponse(await orchestrator.analyze(dedupRequest.value));
      } catch (error: unknown) {
        return toErrorResponse(error, dedupRequest.value.connection.password);
      }
    },

    exportResult: async (request) => {
      const body = await readJsonBody(request);
      if (!body) return failure("El cuerpo de la solicitud debe ser un JSON válido.", HTTP_STATUS.BAD_REQUEST);

      const dedupRequest = readDedupRequest(body);
      if (!dedupRequest.ok) return failure(dedupRequest.error, HTTP_STATUS.BAD_REQUEST);
      const format = readFormat(body);
      if (!format.ok) return failure(format.error, HTTP_STATUS.BAD_REQUEST);

      try {
        const result = await orchestrator.analyze(dedupRequest.value);
        return toExportResponse(format.value, dedupRequest.value.provinceId, result);
      } catch (error: unknown) {
        return toErrorResponse(error, dedupRequest.value.connection.password);
      }
    },
  };
}
