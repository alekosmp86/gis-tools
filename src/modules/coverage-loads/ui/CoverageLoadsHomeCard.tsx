"use client";

import React from "react";
import Link from "next/link";
import { DatabaseZap } from "lucide-react";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { BadgeVariant } from "@/ui-kit/types/ui";
import { HomeCardFrame } from "@/ui-kit/components/HomeCardFrame";
import styles from "./CoverageLoadsHomeCard.module.css";

/** The module's card in the home tool grid; it brings its own entry and takes it away when removed. */

const WIKI_SLUG = "coverage-loads";
const WIKI_LABEL = "Cargas de Coberturas";
const DASHBOARD_ROUTE = "/tools/m/coverage-loads";

export const CoverageLoadsHomeCard: React.FC = () => (
  <HomeCardFrame wikiSlug={WIKI_SLUG} wikiLabel={WIKI_LABEL}>
    <Link href={DASHBOARD_ROUTE} className={`glass-panel ${styles.card}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <DatabaseZap size={24} />
        </div>
        <Badge variant={BadgeVariant.ACTIVE}>Módulo</Badge>
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>Cargas de Coberturas</h3>
        <p className={styles.cardDesc}>
          Cargue los indicadores de cobertura LTE (IndicadoresLTE_aaaammdd.csv) al histórico de PostgreSQL,
          revise qué cortes se reemplazan antes de confirmar y descargue los tres reportes CSV.
        </p>
      </div>
    </Link>
  </HomeCardFrame>
);
