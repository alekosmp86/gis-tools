"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { RenderErrorBoundary } from "@/ui-kit/components/RenderErrorBoundary";
import { AlertType } from "@/ui-kit/types/ui";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { candidateRefAt } from "./manualSplitView";
import styles from "./manualSplit.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/ui-kit/components/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

const BOUNDARY_LABEL = "ejes manual split map";

const mapRenderFailure = (error: Error) => (
  <AlertMessage type={AlertType.ERROR} text={EJES_MANUAL_SPLIT_TEXT.MAP_RENDER_FAILURE(error.message)} />
);

export interface ManualSplitMapProps {
  collection: FeatureCollection;
  /** Changes when the set of candidates changes (another old section, radius or street switch): the map then fits its view again. */
  viewKey: string;
  /** A click on a candidate section toggles it, as its row in the list does. */
  onToggleCandidate: (ref: string) => void;
}

/**
 * The old section, its access points and the candidate sections on the shared map; a click on a candidate chooses it.
 * No labels, and the view is fitted once per `viewKey`: choosing a section only repaints it, it never moves the view.
 */
export function ManualSplitMap({ collection, viewKey, onToggleCandidate }: ManualSplitMapProps) {
  const handleSelect = (index: number | null) => {
    const ref = candidateRefAt(collection, index);
    if (ref !== null) onToggleCandidate(ref);
  };
  return (
    <div className={styles.mapFrame}>
      <RenderErrorBoundary label={BOUNDARY_LABEL} fallback={mapRenderFailure}>
        <SpatialMapPreview
          key={viewKey}
          geojson={collection}
          title={EJES_MANUAL_SPLIT_TEXT.MAP_TITLE}
          onSelectFeature={handleSelect}
          showPopups={false}
          clearOnBackgroundClick
          fitOnce
          fillParent
        />
      </RenderErrorBoundary>
    </div>
  );
}
