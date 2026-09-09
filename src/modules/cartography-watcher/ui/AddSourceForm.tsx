"use client";

import React, { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import styles from "./AddSourceForm.module.css";

interface AddSourceFormProps {
  isSubmitting: boolean;
  onSubmit: (portalUrl: string) => void;
}

/**
 * Accepts a portal URL or a bare dataset identifier; the server decides whether it resolves.
 */
export const AddSourceForm: React.FC<AddSourceFormProps> = ({ isSubmitting, onSubmit }) => {
  const [portalUrl, setPortalUrl] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedUrl = portalUrl.trim();

    if (trimmedUrl.length > 0 && !isSubmitting) {
      onSubmit(trimmedUrl);
      setPortalUrl("");
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        type="text"
        className={styles.input}
        value={portalUrl}
        onChange={(event) => setPortalUrl(event.target.value)}
        placeholder="https://catalogodatos.gub.uy/dataset/... o el identificador del conjunto"
        aria-label="URL o identificador del conjunto de datos"
        disabled={isSubmitting}
      />
      <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
        {isSubmitting ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />}
        <span>{isSubmitting ? "Verificando..." : "Vigilar fuente"}</span>
      </button>
    </form>
  );
};
