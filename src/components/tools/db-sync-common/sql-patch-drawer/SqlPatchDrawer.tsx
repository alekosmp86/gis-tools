import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { SqlPatchHeader } from "./SqlPatchHeader";
import { SqlPatchCopyButton } from "./SqlPatchCopyButton";
import { SqlPatchDownloadButton } from "./SqlPatchDownloadButton";
import { SqlPatchExecuteButton, SqlPatchExecutedButton } from "./SqlPatchExecuteButton";
import { SqlPatchTabs } from "./SqlPatchTabs";
import { SqlPatchPreviewBox } from "./SqlPatchPreviewBox";
import { SqlExecutionModal } from "../SqlExecutionModal";
import { useSqlPatchDrawerState } from "./useSqlPatchDrawerState";
import { AlertType } from "@/ui-kit/types/ui";
import type { DbConfig } from "@/core/types/db";
import styles from "./SqlPatchDrawer.module.css";

const EMPTY_SELECTION_MESSAGE =
  "No hay registros seleccionados. Seleccione registros en la tabla de discrepancias para generar el script.";

export interface SqlPatchDrawerProps {
  sqlUpdateScript?: string;
  sqlInsertScript?: string;
  sqlUpdatePreview?: string;
  sqlInsertPreview?: string;
  sqlUpdateCount?: number;
  sqlInsertCount?: number;
  tableName: string;
  dbConfig: DbConfig;
  selectedCount: number;
  selectionVersion: number;
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
  selectedCount,
  selectionVersion,
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
    ensureScriptAvailable,
  } = useSqlPatchDrawerState({
    sqlUpdateScript,
    sqlInsertScript,
    sqlUpdatePreview,
    sqlInsertPreview,
    sqlUpdateCount,
    sqlInsertCount,
    tableName,
    selectedCount,
    selectionVersion,
    onGenerateFullScript,
  });
  const hasSelection = selectedCount > 0;

  return (
    <div className={styles.container}>
      {/* Drawer Header & Actions */}
      <SqlPatchHeader>
        <SqlPatchCopyButton
          copied={copied}
          disabled={!hasSelection}
          isLoading={isGenerating}
          onClick={handleCopy}
        />
        <SqlPatchDownloadButton
          disabled={!hasSelection}
          isLoading={isGenerating}
          onClick={handleDownload}
        />
        {isCurrentTabExecuted ? (
          <SqlPatchExecutedButton />
        ) : (
          <SqlPatchExecuteButton
            disabled={!hasExecutableStatements}
            isLoading={false}
            onClick={handleOpenExecuteModal}
          />
        )}
      </SqlPatchHeader>

      {!hasSelection && (
        <div className={styles.alertWrapper}>
          <AlertMessage type={AlertType.INFO} text={EMPTY_SELECTION_MESSAGE} />
        </div>
      )}

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
        onEnsureScript={ensureScriptAvailable}
        onExecutionCompleted={handleExecutionCompleted}
      />
    </div>
  );
};
