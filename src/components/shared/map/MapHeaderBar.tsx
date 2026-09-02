import React, { useState, useRef, useEffect } from "react";
import { Layers, Maximize2, Loader2, MapPin, Palette } from "lucide-react";
import { formatNumber } from "@/utils/common/ValueFormatter";
import type { MapFeatureStyle } from "@/types/map";
import { MapStylePopover } from "./MapStylePopover";
import styles from "../SpatialMapPreview.module.css";

export interface MapHeaderBarProps {
  title: string;
  totalFeatures: number;
  renderedCount: number;
  isChunking: boolean;
  basemapKey: string;
  onSelectBasemap: (basemapKey: string) => void;
  onFitBounds: () => void;
  featureStyle: MapFeatureStyle;
  onUpdateFeatureStyle: (newStyle: MapFeatureStyle) => void;
  onResetFeatureStyle: () => void;
  hasDiscrepancies?: boolean;
}

export const MapHeaderBar: React.FC<MapHeaderBarProps> = ({
  title,
  totalFeatures,
  renderedCount,
  isChunking,
  basemapKey,
  onSelectBasemap,
  onFitBounds,
  featureStyle,
  onUpdateFeatureStyle,
  onResetFeatureStyle,
  hasDiscrepancies = false,
}) => {
  const [isStyleOpen, setIsStyleOpen] = useState<boolean>(false);
  const styleButtonContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isStyleOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        styleButtonContainerRef.current &&
        !styleButtonContainerRef.current.contains(event.target as Node)
      ) {
        setIsStyleOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsStyleOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStyleOpen]);

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
            onChange={(event) => onSelectBasemap(event.target.value)}
            className={styles.selectBasemap}
            aria-label="Seleccionar mapa base"
          >
            <option value="osm">Estándar (OpenStreetMap)</option>
            <option value="satellite">Satélite (Esri World)</option>
            <option value="dark">Modo Oscuro (CartoDB)</option>
          </select>
        </div>

        {/* Style Customization Popover Toggle */}
        <div ref={styleButtonContainerRef} className={styles.stylePopoverWrapper}>
          <button
            type="button"
            onClick={() => setIsStyleOpen((prev) => !prev)}
            title="Personalizar colores y estilo de trazo"
            className={`${styles.controlBtn} ${isStyleOpen ? styles.controlBtnActive : ""}`}
            aria-label="Personalizar estilo de capa"
          >
            <Palette size={15} />
          </button>

          {isStyleOpen && (
            <MapStylePopover
              styleState={featureStyle}
              onUpdateStyle={onUpdateFeatureStyle}
              onResetStyle={onResetFeatureStyle}
              hasDiscrepancies={hasDiscrepancies}
            />
          )}
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
