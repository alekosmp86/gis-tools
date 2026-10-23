import React from "react";
import { ShpReplaceRunStatus, reset } from "@/core/services/shpReplaceRunStore";
import type { GeometryProcessingOptions } from "@/core/types/geometryProcessing";
import { GeometryReportPanel } from "@/components/tools/db-sync-common/geometry-processing/GeometryReportPanel";
import { ShpReplaceSummary } from "./ShpReplaceSummary";
import { ShpReplaceFollowUp, type ShpRerunRequest } from "./ShpReplaceFollowUp";
import { ShpReplaceRunHeader } from "./ShpReplaceRunHeader";
import { ShpNewOperationButton, ShpRunFooter } from "./ShpRunFooter";
import { ShpRunStatusNotices } from "./ShpRunStatusNotices";
import { useShpReplaceRun } from "./useShpReplaceRun";
import { shpRunWording } from "./shpReplaceLabels";
import styles from "./ShpReplaceRunPanel.module.css";

export interface ShpReplaceRunPanelProps {
  processing: GeometryProcessingOptions;
  onRerun: (request: ShpRerunRequest) => void;
  onReconfigure: () => void;
}

export const ShpReplaceRunPanel: React.FC<ShpReplaceRunPanelProps> = ({ processing, onRerun, onReconfigure }) => {
  const run = useShpReplaceRun();
  const { status, result, context, report, dryRun } = run;
  if (!context) return null;

  const isBusy = status === ShpReplaceRunStatus.UPLOADING || status === ShpReplaceRunStatus.RUNNING;
  const isFailed = status === ShpReplaceRunStatus.FAILED;
  const isDoneAnalysis = status === ShpReplaceRunStatus.DONE && dryRun;
  const geometryReport = result?.geometry ?? report;
  const showFollowUp = !isBusy && geometryReport !== null && (isDoneAnalysis || isFailed);

  return (
    <div className={styles.panel}>
      <ShpReplaceRunHeader title={shpRunWording(dryRun).titleByStatus[status]} context={context} dryRun={dryRun} />

      <ShpRunStatusNotices
        status={status}
        dryRun={dryRun}
        uploadPct={run.uploadPct}
        phase={run.phase}
        detail={run.detail}
        current={run.current}
        total={run.total}
        startedAt={context.startedAt}
        error={run.error}
        outcomeUnknown={run.outcomeUnknown}
        jobId={run.jobId}
      />

      {result && <ShpReplaceSummary result={result} />}

      {geometryReport && <GeometryReportPanel report={geometryReport} options={processing} />}

      {showFollowUp && (
        <ShpReplaceFollowUp
          report={geometryReport}
          processing={processing}
          targetLabel={context.targetLabel}
          canReplace={isDoneAnalysis}
          onRerun={onRerun}
          onReconfigure={onReconfigure}
          onNewOperation={() => reset()}
        />
      )}

      {!isBusy && !showFollowUp && (
        <ShpRunFooter leading={<ShpNewOperationButton onClick={() => reset()} />} />
      )}
    </div>
  );
};
