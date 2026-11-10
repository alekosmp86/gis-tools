import { Columns3, Eraser } from "lucide-react";
import { ColumnMappingStep } from "@/components/tools/db-sync-common/ColumnMappingStep";
import type { FileReplaceMapping } from "@/components/tools/db-sync-common/useFileReplaceMapping";
import { ShpReplaceStep } from "@/components/tools/db-shapefile-sync/ShpReplaceStep";
import { start as startCsvRun } from "@/core/services/csvReplaceRunStore";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";
import type { WizardStepDef } from "@/ui-kit/types/ui";

const CSV_DEFAULT_SRID = 4326;

const CSV_SRID_HINT =
  "Se aplica a la geometría WKT y a las columnas de latitud/longitud. El EWKB trae su propio SRID. Por defecto 4326.";

export interface BuildCsvReplaceStepsParams {
  replaceMapping: FileReplaceMapping;
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
  targetConfig: DbConfig | null;
  targetRowCount: number;
  file: File | null;
  recordCount: number;
  uploadId: string | null;
  goToStep: (stepId: number) => void;
}

const isGeometryMapped = (mapping: FileReplaceMapping["mapping"]): boolean =>
  Object.values(mapping.sourceByTarget).includes(SHP_GEOMETRY_SOURCE);

export function buildCsvReplaceSteps(params: BuildCsvReplaceStepsParams): WizardStepDef[] {
  const { replaceMapping } = params;
  return [
    {
      id: 4,
      title: "Mapeo de Columnas",
      subtitle: "Columnas del CSV a Columnas",
      cardTitle: "Mapeo de Columnas CSV a Destino",
      cardSubtitle:
        "Para cada columna de la tabla destino elija la columna del CSV que la alimenta, la geometría o no la mapee.",
      icon: Columns3,
      content: (
        <ColumnMappingStep
          sourceColumns={replaceMapping.sourceColumns}
          sourceDetails={replaceMapping.sourceDetails}
          targetColumns={params.targetColumns}
          targetDetails={params.targetDetails}
          mapping={replaceMapping.mapping}
          onSourceChange={replaceMapping.setSource}
          onDefaultChange={replaceMapping.setDefault}
          fileDate={params.file ? new Date(params.file.lastModified) : null}
          autoMatches={replaceMapping.autoMatches}
        />
      ),
      canProceed: replaceMapping.isMappingValid,
      nextLabel: "Continuar a Reemplazo Completo",
      onNext: () => params.goToStep(5),
      onBack: () => params.goToStep(3),
      backLabel: "Volver al Paso 3: Modo",
    },
    {
      id: 5,
      title: "Reemplazo Completo",
      subtitle: "Vaciar y Recargar",
      cardTitle: "Reemplazo Completo de la Tabla Destino",
      cardSubtitle: "Vacíe la tabla destino y recárguela con las filas del CSV según el mapeo.",
      icon: Eraser,
      content: (
        <ShpReplaceStep
          targetConfig={params.targetConfig}
          targetRowCount={params.targetRowCount}
          file={params.file}
          recordCount={params.recordCount}
          detectedSrid={CSV_DEFAULT_SRID}
          sridHint={CSV_SRID_HINT}
          showSrid={isGeometryMapped(replaceMapping.mapping)}
          sourceLabel="CSV"
          runLabel="Vaciar destino y reemplazar con el CSV"
          mapping={replaceMapping.mapping}
          uploadId={params.uploadId}
          startRun={startCsvRun}
        />
      ),
      onBack: () => params.goToStep(4),
      backLabel: "Volver al Paso 4: Mapeo de Columnas",
    },
  ];
}
