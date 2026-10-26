"use client";

import React from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { HomeCardFrame } from "@/ui-kit/components/HomeCardFrame";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { BadgeVariant } from "@/ui-kit/types/ui";
import { ROUTINE_JOBS } from "./jobs";
import styles from "./RoutineJobsHomeCard.module.css";

/**
 * The module's card in the home tool grid. It links to the module page, which lists the jobs.
 */

const WIKI_SLUG = "routine-jobs";
const WIKI_LABEL = "Trabajos de rutina";
const DASHBOARD_ROUTE = "/tools/m/routine-jobs";

export const RoutineJobsHomeCard: React.FC = () => (
  <HomeCardFrame wikiSlug={WIKI_SLUG} wikiLabel={WIKI_LABEL}>
    <Link href={DASHBOARD_ROUTE} className={`glass-panel ${styles.card}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <CalendarClock size={24} />
        </div>
        <Badge variant={BadgeVariant.ACTIVE}>Módulo</Badge>
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{WIKI_LABEL}</h3>
        <p className={styles.cardDesc}>
          Trabajos de base de datos que se repiten, como la carga mensual de los padrones catastrales.
        </p>
        <p className={styles.statusLine}>{`Trabajos disponibles: ${ROUTINE_JOBS.length}`}</p>
      </div>
    </Link>
  </HomeCardFrame>
);
