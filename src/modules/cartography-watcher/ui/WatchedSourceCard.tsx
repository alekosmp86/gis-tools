"use client";

import React, { useState } from "react";
import { AlertTriangle, ExternalLink, Globe, Pencil, Trash2 } from "lucide-react";
import { EditSourceForm } from "./EditSourceForm";
import { SourceStatusBadge } from "./SourceStatusBadge";
import { describePendingCount, formatPublicationDate } from "../domain/formatters";
import { isDirectSource } from "../domain/sourceKind";
import { SourceBadgeState } from "../types";
import type { SourceEditChanges, SourceSummary, WatchedSource } from "../types";
import styles from "./WatchedSourceCard.module.css";

interface WatchedSourceCardProps {
  source: WatchedSource;
  summary?: SourceSummary;
  isRemoving: boolean;
  isUpdating: boolean;
  onUpdate: (sourceId: string, changes: SourceEditChanges) => Promise<void>;
  onRemove: (sourceId: string) => void;
}

const CardBadge: React.FC<{ isDirect: boolean; summary?: SourceSummary }> = ({ isDirect, summary }) => {
  if (isDirect) return <SourceStatusBadge status={SourceBadgeState.ON_DEMAND} />;
  if (summary) return <SourceStatusBadge status={summary.status} />;
  return <span className={styles.pendingLabel}>Consultando...</span>;
};

const Metric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className={styles.metric}>
    <dt className={styles.metricLabel}>{label}</dt>
    <dd className={styles.metricValue}>{value}</dd>
  </div>
);

const SourceMetrics: React.FC<{ summary?: SourceSummary }> = ({ summary }) => (
  <dl className={styles.metrics}>
    <Metric label="Recursos" value={summary?.totalResources ?? "—"} />
    <Metric label="Novedades" value={summary ? describePendingCount(summary.pendingCount) : "—"} />
    <Metric label="Última consulta" value={summary ? formatPublicationDate(summary.checkedAt) : "—"} />
  </dl>
);

const SourceWarnings: React.FC<{ warnings: readonly string[] }> = ({ warnings }) => (
  <>
    {warnings.map((warning) => (
      <p key={warning} className={styles.warningMessage}>
        <AlertTriangle size={14} />
        {warning}
      </p>
    ))}
  </>
);

interface CardActionsProps {
  source: WatchedSource;
  isDirect: boolean;
  isBusy: boolean;
  onEdit: () => void;
  onRemove: (sourceId: string) => void;
}

const CardActions: React.FC<CardActionsProps> = ({ source, isDirect, isBusy, onEdit, onRemove }) => (
  <div className={styles.actionsGroup}>
    <button type="button" className={styles.editButton} onClick={onEdit} disabled={isBusy}>
      <Pencil size={14} />
      Editar
    </button>

    {!source.isDefault && (
      <button type="button" className={styles.removeButton} onClick={() => onRemove(source.id)} disabled={isBusy}>
        <Trash2 size={14} />
        {isDirect ? "Eliminar" : "Dejar de vigilar"}
      </button>
    )}
  </div>
);

interface CardBodyProps {
  source: WatchedSource;
  summary?: SourceSummary;
  isDirect: boolean;
  isEditing: boolean;
  isUpdating: boolean;
  portalUrl: string;
  onSubmit: (changes: SourceEditChanges) => Promise<void>;
  onCancel: () => void;
}

const CardBody: React.FC<CardBodyProps> = ({
  source,
  summary,
  isDirect,
  isEditing,
  isUpdating,
  portalUrl,
  onSubmit,
  onCancel,
}) => {
  if (isEditing) {
    return (
      <EditSourceForm
        initialUrl={portalUrl}
        initialTitle={isDirect ? source.title : undefined}
        isSubmitting={isUpdating}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }
  if (isDirect) {
    return (
      <p className={styles.host}>
        <Globe size={14} />
        {source.portalHost}
      </p>
    );
  }
  return <SourceMetrics summary={summary} />;
};

export const WatchedSourceCard: React.FC<WatchedSourceCardProps> = ({
  source,
  summary,
  isRemoving,
  isUpdating,
  onUpdate,
  onRemove,
}) => {
  const isDirect = isDirectSource(source);
  const portalUrl = isDirect
    ? (source.directUrl ?? "")
    : `https://${source.portalHost}/dataset/${source.datasetSlug}`;
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = async (changes: SourceEditChanges) => {
    // Closing only after the await resolves is what keeps a rejected edit on screen.
    await onUpdate(source.id, changes);
    setIsEditing(false);
  };

  return (
    <article className={`glass-panel ${styles.card}`}>
      <header className={styles.header}>
        <h3 className={styles.title}>{source.title}</h3>
        <CardBadge isDirect={isDirect} summary={summary} />
      </header>

      {source.description && <p className={styles.description}>{source.description}</p>}

      <CardBody
        source={source}
        summary={summary}
        isDirect={isDirect}
        isEditing={isEditing}
        isUpdating={isUpdating}
        portalUrl={portalUrl}
        onSubmit={handleSubmit}
        onCancel={() => setIsEditing(false)}
      />

      {isDirect && !isEditing && <SourceWarnings warnings={source.warnings ?? []} />}

      {summary?.status === SourceBadgeState.ERROR && summary.errorMessage && (
        <p className={styles.errorMessage}>{summary.errorMessage}</p>
      )}

      <footer className={styles.footer}>
        {isDirect ? (
          <span />
        ) : (
          <a className={styles.portalLink} href={portalUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={14} />
            Ver en el portal
          </a>
        )}

        <CardActions
          source={source}
          isDirect={isDirect}
          isBusy={isUpdating || isRemoving}
          onEdit={() => setIsEditing(true)}
          onRemove={onRemove}
        />
      </footer>
    </article>
  );
};
