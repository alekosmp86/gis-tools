import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType } from "@/types/ui";
import { ShapefileParser } from "@/services/parsers/ShapefileParser";
import type { ParsedShapefileData } from "@/types/shp";
import type { ISpatialFileParser, ParsedFileDataset } from "@/types/parsers";
import { DefaultFileSourceTab, SupportedExtensionFormat } from "@/types/extensions";
import { FileSourceSelectionArea } from "@/components/shared/FileSourceSelectionArea";
import { useFileSourceExtensions } from "@/hooks/useFileSourceExtensions";
import { useAutoLoadFileSource } from "@/hooks/useAutoLoadFileSource";
import { LoadedShapefileCard } from "./LoadedShapefileCard";
import styles from "./ShapefileUploader.module.css";

export interface ShapefileUploaderProps {
  onSuccess: (data: ParsedShapefileData) => void;
  onDiscard: () => void;
  loadedData?: ParsedShapefileData | null;
  toolId?: string;
  sourceSlug?: string;
  resourceId?: string;
}

export const ShapefileUploader: React.FC<ShapefileUploaderProps> = ({
  onSuccess,
  onDiscard,
  loadedData = null,
  toolId = "db-shapefile-sync",
  sourceSlug,
  resourceId,
}) => {
  const queryClient = useQueryClient();
  const extensions = useFileSourceExtensions(toolId, SupportedExtensionFormat.SHP);
  const [data, setData] = useState<ParsedFileDataset | null>(
    (loadedData as unknown as ParsedFileDataset) ?? null
  );
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const defaultTabId =
    extensions.length > 0 ? extensions[0].id : DefaultFileSourceTab.PC;
  const activeSourceTab = selectedTabId ?? defaultTabId;

  const processFile = async (file: File) => {
    setLoading(true);
    setErrorMessage(null);
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });

    try {
      const parser: ISpatialFileParser = new ShapefileParser();
      const parsed = await parser.parse(file);
      setData(parsed);
      onSuccess(parsed as unknown as ParsedShapefileData);
      setLoading(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Error al procesar el archivo Shapefile.";
      setErrorMessage(message);
      setLoading(false);
    }
  };

  useAutoLoadFileSource({
    extensions,
    sourceSlug,
    resourceId,
    hasData: Boolean(data),
    onLoadFile: (file) => processFile(file),
    onError: (message) => setErrorMessage(message),
    onLoadingChange: (isLoading) => setLoading(isLoading),
  });

  const handleDiscard = () => {
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });
    setData(null);
    setErrorMessage(null);
    onDiscard();
  };

  return (
    <div className={styles.container}>
      {!data && !loading && (
        <FileSourceSelectionArea
          extensions={extensions}
          activeTabId={activeSourceTab}
          onSelectTab={setSelectedTabId}
          format={SupportedExtensionFormat.SHP}
          onSelectFile={(file) => processFile(file)}
          isLoading={loading}
          accept=".zip,.geojson,.json"
          inputAriaLabel="Seleccionar archivo Shapefile o GeoJSON"
          dropzoneTitle="Arrastre y suelte su archivo Shapefile (.zip) o GeoJSON aquí"
          dropzoneSubtitle="o haga clic para seleccionar un archivo desde su equipo"
          dropzoneFormatBadges={[".ZIP (SHP + DBF)", ".GEOJSON"]}
        />
      )}

      {loading && (
        <div className={styles.loadingArea}>
          <Loader2 size={32} className={styles.spin} />
          <span>Leyendo e inspeccionando atributos del Shapefile en memoria...</span>
        </div>
      )}

      {errorMessage && <AlertMessage type={AlertType.ERROR} text={errorMessage} />}

      {data && <LoadedShapefileCard data={data} onDiscard={handleDiscard} />}
    </div>
  );
};
