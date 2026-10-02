"use client";

import React from "react";
import Link from "next/link";
import { CopyCheck } from "lucide-react";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { BadgeVariant } from "@/ui-kit/types/ui";
import styles from "./DedupHomeCard.module.css";

/** The module's card in the home tool grid; it brings its own entry and takes it away when removed. */

const DASHBOARD_ROUTE = "/tools/m/address-dedup";

export const DedupHomeCard: React.FC = () => (
  <Link href={DASHBOARD_ROUTE} className={`glass-panel ${styles.card}`}>
    <div className={styles.cardHeader}>
      <div className={styles.cardIcon}>
        <CopyCheck size={24} />
      </div>
      <Badge variant={BadgeVariant.ACTIVE}>Módulo</Badge>
    </div>

    <div className={styles.cardBody}>
      <h3 className={styles.cardTitle}>Duplicados de Direcciones</h3>
      <p className={styles.cardDesc}>
        Detecte direcciones duplicadas entre ANTEL, TLK e IDE en PostgreSQL, revise qué conservar o
        eliminar y exporte el resultado a CSV o GeoJSON para QGIS. Solo lectura.
      </p>
    </div>
  </Link>
);
