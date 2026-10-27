import { CLEAR_MODE } from "../constants";
import type { LoadOptions } from "./loadSql";

export const STEP = {
  VALIDATE: "Validación de tablas",
  COUNT: "Conteo de filas",
  PRIVILEGES: "Privilegios de vaciado",
  CLEAR: "Vaciado de la tabla destino",
  SEQUENCES_RESET: "Reinicio de secuencias",
  LOAD_RURAL: "Carga rural",
  LOAD_URBANO: "Carga urbana",
  REPORT: "Reportes y muestras",
  SEQUENCES_REPAIR: "Ajuste de secuencias",
  COMMIT: "COMMIT",
  ANALYZE: "ANALYZE",
} as const;

export type StepLabel = (typeof STEP)[keyof typeof STEP];

export interface PlannedStepsInput {
  dryRun: boolean;
  options: Pick<LoadOptions, "clearMode" | "resetSequences">;
}

export function plannedStepLabels({ dryRun, options }: PlannedStepsInput): StepLabel[] {
  const sequences = options.resetSequences && !dryRun;
  const labels: StepLabel[] = [STEP.VALIDATE, STEP.COUNT];
  if (options.clearMode === CLEAR_MODE.TRUNCATE) labels.push(STEP.PRIVILEGES);
  labels.push(STEP.CLEAR);
  if (sequences) labels.push(STEP.SEQUENCES_RESET);
  labels.push(STEP.LOAD_RURAL, STEP.LOAD_URBANO, STEP.REPORT);
  if (sequences) labels.push(STEP.SEQUENCES_REPAIR);
  if (!dryRun) labels.push(STEP.COMMIT, STEP.ANALYZE);
  return labels;
}
