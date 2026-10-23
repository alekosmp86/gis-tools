import { Columns3, Eraser, Shapes } from "lucide-react";
import { ColumnMappingStep } from "@/components/tools/db-sync-common/ColumnMappingStep";
import { GeometryProcessingStep } from "@/components/tools/db-sync-common/geometry-processing/GeometryProcessingStep";
import type { GeometryProcessingController } from "@/components/tools/db-sync-common/geometry-processing/useGeometryProcessingOptions";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { InsertFieldDefault } from "@/core/types/comparison";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { ShpReplaceStep } from "./ShpReplaceStep";

export interface BuildShpReplaceStepsParams {
  sourceColumns: string[];
  sourceDetails: DbColumnMetadata[];
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
  mapping: ReplaceColumnMapping;
  autoMatches: Record<string, string>;
  isMappingValid: boolean;
  onSourceChange: (targetColumn: string, sourceColumn: string | null) => void;
  onDefaultChange: (targetColumn: string, fieldDefault: InsertFieldDefault) => void;
  targetConfig: DbConfig | null;
  targetRowCount: number;
  file: File | null;
  recordCount: number;
  detectedSrid: number | null;
  prjText: string | undefined;
  fileDate: Date | null;
  dbfFields: string[];
  geometry: GeometryProcessingController;
  uploadId: string | null;
  goToStep: (stepId: number) => void;
}

export function buildShpReplaceSteps(params: BuildShpReplaceStepsParams): WizardStepDef[] {
  return [
    {
      id: 4,
      title: "Mapeo de Columnas",
      subtitle: "Campos del Shapefile a Columnas",
      cardTitle: "Mapeo de Columnas Shapefile a Destino",
      cardSubtitle:
        "Para cada columna de la tabla destino elija el campo del Shapefile que la alimenta, la geometría o no la mapee.",
      icon: Columns3,
      content: (
        <ColumnMappingStep
          sourceColumns={params.sourceColumns}
          sourceDetails={params.sourceDetails}
          targetColumns={params.targetColumns}
          targetDetails={params.targetDetails}
          mapping={params.mapping}
          onSourceChange={params.onSourceChange}
          onDefaultChange={params.onDefaultChange}
          fileDate={params.fileDate}
          autoMatches={params.autoMatches}
        />
      ),
      canProceed: params.isMappingValid,
      nextLabel: "Continuar a Procesamiento de Geometrías",
      onNext: () => params.goToStep(5),
      onBack: () => params.goToStep(3),
      backLabel: "Volver al Paso 3: Modo",
    },
    {
      id: 5,
      title: "Procesamiento de Geometrías",
      subtitle: "Reparar, Unificar y Validar (opcional)",
      cardTitle: "Procesamiento de Geometrías",
      cardSubtitle:
        "Paso opcional: repare geometrías inválidas, unifique registros por clave o valide solapes antes de cargar.",
      icon: Shapes,
      content: (
        <GeometryProcessingStep
          dbfFields={params.dbfFields}
          options={params.geometry.options}
          suggestionOrigin={params.geometry.suggestionOrigin}
          onChange={params.geometry.onChange}
          onSkip={() => {
            params.geometry.omit();
            params.goToStep(6);
          }}
        />
      ),
      canProceed: true,
      nextLabel: "Continuar a Reemplazo Completo",
      onNext: () => params.goToStep(6),
      onBack: () => params.goToStep(4),
      backLabel: "Volver al Paso 4: Mapeo de Columnas",
    },
    {
      id: 6,
      title: "Reemplazo Completo",
      subtitle: "Vaciar y Recargar",
      cardTitle: "Reemplazo Completo de la Tabla Destino",
      cardSubtitle: "Vacíe la tabla destino y recárguela con los registros del Shapefile según el mapeo.",
      icon: Eraser,
      content: (
        <ShpReplaceStep
          targetConfig={params.targetConfig}
          targetRowCount={params.targetRowCount}
          file={params.file}
          recordCount={params.recordCount}
          detectedSrid={params.detectedSrid}
          prjText={params.prjText}
          mapping={params.mapping}
          geometry={params.geometry}
          uploadId={params.uploadId}
        />
      ),
      onBack: () => params.goToStep(5),
      backLabel: "Volver al Paso 5: Procesamiento de Geometrías",
    },
  ];
}
