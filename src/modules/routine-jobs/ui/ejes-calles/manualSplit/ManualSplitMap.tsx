"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { RenderErrorBoundary } from "@/ui-kit/components/RenderErrorBoundary";
import { AlertType } from "@/ui-kit/types/ui";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { candidateRefAt, neighbourRefAt } from "./manualSplitView";
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
  /** Changes when new data arrives (another old section, radius or street switch): the map then fits its view again, without being rebuilt. */
  viewKey: string;
  /** The data on the map is the previous one while the next is requested. */
  loading: boolean;
  /** A click on a candidate section toggles it, as its row in the list does. */
  onToggleCandidate: (ref: string) => void;
  /** A click on a neighbour old section toggles its merge, as its row in the list does. */
  onToggleNeighbour: (ref: string) => void;
}

/**
 * The old section, its access points, the candidate sections and the neighbour old sections on the shared map; a click on a candidate
 * chooses it, a click on a neighbour ticks it for the merge. No labels, and the view is fitted once per `viewKey`: choosing a section
 * only repaints it, it never moves the view.
 */
export function ManualSplitMap({ collection, viewKey, loading, onToggleCandidate, onToggleNeighbour }: ManualSplitMapProps) {
  const handleSelect = (index: number | null) => {
    if (loading) return;
    const candidateRef = candidateRefAt(collection, index);
    if (candidateRef !== null) return onToggleCandidate(candidateRef);
    const neighbourRef = neighbourRefAt(collection, index);
    if (neighbourRef !== null) onToggleNeighbour(neighbourRef);
  };
  return (
    <div className={styles.mapFrame}>
      {loading && <p className={styles.loadingBadge} role="status">{EJES_MANUAL_SPLIT_TEXT.LOADING}</p>}
      <RenderErrorBoundary label={BOUNDARY_LABEL} fallback={mapRenderFailure}>
        <SpatialMapPreview
          fitKey={viewKey}
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
