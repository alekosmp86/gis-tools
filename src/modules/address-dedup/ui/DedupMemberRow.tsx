"use client";

import React from "react";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { BadgeVariant } from "@/ui-kit/types/ui";
import { Decision, EMPTY_FUENTE } from "../constants";
import { DECISION_LABELS, MATCH_KEY_COLUMNS, OTHER_FUENTES_LABEL, REASON_LABELS } from "../data/dedupLabels";
import { formatCell } from "../domain/rowFormat";
import type { AnalysisRow } from "../types";
import { DedupCopyButton } from "./DedupCopyButton";
import styles from "./DedupMemberRow.module.css";

interface DedupMemberRowProps {
  row: AnalysisRow;
}

export const DedupMemberRow: React.FC<DedupMemberRowProps> = ({ row }) => {
  const isRemoval = row.decision === Decision.REMOVE;

  return (
    <tr className={`${styles.row} ${isRemoval ? styles.remove : styles.keep}`}>
      <td className={styles.fuente}>{row.fuente === EMPTY_FUENTE ? OTHER_FUENTES_LABEL : row.fuente}</td>
      <td>
        <span className={styles.urnCell}>
          <span className={styles.urn} title={row.urn}>
            {row.urn}
          </span>
          <DedupCopyButton value={row.urn} />
        </span>
      </td>
      {MATCH_KEY_COLUMNS.map(({ field }) => (
        <td key={field}>{formatCell(row[field])}</td>
      ))}
      <td>
        <Badge
          variant={isRemoval ? BadgeVariant.PLANNED : BadgeVariant.ACTIVE}
          className={isRemoval ? styles.removeBadge : ""}
        >
          {DECISION_LABELS[row.decision]}
        </Badge>
      </td>
      <td>
        <Badge variant={BadgeVariant.DEV}>{REASON_LABELS[row.decision_reason]}</Badge>
      </td>
    </tr>
  );
};
