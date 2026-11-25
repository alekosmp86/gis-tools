import { EJES_SPLIT_POINTS_ROLES, SPLIT_POINTS_PAGE_LIMIT, type EjesTableRole } from "../../jobs/ejes-ide/constants";
import type { EjesSplitPointsParams, EjesTableRef } from "../../jobs/ejes-ide/types";
import { invalid, parseConnection, readRecord, readRequiredText, toDbConfig, type JsonRecord } from "../requestParsing";

const SPLIT_POINTS_KEY = { OLD_REF: "oldRef", OFFSET: "offset", LIMIT: "limit", JOB_ID: "jobId", TABLES: "tables" } as const;
const OLD_REF_PATTERN = /^-?\d+$/;
const INT4_MAX = 2147483647;
const OLD_REF_MESSAGE = "El campo oldRef debe ser un entero.";
const OFFSET_MESSAGE = "El campo offset debe ser un entero mayor o igual que 0.";
const LIMIT_MESSAGE = `El campo limit debe ser un entero entre 1 y ${SPLIT_POINTS_PAGE_LIMIT}.`;

function readOldRef(body: JsonRecord): string {
  const value = body[SPLIT_POINTS_KEY.OLD_REF];
  if (typeof value !== "string" && typeof value !== "number") throw invalid(OLD_REF_MESSAGE);
  const text = String(value).trim();
  if (!OLD_REF_PATTERN.test(text) || Math.abs(Number(text)) > INT4_MAX) throw invalid(OLD_REF_MESSAGE);
  return String(BigInt(text));
}

function readWindow(body: JsonRecord, key: string, fallback: number, isValid: (value: number) => boolean, message: string): number {
  const value = body[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || !isValid(value)) throw invalid(message);
  return value;
}

function readTableRef(tables: JsonRecord, role: EjesTableRole): EjesTableRef {
  const entry = readRecord(tables, role);
  return { schema: readRequiredText(entry, "schema"), table: readRequiredText(entry, "table") };
}

/** The tables the page reads by key or small lookup: the five of `EJES_SPLIT_POINTS_ROLES`, nothing else. */
function readSplitTables(body: JsonRecord): EjesSplitPointsParams["tables"] {
  const tables = readRecord(body, SPLIT_POINTS_KEY.TABLES);
  return Object.fromEntries(EJES_SPLIT_POINTS_ROLES.map((role) => [role, readTableRef(tables, role)])) as EjesSplitPointsParams["tables"];
}

/** One page of the review points of one split of the dry run `jobId`: the connection, the five tables, the old `reftramo` and the window. */
export function parseEjesSplitPointsRequest(body: JsonRecord): EjesSplitPointsParams {
  return {
    config: toDbConfig(parseConnection(body)),
    tables: readSplitTables(body),
    jobId: readRequiredText(body, SPLIT_POINTS_KEY.JOB_ID),
    oldRef: readOldRef(body),
    offset: readWindow(body, SPLIT_POINTS_KEY.OFFSET, 0, (value) => value >= 0, OFFSET_MESSAGE),
    limit: readWindow(
      body,
      SPLIT_POINTS_KEY.LIMIT,
      SPLIT_POINTS_PAGE_LIMIT,
      (value) => value >= 1 && value <= SPLIT_POINTS_PAGE_LIMIT,
      LIMIT_MESSAGE
    ),
  };
}
