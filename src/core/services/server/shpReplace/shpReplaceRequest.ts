import { resolveSchemaName } from "@/core/services/sqlStatements";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { InsertFieldDefault } from "@/core/types/comparison";
import { assertSafeSridNumber } from "@/core/services/server/shpReplace/replaceSql";
import type { PgShpConfig } from "@/core/services/server/shpReplace/pgShpSession";

export interface ShpStartRequest {
  connection: PgShpConfig;
  target: { schema_name: string; table_name: string };
  uploadId: string;
  mapping: ReplaceColumnMapping;
  sourceSrid: number;
  resetSequences: boolean;
  geometryProcessing: unknown;
  dryRun: boolean;
}

export class ShpRequestInvalidError extends Error {
  override readonly name = "ShpRequestInvalidError";
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 5432;
const MAX_PORT = 65535;
const DIGITS_PATTERN = /^\d+$/;

const invalid = (message: string): ShpRequestInvalidError => new ShpRequestInvalidError(message);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBlank = (value: unknown): boolean => value === undefined || value === null || value === "";

function readRequiredText(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw invalid(`El campo ${key} es obligatorio.`);
  }
  return value;
}

function readOptionalText(body: JsonRecord, key: string, fallback: string): string {
  if (isBlank(body[key])) return fallback;
  if (typeof body[key] !== "string") throw invalid(`El campo ${key} debe ser texto.`);
  return body[key] as string;
}

const toPortNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && DIGITS_PATTERN.test(value)) return Number(value);
  return NaN;
};

function readPort(body: JsonRecord): number {
  if (isBlank(body.port)) return DEFAULT_PORT;
  const port = toPortNumber(body.port);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw invalid(`El puerto debe ser un entero entre 1 y ${MAX_PORT}.`);
  }
  return port;
}

function readConfirmation(body: JsonRecord): void {
  if (body.confirm !== true) {
    throw invalid("Debe confirmar el reemplazo antes de iniciarlo.");
  }
}

function readBoolean(body: JsonRecord, key: string): boolean {
  if (typeof body[key] !== "boolean") throw invalid(`El campo ${key} debe ser verdadero o falso.`);
  return body[key] as boolean;
}

function readOptionalFlag(body: JsonRecord, key: string): boolean {
  return body[key] === undefined ? false : readBoolean(body, key);
}

function readSourceSrid(body: JsonRecord): number {
  try {
    return assertSafeSridNumber(body.sourceSrid);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : "El SRID de origen no es válido.");
  }
}

function readSourceByTarget(value: unknown): Record<string, string | null> {
  if (!isRecord(value)) throw invalid("El campo mapping.sourceByTarget debe ser un objeto.");
  const entries = Object.entries(value);
  if (!entries.every(([, source]) => source === null || typeof source === "string")) {
    throw invalid("Cada origen de mapping.sourceByTarget debe ser texto o nulo.");
  }
  return Object.fromEntries(entries) as Record<string, string | null>;
}

const isFieldDefault = (value: unknown): value is InsertFieldDefault =>
  isRecord(value) &&
  typeof value.fieldName === "string" &&
  typeof value.value === "string" &&
  typeof value.useRawExpression === "boolean";

function readDefaults(value: unknown): Record<string, InsertFieldDefault> {
  if (!isRecord(value)) throw invalid("El campo mapping.defaults debe ser un objeto.");
  const entries = Object.entries(value);
  if (!entries.every(([, fixed]) => isFieldDefault(fixed))) {
    throw invalid("Cada valor por defecto de mapping.defaults debe tener fieldName, value y useRawExpression.");
  }
  return Object.fromEntries(entries) as Record<string, InsertFieldDefault>;
}

function readMapping(body: JsonRecord): ReplaceColumnMapping {
  if (!isRecord(body.mapping)) throw invalid("El campo mapping es obligatorio.");
  return {
    sourceByTarget: readSourceByTarget(body.mapping.sourceByTarget),
    defaults: readDefaults(body.mapping.defaults),
  };
}

function parseRecord(raw: unknown): JsonRecord {
  if (!isRecord(raw)) throw invalid("El cuerpo de la petición debe ser un objeto JSON.");
  return raw;
}

export function parseStartRequest(raw: unknown): ShpStartRequest {
  const body = parseRecord(raw);
  readConfirmation(body);
  return {
    connection: {
      host: readOptionalText(body, "host", DEFAULT_HOST),
      port: readPort(body),
      db_name: readRequiredText(body, "db_name"),
      user: readRequiredText(body, "user"),
      password: readRequiredText(body, "password"),
    },
    target: {
      schema_name: resolveSchemaName(readOptionalText(body, "schema_name", "")),
      table_name: readRequiredText(body, "table_name"),
    },
    uploadId: readRequiredText(body, "uploadId"),
    mapping: readMapping(body),
    sourceSrid: readSourceSrid(body),
    resetSequences: readBoolean(body, "resetSequences"),
    geometryProcessing: body.geometryProcessing,
    dryRun: readOptionalFlag(body, "dryRun"),
  };
}

export function parseStatusJobId(searchParams: URLSearchParams): string {
  const jobId = searchParams.get("jobId");
  if (!jobId) throw invalid("Falta el parámetro jobId.");
  return jobId;
}
