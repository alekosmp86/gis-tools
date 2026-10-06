import React from "react";
import dynamic from "next/dynamic";
import { FileSpreadsheet } from "lucide-react";
import { ColumnsList } from "@/ui-kit/components/ColumnsList";
import { FileSourceFormat } from "@/ui-kit/modules/contracts";
import { CsvParser } from "@/core/services/parsers/CsvParser";
import type { ParsedFileDataset } from "@/core/types/parsers";
import { formatNumber, formatFileSize } from "@/core/common/ValueFormatter";
import { FileUploadArea } from "../db-sync-common/FileUploadArea";
import { LoadedFileHeader } from "../db-sync-common/LoadedFileHeader";
import { useSpatialFileUpload } from "../db-sync-common/useSpatialFileUpload";
import styles from "./CsvUploader.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/ui-kit/components/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

interface CsvUploaderProps {
  onSuccess: (data: ParsedFileDataset) => void;
  onDiscard: () => void;
  loadedData?: ParsedFileDataset | null;
}

export const CsvUploader: React.FC<CsvUploaderProps> = ({
  onSuccess,
  onDiscard,
  loadedData = null,
}) => {
  const upload = useSpatialFileUpload({
    createParser: () => new CsvParser(),
    fallbackErrorMessage: "Error al procesar el archivo CSV.",
    loadedData,
    onSuccess,
    onDiscard,
  });
  const { data } = upload;

  return (
    <FileUploadArea
      upload={upload}
      accept=".csv,.txt"
      inputAriaLabel="Seleccionar archivo CSV"
      toolId="db-csv-sync"
      format={FileSourceFormat.CSV}
      dropzoneTitle="Arrastre y suelte su archivo CSV (.csv) aquí"
      dropzoneSubtitle="o haga clic para seleccionar un archivo desde su equipo"
      formatBadges={[".CSV", "DELIMITADO POR COMAS"]}
      loadingMessage="Leyendo e inspeccionando columnas del archivo CSV en memoria..."
    >
      {/* Loaded File Info Card */}
      {data && (
        <div className={styles.loadedCard}>
          <LoadedFileHeader
            variant="csv"
            icon={FileSpreadsheet}
            fileName={data.fileName}
            onDiscard={upload.handleDiscard}
          >
            Tamaño: {formatFileSize(data.fileSize)} &bull; {formatNumber(data.featureCount)} filas
          </LoadedFileHeader>

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
          {data.geojson && data.geojson.features.length > 0 && (
            <div className={styles.mapSection}>
              <SpatialMapPreview
                geojson={data.geojson}
                title="VISTA PREVIA ESPACIAL DEL ARCHIVO CSV"
              />
            </div>
          )}

        </div>
      )}
    </FileUploadArea>
  );
};
