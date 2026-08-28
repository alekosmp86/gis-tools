import { useEffect } from "react";
import L from "leaflet";
import type { MapFeatureStyle } from "@/types/map";
import { getDiscrepancyColor, getDashArrayFromPattern } from "@/constants/mapConstants";

export function useLayerSymbology(
  featureGroupRef: React.RefObject<L.FeatureGroup | null>,
  featureStyle: MapFeatureStyle
): void {
  useEffect(() => {
    if (!featureGroupRef.current) return;
    const parentGroup = featureGroupRef.current;
    const dashArray = getDashArrayFromPattern(featureStyle.strokePattern);

    parentGroup.eachLayer((subLayer: L.Layer) => {
      if ("eachLayer" in subLayer && typeof (subLayer as L.FeatureGroup).eachLayer === "function") {
        (subLayer as L.FeatureGroup).eachLayer((layer: L.Layer) => {
          const feature = (layer as L.Layer & { feature?: GeoJSON.Feature }).feature;
          const discrepancyType = feature?.properties?._discrepancyType;
          const useDiscrepancyColor = Boolean(discrepancyType && !featureStyle.overrideDiscrepancyColors);
          const strokeColor = useDiscrepancyColor ? getDiscrepancyColor(discrepancyType) : featureStyle.color;
          const fillColor = useDiscrepancyColor
            ? getDiscrepancyColor(discrepancyType)
            : featureStyle.fillColor || featureStyle.color;

          if ("setStyle" in layer && typeof (layer as L.Path).setStyle === "function") {
            (layer as L.Path).setStyle({
              color: strokeColor,
              fillColor,
              weight: featureStyle.weight,
              opacity: featureStyle.opacity,
              fillOpacity: featureStyle.fillOpacity,
              dashArray,
            });
          }
          if ("setRadius" in layer && typeof (layer as L.CircleMarker).setRadius === "function") {
            (layer as L.CircleMarker).setRadius(featureStyle.pointRadius);
          }
        });
      }
    });
  }, [featureGroupRef, featureStyle]);
}
