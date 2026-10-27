import { plannedStepLabels, STEP, type StepLabel } from "../jobs/cargar-padrones/domain/plannedSteps";
import { CargarPadronesRunPhase, type CargarPadronesRunPlan } from "./cargarPadronesRunStore";

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
  phase: CargarPadronesRunPhase;
}

export interface PlannedLabelsSource {
  steps?: readonly string[];
  plan?: CargarPadronesRunPlan;
}

const isStepLabel = (label: string): label is StepLabel => STEP_LABEL_VALUES.has(label);

const uiLabelOf = (label: string): string => (isStepLabel(label) ? STEP_UI_LABEL[label] : label);

export function resolvePlannedLabels({ steps, plan }: PlannedLabelsSource): readonly string[] {
  if (steps && steps.length > 0) return steps;
  return plan ? plannedStepLabels(plan) : [];
}

function activeStatusOf(phase: CargarPadronesRunPhase): ChecklistStatus {
  switch (phase) {
    case CargarPadronesRunPhase.FAILED:
      return ChecklistStatus.FAILED;
    case CargarPadronesRunPhase.UNKNOWN:
      return ChecklistStatus.UNKNOWN;
    default:
      return ChecklistStatus.CURRENT;
  }
}

function statusAtIndex(index: number, currentIndex: number, phase: CargarPadronesRunPhase): ChecklistStatus {
  if (index < currentIndex) return ChecklistStatus.DONE;
  if (index === currentIndex) return activeStatusOf(phase);
  return ChecklistStatus.PENDING;
}

export function buildStepChecklist({ plannedLabels, currentLabel, phase }: StepChecklistInput): ChecklistRow[] {
  if (phase === CargarPadronesRunPhase.DONE) {
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
