import type { FeatureCollection } from "geojson";
import { capFeaturesWithoutSplittingGroups } from "@/core/spatial/FeaturePreviewCap";

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

/** The distinct discrepancy types of the collection, in first-seen order; the legend lists them. */
export function presentTypesOf(collection: FeatureCollection): string[] {
  const types = new Set<string>();
  for (const feature of collection?.features ?? []) {
    const type = feature.properties?._discrepancyType;
    if (typeof type === "string" && type) types.add(type);
  }
  return Array.from(types);
}

export function containerClassOf(fillParent: boolean, baseClass: string, fillClass: string): string {
  return fillParent ? `${baseClass} ${fillClass}` : baseClass;
}
