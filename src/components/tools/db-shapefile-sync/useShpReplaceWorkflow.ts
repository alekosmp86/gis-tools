import { useState } from "react";
import { start } from "@/core/services/shpReplaceRunStore";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { DbConfig } from "@/core/types/db";

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
}

export function useShpReplaceWorkflow({ target, file, mapping, detectedSrid }: UseShpReplaceWorkflowParams) {
  const [confirmValue, setConfirmValue] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sridText, setSridText] = useState(() => (detectedSrid !== null ? String(detectedSrid) : ""));
  const [resetSequences, setResetSequences] = useState(true);

  const confirmText = target ? buildQualifiedTableLabel(target.schema_name, target.table_name) : "";
  const sourceSrid = parseSourceSrid(sridText);
  const canRun =
    Boolean(target && file) &&
    sourceSrid !== null &&
    confirmValue === confirmText &&
    password.trim() !== "";

  const run = () => {
    if (!target || !file || sourceSrid === null || !canRun) return;
    const runPassword = password;
    setPassword("");
    void start({
      file,
      fileName: file.name,
      connection: { ...target, password: runPassword },
      mapping,
      sourceSrid,
      resetSequences,
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
    canRun,
    run,
  };
}

export type ShpReplaceWorkflow = ReturnType<typeof useShpReplaceWorkflow>;
