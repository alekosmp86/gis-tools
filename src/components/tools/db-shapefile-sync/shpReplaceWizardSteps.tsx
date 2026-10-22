import { Columns3, Eraser } from "lucide-react";
import { ColumnMappingStep } from "@/components/tools/db-sync-common/ColumnMappingStep";
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
        />
      ),
      canProceed: params.isMappingValid,
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
        />
      ),
      onBack: () => params.goToStep(4),
      backLabel: "Volver al Paso 4: Mapeo de Columnas",
    },
  ];
}
