"use client";

import React from "react";
import {
  Radio,
  RefreshCw,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import type { WatcherSourceCheckResult } from "../types/watcher";
import { WatcherStatsRow } from "./WatcherStatsRow";
import styles from "./WatcherHeroCard.module.css";

export interface WatcherHeroCardProps {
  title: string;
  description?: string;
  checkResult?: WatcherSourceCheckResult | null;
  sourceUrl: string;
  onChangeSourceUrl: (url: string) => void;
  onSubmitUrl: (event: React.FormEvent) => void;
  isChecking: boolean;
  successMessage?: string | null;
  errorMessage?: string | null;
}

export const WatcherHeroCard: React.FC<WatcherHeroCardProps> = ({
  title,
  description,
  checkResult,
  sourceUrl,
  onChangeSourceUrl,
  onSubmitUrl,
  isChecking,
  successMessage,
  errorMessage,
}) => {
  return (
    <div className={styles.heroCard}>
      <div className={styles.heroHeader}>
        <div className={styles.heroTitleArea}>
          <div className={styles.heroIconWrapper}>
            <Radio size={24} />
          </div>
          <div>
            <h2 className={styles.heroTitle}>{title}</h2>
            <p className={styles.heroSubtitle}>
              {description ||
                "Monitoreo automático de datasets de catálogo abierto (CKAN IDEuy) para detección de nuevas versiones."}
            </p>
          </div>
        </div>
      </div>

      {checkResult && (
        <WatcherStatsRow
          totalResources={checkResult.totalResources}
          updatesCount={checkResult.updatesCount}
          datasetModified={checkResult.datasetModified}
        />
      )}

      <form className={styles.urlForm} onSubmit={onSubmitUrl}>
        <input
          type="text"
          className={styles.urlInput}
          value={sourceUrl}
          onChange={(event) => onChangeSourceUrl(event.target.value)}
          placeholder="URL del conjunto de datos CKAN (e.g. https://catalogodatos.gub.uy/dataset/...)"
          aria-label="URL del conjunto de datos CKAN"
          disabled={isChecking}
        />
        <button
          type="submit"
          className={styles.checkButton}
          disabled={isChecking || !sourceUrl.trim()}
        >
          <RefreshCw size={16} className={isChecking ? "animate-spin" : ""} />
          <span>{isChecking ? "Verificando Catálogo..." : "Verificar Catálogo"}</span>
        </button>
      </form>

      {successMessage && (
        <div className={`${styles.alertBanner} ${styles.alertSuccess}`}>
          <CheckCircle size={16} />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className={`${styles.alertBanner} ${styles.alertError}`}>
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};

WatcherHeroCard.displayName = "WatcherHeroCard";
