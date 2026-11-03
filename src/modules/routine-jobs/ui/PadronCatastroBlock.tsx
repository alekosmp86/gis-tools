"use client";

import React from "react";
import { Copy } from "lucide-react";
import type { GeometryMapStagingKey } from "../jobs/actualizar-padron/types";
import { NO_DATA_TEXT } from "./reportFormat";
import styles from "./PadronCatastroBlock.module.css";

const COPY_ICON_SIZE = 13;
const TITLE = "Datos para buscar en Catastro";
const NO_CATASTRO_MESSAGE = "No hay padrón nuevo que buscar en el catastro.";

function CopyValueButton({ label, value }: { label: string; value: string | null }) {
  const copy = () => {
    if (value === null) return;
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .catch(() => undefined);
  };
  return (
    <button
      type="button"
      className={styles.copyButton}
      onClick={copy}
      disabled={value === null}
      aria-label={`Copiar ${label}`}
      title={`Copiar ${label}`}
    >
      <Copy size={COPY_ICON_SIZE} />
    </button>
  );
}

function CatastroField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value ?? NO_DATA_TEXT}</span>
      <CopyValueButton label={label} value={value} />
    </div>
  );
}

function CatastroKeyCard({ catastroKey }: { catastroKey: GeometryMapStagingKey }) {
  return (
    <div className={styles.keyCard}>
      <CatastroField label="Tipo" value={catastroKey.typePadron} />
      <CatastroField label="Departamento" value={catastroKey.department} />
      <CatastroField label="Localidad catastral" value={catastroKey.locality} />
      <CatastroField label="Número" value={catastroKey.number} />
    </div>
  );
}

export interface PadronCatastroBlockProps {
  keys: GeometryMapStagingKey[];
}

/** The new padrón(es) of the clicked outline, each field with a copy button. */
export function PadronCatastroBlock({ keys }: PadronCatastroBlockProps) {
  return (
    <section className={styles.block}>
      <h4 className={styles.title}>{TITLE}</h4>
      {keys.length === 0 ? (
        <p className={styles.hint}>{NO_CATASTRO_MESSAGE}</p>
      ) : (
        keys.map((key) => (
          <CatastroKeyCard key={`${key.typePadron}|${key.department}|${key.locality ?? ""}|${key.number}`} catastroKey={key} />
        ))
      )}
    </section>
  );
}
