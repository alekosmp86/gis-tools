import type { Feature } from "geojson";
import type { BBox } from "@/core/types/map";
import { ViewportFeatureIndex } from "@/core/spatial/ViewportFeatureIndex";
import { capFeaturesWithoutSplittingGroups } from "@/core/spatial/FeaturePreviewCap";

export interface ViewportWindowPlanResult {
  shouldRebuild: boolean;
  windowedFeatures: Feature[];
  newWindowBBox: BBox;
}

export interface ViewportWindowPlannerOptions {
  paddingRatio: number;
  maxRenderFeatures: number | null;
  previousWindowFeatures?: readonly Feature[];
}

const EMPTY_FEATURES: Feature[] = [];

/**
 * Checks whether the inner bounding box is fully contained within the outer bounding box.
 */
export function isBBoxContained(innerBBox: BBox, outerBBox: BBox): boolean {
  return (
    innerBBox[0] >= outerBBox[0] &&
    innerBBox[2] <= outerBBox[2] &&
    innerBBox[1] >= outerBBox[1] &&
    innerBBox[3] <= outerBBox[3]
  );
}

/**
 * Expands a bounding box by a given padding ratio on every side.
 */
export function expandBBox(sourceBBox: BBox, paddingRatio: number): BBox {
  const spanX = sourceBBox[2] - sourceBBox[0];
  const spanY = sourceBBox[3] - sourceBBox[1];
  const paddingX = spanX * paddingRatio;
  const paddingY = spanY * paddingRatio;

  return [
    sourceBBox[0] - paddingX,
    sourceBBox[1] - paddingY,
    sourceBBox[2] + paddingX,
    sourceBBox[3] + paddingY,
  ];
}

/**
 * Pure planner that decides whether a viewport change requires rebuilding the active render window,
 * and computes the windowed feature subset with group-safe capping and object identity preservation.
 */
export function planViewportWindow(
  index: ViewportFeatureIndex,
  sourceFeatures: readonly Feature[],
  viewportBBox: BBox,
  previousWindowBBox: BBox | null,
  options: ViewportWindowPlannerOptions
): ViewportWindowPlanResult {
  const previousFeatures = options.previousWindowFeatures ?? EMPTY_FEATURES;

  // 1. If viewport is fully contained within the previously computed window buffer, do not rebuild
  if (previousWindowBBox !== null && isBBoxContained(viewportBBox, previousWindowBBox)) {
    return {
      shouldRebuild: false,
      windowedFeatures: previousFeatures as Feature[],
      newWindowBBox: previousWindowBBox,
    };
  }

  // 2. Expand the visible viewport by the configured padding ratio on every side
  const newWindowBBox = expandBBox(viewportBBox, options.paddingRatio);

  // 3. Query the spatial index for intersecting candidate feature indices
  const candidateIndices = index.queryBBox(newWindowBBox);

  // 4. Retrieve original feature object references without copying or cloning
  const candidateFeatures: Feature[] = new Array(candidateIndices.length);
  for (let candidateIndex = 0; candidateIndex < candidateIndices.length; candidateIndex++) {
    const featureIndex = candidateIndices[candidateIndex];
    candidateFeatures[candidateIndex] = sourceFeatures[featureIndex];
  }

  // 5. Apply group-safe decimation if candidates exceed maximum viewport render allowance
  let windowedFeatures = candidateFeatures;
  if (options.maxRenderFeatures !== null && candidateFeatures.length > options.maxRenderFeatures) {
    windowedFeatures = capFeaturesWithoutSplittingGroups(
      candidateFeatures,
      options.maxRenderFeatures
    ) as Feature[];
  }

  return {
    shouldRebuild: true,
    windowedFeatures,
    newWindowBBox,
  };
}
