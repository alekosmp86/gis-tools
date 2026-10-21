import { StageStatus, type StageOutcome } from "../../shared/domain/stageContract";
import { FlowPhase, isBusy, type LoadFlowState } from "./loadFlow";

export interface StageReport {
  readonly status: StageStatus;
  readonly outcome: StageOutcome | null;
}

type ReportedState = Pick<LoadFlowState, "phase" | "result">;

function describeResult({ result }: ReportedState): StageOutcome | null {
  if (result === null || result.dryRun) return null;
  const lines = [
    ...result.files.map((file) => `${file.fileName}: ${file.rowsLoaded} filas cargadas, ${file.junkDeleted} de basura eliminadas`),
    `${result.avanceInserted} filas insertadas en el Avance`,
    result.history.skipped ? (result.history.reason ?? "historial omitido") : `${result.history.copied} filas copiadas al historial`,
  ];
  const failedReports = result.reports.filter((report) => report.error !== null).length;
  if (failedReports > 0) lines.push(`${failedReports} reportes fallaron al generarse`);
  return { headline: "Avance FTTH reconstruido", lines };
}

/** What the stage tells the workflow: nothing yet, working, or done. A dry run persisted nothing, so it stays pending. */
export function reportStage(state: ReportedState): StageReport {
  if (isBusy(state)) return { status: StageStatus.BUSY, outcome: null };
  if (state.phase === FlowPhase.DONE && state.result?.dryRun === false) {
    return { status: StageStatus.DONE, outcome: describeResult(state) };
  }
  return { status: StageStatus.PENDING, outcome: null };
}
