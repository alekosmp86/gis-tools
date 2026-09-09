"use client";

import React, { useState } from "react";
import styles from "./SourceSelector.module.css";

export interface AddSourceFormProps {
  onAddSource: (url: string) => void;
  onCancel: () => void;
}

export const AddSourceForm: React.FC<AddSourceFormProps> = ({
  onAddSource,
  onCancel,
}) => {
  const [customUrlInput, setCustomUrlInput] = useState<string>("");

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = customUrlInput.trim();
    if (trimmed) {
      onAddSource(trimmed);
      setCustomUrlInput("");
    }
  };

  return (
    <form className={styles.addSourceForm} onSubmit={handleFormSubmit}>
      <input
        type="text"
        className={styles.addInput}
        value={customUrlInput}
        onChange={(event) => setCustomUrlInput(event.target.value)}
        placeholder="URL del conjunto de datos CKAN (e.g. https://catalogodatos.gub.uy/dataset/...)"
        aria-label="URL del nuevo conjunto de datos CKAN"
      />
      <button
        type="submit"
        className={styles.addSubmitBtn}
        disabled={!customUrlInput.trim()}
      >
        Agregar
      </button>
      <button
        type="button"
        className={styles.addCancelBtn}
        onClick={onCancel}
      >
        Cerrar
      </button>
    </form>
  );
};

AddSourceForm.displayName = "AddSourceForm";
