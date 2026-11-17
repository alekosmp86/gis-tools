import type { FeatureCollection } from "geojson";
import { getDiscrepancyLabel } from "@/core/constants/mapConstants";
import { capFeaturesWithoutSplittingGroups } from "@/core/spatial/FeaturePreviewCap";
import type { MapLegendEntry } from "@/ui-kit/types/map";

export interface CappedPreview {
  collection: FeatureCollection;
  isCapped: boolean;
  suppliedCount: number;
  shownCount: number;
}

/** The collection a preview draws: the first groups within `maxFeatures`, or all of them when `maxFeatures` is null. */
export function capPreview(geojson: FeatureCollection, maxFeatures: number | null): CappedPreview {
  const suppliedFeatures = geojson?.features ?? [];
  const shownFeatures =
    maxFeatures === null ? suppliedFeatures : capFeaturesWithoutSplittingGroups(suppliedFeatures, maxFeatures);
  const isCapped = shownFeatures.length < suppliedFeatures.length;
  return {
    collection: isCapped ? { type: "FeatureCollection", features: [...shownFeatures] } : geojson,
    isCapped,
    suppliedCount: suppliedFeatures.length,
    shownCount: shownFeatures.length,
  };
}

/** The distinct discrepancy types of the collection, in first-seen order; the legend lists them, named by the type or, when asked, by the first feature's label. */
export function legendEntriesOf(collection: FeatureCollection, labelProperty?: string): MapLegendEntry[] {
  const labelByType = new Map<string, string>();
  for (const feature of collection?.features ?? []) {
    const type = feature.properties?._discrepancyType;
    if (typeof type !== "string" || !type || labelByType.has(type)) continue;
    const label = labelProperty === undefined ? undefined : feature.properties?.[labelProperty];
    labelByType.set(type, typeof label === "string" && label !== "" ? label : getDiscrepancyLabel(type));
  }
  return Array.from(labelByType, ([type, label]) => ({ type, label }));
}

export function containerClassOf(fillParent: boolean, baseClass: string, fillClass: string): string {
  return fillParent ? `${baseClass} ${fillClass}` : baseClass;
}
