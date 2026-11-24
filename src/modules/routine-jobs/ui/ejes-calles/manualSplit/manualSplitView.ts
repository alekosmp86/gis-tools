import type { Feature, FeatureCollection, Geometry } from "geojson";
import { MAP_MANUAL_PIECE_TYPES, MAP_MANUAL_POINT_REVIEW_TYPE, MAP_MANUAL_POINT_TYPES, MAP_SECTION_TYPE } from "@/core/constants/mapConstants";
import { MANUAL_CANDIDATE_MAX_RADIUS_M, MANUAL_CANDIDATE_RADIUS_M, MANUAL_SPLIT_PIECES_LIMIT, REPLACEMENT_PIECES } from "../../../jobs/ejes-calles/constants";
import type { EjesMapCandidate, EjesMapFeature, EjesMapNeighbour, EjesManualSplit } from "../../../jobs/ejes-calles/types";
import { OUTLINE_LABEL_PROPERTY } from "../../shared/map/outlineMapCollection";
import { OUTLINE_ROLE } from "../../shared/map/outlineTypes";
import { manualSplitOf } from "../ejesAccept";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { geodesicLengthM } from "./geodesicLength";
import { pointAssignmentsOf } from "./pointAssignment";

export const MANUAL_RADIUS_OPTIONS_M: readonly number[] = [MANUAL_CANDIDATE_RADIUS_M, 50, MANUAL_CANDIDATE_MAX_RADIUS_M];

const CANDIDATE_REF_PROPERTY = "candidateRef";
const NEIGHBOUR_REF_PROPERTY = "neighbourRef";
const DISCREPANCY_TYPE_PROPERTY = "_discrepancyType";
const LABEL_SLOT_PROPERTY = "_labelSlot";

type RefProperties = Record<string, string>;

const byDistance = (first: EjesMapCandidate, second: EjesMapCandidate): number =>
  first.distance - second.distance || first.ref.localeCompare(second.ref);

/** The candidates nearest the old section first. */
export const sortedCandidatesOf = (candidates: readonly EjesMapCandidate[]): EjesMapCandidate[] => [...candidates].sort(byDistance);

export const chosenCandidatesOf = (candidates: readonly EjesMapCandidate[], chosenRefs: readonly string[]): EjesMapCandidate[] => {
  const chosen = new Set(chosenRefs);
  return sortedCandidatesOf(candidates).filter((candidate) => chosen.has(candidate.ref));
};

export const canChooseMore = (chosenCount: number): boolean => chosenCount < MANUAL_SPLIT_PIECES_LIMIT;

/** A split, a replacement or a group needs at least one new section. */
export const canApplyOf = (chosenCount: number): boolean => chosenCount > 0;

/** One piece makes a replacement, two or more a split; with other old sections ticked, the caption names the group. */
export const chosenSummaryOf = (chosenCount: number, mergedOldCount = 0): string => {
  if (mergedOldCount > 0) {
    return chosenCount === 0 ? EJES_MANUAL_SPLIT_TEXT.MERGE_NEEDS_ONE : EJES_MANUAL_SPLIT_TEXT.MERGE_CAPTION(mergedOldCount, chosenCount);
  }
  if (chosenCount === 0) return EJES_MANUAL_SPLIT_TEXT.CHOSEN_NONE;
  if (chosenCount === REPLACEMENT_PIECES) return EJES_MANUAL_SPLIT_TEXT.CHOSEN_REPLACEMENT;
  return EJES_MANUAL_SPLIT_TEXT.CHOSEN_SPLIT(chosenCount);
};

export const nearLengthSumOf = (candidates: readonly EjesMapCandidate[]): number =>
  candidates.reduce((sum, candidate) => sum + candidate.nearLength, 0);

/** The length in metres of the old section, from its outline; null when the outline is not in the response. */
export const oldLengthOf = (features: readonly EjesMapFeature[]): number | null => {
  const oldFeature = features.find((feature) => feature.role === OUTLINE_ROLE.OLD);
  return oldFeature === undefined ? null : geodesicLengthM(oldFeature.geometry);
};

/** The old sections already stored with the same single new section as `oldRef`'s choice: the merge `oldRef` belongs to. */
export function storedMergeRefsOf(splits: readonly EjesManualSplit[], oldRef: string): string[] {
  const stored = manualSplitOf(splits, oldRef)?.newRefs;
  if (stored === undefined || stored.length !== REPLACEMENT_PIECES) return [];
  const [newRef] = stored;
  return splits
    .filter((split) => split.oldRef !== oldRef && split.newRefs.length === REPLACEMENT_PIECES && split.newRefs[0] === newRef)
    .map((split) => split.oldRef);
}

const featureOf = (geometry: Geometry, type: string, label: string, refProperties: RefProperties = {}): Feature => ({
  type: "Feature",
  geometry,
  properties: { [DISCREPANCY_TYPE_PROPERTY]: type, [OUTLINE_LABEL_PROPERTY]: label, ...refProperties },
});

const TYPE_OF_ROLE: Partial<Record<EjesMapFeature["role"], string>> = {
  [OUTLINE_ROLE.OLD]: MAP_SECTION_TYPE.MANUAL_OLD,
  [OUTLINE_ROLE.ACCESS]: MAP_SECTION_TYPE.ACCESS_POINT,
};

const geometriesOf = (features: readonly EjesMapFeature[], role: EjesMapFeature["role"]): Geometry[] =>
  features.filter((feature) => feature.role === role).map((feature) => feature.geometry);

/** The palette slot of a candidate: its position among the candidates, so a section keeps its colour while the choice changes. */
const slotOf = (index: number): number => index % MAP_MANUAL_PIECE_TYPES.length;

/**
 * The candidate (index in `candidates`) each access point of the old section would go to with the chosen sections, null for a point that
 * would go to review; null as a whole when nothing is chosen. The analysis rules, computed on the map geometries.
 */
function pointTargetsOf(features: readonly EjesMapFeature[], candidates: readonly EjesMapCandidate[], chosenRefs: readonly string[]): Array<number | null> | null {
  const newGeometries = geometriesOf(features, OUTLINE_ROLE.NEW);
  const chosen = new Set(chosenRefs);
  const chosenIndexes = candidates.flatMap((candidate, index) => (chosen.has(candidate.ref) && newGeometries[index] !== undefined ? [index] : []));
  if (chosenIndexes.length === 0) return null;
  const points = geometriesOf(features, OUTLINE_ROLE.ACCESS).flatMap((geometry) => (geometry.type === "Point" ? [geometry.coordinates] : [[Number.NaN, Number.NaN]]));
  const oldGeometry = features.find((feature) => feature.role === OUTLINE_ROLE.OLD)?.geometry ?? null;
  const assigned = pointAssignmentsOf(points, oldGeometry, chosenIndexes.map((index) => newGeometries[index]));
  return assigned.map((position) => (position === null ? null : (chosenIndexes[position] ?? null)));
}

/** How many access points go to a chosen section and how many to review; null while nothing is chosen. */
export function pointSummaryOf(features: readonly EjesMapFeature[], candidates: readonly EjesMapCandidate[], chosenRefs: readonly string[]): { assigned: number; review: number } | null {
  const targets = pointTargetsOf(features, candidates, chosenRefs);
  if (targets === null) return null;
  const review = targets.filter((target) => target === null).length;
  return { assigned: targets.length - review, review };
}

const pointTypeOf = (target: number | null | undefined): string =>
  target === undefined ? MAP_SECTION_TYPE.ACCESS_POINT : target === null ? MAP_MANUAL_POINT_REVIEW_TYPE : MAP_MANUAL_POINT_TYPES[slotOf(target)];

const fixedFeaturesOf = (features: readonly EjesMapFeature[], targets: Array<number | null> | null): Feature[] => {
  let pointIndex = 0;
  return features.flatMap((feature) => {
    const type = TYPE_OF_ROLE[feature.role];
    if (type === undefined) return [];
    if (feature.role !== OUTLINE_ROLE.ACCESS) return [featureOf(feature.geometry, type, feature.role === OUTLINE_ROLE.OLD ? feature.label : "")];
    const target = targets === null ? undefined : targets[pointIndex];
    pointIndex += 1;
    return [featureOf(feature.geometry, targets === null ? type : pointTypeOf(target), "")];
  });
};

const candidateFeaturesOf = (features: readonly EjesMapFeature[], candidates: readonly EjesMapCandidate[], chosenRefs: readonly string[]): Feature[] => {
  const geometries = geometriesOf(features, OUTLINE_ROLE.NEW);
  const chosen = new Set(chosenRefs);
  return candidates.flatMap((candidate, index) => {
    const geometry = geometries[index];
    if (geometry === undefined) return [];
    const type = chosen.has(candidate.ref) ? MAP_MANUAL_PIECE_TYPES[slotOf(index)] : MAP_SECTION_TYPE.MANUAL_CANDIDATE;
    return [featureOf(geometry, type, candidate.ref, { [CANDIDATE_REF_PROPERTY]: candidate.ref })];
  });
};

const neighbourFeaturesOf = (features: readonly EjesMapFeature[], neighbours: readonly EjesMapNeighbour[], mergeRefs: readonly string[]): Feature[] => {
  const geometries = geometriesOf(features, OUTLINE_ROLE.NEIGHBOUR);
  const merged = new Set(mergeRefs);
  return neighbours.flatMap((neighbour, index) => {
    const geometry = geometries[index];
    if (geometry === undefined) return [];
    const type = merged.has(neighbour.ref) ? MAP_SECTION_TYPE.MANUAL_NEIGHBOUR_CHOSEN : MAP_SECTION_TYPE.MANUAL_NEIGHBOUR;
    return [featureOf(geometry, type, neighbour.ref, { [NEIGHBOUR_REF_PROPERTY]: neighbour.ref })];
  });
};

/**
 * The map of one manual split: the old section in red, its access points as points, the candidates grey and the chosen ones in
 * their own colour, the neighbours amber and the ticked ones to merge in red. The order of the features never depends on the choice
 * and the geometries are the same objects every time, so the map restyles the drawn layers on a choice instead of redrawing them.
 */
export function manualSplitMapOf(
  features: readonly EjesMapFeature[],
  candidates: readonly EjesMapCandidate[],
  chosenRefs: readonly string[],
  neighbours: readonly EjesMapNeighbour[] = [],
  mergeRefs: readonly string[] = []
): FeatureCollection {
  const drawn = [
    ...fixedFeaturesOf(features, pointTargetsOf(features, candidates, chosenRefs)),
    ...candidateFeaturesOf(features, candidates, chosenRefs),
    ...neighbourFeaturesOf(features, neighbours, mergeRefs),
  ];
  return {
    type: "FeatureCollection",
    features: drawn.map((feature, slot) => ({ ...feature, properties: { ...feature.properties, [LABEL_SLOT_PROPERTY]: slot } })),
  };
}

const refAtProperty = (collection: FeatureCollection, index: number | null, property: string): string | null => {
  if (index === null) return null;
  const ref = collection.features[index]?.properties?.[property];
  return typeof ref === "string" ? ref : null;
};

/** The candidate a clicked feature of the map names; null for the old section, the points and a click on empty map. */
export const candidateRefAt = (collection: FeatureCollection, index: number | null): string | null =>
  refAtProperty(collection, index, CANDIDATE_REF_PROPERTY);

/** The neighbour a clicked feature of the map names; null for every other feature and a click on empty map. */
export const neighbourRefAt = (collection: FeatureCollection, index: number | null): string | null =>
  refAtProperty(collection, index, NEIGHBOUR_REF_PROPERTY);
