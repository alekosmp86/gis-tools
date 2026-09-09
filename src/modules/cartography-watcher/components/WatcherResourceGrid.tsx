"use client";

import React from "react";
import { FolderOpen } from "lucide-react";
import type { WatchResourceDelta } from "../types/watcher";
import { ResourceCard } from "./ResourceCard";
import styles from "./WatcherResourceGrid.module.css";

export interface WatcherResourceGridProps {
  resources: readonly WatchResourceDelta[];
  sourceSlug?: string;
  downloadingResourceId?: string | null;
  isChecking: boolean;
  onDownload: (resourceId: string) => void;
}

export const WatcherResourceGrid: React.FC<WatcherResourceGridProps> = ({
  resources,
  sourceSlug,
  downloadingResourceId,
  isChecking,
  onDownload,
}) => {
  if (resources.length === 0) {
    return (
      <div className={styles.emptyState}>
        <FolderOpen size={36} />
        <p>
          {isChecking
            ? "Consultando catálogo de datos..."
            : "No se encontraron recursos que coincidan con los filtros seleccionados."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {resources.map((deltaItem) => (
        <ResourceCard
          key={deltaItem.resource.id}
          delta={deltaItem}
          sourceSlug={sourceSlug}
          isDownloading={downloadingResourceId === deltaItem.resource.id}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
};

WatcherResourceGrid.displayName = "WatcherResourceGrid";
