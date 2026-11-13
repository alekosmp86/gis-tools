import {
  EJES_ROLES,
  EJES_SUMMARY_COUNT_KEYS,
  REAL_RUN_UNAVAILABLE_MESSAGE,
  type EjesTableRole,
} from "../jobs/ejes-calles/constants";
import { assertEjesRealRunEnabled } from "../jobs/ejes-calles/domain/realRunSwitch";
import { assertDistinctEjesTables } from "../jobs/ejes-calles/domain/tableRoles";
import type { EjesParams, EjesSummary, EjesTableRef, EjesTables } from "../jobs/ejes-calles/types";
import {
  assertTablesDistinct,
  invalid,
  parseConnection,
  readBoolean,
  readRecord,
  readRequiredText,
  toDbConfig,
  type JsonRecord,
} from "./requestParsing";

const PASSWORD_REQUIRED_MESSAGE = "La carga real de ejes de calles necesita la contraseña de la conexión.";
const SUMMARY_REQUIRED_MESSAGE = "Para cargar primero analice los ejes: falta el resumen del análisis.";
const ACCEPTED_REQUIRED_MESSAGE = "El campo accepted es obligatorio y debe ser un objeto.";
const SUMMARY_COUNT_MESSAGE = "El resumen del análisis no tiene todos sus conteos numéricos: vuelva a analizar.";
const ACCEPTED_LIST_KEYS = ["splits", "merges", "removals", "plainRemovals"] as const;

function readTableRef(tables: JsonRecord, role: EjesTableRole): EjesTableRef {
  const entry = readRecord(tables, role);
  return { schema: readRequiredText(entry, "schema"), table: readRequiredText(entry, "table") };
}

function readTables(body: JsonRecord): EjesTables {
  const tables = readRecord(body, "tables");
  return Object.fromEntries(EJES_ROLES.map((role) => [role, readTableRef(tables, role)])) as EjesTables;
}

function readCount(counts: JsonRecord, key: string): number {
  const value = counts[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(SUMMARY_COUNT_MESSAGE);
  return value;
}

function readSummary(body: JsonRecord): EjesSummary {
  if (body.summary === undefined || body.summary === null) throw invalid(SUMMARY_REQUIRED_MESSAGE);
  const counts = readRecord(readRecord(body, "summary"), "counts");
  return { counts: Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key) => [key, readCount(counts, key)])) as EjesSummary["counts"] };
}

/** Slice 1 applies no accepted split, merge or removal: asking for one keeps the message of a real run that is not available. */
function assertNothingAccepted(body: JsonRecord): void {
  if (body.accepted === undefined || body.accepted === null) throw invalid(ACCEPTED_REQUIRED_MESSAGE);
  const accepted = readRecord(body, "accepted");
  for (const key of ACCEPTED_LIST_KEYS) {
    const list = accepted[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw invalid(`El campo accepted.${key} debe ser una lista.`);
    if (list.length > 0) throw invalid(REAL_RUN_UNAVAILABLE_MESSAGE);
  }
}

export function parseEjesCallesStartRequest(body: JsonRecord): EjesParams {
  const config = toDbConfig(parseConnection(body));
  const tables = readTables(body);
  const dryRun = readBoolean(body, "dryRun");
  if (!dryRun) {
    assertEjesRealRunEnabled(invalid);
    if (config.password === "") throw invalid(PASSWORD_REQUIRED_MESSAGE);
    assertNothingAccepted(body);
  }
  const params: EjesParams = { config, tables, dryRun, ...(dryRun ? {} : { summary: readSummary(body) }) };
  assertTablesDistinct(params, assertDistinctEjesTables);
  return params;
}
