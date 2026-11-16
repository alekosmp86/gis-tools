import { EJES_ROLES, EJES_SUMMARY_COUNT_KEYS, type EjesTableRole } from "../jobs/ejes-calles/constants";
import { assertEjesRealRunEnabled } from "../jobs/ejes-calles/domain/realRunSwitch";
import { assertDistinctEjesTables } from "../jobs/ejes-calles/domain/tableRoles";
import type { EjesFingerprint, EjesParams, EjesSummary, EjesTableRef, EjesTables } from "../jobs/ejes-calles/types";
import { readEjesAccepted } from "./ejesAcceptedParsing";
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
const SUMMARY_COUNT_MESSAGE = "El resumen del análisis no tiene todos sus conteos numéricos: vuelva a analizar.";
const FINGERPRINT_MESSAGE = "El resumen del análisis no tiene la huella del origen: vuelva a analizar.";

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

function readFingerprint(summary: JsonRecord): EjesFingerprint {
  const fingerprint = readRecord(summary, "fingerprint");
  const rows = fingerprint.rows;
  const digest = fingerprint.digest;
  if (typeof rows !== "number" || !Number.isFinite(rows)) throw invalid(FINGERPRINT_MESSAGE);
  if (typeof digest !== "string" || digest === "") throw invalid(FINGERPRINT_MESSAGE);
  return { rows, digest };
}

function readSummary(body: JsonRecord): EjesSummary {
  if (body.summary === undefined || body.summary === null) throw invalid(SUMMARY_REQUIRED_MESSAGE);
  const summary = readRecord(body, "summary");
  const counts = readRecord(summary, "counts");
  return {
    counts: Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key) => [key, readCount(counts, key)])) as EjesSummary["counts"],
    fingerprint: readFingerprint(summary),
  };
}

function realRunParams(body: JsonRecord, config: EjesParams["config"], tables: EjesTables): EjesParams {
  assertEjesRealRunEnabled(invalid);
  if (config.password === "") throw invalid(PASSWORD_REQUIRED_MESSAGE);
  const accepted = readEjesAccepted(body);
  return { config, tables, dryRun: false, accepted, summary: readSummary(body) };
}

export function parseEjesCallesStartRequest(body: JsonRecord): EjesParams {
  const config = toDbConfig(parseConnection(body));
  const tables = readTables(body);
  const dryRun = readBoolean(body, "dryRun");
  const params: EjesParams = dryRun ? { config, tables, dryRun } : realRunParams(body, config, tables);
  assertTablesDistinct(params, assertDistinctEjesTables);
  return params;
}
