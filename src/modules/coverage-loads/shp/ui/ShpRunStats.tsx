"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { JobStatus } from "../job/types.ts";
import { elapsedMs, formatDuration, jobStateLabel } from "../domain/shpJobView";
import styles from "./ShpRunStats.module.css";

interface ShpRunStatsProps {
  status: JobStatus;
}

interface StatCell {
  label: string;
  value: string;
}

function buildCells(status: JobStatus): StatCell[] {
  const { progress } = status;
  return [
    { label: "Estado", value: jobStateLabel(status.state) },
    { label: "Filas copiadas", value: formatNumber(progress.rowsCopied) },
    { label: "Piezas reparadas", value: `${formatNumber(progress.piecesRepaired)} / ${formatNumber(progress.piecesTotal)}` },
    { label: "Tiempo transcurrido", value: formatDuration(elapsedMs(status)) },
    { label: "Duración estimada", value: formatDuration(status.expectedMs) },
  ];
}

export const ShpRunStats: React.FC<ShpRunStatsProps> = ({ status }) => (
  <dl className={styles.grid}>
    {buildCells(status).map((cell) => (
      <div key={cell.label} className={styles.cell}>
        <dt>{cell.label}</dt>
        <dd>{cell.value}</dd>
      </div>
    ))}
  </dl>
);
