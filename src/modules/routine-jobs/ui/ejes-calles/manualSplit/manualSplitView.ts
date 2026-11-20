import type { Feature, FeatureCollection, Geometry } from "geojson";
import { MAP_SECTION_TYPE } from "@/core/constants/mapConstants";
import { MANUAL_CANDIDATE_MAX_RADIUS_M, MANUAL_CANDIDATE_RADIUS_M, MANUAL_SPLIT_PIECES_LIMIT, REPLACEMENT_PIECES } from "../../../jobs/ejes-calles/constants";
import type { EjesMapCandidate, EjesMapFeature } from "../../../jobs/ejes-calles/types";
import { OUTLINE_LABEL_PROPERTY } from "../../shared/map/outlineMapCollection";
import { OUTLINE_ROLE } from "../../shared/map/outlineTypes";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { geodesicLengthM } from "./geodesicLength";

export const MANUAL_RADIUS_OPTIONS_M: readonly number[] = [MANUAL_CANDIDATE_RADIUS_M, 50, MANUAL_CANDIDATE_MAX_RADIUS_M];

const CANDIDATE_REF_PROPERTY = "candidateRef";
const DISCREPANCY_TYPE_PROPERTY = "_discrepancyType";
const LABEL_SLOT_PROPERTY = "_labelSlot";

const byDistance = (first: EjesMapCandidate, second: EjesMapCandidate): number =>
  first.distance - second.distance || first.ref.localeCompare(second.ref);

/** The candidates nearest the old section first. */
export const sortedCandidatesOf = (candidates: readonly EjesMapCandidate[]): EjesMapCandidate[] => [...candidates].sort(byDistance);

export const chosenCandidatesOf = (candidates: readonly EjesMapCandidate[], chosenRefs: readonly string[]): EjesMapCandidate[] =>
  sortedCandidatesOf(candidates).filter((candidate) => chosenRefs.includes(candidate.ref));

export const canChooseMore = (chosenCount: number): boolean => chosenCount < MANUAL_SPLIT_PIECES_LIMIT;

/** One piece makes a replacement, two or more a split: the caption the user reads before applying. */
export const chosenSummaryOf = (chosenCount: number): string => {
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

const featureOf = (geometry: Geometry, type: string, label: string, candidateRef: string | null = null): Feature => ({
  type: "Feature",
  geometry,
  properties: { [DISCREPANCY_TYPE_PROPERTY]: type, [OUTLINE_LABEL_PROPERTY]: label, [CANDIDATE_REF_PROPERTY]: candidateRef },
});

const TYPE_OF_ROLE: Partial<Record<EjesMapFeature["role"], string>> = {
  [OUTLINE_ROLE.OLD]: MAP_SECTION_TYPE.MANUAL_OLD,
  [OUTLINE_ROLE.ACCESS]: MAP_SECTION_TYPE.ACCESS_POINT,
};

/**
 * The map of one manual split: the old section in red, its access points as points, the candidates grey and the chosen ones in
 * their own colour, drawn last so they lie on top. The candidate features come in the order of the candidates, so they pair by index.
 */
export function manualSplitMapOf(
  features: readonly EjesMapFeature[],
  candidates: readonly EjesMapCandidate[],
  chosenRefs: readonly string[]
): FeatureCollection {
  const newGeometries = features.filter((feature) => feature.role === OUTLINE_ROLE.NEW).map((feature) => feature.geometry);
  const fixed = features.flatMap((feature) => {
    const type = TYPE_OF_ROLE[feature.role];
    return type === undefined ? [] : [featureOf(feature.geometry, type, feature.role === OUTLINE_ROLE.OLD ? feature.label : "")];
  });
  const pieces = candidates.map((candidate, index) => ({ candidate, geometry: newGeometries[index] }));
  const unchosen = pieces.filter(({ candidate }) => !chosenRefs.includes(candidate.ref));
  const chosen = pieces.filter(({ candidate }) => chosenRefs.includes(candidate.ref));
  const candidateFeatures = [...unchosen, ...chosen]
    .filter((piece): piece is { candidate: EjesMapCandidate; geometry: Geometry } => piece.geometry !== undefined)
    .map(({ candidate, geometry }) =>
      featureOf(
        geometry,
        chosenRefs.includes(candidate.ref) ? MAP_SECTION_TYPE.MANUAL_CHOSEN : MAP_SECTION_TYPE.MANUAL_CANDIDATE,
        candidate.ref,
        candidate.ref
      )
    );
  return {
    type: "FeatureCollection",
    features: [...fixed, ...candidateFeatures].map((feature, slot) => ({ ...feature, properties: { ...feature.properties, [LABEL_SLOT_PROPERTY]: slot } })),
  };
}

/** The candidate a clicked feature of the map names; null for the old section, the points and a click on empty map. */
export const candidateRefAt = (collection: FeatureCollection, index: number | null): string | null => {
  if (index === null) return null;
  const ref = collection.features[index]?.properties?.[CANDIDATE_REF_PROPERTY];
  return typeof ref === "string" ? ref : null;
};
