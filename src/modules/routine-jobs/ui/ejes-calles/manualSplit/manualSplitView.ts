import type { Feature, FeatureCollection, Geometry } from "geojson";
import { MAP_SECTION_TYPE } from "@/core/constants/mapConstants";
import { MANUAL_CANDIDATE_MAX_RADIUS_M, MANUAL_CANDIDATE_RADIUS_M, MANUAL_SPLIT_PIECES_LIMIT, REPLACEMENT_PIECES } from "../../../jobs/ejes-calles/constants";
import type { EjesMapCandidate, EjesMapFeature, EjesMapNeighbour, EjesManualSplit } from "../../../jobs/ejes-calles/types";
import { OUTLINE_LABEL_PROPERTY } from "../../shared/map/outlineMapCollection";
import { OUTLINE_ROLE } from "../../shared/map/outlineTypes";
import { manualSplitOf } from "../ejesAccept";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { geodesicLengthM } from "./geodesicLength";

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

export const chosenCandidatesOf = (candidates: readonly EjesMapCandidate[], chosenRefs: readonly string[]): EjesMapCandidate[] =>
  sortedCandidatesOf(candidates).filter((candidate) => chosenRefs.includes(candidate.ref));

export const canChooseMore = (chosenCount: number): boolean => chosenCount < MANUAL_SPLIT_PIECES_LIMIT;

/** A merge needs exactly one new section; a split or a replacement needs one or more. `mergedOldCount` is 0 when nothing is merged. */
export const canApplyOf = (chosenCount: number, mergedOldCount: number): boolean =>
  mergedOldCount === 0 ? chosenCount > 0 : chosenCount === REPLACEMENT_PIECES;

/** One piece makes a replacement, two or more a split; with a merge, the caption names the old sections joined into the one new section. */
export const chosenSummaryOf = (chosenCount: number, mergedOldCount = 0): string => {
  if (mergedOldCount > 0) {
    return chosenCount === REPLACEMENT_PIECES ? EJES_MANUAL_SPLIT_TEXT.MERGE_CAPTION(mergedOldCount) : EJES_MANUAL_SPLIT_TEXT.MERGE_NEEDS_ONE;
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

const fixedFeaturesOf = (features: readonly EjesMapFeature[]): Feature[] =>
  features.flatMap((feature) => {
    const type = TYPE_OF_ROLE[feature.role];
    return type === undefined ? [] : [featureOf(feature.geometry, type, feature.role === OUTLINE_ROLE.OLD ? feature.label : "")];
  });

const candidateFeaturesOf = (features: readonly EjesMapFeature[], candidates: readonly EjesMapCandidate[], chosenRefs: readonly string[]): Feature[] => {
  const geometries = geometriesOf(features, OUTLINE_ROLE.NEW);
  return candidates.flatMap((candidate, index) => {
    const geometry = geometries[index];
    if (geometry === undefined) return [];
    const type = chosenRefs.includes(candidate.ref) ? MAP_SECTION_TYPE.MANUAL_CHOSEN : MAP_SECTION_TYPE.MANUAL_CANDIDATE;
    return [featureOf(geometry, type, candidate.ref, { [CANDIDATE_REF_PROPERTY]: candidate.ref })];
  });
};

const neighbourFeaturesOf = (features: readonly EjesMapFeature[], neighbours: readonly EjesMapNeighbour[], mergeRefs: readonly string[]): Feature[] => {
  const geometries = geometriesOf(features, OUTLINE_ROLE.NEIGHBOUR);
  return neighbours.flatMap((neighbour, index) => {
    const geometry = geometries[index];
    if (geometry === undefined) return [];
    const type = mergeRefs.includes(neighbour.ref) ? MAP_SECTION_TYPE.MANUAL_NEIGHBOUR_CHOSEN : MAP_SECTION_TYPE.MANUAL_NEIGHBOUR;
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
    ...fixedFeaturesOf(features),
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
