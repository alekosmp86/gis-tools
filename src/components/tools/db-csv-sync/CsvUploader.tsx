import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType } from "@/types/ui";
import { CsvParser } from "@/services/parsers/CsvParser";
import type { ISpatialFileParser, ParsedFileDataset } from "@/types/parsers";
import { DefaultFileSourceTab, SupportedExtensionFormat } from "@/types/extensions";
import { FileSourceSelectionArea } from "@/components/shared/FileSourceSelectionArea";
import { useFileSourceExtensions } from "@/hooks/useFileSourceExtensions";
import { useAutoLoadFileSource } from "@/hooks/useAutoLoadFileSource";
import { LoadedCsvCard } from "./LoadedCsvCard";
import styles from "./CsvUploader.module.css";

export interface CsvUploaderProps {
  onSuccess: (data: ParsedFileDataset) => void;
  onDiscard: () => void;
  loadedData?: ParsedFileDataset | null;
  toolId?: string;
  sourceSlug?: string;
  resourceId?: string;
}

export const CsvUploader: React.FC<CsvUploaderProps> = ({
  onSuccess,
  onDiscard,
  loadedData = null,
  toolId = "db-csv-sync",
  sourceSlug,
  resourceId,
}) => {
  const queryClient = useQueryClient();
  const extensions = useFileSourceExtensions(toolId, SupportedExtensionFormat.CSV);
  const [data, setData] = useState<ParsedFileDataset | null>(loadedData);
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
      const parser: ISpatialFileParser = new CsvParser();
      const parsed = await parser.parse(file);
      setData(parsed);
      onSuccess(parsed);
      setLoading(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Error al procesar el archivo CSV.";
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
          format={SupportedExtensionFormat.CSV}
          onSelectFile={(file) => processFile(file)}
          isLoading={loading}
          accept=".csv,.txt"
          inputAriaLabel="Seleccionar archivo CSV"
          dropzoneTitle="Arrastre y suelte su archivo CSV (.csv) aquí"
          dropzoneSubtitle="o haga clic para seleccionar un archivo desde su equipo"
          dropzoneFormatBadges={[".CSV", "DELIMITADO POR COMAS"]}
        />
      )}

      {loading && (
        <div className={styles.loadingArea}>
          <Loader2 size={32} className={styles.spin} />
          <span>Leyendo e inspeccionando columnas del archivo CSV en memoria...</span>
        </div>
      )}

      {errorMessage && <AlertMessage type={AlertType.ERROR} text={errorMessage} />}

      {data && <LoadedCsvCard data={data} onDiscard={handleDiscard} />}
    </div>
  );
};
