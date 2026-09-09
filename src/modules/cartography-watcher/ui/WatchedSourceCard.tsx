"use client";

import React, { useState } from "react";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { EditSourceForm } from "./EditSourceForm";
import { SourceStatusBadge } from "./SourceStatusBadge";
import { describePendingCount, formatPublicationDate } from "../domain/formatters";
import { SourceBadgeState } from "../types";
import type { SourceSummary, WatchedSource } from "../types";
import styles from "./WatchedSourceCard.module.css";

interface WatchedSourceCardProps {
  source: WatchedSource;
  summary?: SourceSummary;
  isRemoving: boolean;
  isUpdating: boolean;
  onUpdate: (sourceId: string, url: string) => Promise<void>;
  onRemove: (sourceId: string) => void;
}

export const WatchedSourceCard: React.FC<WatchedSourceCardProps> = ({
  source,
  summary,
  isRemoving,
  isUpdating,
  onUpdate,
  onRemove,
}) => {
  const portalUrl = `https://${source.portalHost}/dataset/${source.datasetSlug}`;
  const [isEditing, setIsEditing] = useState(false);

  const handleStartEditing = () => {
    setIsEditing(true);
  };

  return (
    <article className={`glass-panel ${styles.card}`}>
      <header className={styles.header}>
        <h3 className={styles.title}>{source.title}</h3>
        {summary ? (
          <SourceStatusBadge status={summary.status} />
        ) : (
          <span className={styles.pendingLabel}>Consultando...</span>
        )}
      </header>

      {source.description && <p className={styles.description}>{source.description}</p>}

      {isEditing ? (
        <EditSourceForm
          initialUrl={portalUrl}
          isSubmitting={isUpdating}
          onSubmit={async (url) => {
            // Closing only after the await resolves is what keeps a rejected edit on screen.
            await onUpdate(source.id, url);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <dl className={styles.metrics}>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>Recursos</dt>
            <dd className={styles.metricValue}>{summary?.totalResources ?? "—"}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>Novedades</dt>
            <dd className={styles.metricValue}>
              {summary ? describePendingCount(summary.pendingCount) : "—"}
            </dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>Última consulta</dt>
            <dd className={styles.metricValue}>
              {summary ? formatPublicationDate(summary.checkedAt) : "—"}
            </dd>
          </div>
        </dl>
      )}

      {summary?.status === SourceBadgeState.ERROR && summary.errorMessage && (
        <p className={styles.errorMessage}>{summary.errorMessage}</p>
      )}

      <footer className={styles.footer}>
        <a
          className={styles.portalLink}
          href={portalUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink size={14} />
          Ver en el portal
        </a>

        <div className={styles.actionsGroup}>
          <button
            type="button"
            className={styles.editButton}
            onClick={handleStartEditing}
            disabled={isUpdating || isRemoving}
          >
            <Pencil size={14} />
            Editar
          </button>

          {!source.isDefault && (
            <button
              type="button"
              className={styles.removeButton}
              onClick={() => onRemove(source.id)}
              disabled={isRemoving || isUpdating}
            >
              <Trash2 size={14} />
              Dejar de vigilar
            </button>
          )}
        </div>
      </footer>
    </article>
  );
};
