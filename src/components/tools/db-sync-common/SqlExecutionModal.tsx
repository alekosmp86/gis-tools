import React from "react";
import { useSqlBatchExecution } from "@/hooks/useSqlBatchExecution";
import { SqlExecutionHeader } from "./execution/SqlExecutionHeader";
import { SqlExecutionForm } from "./execution/SqlExecutionForm";
import { SqlExecutionProgress } from "./execution/SqlExecutionProgress";
import { SqlExecutionSummary } from "./execution/SqlExecutionSummary";
import type { DbConfig, ExecuteBatchResult } from "@/types/db";
import styles from "./SqlExecutionModal.module.css";

export interface SqlExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  dbConfig: DbConfig;
  scriptType: string;
  statementCount: number;
  activeScript: string;
  onExecutionCompleted?: (result: ExecuteBatchResult) => void;
}

export const SqlExecutionModal: React.FC<SqlExecutionModalProps> = ({
  isOpen,
  onClose,
  dbConfig,
  scriptType,
  statementCount,
  activeScript,
  onExecutionCompleted,
}) => {
  const {
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
  } = useSqlBatchExecution({
    dbConfig,
    activeScript,
    onExecutionCompleted,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <SqlExecutionHeader
          isExecuting={isExecuting}
          isCompleted={isCompleted}
          result={result}
          progress={progress}
          statementCount={statementCount}
          onClose={handleClose}
        />

        {!isExecuting && !isCompleted ? (
          <SqlExecutionForm
            dbConfig={dbConfig}
            scriptType={scriptType}
            statementCount={statementCount}
            passwordInput={passwordInput}
            showPassword={showPassword}
            generalError={generalError}
            onPasswordChange={setPasswordInput}
            onToggleShowPassword={toggleShowPassword}
            onSubmit={handleStartExecution}
            onCancel={handleClose}
          />
        ) : isExecuting ? (
          <SqlExecutionProgress progress={progress} />
        ) : (
          <SqlExecutionSummary result={result} onFinish={handleFinish} />
        )}
      </div>
    </div>
  );
};
