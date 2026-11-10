import React from "react";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { ShpReplaceRunParams } from "@/core/services/replaceRunTypes";
import type { DbConfig } from "@/core/types/db";
import { isProcessingActive } from "@/core/services/geometryProcessingOptions";
import type { GeometryProcessingController } from "@/components/tools/db-sync-common/geometry-processing/useGeometryProcessingOptions";
import { ShpReplaceWarning } from "./ShpReplaceWarning";
import { ShpReplaceFormFields } from "./ShpReplaceFormFields";
import { useShpReplaceWorkflow, type ShpReplaceWorkflow } from "./useShpReplaceWorkflow";
import styles from "./ShpReplaceStep.module.css";

export interface ShpReplaceStepProps {
  targetConfig: DbConfig | null;
  targetRowCount: number;
  file: File | null;
  recordCount: number;
  detectedSrid: number | null;
  sridHint: string;
  showSrid?: boolean;
  sourceLabel?: string;
  runLabel?: string;
  mapping: ReplaceColumnMapping;
  geometry?: GeometryProcessingController;
  uploadId: string | null;
  startRun: (params: ShpReplaceRunParams) => Promise<void>;
}

const DEFAULT_RUN_LABEL = "Vaciar destino y reemplazar con el Shapefile";

const GeometryNotices: React.FC<{ geometry: GeometryProcessingController }> = ({ geometry }) => (
  <>
    {!geometry.isValid && (
      <AlertMessage
        type={AlertType.WARNING}
        text="Unificar por clave requiere al menos un campo clave. Corríjalo en el paso Procesamiento de Geometrías."
      />
    )}
    {geometry.changedSinceAnalysis && (
      <AlertMessage
        type={AlertType.WARNING}
        text="Las opciones cambiaron desde el último análisis; se recomienda volver a analizar antes de reemplazar."
      />
    )}
  </>
);

const AnalyzeAction: React.FC<{ geometry: GeometryProcessingController; workflow: ShpReplaceWorkflow }> = ({
  geometry,
  workflow,
}) => (
  <>
    {!isProcessingActive(geometry.options) && (
      <span className={styles.analysisHint}>Para analizar sin reemplazar, active al menos un proceso de geometrías.</span>
    )}
    <Button type="button" variant={ButtonVariant.SECONDARY} disabled={!workflow.canAnalyze} onClick={workflow.analyze}>
      <Search size={16} />
      <span>Analizar sin reemplazar</span>
    </Button>
  </>
);

export const ShpReplaceStep: React.FC<ShpReplaceStepProps> = ({
  targetConfig,
  targetRowCount,
  file,
  recordCount,
  detectedSrid,
  sridHint,
  showSrid = true,
  sourceLabel,
  runLabel = DEFAULT_RUN_LABEL,
  mapping,
  geometry,
  uploadId,
  startRun,
}) => {
  const workflow = useShpReplaceWorkflow({
    target: targetConfig,
    file,
    mapping,
    detectedSrid,
    geometry,
    uploadId,
    startRun,
  });

  if (!targetConfig || !file) return null;

  return (
    <div className={styles.container}>
      <ShpReplaceWarning
        target={targetConfig}
        targetRowCount={targetRowCount}
        recordCount={recordCount}
        sourceLabel={sourceLabel}
      />
      {geometry && <GeometryNotices geometry={geometry} />}
      <ShpReplaceFormFields workflow={workflow} sridHint={sridHint} showSrid={showSrid} targetUser={targetConfig.user} />
      <div className={styles.actions}>
        {geometry && <AnalyzeAction geometry={geometry} workflow={workflow} />}
        <Button type="button" className={styles.runButton} disabled={!workflow.canRun} onClick={workflow.run}>
          <Trash2 size={16} />
          <span>{runLabel}</span>
        </Button>
      </div>
    </div>
  );
};
