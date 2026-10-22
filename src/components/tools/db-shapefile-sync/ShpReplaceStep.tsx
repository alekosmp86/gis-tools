import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { DbConfig } from "@/core/types/db";
import { ShpReplaceWarning } from "./ShpReplaceWarning";
import { ShpReplaceFormFields } from "./ShpReplaceFormFields";
import { useShpReplaceWorkflow } from "./useShpReplaceWorkflow";
import styles from "./ShpReplaceStep.module.css";

export interface ShpReplaceStepProps {
  targetConfig: DbConfig | null;
  targetRowCount: number;
  file: File | null;
  recordCount: number;
  detectedSrid: number | null;
  prjText: string | undefined;
  mapping: ReplaceColumnMapping;
}

export const ShpReplaceStep: React.FC<ShpReplaceStepProps> = ({
  targetConfig,
  targetRowCount,
  file,
  recordCount,
  detectedSrid,
  prjText,
  mapping,
}) => {
  const workflow = useShpReplaceWorkflow({ target: targetConfig, file, mapping, detectedSrid });

  if (!targetConfig || !file) return null;

  return (
    <div className={styles.container}>
      <ShpReplaceWarning target={targetConfig} targetRowCount={targetRowCount} recordCount={recordCount} />
      <ShpReplaceFormFields workflow={workflow} prjText={prjText} targetUser={targetConfig.user} />
      <div className={styles.actions}>
        <Button type="button" className={styles.runButton} disabled={!workflow.canRun} onClick={workflow.run}>
          <Trash2 size={16} />
          <span>Vaciar destino y reemplazar con el Shapefile</span>
        </Button>
      </div>
    </div>
  );
};
