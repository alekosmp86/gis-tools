import React from "react";
import dynamic from "next/dynamic";
import { FileCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType } from "@/types/ui";
import { ColumnsList } from "@/components/shared/ColumnsList";
import type { ParsedFileDataset } from "@/types/parsers";
import { formatNumber, formatFileSize } from "@/utils/common/ValueFormatter";
import styles from "./LoadedShapefileCard.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((module) => module.SpatialMapPreview),
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
      <div className={styles.loadedHeader}>
        <div className={styles.fileMeta}>
          <FileCheck size={28} className={styles.successIcon} />
          <div>
            <div className={styles.fileName}>{data.fileName}</div>
            <div className={styles.fileSub}>
              Tamaño: {formatFileSize(data.fileSize)} &bull; Tipo:{" "}
              {data.geometryType || "Desconocido"}
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
