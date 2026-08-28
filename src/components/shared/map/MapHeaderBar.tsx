import React from "react";
import { Layers, Maximize2, Loader2, MapPin } from "lucide-react";
import { formatNumber } from "@/utils/formatters";
import type { MapHeaderBarProps } from "@/types/map";
import styles from "../SpatialMapPreview.module.css";

export const MapHeaderBar: React.FC<MapHeaderBarProps> = ({
  title,
  totalFeatures,
  renderedCount,
  isChunking,
  basemapKey,
  onSelectBasemap,
  onFitBounds,
}) => {
  const progressPct = totalFeatures > 0 ? Math.min(100, Math.round((renderedCount / totalFeatures) * 100)) : 0;

  return (
    <div className={styles.mapHeaderBar}>
      <div className={styles.mapHeaderLeft}>
        <div className={styles.mapBadge}>
          <Layers size={14} className={styles.badgeIcon} />
          <span>
            {title} &bull; {formatNumber(totalFeatures)} entidades
          </span>
        </div>

        {isChunking && (
          <div
            className={styles.chunkLoadingBadge}
            title="Cargando entidades progresivamente en segundo plano para mantener la fluidez"
          >
            <Loader2 size={13} className={styles.spinIcon} />
            <span>
              Cargando: {progressPct}% ({formatNumber(renderedCount)} / {formatNumber(totalFeatures)})
            </span>
          </div>
        )}
      </div>

      <div className={styles.mapControls}>
        <div className={styles.basemapSelectorWrapper}>
          <MapPin size={13} className={styles.selectIcon} />
          <select
            value={basemapKey}
            onChange={(e) => onSelectBasemap(e.target.value)}
            className={styles.selectBasemap}
            aria-label="Seleccionar mapa base"
          >
            <option value="osm">Estándar (OpenStreetMap)</option>
            <option value="satellite">Satélite (Esri World)</option>
            <option value="dark">Modo Oscuro (CartoDB)</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onFitBounds}
          title="Ajustar vista a los límites de la capa"
          className={styles.controlBtn}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
};
