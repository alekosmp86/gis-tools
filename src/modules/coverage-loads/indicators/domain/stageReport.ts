import { StageStatus, type StageOutcome } from "../../shared/domain/stageContract";
import { FlowPhase, isBusy, type LoadFlowState } from "./loadFlow";
import { listIncompleteMessages } from "./planView";

export interface StageReport {
  readonly status: StageStatus;
  readonly outcome: StageOutcome | null;
}

const INCOMPLETE_CUT_LINE = "Hay al menos un corte incompleto: perdió filas rechazadas.";

type ReportedState = Pick<LoadFlowState, "phase" | "result">;

function describeResult({ result }: ReportedState): StageOutcome | null {
  if (result === null) return null;
  const lines = [
    `${result.cuts.length} ${result.cuts.length === 1 ? "corte cargado" : "cortes cargados"}`,
    `${result.totalInserted} filas insertadas, ${result.totalReplaced} filas reemplazadas`,
  ];
  if (result.hasIncompleteCut) lines.push(INCOMPLETE_CUT_LINE);
  lines.push(...listIncompleteMessages(result));
  return { headline: "Carga completada", lines };
}

/** What the stage tells the workflow: nothing yet, working, or done with a summary of the load. */
export function reportStage(state: ReportedState): StageReport {
  if (isBusy(state)) return { status: StageStatus.BUSY, outcome: null };
  if (state.phase === FlowPhase.DONE) return { status: StageStatus.DONE, outcome: describeResult(state) };
  return { status: StageStatus.PENDING, outcome: null };
}
