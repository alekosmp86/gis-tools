import React from "react";
import type { EjesSplitRow } from "../../../jobs/ejes-ide/types";
import { EJES_COMPACT_TEXT } from "./ejesCompactTexts";
import styles from "./EjesCompact.module.css";

export type EjesPointsSource = Pick<EjesSplitRow, "points" | "autoPoints" | "reviewPoints" | "noGeometryPoints" | "farPoints">;

export interface EjesPointsCellProps {
  row: EjesPointsSource;
}

/** The access points of a split: the total, then only the non-zero parts of its decision, and the far ones when there are any. */
export const EjesPointsCell: React.FC<EjesPointsCellProps> = ({ row }) => {
  const parts = [
    row.autoPoints > 0 ? EJES_COMPACT_TEXT.AUTO(row.autoPoints) : null,
    row.reviewPoints > 0 ? EJES_COMPACT_TEXT.TO_REVIEW(row.reviewPoints) : null,
    row.noGeometryPoints > 0 ? EJES_COMPACT_TEXT.NO_GEOMETRY(row.noGeometryPoints) : null,
  ].filter((part): part is string => part !== null);
  return (
    <div className={styles.cellStack}>
      <strong className={styles.pointsTotal}>{row.points}</strong>
      {parts.length > 0 && <span className={styles.pointsDetail}>{parts.join(", ")}</span>}
      {row.farPoints > 0 && <span className={styles.pointsFar}>{EJES_COMPACT_TEXT.FAR(row.farPoints)}</span>}
    </div>
  );
};
