import { useState } from "react";
import { start } from "@/core/services/shpReplaceRunStore";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { DbConfig } from "@/core/types/db";
import type { GeometryProcessingController } from "@/components/tools/db-sync-common/geometry-processing/useGeometryProcessingOptions";
import { isProcessingActive } from "@/core/services/geometryProcessingOptions";
import { computeReplaceGates } from "./shpReplaceGates";

const SRID_DIGITS_PATTERN = /^\d+$/;
const SHP_MIN_SRID = 1;
const SHP_MAX_SRID = 998999;

export const parseSourceSrid = (value: string): number | null => {
  const trimmed = value.trim();
  if (!SRID_DIGITS_PATTERN.test(trimmed)) return null;
  const srid = Number(trimmed);
  return srid >= SHP_MIN_SRID && srid <= SHP_MAX_SRID ? srid : null;
};

export interface UseShpReplaceWorkflowParams {
  target: DbConfig | null;
  file: File | null;
  mapping: ReplaceColumnMapping;
  detectedSrid: number | null;
  geometry: GeometryProcessingController;
  uploadId: string | null;
}

export function useShpReplaceWorkflow({ target, file, mapping, detectedSrid, geometry, uploadId }: UseShpReplaceWorkflowParams) {
  const [confirmValue, setConfirmValue] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sridText, setSridText] = useState(() => (detectedSrid !== null ? String(detectedSrid) : ""));
  const [resetSequences, setResetSequences] = useState(true);

  const confirmText = target ? buildQualifiedTableLabel(target.schema_name, target.table_name) : "";
  const sourceSrid = parseSourceSrid(sridText);
  const { canAnalyze, canRun } = computeReplaceGates({
    hasTarget: Boolean(target),
    hasFile: Boolean(file),
    sridValid: sourceSrid !== null,
    passwordFilled: password.trim() !== "",
    processingValid: geometry.isValid,
    processingActive: isProcessingActive(geometry.options),
    confirmMatches: confirmValue === confirmText,
  });

  const launch = (dryRun: boolean) => {
    if (!target || !file || sourceSrid === null) return;
    const runPassword = password;
    setPassword("");
    geometry.prepareRun(geometry.options, dryRun);
    void start({
      file,
      fileName: file.name,
      connection: { ...target, password: runPassword },
      mapping,
      sourceSrid,
      resetSequences,
      processing: geometry.options,
      dryRun,
      uploadId: uploadId ?? undefined,
    });
  };

  return {
    confirmText,
    confirmValue,
    setConfirmValue,
    password,
    setPassword,
    showPassword,
    toggleShowPassword: () => setShowPassword((previous) => !previous),
    sridText,
    setSridText,
    sourceSrid,
    resetSequences,
    setResetSequences,
    canAnalyze,
    canRun,
    analyze: () => {
      if (canAnalyze) launch(true);
    },
    run: () => {
      if (canRun) launch(false);
    },
  };
}

export type ShpReplaceWorkflow = ReturnType<typeof useShpReplaceWorkflow>;
