import { formatNumber } from "@/core/common/ValueFormatter";
import { StageStatus, type StageOutcome } from "../../shared/domain/stageContract";
import { JOB_MODE, JOB_STATE } from "../job/types.ts";
import type { JobStatus } from "../job/types.ts";
import { ShpPhase, isBusy, type ShpFlowState } from "./shpFlowState";
import { elapsedMs, formatDuration } from "./shpJobView";

export interface ShpStageReport {
  readonly status: StageStatus;
  readonly outcome: StageOutcome | null;
}

type ReportedState = Pick<ShpFlowState, "phase" | "status">;

function describeSuccess(status: JobStatus): StageOutcome {
  const isTest = status.mode === JOB_MODE.TEST;
  return {
    headline: isTest ? "Prueba completada: la tabla no fue modificada" : "Carga completada",
    lines: [
      `Tabla public.${status.target.table}, corte ${status.target.fechaact}`,
      `${formatNumber(status.progress.rowsCopied)} filas leídas`,
      `Duración ${formatDuration(elapsedMs(status))}`,
    ],
  };
}

function describeFailure(status: JobStatus): StageOutcome {
  return { headline: "La carga falló", lines: [status.error?.message ?? "Error desconocido."] };
}

function describeCancel(status: JobStatus): StageOutcome {
  return { headline: "Carga cancelada", lines: [`Tabla public.${status.target.table}: sin cambios.`] };
}

function reportFinished(status: JobStatus): ShpStageReport {
  if (status.state === JOB_STATE.SUCCEEDED) return { status: StageStatus.DONE, outcome: describeSuccess(status) };
  if (status.state === JOB_STATE.FAILED) return { status: StageStatus.FAILED, outcome: describeFailure(status) };
  return { status: StageStatus.PENDING, outcome: describeCancel(status) };
}

/** What the stage tells the workflow: working, finished (done, failed or cancelled) or nothing yet. */
export function reportShpStage(state: ReportedState): ShpStageReport {
  if (isBusy(state)) return { status: StageStatus.BUSY, outcome: null };
  if (state.phase === ShpPhase.DONE && state.status !== null) return reportFinished(state.status);
  return { status: StageStatus.PENDING, outcome: null };
}
