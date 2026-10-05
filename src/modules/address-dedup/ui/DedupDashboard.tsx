"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { INITIAL_DB_CONFIG } from "@/core/constants/dbConfigDefaults";
import type { DbConfig } from "@/core/types/db";
import { DedupScope, type ExportFormat } from "../constants";
import {
  MISSING_PROVINCE_MESSAGE,
  findProvinceName,
  parseProvinceId,
  toConnectionPayload,
} from "../domain/provinceSelection";
import type { DedupRequestPayload } from "../types";
import { DedupConfigCard } from "./DedupConfigCard";
import { DedupContextBar } from "./DedupContextBar";
import { DedupLoadingCard } from "./DedupLoadingCard";
import { DedupResultsView } from "./DedupResultsView";
import { downloadExport } from "./dedupClient";
import { useDedupAnalysis } from "./useDedupAnalysis";
import { useDedupProvinces } from "./useDedupProvinces";

/** The page this module owns, served at /tools/m/address-dedup. Analysis is read-only; removal is a separate confirmed flow. */

const MISSING_ANALYSIS_MESSAGE = "Ejecute primero el análisis.";

function buildPayload(
  config: DbConfig,
  provinceId: number,
  protectedSiblingRemovesLone: boolean,
  includeGroupsWithoutRemovals: boolean
): DedupRequestPayload {
  return {
    connection: toConnectionPayload(config),
    provinceId,
    protectedSiblingRemovesLone,
    scope: includeGroupsWithoutRemovals ? DedupScope.ALL_DUPLICATE_GROUPS : DedupScope.REMOVAL_GROUPS,
  };
}

export const DedupDashboard: React.FC = () => {
  const [config, setConfig] = useState<DbConfig>(INITIAL_DB_CONFIG);
  const [provinceIdText, setProvinceIdText] = useState("");
  const [protectedSiblingRemovesLone, setProtectedSiblingRemovesLone] = useState(false);
  const [includeGroupsWithoutRemovals, setIncludeGroupsWithoutRemovals] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<DedupRequestPayload | null>(null);
  const [lastProvinceName, setLastProvinceName] = useState<string | undefined>(undefined);
  const [isEditing, setIsEditing] = useState(false);

  const analysis = useDedupAnalysis();
  const provinces = useDedupProvinces();
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

  const discardProvinceList = () => {
    provinces.reset();
    setProvinceIdText("");
  };

  const handleSubmit = () => {
    const provinceId = parseProvinceId(provinceIdText);
    const provinceName =
      provinceId === null ? undefined : findProvinceName(provinces.provinces, provinceId);
    if (provinceId === null || provinceName === undefined) {
      setValidationError(MISSING_PROVINCE_MESSAGE);
      return;
    }

    setValidationError(null);
    setLastProvinceName(provinceName);
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
          provinceName={lastProvinceName}
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
          provinces={provinces.provinces}
          isLoadingProvinces={provinces.isLoading}
          provincesError={provinces.error?.message ?? null}
          protectedSiblingRemovesLone={protectedSiblingRemovesLone}
          includeGroupsWithoutRemovals={includeGroupsWithoutRemovals}
          isSubmitting={analysis.isPending}
          errorText={configErrorText}
          onConfigChange={(field, value) => {
            discardProvinceList();
            setConfig((previous) => ({ ...previous, [field]: value }));
          }}
          onProfileLoaded={(profileConfig) => {
            discardProvinceList();
            setConfig((previous) => ({ ...previous, ...profileConfig }));
          }}
          onProvinceChange={setProvinceIdText}
          onLoadProvinces={() => {
            setProvinceIdText("");
            void provinces.load(toConnectionPayload(config));
          }}
          onProtectedSiblingChange={setProtectedSiblingRemovesLone}
          onIncludeGroupsChange={setIncludeGroupsWithoutRemovals}
          onSubmit={handleSubmit}
          onCancel={hasResult ? () => setIsEditing(false) : undefined}
        />
      )}

      {exportErrorText && <AlertMessage type={AlertType.ERROR} text={exportErrorText} />}

      <DedupLoadingCard isOpen={analysis.isPending} />

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
