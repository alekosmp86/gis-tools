import React from "react";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { SqlPatchHeader } from "./SqlPatchHeader";
import { SqlPatchCopyButton } from "./SqlPatchCopyButton";
import { SqlPatchDownloadButton } from "./SqlPatchDownloadButton";
import { SqlPatchExecuteButton, SqlPatchExecutedButton } from "./SqlPatchExecuteButton";
import { SqlPatchTabs } from "./SqlPatchTabs";
import { SqlPatchPreviewBox } from "./SqlPatchPreviewBox";
import { SqlExecutionModal } from "../SqlExecutionModal";
import { useSqlPatchDrawerState } from "./useSqlPatchDrawerState";
import type { DbConfig } from "@/types/db";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchDrawerProps {
  sqlUpdateScript?: string;
  sqlInsertScript?: string;
  sqlUpdatePreview?: string;
  sqlInsertPreview?: string;
  sqlUpdateCount?: number;
  sqlInsertCount?: number;
  tableName: string;
  dbConfig: DbConfig;
  onExecutingChange?: (executing: boolean) => void;
  onGenerateFullScript?: () => Promise<{ sqlUpdateScript: string; sqlInsertScript: string }>;
}

export const SqlPatchDrawer: React.FC<SqlPatchDrawerProps> = ({
  sqlUpdateScript,
  sqlInsertScript,
  sqlUpdatePreview,
  sqlInsertPreview,
  sqlUpdateCount,
  sqlInsertCount,
  tableName,
  dbConfig,
  onGenerateFullScript,
}) => {
  const {
    activeTab,
    isUpdateTab,
    activeScript,
    copied,
    isModalOpen,
    isGenerating,
    executedTabs,
    executionResult,
    updateStats,
    insertStats,
    currentStats,
    hasExecutableStatements,
    isCurrentTabExecuted,
    handleTabChange,
    handleCopy,
    handleDownload,
    handleOpenExecuteModal,
    handleCloseExecuteModal,
    handleExecutionCompleted,
  } = useSqlPatchDrawerState({
    sqlUpdateScript,
    sqlInsertScript,
    sqlUpdatePreview,
    sqlInsertPreview,
    sqlUpdateCount,
    sqlInsertCount,
    tableName,
    onGenerateFullScript,
  });

  return (
    <div className={styles.container}>
      {/* Drawer Header & Actions */}
      <SqlPatchHeader>
        <SqlPatchCopyButton
          copied={copied}
          disabled={false}
          isLoading={isGenerating}
          onClick={handleCopy}
        />
        <SqlPatchDownloadButton
          disabled={false}
          isLoading={isGenerating}
          onClick={handleDownload}
        />
        {isCurrentTabExecuted ? (
          <SqlPatchExecutedButton />
        ) : (
          <SqlPatchExecuteButton
            disabled={!hasExecutableStatements}
            isLoading={isGenerating}
            onClick={handleOpenExecuteModal}
          />
        )}
      </SqlPatchHeader>

      {/* Execution Feedback Alert */}
      {executionResult && (
        <div className={styles.alertWrapper}>
          <AlertMessage type={executionResult.type} text={executionResult.text} />
        </div>
      )}

      {/* Script Type Tabs */}
      <SqlPatchTabs
        activeTab={activeTab}
        executedTabs={executedTabs}
        onTabChange={handleTabChange}
      />

      {/* Instant Zero-Lag Code Preview Boxes toggled via CSS */}
      <div className={isUpdateTab ? undefined : styles.tabHidden}>
        <SqlPatchPreviewBox
          previewScript={updateStats.previewScript}
          isTruncated={updateStats.isTruncated}
          statementCount={updateStats.statementCount}
        />
      </div>
      <div className={!isUpdateTab ? undefined : styles.tabHidden}>
        <SqlPatchPreviewBox
          previewScript={insertStats.previewScript}
          isTruncated={insertStats.isTruncated}
          statementCount={insertStats.statementCount}
        />
      </div>

      {/* Password & Chunked Execution Confirmation Modal */}
      <SqlExecutionModal
        isOpen={isModalOpen}
        onClose={handleCloseExecuteModal}
        dbConfig={dbConfig}
        scriptType={activeTab}
        statementCount={currentStats.statementCount}
        activeScript={activeScript}
        onExecutionCompleted={handleExecutionCompleted}
      />
    </div>
  );
};
