import { EJES_MAP_ITEMS_LIMIT } from "../jobs/ejes-calles/domain/geometryMap";
import type { EjesMapItem, EjesMergeRow, EjesSplitRow } from "../jobs/ejes-calles/types";
import { OUTLINE_ROLE, type OutlineLabel, type OutlineMapSubject, type OutlineRole } from "./map/outlineTypes";

export const EJES_SUBJECT_TITLE = {
  SPLIT: "División de tramo",
  MERGE: "Unión de tramos",
} as const;

const OUTLINE_SUFFIX = {
  OLD: "anterior",
  NEW: "nuevo",
} as const;

/** One outline of a subject: its label on the map, its `reftramo` and whether it is the old or the new section. */
export interface EjesMapOutline extends OutlineLabel {
  ref: string;
  role: OutlineRole;
}

/** What the row says as a whole, shown whether or not an outline is selected. */
export interface EjesMapFacts {
  idcalle: string | null;
  points: number;
  coverage: number | null;
  oldLength: number | null;
  newLength: number | null;
  outsideLength: number | null;
}

/** One split or merge on the map. `items[i]` is the request item of `outlines[i]`. */
export interface EjesMapSubject extends OutlineMapSubject<EjesMapItem, EjesMapOutline> {
  facts: EjesMapFacts;
  /** How many outlines the row has; larger than `items.length` when the row was cut at the request limit. */
  total: number;
}

interface OutlineEntry {
  item: EjesMapItem;
  outline: EjesMapOutline;
}

const labelOf = (ref: string, suffix: string): string => `${ref} · ${suffix}`;

const oldEntry = (ref: string): OutlineEntry => ({
  item: { oldRef: Number(ref) },
  outline: { ref, role: OUTLINE_ROLE.OLD, label: labelOf(ref, OUTLINE_SUFFIX.OLD) },
});

const newEntry = (ref: string): OutlineEntry => ({
  item: { newRef: ref },
  outline: { ref, role: OUTLINE_ROLE.NEW, label: labelOf(ref, OUTLINE_SUFFIX.NEW) },
});

function subjectOf(title: string, entries: OutlineEntry[], facts: EjesMapFacts): EjesMapSubject {
  const shown = entries.slice(0, EJES_MAP_ITEMS_LIMIT);
  return {
    title,
    items: shown.map((entry) => entry.item),
    outlines: shown.map((entry) => entry.outline),
    facts,
    total: entries.length,
  };
}

const factsOf = (row: EjesSplitRow | EjesMergeRow): EjesMapFacts => ({
  idcalle: row.idcalle,
  points: row.points,
  coverage: row.coverage,
  oldLength: row.oldLength,
  newLength: row.newLength,
  outsideLength: row.outsideLength,
});

/** A split: the old section first, then its new sections, so a cut at the request limit never drops the old one. */
export const subjectOfSplit = (row: EjesSplitRow): EjesMapSubject =>
  subjectOf(EJES_SUBJECT_TITLE.SPLIT, [oldEntry(row.oldRef), ...row.newRefs.map(newEntry)], factsOf(row));

/** A merge: the new section first, then the old sections it replaces. */
export const subjectOfMerge = (row: EjesMergeRow): EjesMapSubject =>
  subjectOf(EJES_SUBJECT_TITLE.MERGE, [newEntry(row.newRef), ...row.oldRefs.map(oldEntry)], factsOf(row));

/** The note of a row that was cut at the request limit; null when every outline is shown. */
export const truncationNoteOf = (subject: EjesMapSubject): string | null =>
  subject.total > subject.items.length ? `Se muestran ${subject.items.length} de ${subject.total} tramos.` : null;
