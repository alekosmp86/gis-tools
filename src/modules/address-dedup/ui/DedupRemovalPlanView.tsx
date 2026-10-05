"use client";

import React from "react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { BLOCK_REASON_LABELS, REMOVAL_LABELS, REMOVAL_TABLE_LABELS } from "../data/removalLabels";
import { RemovalTable } from "../removalConstants";
import type { RemovalSimulationPayload } from "../removalTypes";
import { DedupRemovalReminder } from "./DedupRemovalReminder";
import { DedupRemovalTargetList } from "./DedupRemovalTargetList";
import styles from "./DedupRemovalPlanView.module.css";

interface DedupRemovalPlanViewProps {
  plan: RemovalSimulationPayload;
  provinceId: number;
  errorText: string | null;
  isExecuting: boolean;
  canExecute: boolean;
  onRestart: () => void;
  onExecute: () => void;
}

const TABLE_ORDER: ReadonlyArray<RemovalTable> = Object.values(RemovalTable);

export const DedupRemovalPlanView: React.FC<DedupRemovalPlanViewProps> = ({
  plan,
  provinceId,
  errorText,
  isExecuting,
  canExecute,
  onRestart,
  onExecute,
}) => (
  <div className={styles.view}>
    <h3 className={styles.title}>{REMOVAL_LABELS.PLAN_TITLE}</h3>

    {plan.counts.total === 0 && <AlertMessage type={AlertType.INFO} text={REMOVAL_LABELS.PLAN_EMPTY} />}

    {plan.blockers.length > 0 && (
      <div className={styles.blockers}>
        <AlertMessage type={AlertType.ERROR} text={REMOVAL_LABELS.PLAN_BLOCKED} />
        <ul className={styles.blockerList}>
          {plan.blockers.map((blocker) => (
            <li key={blocker.urn}>
              <code>{blocker.urn || REMOVAL_LABELS.NO_URN}</code>
              <ul>
                {blocker.reasons.map((reason) => (
                  <li key={`${reason.code}-${reason.detail ?? ""}`}>
                    {BLOCK_REASON_LABELS[reason.code]}
                    {reason.detail ? `: ${reason.detail}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    )}

    <dl className={styles.facts}>
      <div>
        <dt>{REMOVAL_LABELS.PLAN_TOTAL}</dt>
        <dd data-testid="removal-total">{formatNumber(plan.counts.total)}</dd>
      </div>
      {Object.entries(plan.counts.byFuente).map(([fuente, count]) => (
        <div key={fuente}>
          <dt>{fuente || REMOVAL_LABELS.NO_FUENTE}</dt>
          <dd>{formatNumber(count)}</dd>
        </div>
      ))}
    </dl>

    <table className={styles.table}>
      <caption>{REMOVAL_LABELS.PLAN_BY_TABLE}</caption>
      <tbody>
        {TABLE_ORDER.map((table) => (
          <tr key={table}>
            <th scope="row">{REMOVAL_TABLE_LABELS[table]}</th>
            <td>{formatNumber(plan.counts.rowsByTable[table])}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <DedupRemovalTargetList targets={plan.targets} provinceId={provinceId} fingerprint={plan.fingerprint} />

    <p className={styles.fingerprint}>
      {REMOVAL_LABELS.PLAN_FINGERPRINT}: <code data-testid="removal-fingerprint">{plan.fingerprint}</code>
    </p>

    <DedupRemovalReminder />
    {errorText && <AlertMessage type={AlertType.ERROR} text={errorText} />}

    <div className={styles.actions}>
      <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isExecuting} onClick={onRestart}>
        <ArrowLeft size={15} />
        {REMOVAL_LABELS.BACK_BUTTON}
      </Button>
      <Button type="button" className={styles.danger} isDisabled={!canExecute || isExecuting} onClick={onExecute}>
        {isExecuting ? <Loader2 size={15} className={styles.spin} /> : <Trash2 size={15} />}
        {isExecuting ? REMOVAL_LABELS.EXECUTING_BUTTON : REMOVAL_LABELS.EXECUTE_BUTTON}
      </Button>
    </div>
  </div>
);
