import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";

const TYPE_PROPERTY = "_discrepancyType";

type FeatureLayer = L.Layer & { feature?: Feature; setStyle?: (style: L.PathOptions) => void; bringToFront?: () => void };

/** True when both collections hold the same geometry objects in the same order: only the properties may differ. */
export function sameGeometries(previous: FeatureCollection, next: FeatureCollection): boolean {
  if (previous.features.length !== next.features.length) return false;
  return next.features.every((feature, index) => feature.geometry === previous.features[index].geometry);
}

const typeOf = (feature: Feature | undefined): unknown => feature?.properties?.[TYPE_PROPERTY];

/**
 * Paints the already drawn layers again for a collection whose geometries did not change, so a selection repaint does not tear
 * down and redraw the whole map. A layer is restyled only when its type changed, and a restyled one goes to the front. Returns
 * false, leaving the layers as they were, when they do not pair one to one with the features.
 */
export function restyleInPlace(
  drawn: readonly L.Layer[],
  next: readonly Feature[],
  resolvePathStyle: (feature: Feature) => L.PathOptions
): boolean {
  const layers = drawn.flatMap((layer) => (layer instanceof L.GeoJSON ? layer.getLayers() : [layer])) as FeatureLayer[];
  if (layers.length !== next.length) return false;
  if (layers.some((layer) => layer.feature === undefined)) return false;
  layers.forEach((layer, index) => {
    const feature = next[index];
    const changed = typeOf(layer.feature) !== typeOf(feature);
    layer.feature = feature;
    if (!changed || typeof layer.setStyle !== "function") return;
    layer.setStyle(resolvePathStyle(feature));
    layer.bringToFront?.();
  });
  return true;
}
