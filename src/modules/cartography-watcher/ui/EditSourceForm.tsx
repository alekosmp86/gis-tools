"use client";

import React, { useId, useState } from "react";
import styles from "./EditSourceForm.module.css";

interface EditSourceFormProps {
  initialUrl: string;
  isSubmitting: boolean;
  onSubmit: (url: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Inline editor for a watched source's portal reference.
 */
export const EditSourceForm: React.FC<EditSourceFormProps> = ({
  initialUrl,
  isSubmitting,
  onSubmit,
  onCancel,
}) => {
  const inputId = useId();
  const [editUrl, setEditUrl] = useState(initialUrl);
  const [editError, setEditError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = editUrl.trim();
    if (trimmed.length === 0 || isSubmitting) {
      return;
    }

    setEditError(null);
    try {
      await onSubmit(trimmed);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "No se pudo actualizar la fuente vigilada.";
      setEditError(message);
    }
  };

  const handleCancel = () => {
    setEditError(null);
    setEditUrl(initialUrl);
    onCancel();
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor={inputId}>
        URL o identificador del catálogo
      </label>
      <input
        id={inputId}
        type="text"
        className={styles.input}
        value={editUrl}
        onChange={(event) => setEditUrl(event.target.value)}
        disabled={isSubmitting}
        placeholder="https://catalogodatos.gub.uy/dataset/..."
      />
      {editError && <p className={styles.errorMessage}>{editError}</p>}
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.saveButton}
          disabled={isSubmitting || editUrl.trim().length === 0}
        >
          Guardar
        </button>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
};
