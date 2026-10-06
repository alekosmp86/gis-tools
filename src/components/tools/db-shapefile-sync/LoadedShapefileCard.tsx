import React from "react";
import dynamic from "next/dynamic";
import { FileCheck } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { ColumnsList } from "@/ui-kit/components/ColumnsList";
import type { ParsedFileDataset } from "@/core/types/parsers";
import { formatNumber, formatFileSize } from "@/core/common/ValueFormatter";
import { LoadedFileHeader } from "../db-sync-common/LoadedFileHeader";
import styles from "./LoadedShapefileCard.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/ui-kit/components/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

export interface LoadedShapefileCardProps {
  data: ParsedFileDataset;
  onDiscard: () => void;
}

export const LoadedShapefileCard: React.FC<LoadedShapefileCardProps> = ({
  data,
  onDiscard,
}) => {
  const hasGeometry = Boolean(
    data.geojson &&
      data.geojson.features &&
      data.geojson.features.length > 0
  );

  return (
    <div className={styles.loadedCard}>
      <LoadedFileHeader
        variant="shapefile"
        icon={FileCheck}
        fileName={data.fileName}
        onDiscard={onDiscard}
      >
        Tamaño: {formatFileSize(data.fileSize)} &bull; Tipo:{" "}
        {data.geometryType || "Desconocido"}
      </LoadedFileHeader>

      <div className={styles.metaRow}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Total de Geometrías Espaciales:</span>
          <span className={styles.metaValue}>
            {formatNumber(data.featureCount)} entidades
          </span>
        </div>

        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Tipo de Geometría:</span>
          <span className={styles.metaValue}>{data.geometryType || "Desconocido"}</span>
        </div>
      </div>

      {/* DBF Attribute column tags */}
      <ColumnsList
        columns={data.attributes}
        title="Atributos Encontrados en DBF"
      />

      {/* Interactive Spatial Map Preview */}
      {hasGeometry && data.geojson && (
        <div className={styles.mapSection}>
          {data.isLargeDataset && (
            <AlertMessage
              type={AlertType.WARNING}
              className={styles.previewNotice}
              text={`Vista previa de muestra: Mostrando ${formatNumber(data.geojson.features.length)} de ${formatNumber(data.featureCount)} entidades en el mapa inicial para asegurar fluidez de navegación. La totalidad de los ${formatNumber(data.featureCount)} registros se auditará en los pasos siguientes.`}
            />
          )}
          <SpatialMapPreview
            geojson={data.geojson}
            title="VISTA PREVIA ESPACIAL DE CAPA VECTORIAL"
          />
        </div>
      )}
    </div>
  );
};
