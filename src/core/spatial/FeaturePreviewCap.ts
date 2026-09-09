import type { Feature } from "geojson";

/**
 * Property that binds features which must be rendered together, such as the database and file
 * geometries of one discrepancy. Capping must never divide a group: showing one half of a pair
 * reads as "only present on one side" when the truth is that both sides exist and differ.
 */
export const FEATURE_GROUP_PROPERTY = "_pairId";

function readGroupId(feature: Feature | undefined): unknown {
  return feature?.properties?.[FEATURE_GROUP_PROPERTY];
}

/**
 * Limits a collection to at most `limit` features, cutting only at a group boundary.
 *
 * When the feature at the cut belongs to the same group as the one before it, the cut walks
 * backwards until it reaches a boundary, so a partially rendered group is never emitted. Features
 * without a group id are treated as their own group, which makes this a plain prefix slice for
 * ordinary collections.
 */
export function capFeaturesWithoutSplittingGroups<TFeature extends Feature>(
  features: ReadonlyArray<TFeature>,
  limit: number
): ReadonlyArray<TFeature> {
  if (limit <= 0) {
    return [];
  }

  if (features.length <= limit) {
    return features;
  }

  let cutIndex = limit;

  while (cutIndex > 0) {
    const groupAtCut = readGroupId(features[cutIndex]);
    const groupBeforeCut = readGroupId(features[cutIndex - 1]);

    const wouldSplitGroup =
      groupAtCut !== undefined && groupAtCut !== null && groupAtCut === groupBeforeCut;

    if (!wouldSplitGroup) {
      break;
    }

    cutIndex--;
  }

  return features.slice(0, cutIndex);
}
