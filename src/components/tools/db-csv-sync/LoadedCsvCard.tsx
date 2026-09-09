import React from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ColumnsList } from "@/components/shared/ColumnsList";
import { MAX_MAP_PREVIEW_FEATURES } from "@/constants/mapConstants";
import { AlertType } from "@/types/ui";
import type { ParsedFileDataset } from "@/types/parsers";
import { formatNumber, formatFileSize } from "@/utils/common/ValueFormatter";
import styles from "./LoadedCsvCard.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

/**
 * Builds a capped FeatureCollection subset for map preview to preserve UI responsiveness.
 */
function buildCappedPreviewGeoJson(
  geojson: FeatureCollection | undefined,
  maxFeatures: number
): FeatureCollection | null {
  if (!geojson || !geojson.features || geojson.features.length === 0) {
    return null;
  }
  if (geojson.features.length <= maxFeatures) {
    return geojson;
  }
  return {
    ...geojson,
    features: geojson.features.slice(0, maxFeatures),
  };
}

export interface LoadedCsvCardProps {
  data: ParsedFileDataset;
  onDiscard: () => void;
}

export const LoadedCsvCard: React.FC<LoadedCsvCardProps> = ({
  data,
  onDiscard,
}) => {
  const previewGeojson = buildCappedPreviewGeoJson(
    data.geojson,
    MAX_MAP_PREVIEW_FEATURES
  );

  const isPreviewCapped = Boolean(
    data.geojson?.features &&
      data.geojson.features.length > MAX_MAP_PREVIEW_FEATURES
  );

  const hasGeometry = Boolean(previewGeojson && previewGeojson.features.length > 0);

  return (
    <div className={styles.loadedCard}>
      <div className={styles.loadedHeader}>
        <div className={styles.fileMeta}>
          <FileSpreadsheet size={28} className={styles.successIcon} />
          <div>
            <div className={styles.fileName}>{data.fileName}</div>
            <div className={styles.fileSub}>
              Tamaño: {formatFileSize(data.fileSize)} &bull; {formatNumber(data.featureCount)} filas
            </div>
          </div>
        </div>

        <Button variant="ghost" onClick={onDiscard}>
          <Trash2 size={16} color="var(--accent-rose, #f43f5e)" />
          <span className={styles.discardText}>Descartar archivo</span>
        </Button>
      </div>

      <div className={styles.metaRow}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Total de Filas / Registros:</span>
          <span className={styles.metaValue}>{formatNumber(data.featureCount)} filas</span>
        </div>

        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Columnas Encontradas:</span>
          <span className={styles.metaValue}>{formatNumber(data.attributes.length)} columnas</span>
        </div>
      </div>

      {/* Reusable ColumnsList component for CSV Header tags */}
      <ColumnsList
        columns={data.attributes}
        title="Encabezados / Columnas del Archivo CSV"
      />

      {/* Interactive Spatial Map Preview if CSV contains Geometry (EWKB / WKT / GeoJSON) */}
      {hasGeometry && previewGeojson && (
        <div className={styles.mapSection}>
          {isPreviewCapped && data.geojson && (
            <AlertMessage
              type={AlertType.WARNING}
              className={styles.previewNotice}
              text={`Vista previa de muestra: Mostrando los primeros ${formatNumber(previewGeojson.features.length)} de ${formatNumber(data.geojson.features.length)} registros con geometría en el mapa inicial para asegurar fluidez de navegación. La totalidad de los ${formatNumber(data.featureCount)} registros se auditará y visualizará en el paso final.`}
            />
          )}
          <SpatialMapPreview
            geojson={previewGeojson}
            title="VISTA PREVIA ESPACIAL DEL ARCHIVO CSV"
          />
        </div>
      )}
    </div>
  );
};
