import type { FeatureCollection } from "geojson";
import { MAP_ROLE_TYPE } from "@/core/constants/mapConstants";
import { GEOMETRY_MAP_ROLE } from "../jobs/actualizar-padron/constants";
import type { GeometryMapFeature } from "../jobs/actualizar-padron/types";
import type { PadronMapOutline } from "./padronMapSubject";

/** The feature property that the map draws as the permanent label of each outline. */
export const OUTLINE_LABEL_PROPERTY = "label";

const labelOf = (outline: PadronMapOutline | undefined): string => (outline === undefined ? "" : outline.label);

const roleTypeOf = (feature: GeometryMapFeature): string =>
  feature.role === GEOMETRY_MAP_ROLE.OLD ? MAP_ROLE_TYPE.OLD : MAP_ROLE_TYPE.NEW;

/** Each outline is coloured by its role (or its own colour type) and labelled by its minimal label; a feature's `itemIndex` names its outline. */
export function toMapCollection(features: readonly GeometryMapFeature[], outlines: readonly PadronMapOutline[]): FeatureCollection {
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
