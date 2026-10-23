import React from "react";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { ShpReplacePhase } from "@/core/types/shpReplace";
import { shpRunWording } from "./shpReplaceLabels";
import { useElapsedSeconds, useStartedAt } from "./useElapsedSeconds";
import styles from "./ShpRunningProgress.module.css";

const SLOW_STEP_SECONDS = 30;
const SLOW_STEP_TEXT =
  "Si el paso tarda, el servidor sigue trabajando: puede tardar varios minutos con archivos grandes.";

const toPercent = (current: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

const formatElapsed = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

const StepSlowNote: React.FC = () => {
  const stepSeconds = useElapsedSeconds(useStartedAt());
  return stepSeconds > SLOW_STEP_SECONDS ? <span className={styles.slowNote}>{SLOW_STEP_TEXT}</span> : null;
};

export interface ShpRunningProgressProps {
  phase: ShpReplacePhase | null;
  detail: string | null;
  current: number;
  total: number;
  startedAt: number;
  dryRun: boolean;
}

export const ShpRunningProgress: React.FC<ShpRunningProgressProps> = ({
  phase,
  detail,
  current,
  total,
  startedAt,
  dryRun,
}) => {
  const wording = shpRunWording(dryRun);
  const phaseLabel = phase ? wording.phaseLabels[phase] : wording.startingPhaseLabel;
  const elapsedSeconds = useElapsedSeconds(startedAt);
  const stepKey = `${phase ?? ""}|${detail ?? ""}`;
  const slowNote = <StepSlowNote key={stepKey} />;

  if (phase === ShpReplacePhase.STAGING) {
    return (
      <div className={styles.container}>
        <ProgressBar phase={phaseLabel} current={current} total={total} pct={toPercent(current, total)} />
        {slowNote}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.phaseRow}>
        <span className={styles.phaseLabel}>{phaseLabel}</span>
        <span className={styles.timer}>Tiempo transcurrido: {formatElapsed(elapsedSeconds)}</span>
      </div>
      {detail !== null && total > 0 && (
        <span className={styles.stepLine}>
          Paso {current} de {total}: {detail}
        </span>
      )}
      <div className={styles.track}>
        <div className={styles.indeterminate} />
      </div>
      {slowNote}
    </div>
  );
};
