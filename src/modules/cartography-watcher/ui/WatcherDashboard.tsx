"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Radio } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { isQueryBusy } from "@/core/common/queryBusyState";
import { AddSourceForm } from "./AddSourceForm";
import { WatchedSourceCard } from "./WatchedSourceCard";
import { addSource, fetchSources, fetchSummaries, removeSource } from "./watcherClient";
import { describePendingCount } from "../domain/formatters";
import type { SourceSummary } from "../types";
import styles from "./WatcherDashboard.module.css";

/**
 * The page this module owns, served at /tools/m/cartography-watcher.
 *
 * Sources and their delta summaries are fetched separately: the list is cheap and local, while
 * summarising means one portal round trip per source. Splitting them lets the page render its
 * sources immediately and fill in state as it arrives.
 */

const SOURCES_QUERY_KEY = ["cartography-watcher", "sources"] as const;
const SUMMARIES_QUERY_KEY = ["cartography-watcher", "summaries"] as const;

function indexSummariesBySourceId(
  summaries: ReadonlyArray<SourceSummary> | undefined
): Map<string, SourceSummary> {
  return new Map((summaries ?? []).map((summary) => [summary.sourceId, summary]));
}

function sumPendingResources(summaries: ReadonlyArray<SourceSummary> | undefined): number {
  return (summaries ?? []).reduce((total, summary) => total + summary.pendingCount, 0);
}

export const WatcherDashboard: React.FC = () => {
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: SOURCES_QUERY_KEY,
    queryFn: fetchSources,
  });

  const summariesQuery = useQuery({
    queryKey: SUMMARIES_QUERY_KEY,
    queryFn: fetchSummaries,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: SUMMARIES_QUERY_KEY });
  };

  const addSourceMutation = useMutation({
    mutationFn: addSource,
    onSuccess: invalidateAll,
  });

  const removeSourceMutation = useMutation({
    mutationFn: removeSource,
    onSuccess: invalidateAll,
  });

  const summariesBySourceId = indexSummariesBySourceId(summariesQuery.data);
  const totalPending = sumPendingResources(summariesQuery.data);
  const mutationError = addSourceMutation.error ?? removeSourceMutation.error;
  const isSummariesBusy = isQueryBusy(summariesQuery);

  return (
    <ToolWorkspaceLayout
      title="Observador de Actualizaciones Cartográficas"
      description="Vigile catálogos abiertos de datos espaciales, detecte publicaciones nuevas y descargue los archivos al vault local para compararlos con sus tablas PostGIS."
    >
      <section className={`glass-panel ${styles.heroPanel}`}>
        <div className={styles.heroIcon}>
          <Radio size={24} />
        </div>
        <div className={styles.heroBody}>
          <h2 className={styles.heroTitle}>
            {summariesQuery.isPending
              ? "Consultando catálogos..."
              : describePendingCount(totalPending)}
          </h2>
          <p className={styles.heroDescription}>
            {sourcesQuery.data?.length ?? 0} fuentes vigiladas. Los archivos descargados quedan en
            caché y se reutilizan en las herramientas de sincronización.
          </p>
        </div>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => queryClient.invalidateQueries({ queryKey: SUMMARIES_QUERY_KEY })}
          disabled={isSummariesBusy}
        >
          <RefreshCw
            size={15}
            className={isSummariesBusy ? styles.spin : undefined}
          />
          {isSummariesBusy ? "Actualizando..." : "Revisar ahora"}
        </button>
      </section>

      <section className={`glass-panel ${styles.addPanel}`}>
        <h3 className={styles.sectionTitle}>Agregar una fuente</h3>
        <AddSourceForm
          isSubmitting={addSourceMutation.isPending}
          onSubmit={(portalUrl) => addSourceMutation.mutate(portalUrl)}
        />
        {mutationError && (
          <p className={styles.errorMessage}>
            <AlertTriangle size={14} />
            {mutationError instanceof Error
              ? mutationError.message
              : "No se pudo completar la operación."}
          </p>
        )}
      </section>

      {sourcesQuery.isPending ? (
        <div className={styles.stateArea}>
          <Loader2 size={22} className={styles.spin} />
          <span>Cargando fuentes vigiladas...</span>
        </div>
      ) : sourcesQuery.isError ? (
        <div className={styles.stateArea}>
          <AlertTriangle size={20} className={styles.errorIcon} />
          <span>No se pudieron leer las fuentes vigiladas.</span>
        </div>
      ) : (
        <section className={styles.sourceGrid}>
          {sourcesQuery.data.map((source) => (
            <WatchedSourceCard
              key={source.id}
              source={source}
              summary={summariesBySourceId.get(source.id)}
              isRemoving={removeSourceMutation.isPending}
              onRemove={(sourceId) => removeSourceMutation.mutate(sourceId)}
            />
          ))}
        </section>
      )}
    </ToolWorkspaceLayout>
  );
};
