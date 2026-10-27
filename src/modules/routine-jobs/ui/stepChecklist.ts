import { plannedStepLabels, STEP, type StepLabel } from "../jobs/cargar-padrones/domain/plannedSteps";
import { plannedStepLabels as actualizarPlannedStepLabels } from "../jobs/actualizar-padron/domain/plannedSteps";
import { plannedLocalityStepLabels as localidadesPlannedStepLabels } from "../jobs/cargar-localidades/domain/plannedSteps";
import type { CargarPadronesRunPlan } from "./cargarPadronesRunStore";
import type { ActualizarPadronRunPlan } from "./actualizarPadronRunStore";
import type { CargarLocalidadesRunPlan } from "./cargarLocalidadesRunStore";
import { RunPhase } from "./jobRunStore";

const STEP_LABEL_VALUES: ReadonlySet<string> = new Set<string>(Object.values(STEP));

const STEP_UI_LABEL: Record<StepLabel, string> = {
  [STEP.VALIDATE]: "Validar tablas",
  [STEP.COUNT]: "Contar filas de origen",
  [STEP.PRIVILEGES]: "Comprobar privilegios de vaciado",
  [STEP.CLEAR]: "Vaciar la tabla destino",
  [STEP.SEQUENCES_RESET]: "Reiniciar secuencias",
  [STEP.LOAD_RURAL]: "Cargar padrones rurales",
  [STEP.LOAD_URBANO]: "Cargar padrones urbanos",
  [STEP.REPORT]: "Generar informe y muestras",
  [STEP.SEQUENCES_REPAIR]: "Ajustar secuencias",
  [STEP.COMMIT]: "Confirmar la carga",
  [STEP.ANALYZE]: "Actualizar estadísticas (ANALYZE)",
};

export const ChecklistStatus = {
  DONE: "done",
  CURRENT: "current",
  PENDING: "pending",
  FAILED: "failed",
  UNKNOWN: "unknown",
} as const;

export type ChecklistStatus = (typeof ChecklistStatus)[keyof typeof ChecklistStatus];

export interface ChecklistRow {
  label: string;
  status: ChecklistStatus;
}

export interface StepChecklistInput {
  plannedLabels: readonly string[];
  currentLabel: string | null;
  phase: RunPhase;
}

export type RunPlan = CargarPadronesRunPlan | ActualizarPadronRunPlan | CargarLocalidadesRunPlan;

export interface PlannedLabelsSource {
  steps?: readonly string[];
  plan?: RunPlan;
}

const isStepLabel = (label: string): label is StepLabel => STEP_LABEL_VALUES.has(label);

const uiLabelOf = (label: string): string => (isStepLabel(label) ? STEP_UI_LABEL[label] : label);

const labelsOfPlan = (plan: RunPlan): readonly string[] => {
  if ("clearMode" in plan) return actualizarPlannedStepLabels(plan);
  if ("tables" in plan) return localidadesPlannedStepLabels(plan);
  return plannedStepLabels(plan);
};

export function resolvePlannedLabels({ steps, plan }: PlannedLabelsSource): readonly string[] {
  if (steps && steps.length > 0) return steps;
  return plan ? labelsOfPlan(plan) : [];
}

function activeStatusOf(phase: RunPhase): ChecklistStatus {
  switch (phase) {
    case RunPhase.FAILED:
      return ChecklistStatus.FAILED;
    case RunPhase.UNKNOWN:
      return ChecklistStatus.UNKNOWN;
    default:
      return ChecklistStatus.CURRENT;
  }
}

function statusAtIndex(index: number, currentIndex: number, phase: RunPhase): ChecklistStatus {
  if (index < currentIndex) return ChecklistStatus.DONE;
  if (index === currentIndex) return activeStatusOf(phase);
  return ChecklistStatus.PENDING;
}

export function buildStepChecklist({ plannedLabels, currentLabel, phase }: StepChecklistInput): ChecklistRow[] {
  if (phase === RunPhase.DONE) {
    return plannedLabels.map((label) => ({ label: uiLabelOf(label), status: ChecklistStatus.DONE }));
  }
  const currentIndex = currentLabel === null ? -1 : plannedLabels.findIndex((label) => label === currentLabel);
  const rows = plannedLabels.map((label, index) => ({
    label: uiLabelOf(label),
    status: currentIndex === -1 ? ChecklistStatus.PENDING : statusAtIndex(index, currentIndex, phase),
  }));
  if (currentLabel === null || currentIndex !== -1) return rows;
  return [...rows, { label: currentLabel, status: activeStatusOf(phase) }];
}
