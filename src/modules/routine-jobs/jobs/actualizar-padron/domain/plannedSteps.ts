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
}

export function plannedStepLabels({ dryRun, linkAddressMaster = false }: PlannedStepsInput): StepLabel[] {
  return [
    STEP.VALIDATE,
    STEP.TARGET,
    STEP.COUNT,
    STEP.RESOLVE,
    STEP.CLASSIFY,
    STEP.SEQUENCES,
    STEP.APPLY,
    ...(linkAddressMaster ? [STEP.ADDRESS_SEQUENCES, STEP.ADDRESS_CLASSIFY, STEP.ADDRESS_APPLY, STEP.ADDRESS_VERIFY] : []),
    STEP.ANALYZE,
    STEP.REPORT,
    ...(dryRun ? [STEP.ROLLBACK] : [STEP.BACKUP, STEP.COMMIT]),
  ];
}
