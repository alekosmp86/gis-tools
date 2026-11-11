"use client";

import React, { useId, useState } from "react";
import type { SourceEditChanges } from "../types";
import styles from "./EditSourceForm.module.css";

interface EditSourceFormProps {
  initialUrl: string;
  /** Present only for a direct-URL source, whose title is editable and whose URL is the service. */
  initialTitle?: string;
  isSubmitting: boolean;
  onSubmit: (changes: SourceEditChanges) => Promise<void>;
  onCancel: () => void;
}

/**
 * Inline editor for a watched source: the portal reference of a CKAN source, or the title and URL
 * of a direct-URL source.
 */
export const EditSourceForm: React.FC<EditSourceFormProps> = ({
  initialUrl,
  initialTitle,
  isSubmitting,
  onSubmit,
  onCancel,
}) => {
  const titleInputId = useId();
  const inputId = useId();
  const isDirect = initialTitle !== undefined;
  const [editTitle, setEditTitle] = useState(initialTitle ?? "");
  const [editUrl, setEditUrl] = useState(initialUrl);
  const [editError, setEditError] = useState<string | null>(null);

  const trimmedTitle = editTitle.trim();
  const trimmedUrl = editUrl.trim();
  const canSave = trimmedUrl.length > 0 && (!isDirect || trimmedTitle.length > 0);

  const buildChanges = (): SourceEditChanges =>
    isDirect
      ? {
          ...(trimmedTitle !== initialTitle ? { title: trimmedTitle } : {}),
          ...(trimmedUrl !== initialUrl ? { url: trimmedUrl } : {}),
        }
      : { url: trimmedUrl };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || isSubmitting) {
      return;
    }

    const changes = buildChanges();
    if (changes.title === undefined && changes.url === undefined) {
      onCancel();
      return;
    }

    setEditError(null);
    try {
      await onSubmit(changes);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "No se pudo actualizar la fuente vigilada.";
      setEditError(message);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {isDirect && (
        <>
          <label className={styles.label} htmlFor={titleInputId}>
            Título
          </label>
          <input
            id={titleInputId}
            type="text"
            className={styles.input}
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            disabled={isSubmitting}
          />
        </>
      )}
      <label className={styles.label} htmlFor={inputId}>
        {isDirect ? "URL" : "URL o identificador del catálogo"}
      </label>
      <input
        id={inputId}
        type="text"
        className={styles.input}
        value={editUrl}
        onChange={(event) => setEditUrl(event.target.value)}
        disabled={isSubmitting}
        placeholder={isDirect ? "https://..." : "https://catalogodatos.gub.uy/dataset/..."}
      />
      {editError && <p className={styles.errorMessage}>{editError}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.saveButton} disabled={isSubmitting || !canSave}>
          Guardar
        </button>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
};
