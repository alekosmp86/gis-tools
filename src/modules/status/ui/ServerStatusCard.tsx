"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { BadgeVariant } from "@/ui-kit/types/ui";
import { isQueryBusy } from "@/core/common/queryBusyState";
import { ServerEnvironment } from "../types";
import type { ServerStatusResponse } from "../types";
import styles from "./ServerStatusCard.module.css";

/**
 * The module's contribution to the home tool grid.
 *
 * It renders with no props and owns its own fetching, because a slot knows nothing about the
 * contributions it hosts. If this throws, the slot's error boundary drops it and the page carries
 * on — which is what makes a broken module indistinguishable from an absent one.
 */

const STATUS_ENDPOINT = "/api/m/status";
const REFRESH_INTERVAL_MS = 30_000;

async function fetchServerStatus(): Promise<ServerStatusResponse> {
  const response = await fetch(STATUS_ENDPOINT);

  if (!response.ok) {
    throw new Error(`El endpoint de estado respondió ${response.status}.`);
  }

  return response.json();
}

export const ServerStatusCard: React.FC = () => {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["module", "status"],
    queryFn: fetchServerStatus,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const snapshot = data?.status;
  const isProduction = snapshot?.environment === ServerEnvironment.PRODUCTION;
  const isBusy = isQueryBusy({ isPending, isFetching });

  return (
    <div className={`glass-panel ${styles.card}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <Activity size={24} />
        </div>
        <Badge variant={isProduction ? BadgeVariant.ACTIVE : BadgeVariant.DEV}>
          {isProduction ? "Producción" : "Desarrollo"}
        </Badge>
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>Estado del Servidor</h3>

        {isError ? (
          <p className={styles.errorText}>
            <AlertTriangle size={14} />
            No se pudo consultar el estado del servidor.
          </p>
        ) : (
          <p className={styles.cardDesc}>
            {isPending ? "Consultando el estado del servidor..." : `Activo desde hace ${snapshot?.uptimeLabel}.`}
          </p>
        )}

        <dl className={styles.metrics}>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>Node.js</dt>
            <dd className={styles.metricValue}>{snapshot?.nodeVersion ?? "—"}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>Segundos activo</dt>
            <dd className={styles.metricValue}>{snapshot?.uptimeSeconds ?? "—"}</dd>
          </div>
        </dl>

        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => refetch()}
          disabled={isBusy}
        >
          <RefreshCw size={14} className={isBusy ? styles.spinning : undefined} />
          {isBusy ? "Actualizando..." : "Actualizar"}
        </button>
      </div>
    </div>
  );
};
