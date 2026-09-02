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
  tableName: string;
  dbConfig: DbConfig;
  onExecutingChange?: (executing: boolean) => void;
}

export const SqlPatchDrawer: React.FC<SqlPatchDrawerProps> = ({
  sqlUpdateScript,
  sqlInsertScript,
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

  const activeScript = activeTab === SqlScriptType.UPDATE ? sqlUpdateScript : sqlInsertScript;

  // Compute preview script truncation safely
  const MAX_PREVIEW_LINES = 500;
  const count = activeScript ? (activeScript.match(/;/g) || []).length : 0;
  const lines = activeScript ? activeScript.split("\n") : [];
  const isTruncated = lines.length > MAX_PREVIEW_LINES;

  const previewScript = !activeScript
    ? ""
    : !isTruncated
    ? activeScript
    : lines.slice(0, MAX_PREVIEW_LINES).join("\n") +
      `\n\n-- ==========================================================================================\n` +
      `-- ⚡ VISTA PREVIA TRUNCADA EN NAVEGADOR POR RENDIMIENTO\n` +
      `-- Se están mostrando las primeras ${formatNumber(MAX_PREVIEW_LINES)} sentencias de ${formatNumber(count)} sentencias totales.\n` +
      `-- El script completo está disponible intacto para Copiar, Descargar (.sql) o Ejecutar en BD.\n` +
      `-- ==========================================================================================`;

  const hasExecutableStatements = Boolean(
    activeScript &&
      (activeTab === SqlScriptType.UPDATE
        ? /UPDATE\s+/i.test(activeScript.slice(0, 10000))
        : /INSERT\s+INTO\s+/i.test(activeScript.slice(0, 10000)))
  );

  const statementCount = count;
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

      {/* Truncated Code Preview Box */}
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
