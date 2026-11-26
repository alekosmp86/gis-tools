import { getDiscrepancyLabel, MAP_SECTION_TYPE } from "@/core/constants/mapConstants";
import { PADRON_TYPE, type PadronType } from "../../jobs/ejes-ide/constants";
import { EJES_MAP_ITEMS_LIMIT } from "../../jobs/ejes-ide/domain/geometryMap";
import type {
  EjesGeoTwinRow,
  EjesMapItem,
  EjesMergeRow,
  EjesSplitRow,
  EjesTwinCopy,
  EjesTwinRow,
  EjesTwinUndecidedRow,
} from "../../jobs/ejes-ide/types";
import { isReplacementSplit } from "./ejesAccept";
import { OUTLINE_ROLE, type OutlineLabel, type OutlineMapSubject, type OutlineRole } from "../shared/map/outlineTypes";
import { textOrNoData } from "../shared/reportFormat";

const EJES_SUBJECT_TITLE = {
  SPLIT: "División de tramo",
  REPLACEMENT: "Reemplazo de tramo",
  MERGE: "Unión de tramos",
  RENUMBERED: "Tramo renumerado",
  TWIN: "Tramo repetido por localidad",
  HELD: "Renumeración retenida",
  GEO_TWIN: "Tramo gemelo por geometría",
  UNDECIDED: "Tramo con varias copias sin decidir",
} as const;

const OUTLINE_SUFFIX = {
  OLD: "anterior",
  NEW: "nuevo",
} as const;

/** One outline of a subject: its label on the map, its `reftramo` and whether it is the old or the new section. */
export interface EjesMapOutline extends OutlineLabel {
  ref: string;
  role: OutlineRole;
  /** The locality of the copy, on the outlines of a twin row. */
  locality?: string;
  /** Whether the copy would be dropped, on the copies of a twin row. */
  dropped?: boolean;
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
  dropLocalities: string[];
  insideLocalities: string[];
}

/** A `reftramo` with several copies and no decision yet: the copies the user picks from, in the row's order. */
interface EjesUndecidedFacts {
  ref: string;
  copies: EjesTwinCopy[];
}

/** One split, merge, twin or renumbered row on the map. `items[i]` is the request item of `outlines[i]`; `twin` and `renumbered` are set on their own rows only. */
export interface EjesMapSubject extends OutlineMapSubject<EjesMapItem, EjesMapOutline> {
  facts: EjesMapFacts;
  twin?: EjesTwinFacts;
  /** The largest distance in metres between the old and the new shape. */
  renumbered?: { hausdorff: number | null };
  geoTwin?: EjesGeoTwinRow;
  undecided?: EjesUndecidedFacts;
  held?: boolean;
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

const departmentEntry = (ref: string): OutlineEntry => ({
  item: { departmentOf: ref },
  outline: {
    ref,
    role: OUTLINE_ROLE.DEPARTMENT,
    label: getDiscrepancyLabel(MAP_SECTION_TYPE.DEPARTMENT),
    mapType: MAP_SECTION_TYPE.DEPARTMENT,
    featureLabels: true,
  },
});

const localitiesEntry = (ref: string): OutlineEntry => ({
  item: { localitiesOf: ref },
  outline: {
    ref,
    role: OUTLINE_ROLE.LOCALITY,
    label: getDiscrepancyLabel(MAP_SECTION_TYPE.LOCALITY),
    mapType: MAP_SECTION_TYPE.LOCALITY,
    featureLabels: true,
  },
});

const undecidedSectionEntry = (row: EjesTwinUndecidedRow): OutlineEntry => ({
  item: { newRef: row.ref },
  outline: {
    ref: row.ref,
    role: OUTLINE_ROLE.NEW,
    label: `${row.ref} · idcalle ${textOrNoData(row.idcalle)}`,
    mapType: MAP_SECTION_TYPE.NEW,
  },
});

/** Areas go first so they lie below the lines: departments, localities, padrone zones; the new section goes last, on top. */
const DRAW_ORDER: Record<EjesMapOutline["role"], number> = {
  [OUTLINE_ROLE.DEPARTMENT]: 0,
  [OUTLINE_ROLE.LOCALITY]: 1,
  [OUTLINE_ROLE.ZONE]: 2,
  [OUTLINE_ROLE.OLD]: 3,
  [OUTLINE_ROLE.NEIGHBOUR]: 3,
  [OUTLINE_ROLE.NEW]: 4,
  [OUTLINE_ROLE.ACCESS]: 5,
};

type SubjectExtras = Pick<EjesMapSubject, "twin" | "renumbered" | "geoTwin" | "held" | "undecided">;

function subjectOf(title: string, entries: OutlineEntry[], facts: EjesMapFacts, extras: SubjectExtras = {}): EjesMapSubject {
  const order = (entry: OutlineEntry): number => DRAW_ORDER[entry.outline.role];
  const shown = entries.slice(0, EJES_MAP_ITEMS_LIMIT).sort((first, second) => order(first) - order(second));
  return {
    title,
    items: shown.map((entry) => entry.item),
    outlines: shown.map((entry) => entry.outline),
    facts,
    ...extras,
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
  subjectOf(
    isReplacementSplit(row) ? EJES_SUBJECT_TITLE.REPLACEMENT : EJES_SUBJECT_TITLE.SPLIT,
    [oldEntry(row.oldRef), ...row.newRefs.map(newEntry)],
    factsOf(row)
  );

/** A merge: the new section first, then the old sections it replaces. */
export const subjectOfMerge = (row: EjesMergeRow): EjesMapSubject =>
  subjectOf(EJES_SUBJECT_TITLE.MERGE, [newEntry(row.newRef), ...row.oldRefs.map(oldEntry)], factsOf(row));

const COPY_STAYS = "se queda";
const COPY_DROPPED = "se quitaría";

/** A held renumber: the old section first, then every candidate new section it could have become. */
export const subjectOfHeldCandidates = (oldRef: string, newRefs: string[], idcalle: string | null, points: number): EjesMapSubject =>
  subjectOf(
    EJES_SUBJECT_TITLE.HELD,
    [oldEntry(oldRef), ...newRefs.map(newEntry)],
    { idcalle, points, coverage: null, oldLength: null, newLength: null, outsideLength: null },
    { held: true }
  );

const geoEntry = (ref: string, suffix: string, dropped: boolean): OutlineEntry => ({
  item: { newRef: ref },
  outline: {
    ref,
    role: OUTLINE_ROLE.NEW,
    label: labelOf(ref, suffix),
    mapType: dropped ? MAP_SECTION_TYPE.COPY_DROPPED : MAP_SECTION_TYPE.COPY_KEPT,
    dropped,
  },
});

/** A geometric twin: the winner of its group, then the copy the row would remove. Both lie on the same geometry, so both are labelled. */
export const subjectOfGeoTwin = (row: EjesGeoTwinRow): EjesMapSubject => {
  const kept = geoEntry(row.winnerRef, COPY_STAYS, false);
  const entries = row.ref === row.winnerRef ? [kept] : [kept, geoEntry(row.ref, COPY_DROPPED, true)];
  const facts: EjesMapFacts = { idcalle: row.idcalle, points: row.points, coverage: null, oldLength: null, newLength: row.winnerLength, outsideLength: null };
  return subjectOf(EJES_SUBJECT_TITLE.GEO_TWIN, entries, facts, { geoTwin: row });
};

/** A twin `reftramo` with no copy picked: the department and the localities its section crosses, the padrones near it, then the section once, since its copies share it. */
export const subjectOfUndecided = (row: EjesTwinUndecidedRow): EjesMapSubject =>
  subjectOf(
    EJES_SUBJECT_TITLE.UNDECIDED,
    [
      departmentEntry(row.ref),
      localitiesEntry(row.ref),
      zoneEntry(row.ref, PADRON_TYPE.URBAN),
      zoneEntry(row.ref, PADRON_TYPE.RURAL),
      undecidedSectionEntry(row),
    ],
    { idcalle: row.idcalle, points: row.points, coverage: null, oldLength: null, newLength: null, outsideLength: null },
    { undecided: { ref: row.ref, copies: row.copies } }
  );

/** The note of a row that was cut at the request limit; null when every outline is shown. */
export const truncationNoteOf = (subject: EjesMapSubject): string | null =>
  subject.total > subject.items.length ? `Se muestran ${subject.items.length} de ${subject.total} tramos.` : null;
