import React from "react";
import { ShieldAlert } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { AlertType } from "@/ui-kit/types/ui";
import { ShpReplaceRunStatus } from "@/core/services/shpReplaceRunStore";
import type { ShpReplacePhase } from "@/core/types/shpReplace";
import { SHP_REPLACE_UPLOAD_PHASE_LABEL, shpRunWording } from "./shpReplaceLabels";
import { ShpRunningProgress } from "./ShpRunningProgress";
import styles from "./ShpReplaceRunPanel.module.css";

const FailureNotice: React.FC<{ error: string | null; outcomeUnknown: boolean; jobId: string | null; dryRun: boolean }> = ({
  error,
  outcomeUnknown,
  jobId,
  dryRun,
}) => {
  const wording = shpRunWording(dryRun);
  return (
    <>
      {error && <AlertMessage type={AlertType.ERROR} text={error} />}
      {outcomeUnknown ? (
        <AlertMessage type={AlertType.WARNING} text={`${wording.unknownOutcome} Trabajo: ${jobId ?? "desconocido"}.`} />
      ) : (
        <AlertMessage type={AlertType.WARNING} text={wording.unmodifiedTarget} />
      )}
    </>
  );
};

const RunningNotice: React.FC<{ dryRun: boolean }> = ({ dryRun }) => (
  <div className={styles.notice}>
    <ShieldAlert size={18} className={styles.noticeIcon} />
    <span>{shpRunWording(dryRun).runningNotice}</span>
  </div>
);

const UploadingNotice: React.FC<{ dryRun: boolean }> = ({ dryRun }) => (
  <div className={styles.notice}>
    <ShieldAlert size={18} className={styles.noticeIcon} />
    <span>{shpRunWording(dryRun).uploadingNotice}</span>
  </div>
);

export interface ShpRunStatusNoticesProps {
  status: ShpReplaceRunStatus;
  dryRun: boolean;
  uploadPct: number;
  phase: ShpReplacePhase | null;
  detail: string | null;
  current: number;
  total: number;
  startedAt: number;
  error: string | null;
  outcomeUnknown: boolean;
  jobId: string | null;
}

export const ShpRunStatusNotices: React.FC<ShpRunStatusNoticesProps> = ({
  status,
  dryRun,
  uploadPct,
  phase,
  detail,
  current,
  total,
  startedAt,
  error,
  outcomeUnknown,
  jobId,
}) => {
  if (status === ShpReplaceRunStatus.UPLOADING) {
    return (
      <>
        <UploadingNotice dryRun={dryRun} />
        <ProgressBar phase={SHP_REPLACE_UPLOAD_PHASE_LABEL} current={0} total={0} pct={uploadPct} />
      </>
    );
  }
  if (status === ShpReplaceRunStatus.RUNNING) {
    return (
      <>
        <RunningNotice dryRun={dryRun} />
        <ShpRunningProgress
          phase={phase}
          detail={detail}
          current={current}
          total={total}
          startedAt={startedAt}
          dryRun={dryRun}
        />
      </>
    );
  }
  if (status === ShpReplaceRunStatus.FAILED) {
    return <FailureNotice error={error} outcomeUnknown={outcomeUnknown} jobId={jobId} dryRun={dryRun} />;
  }
  return null;
};
