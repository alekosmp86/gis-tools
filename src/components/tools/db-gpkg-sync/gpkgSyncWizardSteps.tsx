import { Columns3, Eraser, Package } from "lucide-react";
import { ColumnMappingStep } from "@/components/tools/db-sync-common/ColumnMappingStep";
import type { FileReplaceMapping } from "@/components/tools/db-sync-common/useFileReplaceMapping";
import { ShpReplaceStep } from "@/components/tools/db-shapefile-sync/ShpReplaceStep";
import type { ShpReplaceRunParams } from "@/core/services/replaceRunTypes";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { GpkgSourceContent } from "./GpkgSourceContent";
import type { GpkgSource } from "./useGpkgSource";

const GPKG_SRID_HINT = "SRID declarado por la capa del GeoPackage (srs_id). Puede cambiarlo antes de reemplazar.";
const GPKG_NO_SRID_HINT = "La capa no declara un SRID válido (srs_id 0 o -1). Indique el SRID de sus geometrías.";

export interface BuildGpkgReplaceStepsParams {
  source: GpkgSource;
  replaceMapping: FileReplaceMapping;
  targetConfig: DbConfig | null;
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
  targetRowCount: number;
  startRun: (params: ShpReplaceRunParams) => Promise<void>;
  goToStep: (stepId: number) => void;
}

export function buildGpkgReplaceSteps(params: BuildGpkgReplaceStepsParams): WizardStepDef[] {
  const { source, replaceMapping, goToStep } = params;
  return [
    {
      id: 2,
      title: "Archivo GeoPackage",
      subtitle: "Cargar Archivo .gpkg",
      cardTitle: "Cargar Archivo GeoPackage",
      cardSubtitle: "Suba un archivo .gpkg y elija la capa de entidades cuyas filas reemplazarán la tabla destino.",
      icon: Package,
      content: <GpkgSourceContent source={source} />,
      canProceed: source.file !== null && source.selectedLayer !== null,
      nextLabel: "Continuar a Mapeo de Columnas",
      onNext: () => goToStep(3),
      onBack: () => goToStep(1),
      backLabel: "Volver al Paso 1: Base de Datos",
    },
    {
      id: 3,
      title: "Mapeo de Columnas",
      subtitle: "Campos del GeoPackage a Columnas",
      cardTitle: "Mapeo de Columnas GeoPackage a Destino",
      cardSubtitle:
        "Para cada columna de la tabla destino elija el campo de la capa que la alimenta, la geometría o no la mapee. Las columnas no mapeadas conservan su valor por defecto.",
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
          fileDate={source.file ? new Date(source.file.lastModified) : null}
          autoMatches={replaceMapping.autoMatches}
        />
      ),
      canProceed: replaceMapping.isMappingValid,
      nextLabel: "Continuar a Reemplazo Completo",
      onNext: () => goToStep(4),
      onBack: () => goToStep(2),
      backLabel: "Volver al Paso 2: Archivo GeoPackage",
    },
    {
      id: 4,
      title: "Reemplazo Completo",
      subtitle: "Vaciar y Recargar",
      cardTitle: "Reemplazo Completo de la Tabla Destino",
      cardSubtitle: "Vacíe la tabla destino y recárguela con las filas de la capa del GeoPackage según el mapeo.",
      icon: Eraser,
      content: (
        <ShpReplaceStep
          targetConfig={params.targetConfig}
          targetRowCount={params.targetRowCount}
          file={source.file}
          recordCount={source.recordCount}
          detectedSrid={source.detectedSrid}
          sridHint={source.detectedSrid !== null ? GPKG_SRID_HINT : GPKG_NO_SRID_HINT}
          showSrid
          sourceLabel="GeoPackage"
          runLabel="Vaciar destino y reemplazar con el GeoPackage"
          mapping={replaceMapping.mapping}
          uploadId={source.uploadId}
          startRun={(runParams) => params.startRun({ ...runParams, layer: source.layerParam })}
        />
      ),
      onBack: () => goToStep(3),
      backLabel: "Volver al Paso 3: Mapeo de Columnas",
    },
  ];
}
