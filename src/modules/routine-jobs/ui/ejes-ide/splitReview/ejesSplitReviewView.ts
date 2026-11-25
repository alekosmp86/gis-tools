import type { Feature, FeatureCollection, Geometry } from "geojson";
import { formatNumber } from "@/core/common/ValueFormatter";
import { MAP_SECTION_TYPE, MAP_SPLIT_PIECE_TYPES } from "@/core/constants/mapConstants";
import { EJES_POINT_REASON } from "../../../jobs/ejes-ide/constants";
import type { EjesSplitPiece, EjesSplitPointCandidate, EjesSplitReviewPoint, EjesStreet } from "../../../jobs/ejes-ide/types";
import type { EjesPointChoiceRequest } from "../shared/ejesIdeClientTypes";
import { OUTLINE_LABEL_PROPERTY } from "../../shared/map/outlineMapCollection";
import type { EjesPointChoiceKey } from "../ejesAccept";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";

export const REASON_FILTER = {
  ALL: "all",
  AMBIGUOUS: EJES_POINT_REASON.AMBIGUOUS,
  NO_GEOMETRY: EJES_POINT_REASON.NO_GEOMETRY,
} as const;

export type ReasonFilter = (typeof REASON_FILTER)[keyof typeof REASON_FILTER];

const POINT_LABEL_PROPERTY_SLOT = "_labelSlot";
const DISCREPANCY_TYPE_PROPERTY = "_discrepancyType";

export const filterPointsByReason = (points: readonly EjesSplitReviewPoint[], filter: ReasonFilter): EjesSplitReviewPoint[] =>
  filter === REASON_FILTER.ALL ? [...points] : points.filter((point) => point.reason === filter);

/** A street as one phrase: "RUTA 25 (idcalle 71939)" in the long form, "RUTA 25 (71939)" in the compact one; no name gives "idcalle N". */
export const streetTextOf = (street: EjesStreet | null, compact: boolean): string => {
  if (street === null) return EJES_SPLIT_REVIEW_TEXT.STREET_NO_DATA;
  if (street.name === null) return EJES_SPLIT_REVIEW_TEXT.STREET_ID_ONLY(street.idcalle);
  return compact
    ? EJES_SPLIT_REVIEW_TEXT.STREET_NAMED_COMPACT(street.name, street.idcalle)
    : EJES_SPLIT_REVIEW_TEXT.STREET_NAMED(street.name, street.idcalle);
};

export interface SplitStreetView {
  /** One line when both streets are the same street; otherwise the point's line and the old section's line. */
  lines: string[];
  /** True when both streets have an idcalle and they differ: the choices stay as they are, the screen only warns. */
  mismatch: boolean;
}

/** The street lines of a point and of its old section: the same street gives one line, two different streets two lines and a warning. */
export const splitStreetViewOf = (pointStreet: EjesStreet | null, oldStreet: EjesStreet | null): SplitStreetView => {
  const pointId = pointStreet?.idcalle ?? null;
  const oldId = oldStreet?.idcalle ?? null;
  if (pointId === oldId) {
    const named = pointStreet?.name != null ? pointStreet : oldStreet?.name != null ? oldStreet : (pointStreet ?? oldStreet);
    return { lines: [EJES_SPLIT_REVIEW_TEXT.STREET_SINGLE(streetTextOf(named, true))], mismatch: false };
  }
  return {
    lines: [
      EJES_SPLIT_REVIEW_TEXT.STREET_POINT(streetTextOf(pointStreet, false)),
      EJES_SPLIT_REVIEW_TEXT.STREET_OLD(streetTextOf(oldStreet, false)),
    ],
    mismatch: pointId !== null && oldId !== null,
  };
};

/** The destinations chosen on one split, by point. */
export const chosenByPointOf = (choices: readonly EjesPointChoiceKey[], oldRef: string): Map<string, string> =>
  new Map(choices.filter((choice) => choice.oldRef === oldRef).map((choice) => [choice.pointId, choice.newRef]));

/** The suggestion of a point: its nearest piece, when the point has one (no geometry, no suggestion). */
const suggestionOf = (point: EjesSplitReviewPoint): string | null =>
  point.candidates.find((candidate) => candidate.isSuggestion)?.newRef ?? null;

/** The destinations an "Aceptar sugeridos" adds: the suggestion of each ambiguous point the user has not decided yet. */
export const suggestedChoicesOf = (
  points: readonly EjesSplitReviewPoint[],
  chosenByPoint: ReadonlyMap<string, string>
): EjesPointChoiceRequest[] =>
  points.flatMap((point) => {
    if (point.reason !== EJES_POINT_REASON.AMBIGUOUS || chosenByPoint.has(point.pointId)) return [];
    const suggested = suggestionOf(point);
    return suggested === null ? [] : [{ pointId: point.pointId, newRef: suggested }];
  });

const candidateTypeOf = (pieceIndex: number): string => MAP_SPLIT_PIECE_TYPES[pieceIndex % MAP_SPLIT_PIECE_TYPES.length];

const candidateOf = (point: EjesSplitReviewPoint, newRef: string): EjesSplitPointCandidate | undefined =>
  point.candidates.find((candidate) => candidate.newRef === newRef);

const distanceTextOf = (candidate: EjesSplitPointCandidate | undefined): string | null => {
  if (candidate === undefined || candidate.distance === null) return null;
  return EJES_SPLIT_REVIEW_TEXT.METERS(formatNumber(candidate.distance));
};

/** The name of a piece on the map and in its legend: the same text as the list, with its distance and marks. */
const pieceLabelOf = (newRef: string, candidate: EjesSplitPointCandidate | undefined, suggested: boolean, chosen: boolean): string => {
  const marks: (string | null)[] = [suggested ? EJES_SPLIT_REVIEW_TEXT.SUGGESTED : null, chosen ? EJES_SPLIT_REVIEW_TEXT.CHOSEN : null];
  const parts: (string | null)[] = [EJES_SPLIT_REVIEW_TEXT.PIECE_LABEL(newRef), distanceTextOf(candidate), ...marks];
  return parts.filter((part): part is string => part !== null).join(" · ");
};

const featureOf = (geometry: Geometry, type: string, label: string): Feature => ({
  type: "Feature",
  geometry,
  properties: { [DISCREPANCY_TYPE_PROPERTY]: type, [OUTLINE_LABEL_PROPERTY]: label },
});

export interface SplitPointMapSource {
  pieces: readonly EjesSplitPiece[];
  oldGeometry: Geometry | null;
}

/** The map of one point: the old section, every piece in its own colour (the chosen and the suggested one are named), and the point. */
export function splitPointMapOf(
  source: SplitPointMapSource,
  oldRef: string,
  point: EjesSplitReviewPoint,
  chosenRef: string | undefined
): FeatureCollection {
  const suggested = suggestionOf(point);
  const features: Feature[] = [];
  if (source.oldGeometry !== null) {
    features.push(featureOf(source.oldGeometry, MAP_SECTION_TYPE.OLD, EJES_SPLIT_REVIEW_TEXT.OLD_SECTION_LABEL(oldRef)));
  }
  source.pieces.forEach((piece, pieceIndex) =>
    features.push(
      featureOf(
        piece.geometry,
        candidateTypeOf(pieceIndex),
        pieceLabelOf(piece.newRef, candidateOf(point, piece.newRef), piece.newRef === suggested, piece.newRef === chosenRef)
      )
    )
  );
  if (point.geometry !== null) {
    features.push(featureOf(point.geometry, MAP_SECTION_TYPE.ACCESS_POINT, `${EJES_SPLIT_REVIEW_TEXT.POINT_TITLE} ${point.pointId}`));
  }
  return {
    type: "FeatureCollection",
    features: features.map((feature, slot) => ({ ...feature, properties: { ...feature.properties, [POINT_LABEL_PROPERTY_SLOT]: slot } })),
  };
}
