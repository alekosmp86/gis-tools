import { useState } from "react";
import { executeSqlInChunks } from "@/services/dbExecutionService";
import type { DbConfig, ExecuteChunkProgress, ExecuteBatchResult } from "@/types/db";

interface UseSqlBatchExecutionParams {
  dbConfig: DbConfig;
  activeScript: string;
  onExecutionCompleted?: (result: ExecuteBatchResult) => void;
  onClose: () => void;
}

export function useSqlBatchExecution({
  dbConfig,
  activeScript,
  onExecutionCompleted,
  onClose,
}: UseSqlBatchExecutionParams) {
  const [passwordInput, setPasswordInput] = useState<string>(dbConfig.password || "");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [progress, setProgress] = useState<ExecuteChunkProgress | null>(null);
  const [result, setResult] = useState<ExecuteBatchResult | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const handleStartExecution = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordInput.trim() || isExecuting) return;

    setIsExecuting(true);
    setGeneralError(null);
    setProgress(null);
    setResult(null);

    try {
      const batchResult = await executeSqlInChunks(
        dbConfig,
        passwordInput,
        activeScript,
        (chunkProgress) => setProgress(chunkProgress),
        500
      );
      setResult(batchResult);
      setIsCompleted(true);
      setIsExecuting(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al ejecutar las sentencias SQL.";
      setGeneralError(msg);
      setIsExecuting(false);
    }
  };

  const handleFinish = () => {
    if (result && onExecutionCompleted) {
      onExecutionCompleted(result);
    }
    handleClose();
  };

  const handleClose = () => {
    if (isExecuting) return;
    setIsExecuting(false);
    setIsCompleted(false);
    setProgress(null);
    setResult(null);
    setGeneralError(null);
    onClose();
  };

  const toggleShowPassword = () => setShowPassword((prev) => !prev);

  return {
    passwordInput,
    setPasswordInput,
    showPassword,
    toggleShowPassword,
    isExecuting,
    isCompleted,
    progress,
    result,
    generalError,
    handleStartExecution,
    handleFinish,
    handleClose,
  };
}
