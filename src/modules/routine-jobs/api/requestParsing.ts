import type { DbConfig } from "@/core/types/db";
import {
  ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE,
  type ActualizarTableRole,
} from "../jobs/actualizar-padron/constants";
import {
  CLEAR_MODE,
  REQUIRED_COLUMNS_BY_ROLE,
  type ClearMode,
  type TableRole,
} from "../jobs/cargar-padrones/constants";
import type { LoadOptions } from "../jobs/cargar-padrones/domain/loadSql";
import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/cargar-padrones/services/preflight";
import { DISTINCT_TABLES_MESSAGE } from "../jobs/cargar-padrones/services/resolveLayouts";
import {
  LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE,
  type LocalidadesTableRole,
} from "../jobs/cargar-localidades/constants";
import type { PgRunConnection } from "../jobs/cargar-padrones/services/openPgSession";
import type { CargarPadronesParams } from "../jobs/cargar-padrones/types";
import { UNIT_REQUIRED_COLUMNS_BY_ROLE, type UnitTableRole } from "../jobs/unidad-territorial/constants";
import {
  COMPLETAR_REQUIRED_COLUMNS_BY_ROLE,
  type CompletarTableRole,
} from "../jobs/completar-unidad-territorial/constants";

export class RequestInvalidError extends Error {
  override readonly name = "RequestInvalidError";
}

export type JsonRecord = Record<string, unknown>;

export interface CatalogRequest {
  connection: PgRunConnection;
  schema: string;
}

export type ColumnsRole = TableRole | ActualizarTableRole | LocalidadesTableRole | UnitTableRole | CompletarTableRole;

export interface ColumnsRequest extends CatalogRequest {
  table: string;
  role: ColumnsRole;
  required: readonly string[];
}

const MIN_PORT = 1;
const MAX_PORT = 65535;
const DIGITS_PATTERN = /^\d+$/;
const COLUMNS_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  ...REQUIRED_COLUMNS_BY_ROLE,
  ...ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE,
  ...LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE,
  ...UNIT_REQUIRED_COLUMNS_BY_ROLE,
  ...COMPLETAR_REQUIRED_COLUMNS_BY_ROLE,
};
const ROLE_NAMES: readonly string[] = Object.keys(COLUMNS_BY_ROLE);
const CLEAR_MODES: readonly string[] = Object.values(CLEAR_MODE);

export const invalid = (message: string): RequestInvalidError => new RequestInvalidError(message);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Runs a domain check on the parsed params and reports its failure as an invalid request. */
export function assertTablesDistinct<Params>(params: Params, check: (params: Params) => void): void {
  try {
    check(params);
  } catch (error: unknown) {
    throw invalid(messageOf(error));
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readRequiredText(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw invalid(`El campo ${key} es obligatorio.`);
  }
  return value;
}

function readText(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw invalid(`El campo ${key} debe ser texto.`);
  return value;
}

export function readBoolean(body: JsonRecord, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") throw invalid(`El campo ${key} debe ser verdadero o falso.`);
  return value;
}

export function readTolerance(options: JsonRecord): number {
  const value = options.tolerance;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalid("El campo tolerance debe ser un número mayor o igual que 0.");
  }
  return value;
}

export function readRecord(body: JsonRecord, key: string): JsonRecord {
  const value = body[key];
  if (!isRecord(value)) throw invalid(`El campo ${key} debe ser un objeto.`);
  return value;
}

function readPort(connection: JsonRecord): string {
  const raw = connection.port;
  const port =
    typeof raw === "number" ? raw : typeof raw === "string" && DIGITS_PATTERN.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw invalid(`El puerto debe ser un entero entre ${MIN_PORT} y ${MAX_PORT}.`);
  }
  return String(port);
}

export function parseConnection(body: JsonRecord): PgRunConnection {
  const connection = readRecord(body, "connection");
  return {
    host: readRequiredText(connection, "host"),
    port: readPort(connection),
    db_name: readRequiredText(connection, "db_name"),
    user: readRequiredText(connection, "user"),
    password: readText(connection, "password"),
  };
}

const isColumnsRole = (value: string): value is ColumnsRole => ROLE_NAMES.includes(value);

const isClearMode = (value: string): value is ClearMode => CLEAR_MODES.includes(value);

export async function readJsonRecord(request: Request): Promise<JsonRecord> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw invalid("El cuerpo de la petición no es JSON válido.");
  }
  if (!isRecord(parsed)) throw invalid("El cuerpo de la petición debe ser un objeto JSON.");
  return parsed;
}

export function parseCatalogRequest(body: JsonRecord): CatalogRequest {
  return {
    connection: parseConnection(body),
    schema: readRequiredText(body, "schema"),
  };
}

export function parseColumnsRequest(body: JsonRecord): ColumnsRequest {
  const catalog = parseCatalogRequest(body);
  const table = readRequiredText(body, "table");
  const role = readRequiredText(body, "role");
  if (!isColumnsRole(role)) throw invalid(`El campo role debe ser ${ROLE_NAMES.join(", ")}.`);
  return { ...catalog, table, role, required: COLUMNS_BY_ROLE[role] };
}

function parseClearMode(options: JsonRecord): ClearMode {
  const clearMode = readRequiredText(options, "clearMode");
  if (!isClearMode(clearMode)) throw invalid(`El campo clearMode debe ser ${CLEAR_MODES.join(" o ")}.`);
  return clearMode;
}

function parseOptions(value: unknown): LoadOptions {
  if (!isRecord(value)) throw invalid("El campo options debe ser un objeto.");
  const clearMode = parseClearMode(value);
  return {
    repair: readBoolean(value, "repair"),
    clearMode,
    resetSequences: readBoolean(value, "resetSequences"),
  };
}

export function toDbConfig(connection: PgRunConnection): DbConfig {
  return {
    host: connection.host,
    port: String(connection.port),
    db_name: connection.db_name,
    user: connection.user,
    password: connection.password,
    schema_name: "",
    table_name: "",
  };
}

export function parseStartRequest(body: JsonRecord): CargarPadronesParams {
  const connection = parseConnection(body);
  const schema = readRequiredText(body, "schema");
  const ruralTable = readRequiredText(body, "ruralTable");
  const urbanoTable = readRequiredText(body, "urbanoTable");
  const targetTable = readRequiredText(body, "targetTable");
  const options = parseOptions(body.options);
  const dryRun = readBoolean(body, "dryRun");
  const confirm = readBoolean(body, "confirm");
  if (!dryRun && !confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  const tables = [ruralTable, urbanoTable, targetTable];
  if (new Set(tables).size !== tables.length) throw invalid(DISTINCT_TABLES_MESSAGE);
  return {
    config: toDbConfig(connection),
    schema,
    ruralTable,
    urbanoTable,
    targetTable,
    options,
    dryRun,
    confirm,
  };
}

export function parseStatusJobId(params: URLSearchParams): string {
  const jobId = params.get("jobId");
  if (!jobId) throw invalid("El parámetro jobId es obligatorio.");
  return jobId;
}
