import { PADRON_UNIT } from "../jobs/cargar-padrones/constants";
import type {
  GeometryMapItem,
  GeometryMapStagingKey,
  MissingPadron,
  PadronGeometryChange,
  PadronPair,
} from "../jobs/actualizar-padron/types";
import { MAP_CANDIDATE_TYPES } from "@/core/constants/mapConstants";
import type { AmbiguousGroupView, PairCandidateView } from "./pairChoices";
import { NO_DATA_TEXT } from "./reportFormat";

export const AREA_CHANGE_KIND = {
  SIGNED: "signed",
  NON_OVERLAP: "nonOverlap",
} as const;

export type AreaChangeKind = (typeof AREA_CHANGE_KIND)[keyof typeof AREA_CHANGE_KIND];

/** What the details of one outline show. `previous` names the old key of a pair, on its new outline. */
export interface PadronMapDetails {
  typePadron: string | null;
  department: string | null;
  locality: string | null;
  number: string | null;
  currentId: number | null;
  oldAreaM2: number | null;
  newAreaM2: number | null;
  areaChangePct: number | null;
  areaChangeKind: AreaChangeKind;
  centroidLat: number | null;
  centroidLon: number | null;
  previous: string | null;
}

/** One outline of a subject: its minimal label on the map, its details and the Catastro keys to search for it. */
export interface PadronMapOutline {
  label: string;
  details: PadronMapDetails;
  catastro: GeometryMapStagingKey[];
  /** The map colour type of the outline when its role colour is not enough (the candidates of an ambiguous group). */
  mapType?: string;
}

/** One padrón shown on the map. `items[i]` is the request item of `outlines[i]`: the two lists are parallel. */
export interface PadronMapSubject {
  title: string;
  items: GeometryMapItem[];
  outlines: PadronMapOutline[];
}

interface KeyFields {
  typePadron: string | null;
  department: string | null;
  locality: string | null;
  number: string | null;
}

type SharedFacts = Omit<PadronMapDetails, keyof KeyFields | "previous">;

interface OutlineEntry {
  item: GeometryMapItem;
  outline: PadronMapOutline;
}

const NUMBER_PATTERN = /^\d+$/;
const SUBJECT_TITLE = {
  GEOMETRY: "Geometría que cambia",
  PAIR: "Par por coincidencia parcial",
  MISSING: "Padrón que ya no está en el catastro",
  AMBIGUOUS: "Grupo ambiguo: elija el padrón anterior",
} as const;
const OUTLINE_SUFFIX = {
  OLD: "anterior",
  NEW: "nuevo",
  PART: "parte",
} as const;
const CANDIDATE_SUFFIX = "candidato";

const filled = (value: string | null): value is string => value !== null && value.trim() !== "";

/** The staging key of a new padrón, or null when the fields cannot name a staging row (the server would refuse them). */
function stagingKeyOf(fields: KeyFields): GeometryMapStagingKey | null {
  const { typePadron, department, locality, number } = fields;
  if (!filled(typePadron) || !filled(department) || !filled(number) || !NUMBER_PATTERN.test(number.trim())) return null;
  if (typePadron !== PADRON_UNIT.RURAL && typePadron !== PADRON_UNIT.URBANO) return null;
  if (typePadron === PADRON_UNIT.RURAL) {
    return { typePadron, department: department.trim(), locality: null, number: number.trim() };
  }
  if (!filled(locality)) return null;
  return { typePadron, department: department.trim(), locality: locality.trim(), number: number.trim() };
}

const textOf = (value: string | null): string => (value === null || value.trim() === "" ? NO_DATA_TEXT : value);

const keyFieldsOf = (fields: KeyFields): KeyFields => ({
  typePadron: fields.typePadron,
  department: fields.department,
  locality: fields.locality,
  number: fields.number,
});

/** The minimal label of an outline: type and number, then which outline it is, as `RURAL 1345 · anterior`. */
const labelOf = (fields: KeyFields, suffix: string): string => `${textOf(fields.typePadron)} ${textOf(fields.number)} · ${suffix}`;

const outlineOf = (
  fields: KeyFields,
  suffix: string,
  shared: SharedFacts,
  catastro: GeometryMapStagingKey[],
  previous: string | null
): PadronMapOutline => ({
  label: labelOf(fields, suffix),
  details: { ...keyFieldsOf(fields), ...shared, previous },
  catastro,
});

/** The old outline of a destination id, with no Catastro key: there is no new padrón to search for. */
const oldEntries = (oldId: number | null, fields: KeyFields, shared: SharedFacts): OutlineEntry[] =>
  oldId === null ? [] : [{ item: { oldId }, outline: outlineOf(fields, OUTLINE_SUFFIX.OLD, shared, [], null) }];

/** A new outline by its staging key, with that key as the Catastro search; a key that cannot name a row has no outline. */
const stagingEntries = (
  key: GeometryMapStagingKey | null,
  suffix: string,
  shared: SharedFacts,
  previous: string | null
): OutlineEntry[] =>
  key === null ? [] : [{ item: { staging: key }, outline: outlineOf(key, suffix, shared, [key], previous) }];

function subjectOf(title: string, entries: OutlineEntry[]): PadronMapSubject {
  return {
    title,
    items: entries.map((entry) => entry.item),
    outlines: entries.map((entry) => entry.outline),
  };
}

/** A changed geometry: the old outline by id and the new one by its staging key. The area column is the non-overlapping share. */
export function subjectOfGeometryChange(change: PadronGeometryChange): PadronMapSubject {
  const shared: SharedFacts = {
    currentId: change.oldId,
    oldAreaM2: change.oldAreaM2,
    newAreaM2: change.newAreaM2,
    areaChangePct: change.areaChangePct,
    areaChangeKind: AREA_CHANGE_KIND.NON_OVERLAP,
    centroidLat: change.centroidLat,
    centroidLon: change.centroidLon,
  };
  return subjectOf(SUBJECT_TITLE.GEOMETRY, [
    ...oldEntries(change.oldId, change, shared),
    ...stagingEntries(stagingKeyOf(change), OUTLINE_SUFFIX.NEW, shared, null),
  ]);
}

/** A pair (new key and old id): the old outline and the new one; the area column is the signed change. */
export function subjectOfPair(pair: PadronPair): PadronMapSubject {
  const shared: SharedFacts = {
    currentId: pair.oldId,
    oldAreaM2: pair.oldAreaM2,
    newAreaM2: pair.newAreaM2,
    areaChangePct: pair.areaChangePct,
    areaChangeKind: AREA_CHANGE_KIND.SIGNED,
    centroidLat: pair.centroidLat,
    centroidLon: pair.centroidLon,
  };
  const previous = `${textOf(pair.old.typePadron)} · ${textOf(pair.old.locality)} · ${textOf(pair.old.number)} (id ${pair.oldId ?? NO_DATA_TEXT})`;
  return subjectOf(SUBJECT_TITLE.PAIR, [
    ...oldEntries(pair.oldId, pair.old, shared),
    ...stagingEntries(stagingKeyOf(pair.new), OUTLINE_SUFFIX.NEW, shared, previous),
  ]);
}

/** The label of the candidate at `index` of an ambiguous group, shared by its map outline and its radio option. */
export const candidateLabelOf = (index: number): string => `${CANDIDATE_SUFFIX} ${index + 1}`;

/** The candidates the map of an ambiguous group can colour apart: the map request also carries the new padrón. */
export const MAP_CANDIDATE_LIMIT = MAP_CANDIDATE_TYPES.length;

const NO_AREA_FACTS: Omit<SharedFacts, "currentId"> = {
  oldAreaM2: null,
  newAreaM2: null,
  areaChangePct: null,
  areaChangeKind: AREA_CHANGE_KIND.SIGNED,
  centroidLat: null,
  centroidLon: null,
};

function candidateEntry(group: AmbiguousGroupView, candidate: PairCandidateView, index: number): OutlineEntry {
  const fields: KeyFields = {
    typePadron: candidate.oldType,
    department: group.department,
    locality: candidate.oldLocality,
    number: candidate.oldNumber,
  };
  const outline = outlineOf(fields, `${candidateLabelOf(index)} (id ${candidate.oldId})`, { ...NO_AREA_FACTS, currentId: candidate.oldId }, [], null);
  return { item: { oldId: candidate.oldId }, outline: { ...outline, mapType: MAP_CANDIDATE_TYPES[index] } };
}

/** An ambiguous group: the new padrón and each candidate old padrón (up to MAP_CANDIDATE_LIMIT), every candidate in its own colour. */
export function subjectOfAmbiguousGroup(group: AmbiguousGroupView): PadronMapSubject {
  const newFields: KeyFields = {
    typePadron: group.key.typePadron,
    department: group.department,
    locality: group.locality,
    number: group.key.number,
  };
  const candidates = group.candidates.slice(0, MAP_CANDIDATE_LIMIT).map((candidate, index) => candidateEntry(group, candidate, index));
  return subjectOf(SUBJECT_TITLE.AMBIGUOUS, [
    ...stagingEntries(stagingKeyOf(newFields), OUTLINE_SUFFIX.NEW, { ...NO_AREA_FACTS, currentId: null }, null),
    ...candidates,
  ]);
}

/** A missing padrón: its old outline and each replacing part (the department is the missing padrón's, the parts are in its province). */
export function subjectOfMissing(padron: MissingPadron): PadronMapSubject {
  const shared: SharedFacts = {
    currentId: padron.oldId,
    oldAreaM2: padron.oldAreaM2,
    newAreaM2: null,
    areaChangePct: null,
    areaChangeKind: AREA_CHANGE_KIND.SIGNED,
    centroidLat: padron.centroidLat,
    centroidLon: padron.centroidLon,
  };
  const partEntries = (padron.partKeys ?? []).flatMap((part) =>
    stagingEntries(
      stagingKeyOf({ typePadron: part.typePadron, department: padron.department, locality: part.locality, number: part.number }),
      OUTLINE_SUFFIX.PART,
      shared,
      null
    )
  );
  return subjectOf(SUBJECT_TITLE.MISSING, [...oldEntries(padron.oldId, padron, shared), ...partEntries]);
}
