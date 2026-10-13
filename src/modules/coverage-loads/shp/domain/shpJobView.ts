import { JOB_STAGE, JOB_STATE, STAGE_STATE } from "../job/types.ts";
import type { JobError, JobGates, JobStageId, JobState, JobStatus, StageState } from "../job/types.ts";
import { formatFileSize, formatNumber } from "@/core/common/ValueFormatter";

const STAGE_LABELS: Readonly<Record<JobStageId, string>> = {
  [JOB_STAGE.COPYING_FILE]: "Copiando el archivo",
  [JOB_STAGE.READING]: "Leyendo el SHP",
  [JOB_STAGE.STAGING]: "Cargando a la tabla de trabajo",
  [JOB_STAGE.SUBDIVIDING]: "Subdividiendo geometrías",
  [JOB_STAGE.REPAIRING]: "Reparando geometrías",
  [JOB_STAGE.SWAPPING]: "Reemplazando la tabla",
  [JOB_STAGE.FINALIZING]: "Finalizando",
};

const STATE_LABELS: Readonly<Record<JobState, string>> = {
  [JOB_STATE.UPLOADING]: "Subiendo",
  [JOB_STATE.READY]: "Lista",
  [JOB_STATE.RUNNING]: "En curso",
  [JOB_STATE.CANCELLING]: "Cancelando",
  [JOB_STATE.SUCCEEDED]: "Completada",
  [JOB_STATE.FAILED]: "Con error",
  [JOB_STATE.CANCELLED]: "Cancelada",
};

const STAGE_STATE_LABELS: Readonly<Record<StageState, string>> = {
  [STAGE_STATE.PENDING]: "Pendiente",
  [STAGE_STATE.RUNNING]: "En curso",
  [STAGE_STATE.DONE]: "Listo",
  [STAGE_STATE.SKIPPED]: "Omitido",
  [STAGE_STATE.FAILED]: "Con error",
};

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const PERCENT = 100;
const PAD_WIDTH = 2;

export function stageLabel(stage: JobStageId): string {
  return STAGE_LABELS[stage];
}

export function jobStateLabel(state: JobState): string {
  return STATE_LABELS[state];
}

export function stageStateLabel(state: StageState): string {
  return STAGE_STATE_LABELS[state];
}

export function overallPercent(status: JobStatus | null): number {
  return status === null ? 0 : Math.round(status.progress.overallFraction * PERCENT);
}

export function currentPhaseLabel(status: JobStatus | null): string {
  if (status === null) return "Iniciando la carga";
  return status.stage === null ? jobStateLabel(status.state) : stageLabel(status.stage);
}

/** Time the job has been running as of its last write (the clock stops when the job ends). */
export function elapsedMs(status: JobStatus | null): number {
  if (status === null || status.startedAt === null) return 0;
  return Math.max(0, Date.parse(status.updatedAt) - Date.parse(status.startedAt));
}

function pad(value: number): string {
  return String(value).padStart(PAD_WIDTH, "0");
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function stagePercent(status: JobStatus): number {
  return Math.round(status.progress.stageFraction * PERCENT);
}

/** What the running phase is counting, in words; null when the phase reports no count. */
export function phaseDetail(status: JobStatus): string | null {
  const { progress } = status;
  switch (status.stage) {
    case JOB_STAGE.READING:
    case JOB_STAGE.STAGING:
      return progress.bytesTotal > 0 ? `Leído ${formatFileSize(progress.bytesRead)} de ${formatFileSize(progress.bytesTotal)}` : null;
    case JOB_STAGE.SUBDIVIDING:
      return progress.piecesTotal > 0 ? `${formatNumber(progress.piecesTotal)} piezas generadas` : null;
    case JOB_STAGE.REPAIRING:
      return progress.piecesTotal > 0 ? `${formatNumber(progress.piecesRepaired)} de ${formatNumber(progress.piecesTotal)} piezas reparadas` : null;
    default:
      return null;
  }
}

export const FAILURE_CODE_VIEW = {
  DB_CONNECT_FAILED: "DB_CONNECT_FAILED",
  DB_CONNECTION_LOST: "DB_CONNECTION_LOST",
  TABLE_LOCKED: "TABLE_LOCKED",
  LOCK_ERROR: "LOCK_ERROR",
  GATE_FAILED: "GATE_FAILED",
  PIPELINE_ERROR: "PIPELINE_ERROR",
  SHP_EMPTY: "SHP_EMPTY",
  SHP_INVALID: "SHP_INVALID",
  STAGE_MISMATCH: "STAGE_MISMATCH",
  SWAP_MISMATCH: "SWAP_MISMATCH",
  STATEMENT_TIMEOUT: "STATEMENT_TIMEOUT",
  LOCK_TIMEOUT: "LOCK_TIMEOUT",
  PRIVILEGE_DENIED: "PRIVILEGE_DENIED",
  SERVER_RESOURCES: "SERVER_RESOURCES",
  JOB_CRASHED: "JOB_CRASHED",
  FORCE_KILLED: "FORCE_KILLED",
} as const;

const FAILURE_TITLES: Readonly<Record<string, string>> = {
  [FAILURE_CODE_VIEW.DB_CONNECT_FAILED]: "No se pudo conectar a la base de datos. La tabla no fue modificada.",
  [FAILURE_CODE_VIEW.DB_CONNECTION_LOST]: "Se perdió la conexión con la base de datos durante la carga.",
  [FAILURE_CODE_VIEW.TABLE_LOCKED]: "Otra carga de esta tabla está en curso; esta no se ejecutó. La tabla no fue modificada.",
  [FAILURE_CODE_VIEW.LOCK_ERROR]: "No se pudo tomar el bloqueo de la tabla. La tabla no fue modificada.",
  [FAILURE_CODE_VIEW.GATE_FAILED]: "La carga se detuvo: el archivo no pasó las verificaciones de calidad. La tabla no fue modificada.",
  [FAILURE_CODE_VIEW.PIPELINE_ERROR]: "La carga falló por un error inesperado.",
  [FAILURE_CODE_VIEW.SHP_EMPTY]: "El archivo SHP no contiene registros.",
  [FAILURE_CODE_VIEW.SHP_INVALID]: "El archivo SHP no es válido.",
  [FAILURE_CODE_VIEW.STAGE_MISMATCH]: "Las filas cargadas a la tabla de trabajo no coinciden con las del archivo.",
  [FAILURE_CODE_VIEW.SWAP_MISMATCH]: "El reemplazo no coincidió con lo esperado y se revirtió. La tabla conserva sus datos anteriores.",
  [FAILURE_CODE_VIEW.STATEMENT_TIMEOUT]: "Una operación superó el tiempo máximo permitido.",
  [FAILURE_CODE_VIEW.LOCK_TIMEOUT]: "La tabla está en uso por otra sesión; el reemplazo no se realizó.",
  [FAILURE_CODE_VIEW.PRIVILEGE_DENIED]: "El usuario de la base de datos no tiene privilegios suficientes.",
  [FAILURE_CODE_VIEW.SERVER_RESOURCES]: "El servidor de base de datos se quedó sin recursos.",
  [FAILURE_CODE_VIEW.JOB_CRASHED]: "El proceso de carga terminó de forma inesperada.",
  [FAILURE_CODE_VIEW.FORCE_KILLED]: "El proceso de carga fue detenido a la fuerza.",
};

const FAILED_FALLBACK_TITLE = "La carga falló.";

export interface FailureView {
  readonly title: string;
  /** The server's own message (already scrubbed); carries the gate reasons for GATE_FAILED. */
  readonly detail: string | null;
}

export function describeFailure(error: JobError | null): FailureView {
  if (error === null) return { title: FAILED_FALLBACK_TITLE, detail: null };
  const title = FAILURE_TITLES[error.code] ?? FAILED_FALLBACK_TITLE;
  const stageText = error.stage === null ? "" : ` (fase: ${stageLabel(error.stage)})`;
  return { title: `${title}${stageText}`, detail: error.message.length > 0 ? error.message : null };
}

const MAX_PIECE_VERTICES = 1024;
const MAX_AREA_RELATIVE_DIFF = 1e-6;

export interface GateRow {
  readonly label: string;
  readonly value: string;
  readonly passed: boolean;
}

export function gateRows(gates: JobGates): GateRow[] {
  return [
    { label: "Filas en la tabla de trabajo", value: formatNumber(gates.stagingRows), passed: gates.stagingRows > 0 },
    { label: `Vértices máximos por pieza (límite ${MAX_PIECE_VERTICES})`, value: formatNumber(gates.maxVertices), passed: gates.maxVertices <= MAX_PIECE_VERTICES },
    { label: "Piezas inválidas", value: formatNumber(gates.invalidPieces), passed: gates.invalidPieces === 0 },
    { label: "Diferencia relativa de área", value: gates.areaRelativeDiff.toExponential(2), passed: gates.areaRelativeDiff <= MAX_AREA_RELATIVE_DIFF },
  ];
}
