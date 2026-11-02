import type L from "leaflet";
import type { GeoJsonProperties } from "geojson";

const LABEL_CLASS = "map-feature-label";

/** Binds a permanent tooltip with the text of `labelProperty`; a feature without that text stays unlabelled. */
export function bindFeatureLabel(properties: GeoJsonProperties, layer: L.Layer, labelProperty: string): void {
  const text = properties?.[labelProperty];
  if (typeof text !== "string" || text === "") return;
  layer.bindTooltip(text, { permanent: true, direction: "center", className: LABEL_CLASS });
}
