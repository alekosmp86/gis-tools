import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SqlScriptType } from "@/core/types/comparison";
import type { ExecuteBatchResult } from "@/core/types/db";
import { AlertType } from "@/ui-kit/types/ui";
import { formatNumber } from "@/core/common/ValueFormatter";

const MAX_PREVIEW_LINES = 25;

const NONE_EXECUTED: Record<SqlScriptType, boolean> = {
  [SqlScriptType.UPDATE]: false,
  [SqlScriptType.INSERT]: false,
};

interface ScriptPreviewStats {
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
  selectedCount: number;
  selectionVersion: number;
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
  selectedCount,
  selectionVersion,
  onGenerateFullScript,
}: UseSqlPatchDrawerStateParams) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SqlScriptType>(SqlScriptType.UPDATE);
  const [copied, setCopied] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lazyCache, setLazyCache] = useState<{
    version: number;
    sqlUpdateScript?: string;
    sqlInsertScript?: string;
  } | null>(null);
  const latestVersionRef = useRef(selectionVersion);
  useEffect(() => {
    latestVersionRef.current = selectionVersion;
  }, [selectionVersion]);
  const lazyScripts = lazyCache?.version === selectionVersion ? lazyCache : null;
  const [executedCache, setExecutedCache] = useState<{
    version: number;
    tabs: Record<SqlScriptType, boolean>;
  }>({ version: selectionVersion, tabs: NONE_EXECUTED });
  const executedTabs = executedCache.version === selectionVersion ? executedCache.tabs : NONE_EXECUTED;
  const [executionResult, setExecutionResult] = useState<{
    type: AlertType;
    text: string;
  } | null>(null);

  const isUpdateTab = activeTab === SqlScriptType.UPDATE;
  const resolvedUpdateScript = lazyScripts?.sqlUpdateScript ?? sqlUpdateScript ?? "";
  const resolvedInsertScript = lazyScripts?.sqlInsertScript ?? sqlInsertScript ?? "";
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
    if (selectedCount === 0) return null;

    if (activeScript && activeScript.trim() !== "") {
      return activeScript;
    }

    if (!onGenerateFullScript) {
      return activeScript;
    }

    const requestedVersion = selectionVersion;
    setIsGenerating(true);

    try {
      const generated = await onGenerateFullScript();
      setIsGenerating(false);
      if (latestVersionRef.current !== requestedVersion) {
        setExecutionResult({
          type: AlertType.INFO,
          text: "La selección cambió durante la generación del script. Vuelva a intentarlo.",
        });
        return null;
      }
      setLazyCache({ version: requestedVersion, ...generated });
      const script = isUpdateTab ? generated.sqlUpdateScript : generated.sqlInsertScript;
      warnOnStatementMismatch(script);
      return script;
    } catch {
      setIsGenerating(false);
      setExecutionResult({
        type: AlertType.ERROR,
        text: "Error al generar el script SQL completo en segundo plano.",
      });
      return null;
    }
  };

  const warnOnStatementMismatch = (script: string) => {
    const generatedCount = computeFallbackStats(script, 0).statementCount;
    if (generatedCount === currentStats.statementCount) return;
    setExecutionResult({
      type: AlertType.WARNING,
      text: `El script generado contiene ${formatNumber(generatedCount)} sentencias, pero se esperaban ${formatNumber(currentStats.statementCount)} según la selección. Revise el script antes de ejecutarlo.`,
    });
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
    setExecutedCache({
      version: selectionVersion,
      tabs: { ...executedTabs, [activeTab]: true },
    });

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
