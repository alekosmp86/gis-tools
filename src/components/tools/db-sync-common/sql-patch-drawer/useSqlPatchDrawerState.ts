import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SqlScriptType } from "@/types/comparison";
import type { ExecuteBatchResult } from "@/types/db";
import { AlertType } from "@/types/ui";

const MAX_PREVIEW_LINES = 25;

export interface ScriptPreviewStats {
  readonly previewScript: string;
  readonly isTruncated: boolean;
  readonly statementCount: number;
}

export interface UseSqlPatchDrawerStateParams {
  sqlUpdateScript?: string;
  sqlInsertScript?: string;
  sqlUpdatePreview?: string;
  sqlInsertPreview?: string;
  sqlUpdateCount?: number;
  sqlInsertCount?: number;
  tableName: string;
  onGenerateFullScript?: () => Promise<{ sqlUpdateScript: string; sqlInsertScript: string }>;
}

function computeFallbackStats(
  script?: string,
  maxLines: number = MAX_PREVIEW_LINES
): ScriptPreviewStats {
  if (!script) {
    return { previewScript: "", isTruncated: false, statementCount: 0 };
  }

  let currentPos = 0;
  let cutoffPos = -1;
  let statementCount = 0;

  while (currentPos < script.length) {
    const nextNewline = script.indexOf("\n", currentPos);
    const lineEnd = nextNewline === -1 ? script.length : nextNewline;
    const line = script.slice(currentPos, lineEnd).trim();

    if (line.length > 0 && !line.startsWith("--")) {
      statementCount++;
      if (statementCount <= maxLines) {
        cutoffPos = lineEnd;
      }
    }

    if (nextNewline === -1) break;
    currentPos = nextNewline + 1;
  }

  const isTruncated = statementCount > maxLines;
  const previewScript = cutoffPos !== -1 ? script.slice(0, cutoffPos) : script;

  return { previewScript, isTruncated, statementCount };
}

export function useSqlPatchDrawerState({
  sqlUpdateScript,
  sqlInsertScript,
  sqlUpdatePreview,
  sqlInsertPreview,
  sqlUpdateCount,
  sqlInsertCount,
  tableName,
  onGenerateFullScript,
}: UseSqlPatchDrawerStateParams) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SqlScriptType>(SqlScriptType.UPDATE);
  const [copied, setCopied] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lazyScripts, setLazyScripts] = useState<{
    sqlUpdateScript?: string;
    sqlInsertScript?: string;
  }>({});
  const [executedTabs, setExecutedTabs] = useState<Record<SqlScriptType, boolean>>({
    [SqlScriptType.UPDATE]: false,
    [SqlScriptType.INSERT]: false,
  });
  const [executionResult, setExecutionResult] = useState<{
    type: AlertType;
    text: string;
  } | null>(null);

  const isUpdateTab = activeTab === SqlScriptType.UPDATE;
  const resolvedUpdateScript = lazyScripts.sqlUpdateScript ?? sqlUpdateScript ?? "";
  const resolvedInsertScript = lazyScripts.sqlInsertScript ?? sqlInsertScript ?? "";
  const activeScript = isUpdateTab ? resolvedUpdateScript : resolvedInsertScript;

  // Resolve precomputed values for UPDATE tab
  const updateStats: ScriptPreviewStats =
    sqlUpdatePreview !== undefined && sqlUpdateCount !== undefined
      ? {
          previewScript: sqlUpdatePreview,
          statementCount: sqlUpdateCount,
          isTruncated: sqlUpdateCount > MAX_PREVIEW_LINES,
        }
      : computeFallbackStats(resolvedUpdateScript, MAX_PREVIEW_LINES);

  // Resolve precomputed values for INSERT tab
  const insertStats: ScriptPreviewStats =
    sqlInsertPreview !== undefined && sqlInsertCount !== undefined
      ? {
          previewScript: sqlInsertPreview,
          statementCount: sqlInsertCount,
          isTruncated: sqlInsertCount > MAX_PREVIEW_LINES,
        }
      : computeFallbackStats(resolvedInsertScript, MAX_PREVIEW_LINES);

  const currentStats = isUpdateTab ? updateStats : insertStats;
  const hasExecutableStatements = currentStats.statementCount > 0;
  const isCurrentTabExecuted = executedTabs[activeTab];

  const handleTabChange = (newTab: SqlScriptType) => {
    setActiveTab(newTab);
    setCopied(false);
    setExecutionResult(null);
  };

  const ensureScriptAvailable = async (): Promise<string | null> => {
    if (activeScript && activeScript.trim() !== "") {
      return activeScript;
    }

    if (!onGenerateFullScript) {
      return activeScript;
    }

    setIsGenerating(true);

    try {
      const generated = await onGenerateFullScript();
      setLazyScripts(generated);
      setIsGenerating(false);
      return isUpdateTab ? generated.sqlUpdateScript : generated.sqlInsertScript;
    } catch {
      setIsGenerating(false);
      setExecutionResult({
        type: AlertType.ERROR,
        text: "Error al generar el script SQL completo en segundo plano.",
      });
      return null;
    }
  };

  const handleCopy = async () => {
    const script = await ensureScriptAvailable();
    if (!script) return;

    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = async () => {
    const script = await ensureScriptAvailable();
    if (!script) return;

    const suffix = activeTab === SqlScriptType.UPDATE ? "update" : "insert";
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${suffix}_${tableName}_${new Date().toISOString().slice(0, 10)}.sql`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleOpenExecuteModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseExecuteModal = () => {
    setIsModalOpen(false);
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

  return {
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
  };
}
