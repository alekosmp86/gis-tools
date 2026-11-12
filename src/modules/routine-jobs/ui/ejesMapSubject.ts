import { getDiscrepancyLabel, MAP_SECTION_TYPE } from "@/core/constants/mapConstants";
import { PADRON_TYPE, type PadronType } from "../jobs/ejes-calles/constants";
import { EJES_MAP_ITEMS_LIMIT } from "../jobs/ejes-calles/domain/geometryMap";
import type { EjesMapItem, EjesMergeRow, EjesSplitRow, EjesTwinRow } from "../jobs/ejes-calles/types";
import { OUTLINE_ROLE, type OutlineLabel, type OutlineMapSubject, type OutlineRole } from "./map/outlineTypes";

export const EJES_SUBJECT_TITLE = {
  SPLIT: "División de tramo",
  MERGE: "Unión de tramos",
  TWIN: "Tramo repetido por localidad",
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

/** What a twin row says as a whole: the places of the section, its case and how long it lies near each type of padron. */
export interface EjesTwinFacts {
  department: string | null;
  localities: string[];
  twinClass: EjesTwinRow["class"];
  length: number | null;
  urbanLength: number | null;
  ruralLength: number | null;
}

/** One split, merge or twin row on the map. `items[i]` is the request item of `outlines[i]`; `twin` is set on a twin row only. */
export interface EjesMapSubject extends OutlineMapSubject<EjesMapItem, EjesMapOutline> {
  facts: EjesMapFacts;
  twin?: EjesTwinFacts;
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
  outline: { ref, role: OUTLINE_ROLE.OLD, label: labelOf(ref, OUTLINE_SUFFIX.OLD), mapType: MAP_SECTION_TYPE.OLD },
});

const newEntry = (ref: string): OutlineEntry => ({
  item: { newRef: ref },
  outline: { ref, role: OUTLINE_ROLE.NEW, label: labelOf(ref, OUTLINE_SUFFIX.NEW), mapType: MAP_SECTION_TYPE.NEW },
});

const ZONE_TYPE: Record<PadronType, string> = {
  [PADRON_TYPE.URBAN]: MAP_SECTION_TYPE.URBAN_ZONE,
  [PADRON_TYPE.RURAL]: MAP_SECTION_TYPE.RURAL_ZONE,
};

const zoneEntry = (ref: string, type: PadronType): OutlineEntry => ({
  item: { zoneOf: ref, type },
  outline: { ref, role: OUTLINE_ROLE.ZONE, label: getDiscrepancyLabel(ZONE_TYPE[type]), mapType: ZONE_TYPE[type] },
});

/** Zones are areas and go first so they lie below the lines; the new section goes last, on top. */
const DRAW_ORDER: Record<EjesMapOutline["role"], number> = {
  [OUTLINE_ROLE.ZONE]: 0,
  [OUTLINE_ROLE.OLD]: 1,
  [OUTLINE_ROLE.NEW]: 2,
};

function subjectOf(title: string, entries: OutlineEntry[], facts: EjesMapFacts, twin?: EjesTwinFacts): EjesMapSubject {
  const order = (entry: OutlineEntry): number => DRAW_ORDER[entry.outline.role];
  const shown = entries.slice(0, EJES_MAP_ITEMS_LIMIT).sort((first, second) => order(first) - order(second));
  return {
    title,
    items: shown.map((entry) => entry.item),
    outlines: shown.map((entry) => entry.outline),
    facts,
    ...(twin === undefined ? {} : { twin }),
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

/** A twin row: the zones with padrones near, below, then the section on top. A zone with no length near is not listed. */
export function subjectOfTwin(row: EjesTwinRow): EjesMapSubject {
  const zones = [
    (row.urbanLength ?? 0) > 0 ? zoneEntry(row.ref, PADRON_TYPE.URBAN) : null,
    (row.ruralLength ?? 0) > 0 ? zoneEntry(row.ref, PADRON_TYPE.RURAL) : null,
  ].filter((entry): entry is OutlineEntry => entry !== null);
  const facts: EjesMapFacts = { idcalle: row.idcalle, points: 0, coverage: null, oldLength: null, newLength: row.length, outsideLength: null };
  const twin: EjesTwinFacts = {
    department: row.department,
    localities: row.localities,
    twinClass: row.class,
    length: row.length,
    urbanLength: row.urbanLength,
    ruralLength: row.ruralLength,
  };
  return subjectOf(EJES_SUBJECT_TITLE.TWIN, [...zones, newEntry(row.ref)], facts, twin);
}

/** The note of a row that was cut at the request limit; null when every outline is shown. */
export const truncationNoteOf = (subject: EjesMapSubject): string | null =>
  subject.total > subject.items.length ? `Se muestran ${subject.items.length} de ${subject.total} tramos.` : null;
