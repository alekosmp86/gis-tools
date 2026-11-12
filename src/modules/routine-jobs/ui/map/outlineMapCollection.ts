import type { FeatureCollection } from "geojson";
import { MAP_ROLE_TYPE } from "@/core/constants/mapConstants";
import { OUTLINE_ROLE, type OutlineFeature, type OutlineLabel } from "./outlineTypes";

/** The feature property that the map draws as the permanent label of each outline. */
export const OUTLINE_LABEL_PROPERTY = "label";

const labelOf = (outline: OutlineLabel | undefined): string => (outline === undefined ? "" : outline.label);

const roleTypeOf = (feature: OutlineFeature): string => (feature.role === OUTLINE_ROLE.OLD ? MAP_ROLE_TYPE.OLD : MAP_ROLE_TYPE.NEW);

/** Each outline is coloured by its role (or its own colour type) and labelled by its minimal label; a feature's `itemIndex` names its outline. */
export function toMapCollection(features: readonly OutlineFeature[], outlines: readonly OutlineLabel[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((feature, labelSlot) => {
      const outline = outlines[feature.itemIndex];
      return {
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          _discrepancyType: outline?.mapType ?? roleTypeOf(feature),
          [OUTLINE_LABEL_PROPERTY]: labelOf(outline),
          _labelSlot: labelSlot,
        },
      };
    }),
  };
}
