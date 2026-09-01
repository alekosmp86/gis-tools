import React from "react";
import { Info, Layers, AlertTriangle, Zap } from "lucide-react";
import { formatNumber, formatFileSize } from "@/utils/formatters";
import type { ParsedFileDataset } from "@/types/parsers";
import styles from "./FileMetaPanel.module.css";

interface FileMetaPanelProps {
  dataset: ParsedFileDataset;
}

export const FileMetaPanel: React.FC<FileMetaPanelProps> = ({ dataset }) => {
  const formattedSize = formatFileSize(dataset.fileSize);
  const hasGeometry = Boolean(
    dataset.geojson &&
      dataset.geojson.features &&
      dataset.geojson.features.length > 0
  );

  return (
    <div className={styles.panelContainer}>
      <h4 className={styles.headerTitle}>
        <Info size={16} />
        <span>Metadatos del Archivo</span>
      </h4>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Registros / Entidades</span>
          <span className={styles.statValue}>{formatNumber(dataset.featureCount)}</span>
        </div>

        <div className={styles.statCard}>
          <span className={styles.statLabel}>Tipo de Geometría</span>
          <span className={styles.statValue}>
            {hasGeometry || dataset.shpBuffer
              ? dataset.geometryType || "Geometría"
              : "Alfanumérico"}
          </span>
        </div>

        <div className={styles.statCard}>
          <span className={styles.statLabel}>Tamaño del Archivo</span>
          <span className={styles.statValue}>{formattedSize}</span>
        </div>

        <div className={styles.statCard}>
          <span className={styles.statLabel}>Columnas / Campos</span>
          <span className={styles.statValue}>{formatNumber(dataset.attributes.length)}</span>
        </div>
      </div>

      {dataset.isLargeDataset && (
        <div className={styles.largeDatasetNotice}>
          <Zap size={16} color="#38bdf8" />
          <span>
            Motor de Alta Capacidad (1M Registros) activo con lectura binaria de bajo consumo en memoria RAM.
          </span>
        </div>
      )}

      {!hasGeometry && !dataset.shpBuffer && (
        <div className={styles.warningNote}>
          <AlertTriangle size={16} color="#eab308" />
          <span>
            Este archivo no contiene geometría dibujable en el mapa. Visualizando solo la tabla de atributos.
          </span>
        </div>
      )}

      <div className={styles.attributesSection}>
        <h5 className={styles.attributesTitle}>
          <Layers size={14} />
          <span>Campos de Atributos ({formatNumber(dataset.attributes.length)})</span>
        </h5>

        <div className={styles.attributesBadgeList}>
          {dataset.attributes.map((attr) => (
            <span key={attr} className={styles.attributeBadge}>
              {attr}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
