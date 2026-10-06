import React from "react";
import { ShapefileParser } from "@/core/services/parsers/ShapefileParser";
import type { ParsedShapefileData } from "@/core/types/shp";
import type { ParsedFileDataset } from "@/core/types/parsers";
import { FileSourceFormat } from "@/ui-kit/modules/contracts";
import { FileUploadArea } from "../db-sync-common/FileUploadArea";
import { useSpatialFileUpload } from "../db-sync-common/useSpatialFileUpload";
import { LoadedShapefileCard } from "./LoadedShapefileCard";

export interface ShapefileUploaderProps {
  onSuccess: (data: ParsedShapefileData) => void;
  onDiscard: () => void;
  loadedData?: ParsedShapefileData | null;
}

export const ShapefileUploader: React.FC<ShapefileUploaderProps> = ({
  onSuccess,
  onDiscard,
  loadedData = null,
}) => {
  const upload = useSpatialFileUpload({
    createParser: () => new ShapefileParser(),
    fallbackErrorMessage: "Error al procesar el archivo Shapefile.",
    loadedData: loadedData ? (loadedData as unknown as ParsedFileDataset) : null,
    onSuccess: (parsed) => onSuccess(parsed as unknown as ParsedShapefileData),
    onDiscard,
  });
  const { data } = upload;

  return (
    <FileUploadArea
      upload={upload}
      accept=".zip,.geojson,.json"
      inputAriaLabel="Seleccionar archivo Shapefile o GeoJSON"
      toolId="db-shapefile-sync"
      format={FileSourceFormat.SHP}
      dropzoneTitle="Arrastre y suelte su archivo Shapefile (.zip) o GeoJSON aquí"
      dropzoneSubtitle="o haga clic para seleccionar un archivo desde su equipo"
      formatBadges={[".ZIP (SHP + DBF)", ".GEOJSON"]}
      loadingMessage="Leyendo e inspeccionando atributos del Shapefile en memoria..."
      compactLoading
    >
      {data && <LoadedShapefileCard data={data} onDiscard={upload.handleDiscard} />}
    </FileUploadArea>
  );
};
