import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { SqlPatchHeader } from "./SqlPatchHeader";
import { SqlPatchTabs } from "./SqlPatchTabs";
import { SqlPatchPreviewBox } from "./SqlPatchPreviewBox";
import { SqlExecutionModal } from "./SqlExecutionModal";
import { SqlScriptType } from "@/types/comparison";
import type { DbConfig, ExecuteBatchResult } from "@/types/db";
import { AlertType } from "@/types/ui";
import { formatNumber } from "@/utils/common/ValueFormatter";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchDrawerProps {
  sqlUpdateScript: string;
  sqlInsertScript: string;
  sqlUpdatePreview?: string;
  sqlInsertPreview?: string;
  sqlUpdateCount?: number;
  sqlInsertCount?: number;
  tableName: string;
  dbConfig: DbConfig;
  onExecutingChange?: (executing: boolean) => void;
}

interface ScriptPreviewStats {
  readonly previewScript: string;
  readonly isTruncated: boolean;
  readonly statementCount: number;
}

const MAX_PREVIEW_LINES = 500;

function computeFallbackStats(script: string, maxLines: number = MAX_PREVIEW_LINES): ScriptPreviewStats {
  if (!script) {
    return { previewScript: "", isTruncated: false, statementCount: 0 };
  }

  let currentPos = 0;
  let lineCount = 0;
  let cutoffPos = -1;
  let statementCount = 0;

  while (currentPos < script.length) {
    const nextNewline = script.indexOf("\n", currentPos);
    if (nextNewline === -1) {
      if (script.slice(currentPos).includes(";")) {
        statementCount++;
      }
      lineCount++;
      break;
    }

    if (script.slice(currentPos, nextNewline).includes(";")) {
      statementCount++;
    }

    lineCount++;
    if (lineCount === maxLines && cutoffPos === -1) {
      cutoffPos = nextNewline;
    }

    currentPos = nextNewline + 1;
  }

  const isTruncated = cutoffPos !== -1 && cutoffPos < script.length;
  const rawPreview = isTruncated ? script.slice(0, cutoffPos) : script;

  const previewScript = !isTruncated
    ? rawPreview
    : rawPreview +
      `\n\n-- ==========================================================================================\n` +
      `-- ⚡ VISTA PREVIA TRUNCADA EN NAVEGADOR POR RENDIMIENTO\n` +
      `-- Se están mostrando las primeras ${formatNumber(maxLines)} sentencias de ${formatNumber(statementCount)} sentencias totales.\n` +
      `-- El script completo está disponible intacto para Copiar, Descargar (.sql) o Ejecutar en BD.\n` +
      `-- ==========================================================================================`;

  return { previewScript, isTruncated, statementCount };
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
}) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SqlScriptType>(SqlScriptType.UPDATE);
  const [copied, setCopied] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [executedTabs, setExecutedTabs] = useState<Record<SqlScriptType, boolean>>({
    [SqlScriptType.UPDATE]: false,
    [SqlScriptType.INSERT]: false,
  });
  const [executionResult, setExecutionResult] = useState<{
    type: AlertType;
    text: string;
  } | null>(null);

  const isUpdateTab = activeTab === SqlScriptType.UPDATE;
  const activeScript = isUpdateTab ? sqlUpdateScript : sqlInsertScript;

  // Resolve precomputed values from Web Worker or fallback to fast single-pass scanner
  let previewScript: string;
  let isTruncated: boolean;
  let statementCount: number;

  const precomputedPreview = isUpdateTab ? sqlUpdatePreview : sqlInsertPreview;
  const precomputedCount = isUpdateTab ? sqlUpdateCount : sqlInsertCount;

  if (precomputedPreview !== undefined && precomputedCount !== undefined) {
    previewScript = precomputedPreview;
    statementCount = precomputedCount;
    isTruncated = statementCount > MAX_PREVIEW_LINES;
  } else {
    const fallbackStats = computeFallbackStats(activeScript);
    previewScript = fallbackStats.previewScript;
    statementCount = fallbackStats.statementCount;
    isTruncated = fallbackStats.isTruncated;
  }

  const hasExecutableStatements = statementCount > 0 || Boolean(activeScript && activeScript.trim().length > 0);
  const isCurrentTabExecuted = executedTabs[activeTab];

  const handleTabChange = (newTab: SqlScriptType) => {
    setActiveTab(newTab);
    setCopied(false);
    setExecutionResult(null);
  };

  const handleCopy = () => {
    navigator.clipboard
      .writeText(activeScript)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  const handleDownload = () => {
    const suffix = activeTab === SqlScriptType.UPDATE ? "update" : "insert";
    const blob = new Blob([activeScript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${suffix}_${tableName}_${new Date().toISOString().slice(0, 10)}.sql`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExecutionCompleted = (res: ExecuteBatchResult) => {
    setExecutedTabs((prev) => ({
      ...prev,
      [activeTab]: true,
    }));

    setExecutionResult({
      type: res.success ? AlertType.SUCCESS : AlertType.WARNING,
      text: `${res.message} Sincronizando y re-analizando base de datos en segundo plano...`,
    });

    queryClient.invalidateQueries({ queryKey: ["datasetComparison"] });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className={styles.container}>
      {/* Drawer Header & Actions */}
      <SqlPatchHeader
        copied={copied}
        executing={false}
        hasExecutableStatements={hasExecutableStatements}
        isCurrentTabExecuted={isCurrentTabExecuted}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onOpenExecuteModal={() => setIsModalOpen(true)}
      />

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

      {/* Instant Zero-Lag Code Preview Box */}
      <SqlPatchPreviewBox
        previewScript={previewScript}
        isTruncated={isTruncated}
        statementCount={statementCount}
      />

      {/* Password & Chunked Execution Confirmation Modal */}
      <SqlExecutionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        dbConfig={dbConfig}
        scriptType={activeTab}
        statementCount={statementCount}
        activeScript={activeScript}
        onExecutionCompleted={handleExecutionCompleted}
      />
    </div>
  );
};
