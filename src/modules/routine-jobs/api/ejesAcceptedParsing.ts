import { ACCEPTED_KEYS_LIMIT, REAL_RUN_UNAVAILABLE_MESSAGE } from "../jobs/ejes-calles/constants";
import type { EjesAccepted } from "../jobs/ejes-calles/types";
import { invalid, isRecord, readRecord, type JsonRecord } from "./requestParsing";

const ACCEPTED_REQUIRED_MESSAGE = "El campo accepted es obligatorio y debe ser un objeto.";
const REF_PATTERN = /^-?\d+$/;

const ACCEPTED_KEY = {
  SPLITS: "splits",
  MERGES: "merges",
  PLAIN_REMOVALS: "plainRemovals",
} as const;

const ACCEPTED_KEYS: readonly string[] = Object.values(ACCEPTED_KEY);

function readAcceptedRecord(body: JsonRecord): JsonRecord {
  if (body.accepted === undefined || body.accepted === null) throw invalid(ACCEPTED_REQUIRED_MESSAGE);
  return readRecord(body, "accepted");
}

function assertKnownKeys(accepted: JsonRecord): void {
  const unknownKey = Object.keys(accepted).find((key) => !ACCEPTED_KEYS.includes(key));
  if (unknownKey !== undefined) throw invalid(`El campo accepted tiene una clave no admitida: ${unknownKey}.`);
}

/** Splits are not applied in this slice: a non-empty list keeps the message of the real run that is not available. */
function assertNoSplits(accepted: JsonRecord): void {
  const splits = accepted[ACCEPTED_KEY.SPLITS];
  if (splits === undefined) return;
  if (!Array.isArray(splits)) throw invalid(`El campo accepted.${ACCEPTED_KEY.SPLITS} debe ser una lista.`);
  if (splits.length > 0) throw invalid(REAL_RUN_UNAVAILABLE_MESSAGE);
}

/** The reftramo of one entry in its canonical text: an integer string, without leading zeros. */
function readRef(key: string, field: string, entry: unknown): string {
  if (!isRecord(entry)) throw invalid(`Cada elemento de accepted.${key} debe ser un objeto.`);
  const value = entry[field];
  if (typeof value !== "string" || !REF_PATTERN.test(value)) throw invalid(`El campo accepted.${key}.${field} debe ser un entero.`);
  return String(BigInt(value));
}

/** Absent means none. The list is refused above the limit, never truncated; a repeated reftramo is sent once. */
function readRefs(accepted: JsonRecord, key: string, field: string): string[] {
  const list = accepted[key];
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw invalid(`El campo accepted.${key} debe ser una lista.`);
  if (list.length > ACCEPTED_KEYS_LIMIT) throw invalid(`El campo accepted.${key} admite como máximo ${ACCEPTED_KEYS_LIMIT} elementos.`);
  return [...new Set(list.map((entry) => readRef(key, field, entry)))];
}

/** The accepted review rows of a real run (EJS-16, EJ-13): splits are refused until their slice, every other key is checked. */
export function readEjesAccepted(body: JsonRecord): EjesAccepted {
  const accepted = readAcceptedRecord(body);
  assertKnownKeys(accepted);
  assertNoSplits(accepted);
  return {
    plainRemovals: readRefs(accepted, ACCEPTED_KEY.PLAIN_REMOVALS, "ref"),
    merges: readRefs(accepted, ACCEPTED_KEY.MERGES, "newRef"),
  };
}
