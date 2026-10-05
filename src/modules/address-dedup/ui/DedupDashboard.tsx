"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { INITIAL_DB_CONFIG } from "@/core/constants/dbConfigDefaults";
import type { DbConfig } from "@/core/types/db";
import { DEFAULT_PROVINCE_ID, DedupScope, type ExportFormat } from "../constants";
import type { DedupRequestPayload } from "../types";
import { DedupConfigCard } from "./DedupConfigCard";
import { DedupContextBar } from "./DedupContextBar";
import { DedupLoadingCard } from "./DedupLoadingCard";
import { DedupResultsView } from "./DedupResultsView";
import { downloadExport } from "./dedupClient";
import { useDedupAnalysis } from "./useDedupAnalysis";

/** The page this module owns, served at /tools/m/address-dedup. Analysis is read-only; removal is a separate confirmed flow. */

const INVALID_PROVINCE_MESSAGE = "El identificador de provincia debe ser un entero positivo.";
const MISSING_ANALYSIS_MESSAGE = "Ejecute primero el análisis.";

function parseProvinceId(text: string): number | null {
  const provinceId = Number(text);
  return Number.isInteger(provinceId) && provinceId > 0 ? provinceId : null;
}

function buildPayload(
  config: DbConfig,
  provinceId: number,
  protectedSiblingRemovesLone: boolean,
  includeGroupsWithoutRemovals: boolean
): DedupRequestPayload {
  return {
    connection: {
      host: config.host,
      port: config.port,
      db_name: config.db_name,
      user: config.user,
      password: config.password ?? "",
    },
    provinceId,
    protectedSiblingRemovesLone,
    scope: includeGroupsWithoutRemovals ? DedupScope.ALL_DUPLICATE_GROUPS : DedupScope.REMOVAL_GROUPS,
  };
}

export const DedupDashboard: React.FC = () => {
  const [config, setConfig] = useState<DbConfig>(INITIAL_DB_CONFIG);
  const [provinceIdText, setProvinceIdText] = useState(String(DEFAULT_PROVINCE_ID));
  const [protectedSiblingRemovesLone, setProtectedSiblingRemovesLone] = useState(false);
  const [includeGroupsWithoutRemovals, setIncludeGroupsWithoutRemovals] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<DedupRequestPayload | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const analysis = useDedupAnalysis();
  const exportMutation = useMutation({
    mutationFn: (format: ExportFormat) => {
      if (!lastPayload) throw new Error(MISSING_ANALYSIS_MESSAGE);
      return downloadExport(lastPayload, format);
    },
  });

  const runAnalysis = (payload: DedupRequestPayload) => {
    setLastPayload(payload);
    setIsEditing(false);
    exportMutation.reset();
    void analysis.run(payload);
  };

  const handleSubmit = () => {
    const provinceId = parseProvinceId(provinceIdText);
    if (provinceId === null) {
      setValidationError(INVALID_PROVINCE_MESSAGE);
      return;
    }

    setValidationError(null);
    runAnalysis(
      buildPayload(config, provinceId, protectedSiblingRemovesLone, includeGroupsWithoutRemovals)
    );
  };

  const configErrorText = validationError ?? analysis.error?.message ?? null;
  const exportErrorText =
    exportMutation.error instanceof Error ? exportMutation.error.message : null;
  const resultPayload = analysis.data ? lastPayload : null;
  const hasResult = resultPayload !== null;
  const isConfigVisible = !hasResult || isEditing;

  return (
    <ToolWorkspaceLayout
      title="Duplicados de Direcciones"
      description="Detecte direcciones duplicadas entre ANTEL, TLK e IDE directamente en PostgreSQL, revise la decisión de conservar o eliminar de cada fila y exporte el resultado para QGIS. La base de datos solo se modifica al confirmar y eliminar, en un paso aparte, y nunca sobre las filas para revisar."
    >
      {resultPayload && (
        <DedupContextBar
          payload={resultPayload}
          isBusy={analysis.isPending}
          exportingFormat={exportMutation.isPending ? (exportMutation.variables ?? null) : null}
          onEdit={() => setIsEditing(true)}
          onRerun={() => runAnalysis(resultPayload)}
          onExport={(format) => exportMutation.mutate(format)}
        />
      )}

      {isConfigVisible && (
        <DedupConfigCard
          config={config}
          provinceId={provinceIdText}
          protectedSiblingRemovesLone={protectedSiblingRemovesLone}
          includeGroupsWithoutRemovals={includeGroupsWithoutRemovals}
          isSubmitting={analysis.isPending}
          errorText={configErrorText}
          onConfigChange={(field, value) =>
            setConfig((previous) => ({ ...previous, [field]: value }))
          }
          onProfileLoaded={(profileConfig) =>
            setConfig((previous) => ({ ...previous, ...profileConfig }))
          }
          onProvinceChange={setProvinceIdText}
          onProtectedSiblingChange={setProtectedSiblingRemovesLone}
          onIncludeGroupsChange={setIncludeGroupsWithoutRemovals}
          onSubmit={handleSubmit}
          onCancel={hasResult ? () => setIsEditing(false) : undefined}
        />
      )}

      {exportErrorText && <AlertMessage type={AlertType.ERROR} text={exportErrorText} />}

      {analysis.isPending && <DedupLoadingCard />}

      {!analysis.isPending && analysis.data && resultPayload && (
        <DedupResultsView
          key={analysis.resultId}
          result={analysis.data}
          payload={resultPayload}
          onRemovalComplete={() => runAnalysis(resultPayload)}
        />
      )}
    </ToolWorkspaceLayout>
  );
};
