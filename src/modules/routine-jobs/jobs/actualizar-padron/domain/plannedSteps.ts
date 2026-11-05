// Same planned-step API names as cargar-padrones/domain/plannedSteps.ts: each job imports its own module by path.
// fallow-ignore-file duplicate-export
import type { AddressMasterPassSteps } from "../../shared/addressMasterLinkPass";

export const STEP = {
  VALIDATE: "Validar tablas y columnas",
  TARGET: "Validar tabla de destino",
  COUNT: "Contar filas de staging",
  RESOLVE: "Resolver provincias y localidades",
  CLASSIFY: "Clasificar padrones",
  SEQUENCES: "Ajustar secuencias de destino",
  APPLY: "Aplicar cambios de padrones",
  REASSIGN: "Reasignar direcciones de padrones subdivididos",
  REASSIGN_CHANGED: "Reasignar direcciones de padrones modificados",
  DELETE: "Eliminar padrones faltantes sin referencias",
  ADDRESS_SEQUENCES: "Ajustar secuencia de direcciones maestras",
  ADDRESS_CLASSIFY: "Clasificar padrones sin dirección maestra",
  ADDRESS_APPLY: "Crear y enlazar direcciones maestras de padrones",
  ADDRESS_VERIFY: "Verificar padrones pendientes",
  ANALYZE: "Analizar tabla de destino",
  REPORT: "Generar informe",
  BACKUP: "Generar respaldo para revertir",
  COMMIT: "Confirmar cambios",
  ROLLBACK: "Revertir cambios de la simulación",
} as const;

export type StepLabel = (typeof STEP)[keyof typeof STEP];

export const ADDRESS_MASTER_PASS_STEPS: AddressMasterPassSteps = {
  classify: STEP.ADDRESS_CLASSIFY,
  apply: STEP.ADDRESS_APPLY,
  verify: STEP.ADDRESS_VERIFY,
};

export interface PlannedStepsInput {
  dryRun: boolean;
  linkAddressMaster?: boolean;
  repairSequences: boolean;
}

const ANALYSIS_STEPS = (linkAddressMaster: boolean): StepLabel[] => [
  STEP.VALIDATE,
  STEP.TARGET,
  STEP.COUNT,
  STEP.RESOLVE,
  STEP.CLASSIFY,
  ...(linkAddressMaster ? [STEP.ADDRESS_CLASSIFY] : []),
  STEP.REPORT,
];

const WRITE_STEPS = (linkAddressMaster: boolean, repairSequences: boolean): StepLabel[] => [
  STEP.VALIDATE,
  STEP.TARGET,
  STEP.COUNT,
  STEP.RESOLVE,
  STEP.CLASSIFY,
  ...(repairSequences ? [STEP.SEQUENCES] : []),
  STEP.APPLY,
  STEP.REASSIGN,
  STEP.REASSIGN_CHANGED,
  STEP.DELETE,
  ...(linkAddressMaster
    ? [...(repairSequences ? [STEP.ADDRESS_SEQUENCES] : []), STEP.ADDRESS_CLASSIFY, STEP.ADDRESS_APPLY, STEP.ADDRESS_VERIFY]
    : []),
  STEP.ANALYZE,
  STEP.REPORT,
  STEP.BACKUP,
  STEP.COMMIT,
];

/** An analysis is read-only: no sequence repair, apply, ANALYZE, backup or rollback step. */
export function plannedStepLabels({ dryRun, linkAddressMaster = false, repairSequences }: PlannedStepsInput): StepLabel[] {
  return dryRun ? ANALYSIS_STEPS(linkAddressMaster) : WRITE_STEPS(linkAddressMaster, repairSequences);
}
