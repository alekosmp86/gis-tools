"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import { REMOVAL_LABELS, REMOVAL_TABLE_LABELS } from "../data/removalLabels";
import { RemovalTable } from "../removalConstants";
import type { RemovalResult } from "../removalTypes";
import { DedupRemovalReminder } from "./DedupRemovalReminder";
import styles from "./DedupRemovalResultView.module.css";

interface DedupRemovalResultViewProps {
  result: RemovalResult;
  onClose: () => void;
}

const TABLE_ORDER: ReadonlyArray<RemovalTable> = Object.values(RemovalTable);

export const DedupRemovalResultView: React.FC<DedupRemovalResultViewProps> = ({ result, onClose }) => (
  <div className={styles.view}>
    <AlertMessage type={AlertType.SUCCESS} text={REMOVAL_LABELS.RESULT_TITLE} />
    {result.recovered && <AlertMessage type={AlertType.INFO} text={REMOVAL_LABELS.RESULT_RECOVERED} />}

    <p className={styles.operation}>
      {REMOVAL_LABELS.RESULT_OPERATION}: <code data-testid="removal-operation">{result.operationId}</code>
    </p>

    <table className={styles.table}>
      <caption>{REMOVAL_LABELS.RESULT_DELETED}</caption>
      <tbody>
        {TABLE_ORDER.map((table) => (
          <tr key={table}>
            <th scope="row">{REMOVAL_TABLE_LABELS[table]}</th>
            <td>{formatNumber(result.deletedByTable[table])}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <DedupRemovalReminder />
    <AlertMessage type={AlertType.WARNING} text={REMOVAL_LABELS.RESULT_STALE} />

    <div className={styles.actions}>
      <Button type="button" onClick={onClose}>
        {REMOVAL_LABELS.CLOSE_BUTTON}
      </Button>
    </div>
  </div>
);
