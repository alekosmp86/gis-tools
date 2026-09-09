"use client";

import React from "react";
import Link from "next/link";
import {
  Download,
  Calendar,
  HardDrive,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import {
  type WatchResourceDelta,
  DeltaStatus,
} from "../types/watcher";
import {
  formatBytes,
  formatDate,
  getTargetSyncUrl,
} from "../utils/watcherFormatters";
import { ResourceStatusBadge } from "./ResourceStatusBadge";
import { ResourceVaultSection } from "./ResourceVaultSection";
import styles from "./ResourceCard.module.css";

export interface ResourceCardProps {
  delta: WatchResourceDelta;
  sourceSlug?: string;
  isDownloading: boolean;
  onDownload: (resourceId: string) => void;
}

export const ResourceCard: React.FC<ResourceCardProps> = ({
  delta,
  sourceSlug,
  isDownloading,
  onDownload,
}) => {
  const resource = delta.resource;
  const isUpdate = delta.status === DeltaStatus.UPDATE_AVAILABLE;
  const isNotDownloaded = delta.status === DeltaStatus.NOT_DOWNLOADED;
  const targetSyncUrl = getTargetSyncUrl(resource.format, sourceSlug, resource.id);
  const isCsv = (resource.format || "").toUpperCase() === "CSV";

  const cardClasses = [
    styles.card,
    isUpdate || isNotDownloaded ? styles.cardUpdateAvailable : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClasses}>
      <div>
        <div className={styles.header}>
          <div className={styles.titleArea}>
            <div className={styles.badges}>
              <span className={styles.formatBadge}>
                {(resource.format || "CSV").toUpperCase()}
              </span>
              <ResourceStatusBadge status={delta.status} />
            </div>
            <h3 className={styles.title}>{resource.name}</h3>
          </div>
        </div>

        <div className={styles.details}>
          <div className={styles.detailRow}>
            <Calendar size={14} className={styles.detailIcon} />
            <span>
              Catálogo: {formatDate(resource.last_modified || resource.metadata_modified, true)}
            </span>
          </div>
          <div className={styles.detailRow}>
            <HardDrive size={14} className={styles.detailIcon} />
            <span>Tamaño: {formatBytes(resource.size)}</span>
          </div>

          {delta.reason && isUpdate && (
            <div className={styles.reasonNotice}>{delta.reason}</div>
          )}

          <ResourceVaultSection localMeta={delta.localMeta} />
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.downloadButton}
          onClick={() => onDownload(resource.id)}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Descargando...
            </>
          ) : (
            <>
              <Download size={15} />
              {delta.localMeta ? "Actualizar Caché" : "Descargar a Caché"}
            </>
          )}
        </button>

        {targetSyncUrl && (
          <Link
            href={targetSyncUrl}
            className={styles.syncLinkButton}
            title={
              isCsv
                ? "Abrir herramienta de Sincronización DB vs CSV con este archivo"
                : "Abrir herramienta de Sincronización DB vs Shapefile con este archivo"
            }
          >
            <span>Sincronizar</span>
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
};

ResourceCard.displayName = "ResourceCard";
