"use client";

import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { BadgeVariant } from "@/ui-kit/types/ui";
import { countByDecision, hasReviewRows } from "../domain/groupFilters";
import type { AnalysisGroup } from "../types";
import { GROUP_TABLE_COLUMN_COUNT, ROW_COUNT_WORDS } from "../data/dedupLabels";
import { pluralize } from "../domain/rowFormat";
import styles from "./DedupGroupHeaderRow.module.css";

interface DedupGroupHeaderRowProps {
  group: AnalysisGroup;
  isExpanded: boolean;
  onToggle: () => void;
}

export const DedupGroupHeaderRow: React.FC<DedupGroupHeaderRowProps> = ({
  group,
  isExpanded,
  onToggle,
}) => {
  const { keep, remove } = countByDecision(group);
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <tr className={styles.row}>
      <td colSpan={GROUP_TABLE_COLUMN_COUNT} className={styles.cell}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={isExpanded}
          title={group.rows[0]?.match_key}
          onClick={onToggle}
        >
          <Chevron size={16} />
          <span className={styles.title}>Grupo {group.groupId}</span>
          <span className={styles.meta}>
            {group.rows.length}{" "}
            {pluralize(group.rows.length, ROW_COUNT_WORDS.singular, ROW_COUNT_WORDS.plural)}
          </span>
          <span className={styles.meta}>
            {remove} eliminar · {keep} conservar
          </span>
          {hasReviewRows(group) && <Badge variant={BadgeVariant.DEV} className={styles.reviewBadge}>Revisar</Badge>}
        </button>
      </td>
    </tr>
  );
};
