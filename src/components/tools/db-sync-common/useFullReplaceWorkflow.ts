import { useState } from "react";
import { FullReplaceRunStatus, start } from "@/core/services/fullReplaceRunStore";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { resolveInsertColumns, type ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import { discoverTargetSequences } from "@/core/services/replaceSequences";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import { useFullReplaceRun } from "./useFullReplaceRun";

export interface UseFullReplaceWorkflowParams {
  sourceConfig: DbConfig | null;
  targetConfig: DbConfig | null;
  sourceColumns: string[];
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
  mapping: ReplaceColumnMapping;
}

export function useFullReplaceWorkflow({
  sourceConfig,
  targetConfig,
  sourceColumns,
  targetColumns,
  targetDetails,
  mapping,
}: UseFullReplaceWorkflowParams) {
  const [confirmValue, setConfirmValue] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetSequences, setResetSequences] = useState(true);
  const { status } = useFullReplaceRun();
  const sequenceDiscovery = discoverTargetSequences(
    targetDetails,
    resolveInsertColumns(mapping, targetColumns),
    targetConfig?.schema_name
  );

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
    void start({
      sourceConfig,
      targetConfig,
      password: runPassword,
      sourceColumns,
      targetColumns,
      mapping,
      sequences: sequenceDiscovery.sequences,
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
    sequenceDiscovery,
    resetSequences,
    setResetSequences,
    isRunning,
    canRun,
    run,
  };
}
