import type { FeatureCollection } from "geojson";
import { MAP_ROLE_TYPE } from "@/core/constants/mapConstants";
import { OUTLINE_ROLE, type OutlineFeature, type OutlineLabel } from "./outlineTypes";

/** The feature property that the map draws as the permanent label of each outline. */
export const OUTLINE_LABEL_PROPERTY = "label";

/** More outlines than this and the permanent labels would cover the map: none is drawn, and a click names the outline. */
export const OUTLINE_LABEL_LIMIT = 6;

const labelOf = (outline: OutlineLabel | undefined, labelled: boolean): string =>
  outline === undefined || !labelled ? "" : outline.label;

const roleTypeOf = (feature: OutlineFeature): string => (feature.role === OUTLINE_ROLE.OLD ? MAP_ROLE_TYPE.OLD : MAP_ROLE_TYPE.NEW);

/** Each outline is coloured by its role (or its own colour type) and labelled by its minimal label; a feature's `itemIndex` names its outline. */
export function toMapCollection(features: readonly OutlineFeature[], outlines: readonly OutlineLabel[], showLabels = true): FeatureCollection {
  const labelled = showLabels && features.length <= OUTLINE_LABEL_LIMIT;
  return {
    type: "FeatureCollection",
    features: features.map((feature, labelSlot) => {
      const outline = outlines[feature.itemIndex];
      return {
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          _discrepancyType: outline?.mapType ?? roleTypeOf(feature),
          [OUTLINE_LABEL_PROPERTY]: labelOf(outline, labelled),
          _labelSlot: labelSlot,
        },
      };
    }),
  };
}
