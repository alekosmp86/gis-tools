import { ACCEPTED_CHOICES_LIMIT, ACCEPTED_KEYS_LIMIT } from "../jobs/ejes-calles/constants";
import type { EjesAccepted, EjesAcceptedSplit, EjesPointChoice } from "../jobs/ejes-calles/types";
import { invalid, isRecord, readRecord, type JsonRecord } from "./requestParsing";

const ACCEPTED_REQUIRED_MESSAGE = "El campo accepted es obligatorio y debe ser un objeto.";
const REF_PATTERN = /^-?\d+$/;

const ACCEPTED_KEY = {
  SPLITS: "splits",
  MERGES: "merges",
  PLAIN_REMOVALS: "plainRemovals",
  TWIN_REMOVALS: "twinRemovals",
} as const;

const SPLIT_KEY = { OLD_REF: "oldRef", CHOICES: "choices" } as const;
const CHOICE_KEY = { POINT_ID: "pointId", NEW_REF: "newRef" } as const;

const ACCEPTED_KEYS: readonly string[] = Object.values(ACCEPTED_KEY);

function readAcceptedRecord(body: JsonRecord): JsonRecord {
  if (body.accepted === undefined || body.accepted === null) throw invalid(ACCEPTED_REQUIRED_MESSAGE);
  return readRecord(body, "accepted");
}

function assertOnlyKeys(record: JsonRecord, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) throw invalid(`El campo ${path} tiene una clave no admitida: ${unknownKey}.`);
}

/** The reftramo of one entry in its canonical text: an integer string, without leading zeros. */
function canonicalRef(path: string, value: unknown): string {
  if (typeof value !== "string" || !REF_PATTERN.test(value)) throw invalid(`El campo ${path} debe ser un entero.`);
  return String(BigInt(value));
}

/** Absent means none. The list is refused above the limit, never truncated; a repeated reftramo is sent once. */
function readRefs(accepted: JsonRecord, key: string, field: string): string[] {
  const list = accepted[key];
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw invalid(`El campo accepted.${key} debe ser una lista.`);
  if (list.length > ACCEPTED_KEYS_LIMIT) throw invalid(`El campo accepted.${key} admite como máximo ${ACCEPTED_KEYS_LIMIT} elementos.`);
  return [
    ...new Set(
      list.map((entry) => {
        if (!isRecord(entry)) throw invalid(`Cada elemento de accepted.${key} debe ser un objeto.`);
        return canonicalRef(`accepted.${key}.${field}`, entry[field]);
      })
    ),
  ];
}

function readChoice(entry: unknown): EjesPointChoice {
  if (!isRecord(entry)) throw invalid("Cada elemento de accepted.splits.choices debe ser un objeto.");
  assertOnlyKeys(entry, Object.values(CHOICE_KEY), "accepted.splits.choices");
  return {
    pointId: canonicalRef("accepted.splits.choices.pointId", entry[CHOICE_KEY.POINT_ID]),
    newRef: canonicalRef("accepted.splits.choices.newRef", entry[CHOICE_KEY.NEW_REF]),
  };
}

function readChoices(entry: JsonRecord): EjesPointChoice[] {
  const list = entry[SPLIT_KEY.CHOICES];
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw invalid("El campo accepted.splits.choices debe ser una lista.");
  if (list.length > ACCEPTED_CHOICES_LIMIT) throw invalid(`El campo accepted.splits.choices admite como máximo ${ACCEPTED_CHOICES_LIMIT} elementos.`);
  return list.map(readChoice);
}

function readSplitEntry(entry: unknown): EjesAcceptedSplit {
  if (!isRecord(entry)) throw invalid("Cada elemento de accepted.splits debe ser un objeto.");
  assertOnlyKeys(entry, Object.values(SPLIT_KEY), "accepted.splits");
  return { oldRef: canonicalRef("accepted.splits.oldRef", entry[SPLIT_KEY.OLD_REF]), choices: readChoices(entry) };
}

/** One entry per old `reftramo`: the choices of a repeated one are joined; the same point chosen twice must name the same piece. */
function mergeSplitEntries(entries: readonly EjesAcceptedSplit[]): EjesAcceptedSplit[] {
  const choicesByRef = new Map<string, Map<string, string>>();
  for (const entry of entries) {
    const choices = choicesByRef.get(entry.oldRef) ?? new Map<string, string>();
    for (const choice of entry.choices) {
      const chosen = choices.get(choice.pointId);
      if (chosen !== undefined && chosen !== choice.newRef) {
        throw invalid(`El punto ${choice.pointId} del tramo ${entry.oldRef} tiene más de un destino.`);
      }
      choices.set(choice.pointId, choice.newRef);
    }
    choicesByRef.set(entry.oldRef, choices);
  }
  return Array.from(choicesByRef, ([oldRef, choices]) => ({
    oldRef,
    choices: Array.from(choices, ([pointId, newRef]) => ({ pointId, newRef })),
  }));
}

/** Splits are refused above the key limit, choices above their own limit (over every split together); a repeated split is sent once. */
function readSplits(accepted: JsonRecord): EjesAcceptedSplit[] {
  const list = accepted[ACCEPTED_KEY.SPLITS];
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw invalid(`El campo accepted.${ACCEPTED_KEY.SPLITS} debe ser una lista.`);
  if (list.length > ACCEPTED_KEYS_LIMIT) throw invalid(`El campo accepted.splits admite como máximo ${ACCEPTED_KEYS_LIMIT} elementos.`);
  const splits = mergeSplitEntries(list.map(readSplitEntry));
  const choiceCount = splits.reduce((total, split) => total + split.choices.length, 0);
  if (choiceCount > ACCEPTED_CHOICES_LIMIT) throw invalid(`El campo accepted.splits admite como máximo ${ACCEPTED_CHOICES_LIMIT} destinos de puntos en total.`);
  return splits;
}

/** The accepted review rows of a real run (EJS-16, EJ-13): splits with their choices, plain removals and merges; every other key is refused. */
export function readEjesAccepted(body: JsonRecord): EjesAccepted {
  const accepted = readAcceptedRecord(body);
  assertOnlyKeys(accepted, ACCEPTED_KEYS, "accepted");
  return {
    splits: readSplits(accepted),
    plainRemovals: readRefs(accepted, ACCEPTED_KEY.PLAIN_REMOVALS, "ref"),
    merges: readRefs(accepted, ACCEPTED_KEY.MERGES, "newRef"),
    twinRemovals: readRefs(accepted, ACCEPTED_KEY.TWIN_REMOVALS, "ref"),
  };
}
