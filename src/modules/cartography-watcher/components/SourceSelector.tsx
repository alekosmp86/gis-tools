"use client";

import React, { useState } from "react";
import { Layers, RefreshCw, Plus, X } from "lucide-react";
import type { WatchedSourceConfig, SourceCheckSummary } from "../types/watcher";
import { WatchedSourceCard } from "./WatchedSourceCard";
import { AddSourceForm } from "./AddSourceForm";
import styles from "./SourceSelector.module.css";

export interface SourceSelectorProps {
  sources: readonly WatchedSourceConfig[];
  selectedSourceId: string;
  summaries: Record<string, SourceCheckSummary>;
  isCheckingSummaries: boolean;
  onSelectSource: (sourceId: string) => void;
  onAddSource?: (url: string) => void;
  onRefreshAll?: () => void;
}

export const SourceSelector: React.FC<SourceSelectorProps> = ({
  sources,
  selectedSourceId,
  summaries,
  isCheckingSummaries,
  onSelectSource,
  onAddSource,
  onRefreshAll,
}) => {
  const [isAddingSource, setIsAddingSource] = useState<boolean>(false);

  const handleToggleAddForm = () => {
    setIsAddingSource((previous) => !previous);
  };

  const handleAddSource = (url: string) => {
    onAddSource?.(url);
    setIsAddingSource(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.titleArea}>
          <Layers size={18} color="#38bdf8" />
          <h3 className={styles.sectionTitle}>Fuentes Cartográficas Monitoreadas</h3>
        </div>

        <div className={styles.actionButtons}>
          {onRefreshAll && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onRefreshAll}
              disabled={isCheckingSummaries}
              aria-label="Verificar estado de todas las fuentes"
            >
              <RefreshCw
                size={14}
                className={isCheckingSummaries ? "animate-spin" : ""}
              />
              <span>Actualizar Estado</span>
            </button>
          )}

          {onAddSource && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleToggleAddForm}
              aria-label="Agregar nuevo conjunto de datos"
            >
              {isAddingSource ? <X size={14} /> : <Plus size={14} />}
              <span>{isAddingSource ? "Cancelar" : "Agregar Fuente"}</span>
            </button>
          )}
        </div>
      </div>

      {isAddingSource && onAddSource && (
        <AddSourceForm
          onAddSource={handleAddSource}
          onCancel={handleToggleAddForm}
        />
      )}

      <div className={styles.grid}>
        {sources.map((source) => (
          <WatchedSourceCard
            key={source.id}
            source={source}
            isSelected={source.id === selectedSourceId}
            summary={summaries[source.id]}
            isCheckingSummaries={isCheckingSummaries}
            onSelect={onSelectSource}
          />
        ))}
      </div>
    </div>
  );
};

SourceSelector.displayName = "SourceSelector";
