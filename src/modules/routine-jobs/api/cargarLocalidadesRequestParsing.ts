import { MAX_TARGETS } from "../jobs/cargar-localidades/constants";
import { assertDistinctTables } from "../jobs/cargar-localidades/domain/tableRoles";
import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/cargar-localidades/services/preflight";
import type { CargarLocalidadesParams, LocalityOptions, LocalityTableRef } from "../jobs/cargar-localidades/types";
import {
  invalid,
  parseConnection,
  readBoolean,
  readRecord,
  readRequiredText,
  readTolerance,
  toDbConfig,
  type JsonRecord,
} from "./requestParsing";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function assertTablesDistinct(params: CargarLocalidadesParams): void {
  try {
    assertDistinctTables(params);
  } catch (error: unknown) {
    throw invalid(messageOf(error));
  }
}

function parseLocalityOptions(body: JsonRecord): LocalityOptions {
  const options = readRecord(body, "options");
  return {
    tolerance: readTolerance(options),
    updateGeometries: readBoolean(options, "updateGeometries"),
  };
}

function parseTargetEntry(entry: unknown, index: number): LocalityTableRef {
  if (!isRecord(entry)) throw invalid(`La tabla de destino ${index + 1} debe ser un objeto.`);
  return { schema: readRequiredText(entry, "schema"), table: readRequiredText(entry, "table") };
}

function parseTargets(body: JsonRecord): LocalityTableRef[] {
  const value = body.targets;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS) {
    throw invalid(`El campo targets debe listar entre 1 y ${MAX_TARGETS} tablas de destino.`);
  }
  return value.map((entry: unknown, index: number) => parseTargetEntry(entry, index));
}

export function parseCargarLocalidadesStartRequest(body: JsonRecord): CargarLocalidadesParams {
  const params: CargarLocalidadesParams = {
    config: toDbConfig(parseConnection(body)),
    stagingSchema: readRequiredText(body, "stagingSchema"),
    padronTable: readRequiredText(body, "padronTable"),
    localityStagingTable: readRequiredText(body, "localityStagingTable"),
    provinceSchema: readRequiredText(body, "provinceSchema"),
    provinceTable: readRequiredText(body, "provinceTable"),
    targets: parseTargets(body),
    options: parseLocalityOptions(body),
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params);
  return params;
}
