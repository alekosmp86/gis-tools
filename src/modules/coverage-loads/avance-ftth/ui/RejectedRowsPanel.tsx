"use client";

import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { downloadBlob } from "../../shared/ui/downloadBlob";
import { buildRejectedCsv, buildRejectedFileName, type RejectedRow } from "../client";
import { groupRejectedByFile } from "../domain/planView";
import { RejectedFileTable } from "./RejectedFileTable";
import styles from "./RejectedRowsPanel.module.css";

interface RejectedRowsPanelProps {
  rows: ReadonlyArray<RejectedRow>;
  totalRejected: number;
}

const CSV_BYTE_ORDER_MARK = "﻿";
const CSV_MIME_TYPE = "text/csv;charset=utf-8";

function downloadRejectedRows(rows: ReadonlyArray<RejectedRow>): void {
  const blob = new Blob([CSV_BYTE_ORDER_MARK + buildRejectedCsv(rows)], { type: CSV_MIME_TYPE });
  downloadBlob(blob, buildRejectedFileName(new Date()));
}

/** Rows that will not be (or were not) saved, per file, with a CSV the user can send to whoever fixes the file. */
export const RejectedRowsPanel: React.FC<RejectedRowsPanelProps> = ({ rows, totalRejected }) => {
  if (rows.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="Filas rechazadas">
      <div className={styles.header}>
        <h3 className={styles.title}>
          Filas rechazadas{totalRejected > rows.length ? ` (se listan ${rows.length} de ${totalRejected})` : ""}
        </h3>
        <Button type="button" variant={ButtonVariant.SECONDARY} onClick={() => downloadRejectedRows(rows)}>
          <Download size={15} />
          Descargar filas rechazadas (CSV)
        </Button>
      </div>
      {groupRejectedByFile(rows).map((group) => (
        <RejectedFileTable key={group.file} group={group} />
      ))}
    </section>
  );
};
