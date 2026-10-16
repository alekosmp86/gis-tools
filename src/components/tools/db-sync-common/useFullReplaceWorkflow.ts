import { useState } from "react";
import { FullReplaceRunStatus, start } from "@/core/services/fullReplaceRunStore";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { DbConfig } from "@/core/types/db";
import { useFullReplaceRun } from "./useFullReplaceRun";

export interface UseFullReplaceWorkflowParams {
  sourceConfig: DbConfig | null;
  targetConfig: DbConfig | null;
  sourceColumns: string[];
  targetColumns: string[];
  mapping: ReplaceColumnMapping;
}

export function useFullReplaceWorkflow({
  sourceConfig,
  targetConfig,
  sourceColumns,
  targetColumns,
  mapping,
}: UseFullReplaceWorkflowParams) {
  const [confirmValue, setConfirmValue] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { status } = useFullReplaceRun();

  const confirmText = targetConfig ? buildQualifiedTableLabel(targetConfig.schema_name, targetConfig.table_name) : "";
  const isRunning = status === FullReplaceRunStatus.RUNNING;
  const canRun =
    Boolean(sourceConfig && targetConfig) &&
    confirmValue === confirmText &&
    password.trim() !== "" &&
    !isRunning;

  const run = () => {
    if (!sourceConfig || !targetConfig || !canRun) return;
    const runPassword = password;
    setPassword("");
    void start({ sourceConfig, targetConfig, password: runPassword, sourceColumns, targetColumns, mapping });
  };

  return {
    confirmText,
    confirmValue,
    setConfirmValue,
    password,
    setPassword,
    showPassword,
    toggleShowPassword: () => setShowPassword((previous) => !previous),
    isRunning,
    canRun,
    run,
  };
}
