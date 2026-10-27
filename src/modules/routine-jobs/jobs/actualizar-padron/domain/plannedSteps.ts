import { CLEAR_MODE, type ClearMode } from "../../cargar-padrones/constants";

export const STEP = {
  VALIDATE: "Validar tablas y columnas",
  COUNT: "Contar filas de staging",
  PRIVILEGES: "Comprobar privilegios de vaciado",
  CLEAR: "Vaciar tabla de trabajo",
  RESOLVE: "Resolver provincias y localidades",
  LOAD: "Cargar tabla de trabajo",
  ANALYZE: "Analizar tabla de trabajo",
  REPORT: "Generar informe",
  COMMIT: "Confirmar cambios",
  ROLLBACK: "Revertir cambios de la simulación",
} as const;

export type StepLabel = (typeof STEP)[keyof typeof STEP];

export interface PlannedStepsInput {
  dryRun: boolean;
  clearMode: ClearMode;
}

export function plannedStepLabels({ dryRun, clearMode }: PlannedStepsInput): StepLabel[] {
  const labels: StepLabel[] = [STEP.VALIDATE, STEP.COUNT];
  if (clearMode === CLEAR_MODE.TRUNCATE) labels.push(STEP.PRIVILEGES);
  labels.push(STEP.CLEAR, STEP.RESOLVE, STEP.LOAD, STEP.ANALYZE, STEP.REPORT);
  labels.push(dryRun ? STEP.ROLLBACK : STEP.COMMIT);
  return labels;
}
