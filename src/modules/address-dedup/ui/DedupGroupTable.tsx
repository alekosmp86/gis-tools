"use client";

import React from "react";
import { GROUP_TABLE_COLUMNS } from "../data/dedupLabels";
import type { AnalysisGroup } from "../types";
import { DedupGroupHeaderRow } from "./DedupGroupHeaderRow";
import { DedupMemberRow } from "./DedupMemberRow";
import { DedupScrollFrame } from "./DedupScrollFrame";
import shared from "./DedupShared.module.css";
import styles from "./DedupGroupTable.module.css";

interface DedupGroupTableProps {
  groups: ReadonlyArray<AnalysisGroup>;
  collapsedGroupIds: ReadonlySet<number>;
  onToggleGroup: (groupId: number) => void;
}

/** One table, one `tbody` per group: a header row followed by its members. */
export const DedupGroupTable: React.FC<DedupGroupTableProps> = ({
  groups,
  collapsedGroupIds,
  onToggleGroup,
}) => (
  <DedupScrollFrame>
    <table className={styles.table}>
      <caption className={shared.visuallyHidden}>Grupos de direcciones duplicadas</caption>
      <thead>
        <tr>
          {GROUP_TABLE_COLUMNS.map((label) => (
            <th key={label} scope="col" className={styles.head}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      {groups.map((group) => {
        const isExpanded = !collapsedGroupIds.has(group.groupId);
        return (
          <tbody key={group.groupId}>
            <DedupGroupHeaderRow
              group={group}
              isExpanded={isExpanded}
              onToggle={() => onToggleGroup(group.groupId)}
            />
            {isExpanded && group.rows.map((row) => <DedupMemberRow key={row.urn} row={row} />)}
          </tbody>
        );
      })}
    </table>
  </DedupScrollFrame>
);
