"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { RenderErrorBoundary } from "@/ui-kit/components/RenderErrorBoundary";
import { AlertType } from "@/ui-kit/types/ui";
import { OUTLINE_LABEL_PROPERTY } from "../../shared/map/outlineMapCollection";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import styles from "./EjesSplitReview.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/ui-kit/components/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

const BOUNDARY_LABEL = "ejes split point map";

const mapRenderFailure = (error: Error) => (
  <AlertMessage type={AlertType.ERROR} text={EJES_SPLIT_REVIEW_TEXT.MAP_RENDER_FAILURE(error.message)} />
);

export interface EjesSplitPointMapProps {
  collection: FeatureCollection;
}

/** The point, the old section and every piece of the split on the shared map; the pieces are labelled with their chosen and suggested marks. */
export function EjesSplitPointMap({ collection }: EjesSplitPointMapProps) {
  if (collection.features.length === 0) return <p className={styles.note}>{EJES_SPLIT_REVIEW_TEXT.MAP_EMPTY}</p>;
  return (
    <div className={styles.mapFrame}>
      <RenderErrorBoundary label={BOUNDARY_LABEL} fallback={mapRenderFailure}>
        <SpatialMapPreview
          geojson={collection}
          title={EJES_SPLIT_REVIEW_TEXT.MAP_TITLE}
          showPopups={false}
          labelProperty={OUTLINE_LABEL_PROPERTY}
          codedLabels
          clearOnBackgroundClick
          fillParent
        />
      </RenderErrorBoundary>
    </div>
  );
}
