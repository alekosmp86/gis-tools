"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { BadgeVariant } from "@/ui-kit/types/ui";
import { fetchSummaries } from "./watcherClient";
import { describePendingCount } from "../domain/formatters";
import styles from "./WatcherHomeCard.module.css";

/**
 * The module's card in the home tool grid.
 *
 * It reports pending updates rather than a static description, so the grid itself shows whether
 * anything needs attention. `src/data/toolsData.ts` is core data and is deliberately untouched:
 * the module brings its own entry and takes it away when removed.
 */

/** Route owned by this module, emitted by the page generator. */
const DASHBOARD_ROUTE = "/tools/m/cartography-watcher";

export const WatcherHomeCard: React.FC = () => {
  const { data: summaries, isPending, isError } = useQuery({
    queryKey: ["cartography-watcher", "summaries"],
    queryFn: fetchSummaries,
  });

  const totalPending = (summaries ?? []).reduce(
    (total, summary) => total + summary.pendingCount,
    0
  );

  const statusLine = isPending
    ? "Consultando catálogos..."
    : isError
      ? "No se pudo consultar el catálogo."
      : describePendingCount(totalPending);

  return (
    <Link href={DASHBOARD_ROUTE} className={`glass-panel ${styles.card}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <Radio size={24} />
        </div>
        <Badge variant={BadgeVariant.ACTIVE}>Módulo</Badge>
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>Observador de Actualizaciones Cartográficas</h3>
        <p className={styles.cardDesc}>
          Vigile catálogos abiertos (CKAN / IDEuy), detecte publicaciones nuevas de ejes viales y
          direcciones, y descárguelas al vault local.
        </p>
        <p className={styles.statusLine}>{statusLine}</p>
      </div>
    </Link>
  );
};
