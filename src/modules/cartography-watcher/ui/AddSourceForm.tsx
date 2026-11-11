"use client";

import React, { useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { WatchedSourceKind } from "../types";
import type { AddSourceRequest } from "../types";
import styles from "./AddSourceForm.module.css";

interface AddSourceFormProps {
  isSubmitting: boolean;
  /** Resolves with the non-blocking warnings of the saved source; rejects with the refusal. */
  onSubmit: (request: AddSourceRequest) => Promise<ReadonlyArray<string>>;
}

const KIND_OPTIONS = [
  { kind: WatchedSourceKind.CKAN, label: "Conjunto CKAN" },
  { kind: WatchedSourceKind.DIRECT_URL, label: "URL directa" },
] as const;

function isSourceKind(value: string): value is WatchedSourceKind {
  return KIND_OPTIONS.some((option) => option.kind === value);
}

function buildRequest(kind: WatchedSourceKind, title: string, url: string): AddSourceRequest {
  return kind === WatchedSourceKind.DIRECT_URL
    ? { kind, title, url }
    : { kind: WatchedSourceKind.CKAN, url };
}

/**
 * Accepts a CKAN dataset (portal URL or bare identifier) or a direct service URL with its title;
 * the server decides whether either resolves.
 */
export const AddSourceForm: React.FC<AddSourceFormProps> = ({ isSubmitting, onSubmit }) => {
  const [kind, setKind] = useState<WatchedSourceKind>(WatchedSourceKind.CKAN);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ReadonlyArray<string>>([]);

  const isDirect = kind === WatchedSourceKind.DIRECT_URL;
  const trimmedTitle = title.trim();
  const trimmedUrl = url.trim();
  const canSubmit = trimmedUrl.length > 0 && (!isDirect || trimmedTitle.length > 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSubmitting) {
      return;
    }

    setSubmitError(null);
    setWarnings([]);
    try {
      setWarnings(await onSubmit(buildRequest(kind, trimmedTitle, trimmedUrl)));
      setTitle("");
      setUrl("");
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo agregar la fuente.");
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <select
        className={styles.kindSelect}
        value={kind}
        onChange={(event) => {
          if (isSourceKind(event.target.value)) {
            setKind(event.target.value);
            setSubmitError(null);
          }
        }}
        aria-label="Tipo de fuente"
        disabled={isSubmitting}
      >
        {KIND_OPTIONS.map((option) => (
          <option key={option.kind} value={option.kind}>
            {option.label}
          </option>
        ))}
      </select>
      {isDirect && (
        <input
          type="text"
          className={styles.titleInput}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Título"
          aria-label="Título"
          disabled={isSubmitting}
        />
      )}
      <input
        type="text"
        className={styles.input}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder={
          isDirect
            ? "URL"
            : "https://catalogodatos.gub.uy/dataset/... o el identificador del conjunto"
        }
        aria-label={isDirect ? "URL" : "URL o identificador del conjunto de datos"}
        disabled={isSubmitting}
      />
      <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
        {isSubmitting ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />}
        <span>{isSubmitting ? "Verificando..." : "Vigilar fuente"}</span>
      </button>
      {submitError && (
        <p className={styles.errorMessage}>
          <AlertTriangle size={14} />
          {submitError}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className={styles.warningMessage}>
          <AlertTriangle size={14} />
          {warning}
        </p>
      ))}
    </form>
  );
};
