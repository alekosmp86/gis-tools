import type { RefObject } from "react";
import { Database, GitMerge, Sliders } from "lucide-react";
import { SuidMappingStep } from "./SuidMappingStep";
import { SyncParametersStep } from "./SyncParametersStep";
import { ComparisonResultsView } from "./ComparisonResultsView";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import type { ParsedFileDataset } from "@/core/types/parsers";
import type { ParsedShapefileData } from "@/core/types/shp";
import type {
  ColumnMappingConfig,
  ComparisonSourceDescriptor,
  SuidMappingStepRef,
  SyncParametersStepRef,
} from "@/core/types/comparison";
import type { WizardStepDef } from "@/ui-kit/types/ui";

export interface BuildSuidMappingStepParams {
  ref: RefObject<SuidMappingStepRef | null>;
  isSourceReady: boolean;
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  fileAttributes: string[];
  initialConfig: ColumnMappingConfig | null;
  showGeometryToggle?: boolean;
  onReadyChange: (ready: boolean) => void;
  onSuccess: (config: ColumnMappingConfig) => void;
  cardSubtitle: string;
  onBack: () => void;
  isMappingReady: boolean;
}

export interface BuildSyncParametersStepParams {
  ref: RefObject<SyncParametersStepRef | null>;
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  initialConfig: ColumnMappingConfig | null;
  onSuccess: (finalConfig: ColumnMappingConfig) => void;
  onBack: () => void;
}

export interface BuildResultsStepParams {
  dbConfig: DbConfig | null;
  fileDataset: ParsedShapefileData | ParsedFileDataset | null;
  mappingConfig: ColumnMappingConfig | null;
  sourceDbConfig?: DbConfig;
  descriptor: ComparisonSourceDescriptor;
  cardSubtitleWhenReady: string;
  onBack: () => void;
}

export function buildSuidMappingStep(params: BuildSuidMappingStepParams): WizardStepDef {
  return {
    id: 3,
    title: "Mapeo SUID",
    subtitle: "Identificador y Atributos",
    cardTitle: "Configuración de SUID y Campos a Comparar",
    cardSubtitle: params.cardSubtitle,
    icon: GitMerge,
    content: params.isSourceReady ? (
      <SuidMappingStep
        ref={params.ref}
        dbColumns={params.dbColumns}
        columnDetails={params.columnDetails}
        fileAttributes={params.fileAttributes}
        onSuccess={params.onSuccess}
        initialConfig={params.initialConfig}
        showGeometryToggle={params.showGeometryToggle}
        onReadyChange={params.onReadyChange}
      />
    ) : null,
    canProceed: params.isMappingReady,
    nextLabel: "Continuar a Parámetros de Sincronización",
    onNext: () => params.ref.current?.proceed(),
    onBack: params.onBack,
  };
}

export function buildSyncParametersStep(params: BuildSyncParametersStepParams): WizardStepDef {
  return {
    id: 4,
    title: "Parámetros",
    subtitle: "Tolerancia y Parches SQL",
    cardTitle: "Parámetros Avanzados de Sincronización",
    cardSubtitle:
      "Configure la tolerancia a fallas de codificación, optimización de sentencias UPDATE y valores por defecto para INSERT.",
    icon: Sliders,
    content: (
      <SyncParametersStep
        ref={params.ref}
        dbColumns={params.dbColumns}
        columnDetails={params.columnDetails}
        initialConfig={params.initialConfig}
        onSuccess={params.onSuccess}
      />
    ),
    canProceed: true,
    nextLabel: "Iniciar Análisis y Comparación",
    onNext: () => params.ref.current?.proceed(),
    onBack: params.onBack,
    backLabel: "Volver al Paso 3: Mapeo SUID",
  };
}

export function buildResultsStep(params: BuildResultsStepParams): WizardStepDef {
  const hasDatasets = Boolean(params.dbConfig && params.fileDataset);

  return {
    id: 5,
    title: "Resultados",
    subtitle: "Discrepancias y Script",
    cardTitle: "Resultados de Análisis y Discrepancias",
    cardSubtitle: hasDatasets
      ? params.cardSubtitleWhenReady
      : "Visualice las diferencias detectadas y genere scripts SQL de sincronización.",
    icon: Database,
    content:
      hasDatasets && params.dbConfig && params.fileDataset && params.mappingConfig ? (
        <ComparisonResultsView
          dbConfig={params.dbConfig}
          fileDataset={params.fileDataset}
          mappingConfig={params.mappingConfig}
          sourceDbConfig={params.sourceDbConfig}
          descriptor={params.descriptor}
        />
      ) : null,
    onBack: params.onBack,
    backLabel: "Volver al Paso 4: Parámetros de Sincronización",
  };
}
