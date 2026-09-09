import type { Feature } from "geojson";

/**
 * Bidirectional translation between a feature's position in a `FeatureCollection` and the position
 * of the record it was built from.
 *
 * The two drift apart because producers emit a feature only when a record's geometry parses, while
 * the attribute table lists every record. Both indexes are needed: the table selects by record and
 * the map selects by feature.
 */
export interface FeatureRecordIndex {
  /** Record position for a rendered feature, or null when the feature is unknown. */
  toRecordIndex(featureIndex: number): number | null;
  /** Feature position for a record, or null when that record produced no geometry. */
  toFeatureIndex(recordIndex: number): number | null;
}

/**
 * Builds the translation from the `id` each producer stamps on its features.
 *
 * Features without a numeric id fall back to their own position, which preserves existing behaviour
 * for collections built elsewhere (the comparison engines) rather than dropping their selection.
 */
export function buildFeatureRecordIndex(
  features: Feature[] | undefined
): FeatureRecordIndex {
  const recordIndexByFeature: number[] = [];
  const featureIndexByRecord = new Map<number, number>();

  if (features) {
    features.forEach((feature, featureIndex) => {
      const recordIndex = typeof feature.id === "number" ? feature.id : featureIndex;
      recordIndexByFeature[featureIndex] = recordIndex;

      if (!featureIndexByRecord.has(recordIndex)) {
        featureIndexByRecord.set(recordIndex, featureIndex);
      }
    });
  }

  return {
    toRecordIndex: (featureIndex) => {
      const recordIndex = recordIndexByFeature[featureIndex];
      return typeof recordIndex === "number" ? recordIndex : null;
    },
    toFeatureIndex: (recordIndex) => {
      const featureIndex = featureIndexByRecord.get(recordIndex);
      return typeof featureIndex === "number" ? featureIndex : null;
    },
  };
}
